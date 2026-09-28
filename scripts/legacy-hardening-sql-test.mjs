// [audyt 28.09, v2 po review Codexa] Test migracji 20260928120000_reminder_job_lockdown i
// 20260928120100_scraper_articles_write_lockdown na lokalnym embedded PostgreSQL (127.0.0.1:54329).
// Obiekty scrapera i crona NIE istnieją w migracjach tego repo → runner:
//   A) pusta baza: wszystkie migracje od zera z `app.allow_missing=on` (obie migracje = tylko NOTICE);
//      bez tej flagi w pustej bazie obie migracje muszą RZUCIĆ (tryb ścisły produkcji);
//   B) atrapy o PIERWOTNYM kształcie i PEŁNYM ACL produkcji (grant all → arwdDxtm dla anon/authenticated):
//      - articles: osobna polityka SELECT + „Service full access articles” (ALL) — jak produkcja,
//      - article_facts: publiczny odczyt TYLKO przez politykę ALL (wariant z review: odczyt musi przetrwać),
//      - article_prices: BEZ publicznego odczytu (tylko ALL dla service_role? nie — bez żadnej: odczyt NIE może zostać dodany),
//      - fm_14d_reminder_job(): SECURITY DEFINER, EXECUTE dla PUBLIC + bezpośrednio anon/authenticated/service_role;
//      dziura potwierdzona → obie migracje dwukrotnie → wszystkie 8 uprawnień tabel per rola (w tym MAINTAIN),
//      widoczność wierszy (nie tylko „SELECT się wykonał”), service_role pisze, postgres/service_role wykonują funkcję.
// Nigdy nie kieruj tego na produkcję.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
const opts = { host: "127.0.0.1", port: 54329, user: "postgres", password: "pw" };
const name = "legacy_hardening_test_" + Date.now();
const root = new pg.Client({ ...opts, database: "postgres" });
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const ok = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok   " + msg); };
const M1 = "supabase/migrations/20260928120000_reminder_job_lockdown.sql";
const M2 = "supabase/migrations/20260928120100_scraper_articles_write_lockdown.sql";
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
let db, created = false;
const asRole = async (c, role) => { await c.query("reset role"); await c.query("set role " + role); };
const tryq = (c, sql) => c.query(sql).then((r) => ({ res: "ok", rows: r.rows }), (e) => ({ res: e.code }));
const privs = async (c, role, t) => { const r = await c.query(`select p from unnest($1::text[]) p where has_table_privilege($2, 'public.' || $3, p)`, [PRIVS, role, t]); return r.rows.map((x) => x.p).sort().join(","); };
try {
  await root.connect(); await root.query("create database " + name); created = true;
  db = new pg.Client({ ...opts, database: name }); await db.connect();
  await db.query(read("supabase/tests/000_supabase_shim.sql"));
  const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  await db.query("set app.allow_missing = 'on'");
  for (const f of files) await db.query("begin;" + read("supabase/migrations/" + f) + ";commit;");
  ok(true, "A) wszystkie migracje od zera z app.allow_missing=on (obie migracje utwardzające = NOTICE)");
  await db.query("reset app.allow_missing");
  const s1 = await db.query(read(M1)).then(() => "ok", (e) => e.message); await db.query("rollback").catch(() => {});
  const s2 = await db.query(read(M2)).then(() => "ok", (e) => e.message); await db.query("rollback").catch(() => {});
  ok(/brak public\.fm_14d_reminder_job/.test(s1) && /brak tabeli public\.articles/.test(s2), "A) tryb ścisły: w bazie bez obiektów obie migracje przerywają z jasnym błędem (nie udają wdrożenia)");

  // ── B) atrapy jak produkcja ──
  await db.query(`
    create table public.articles (id bigserial primary key, title text, status text default 'new');
    create table public.article_facts (id bigserial primary key, article_id bigint, fact text);
    create table public.article_prices (id bigserial primary key, article_id bigint, price numeric);
    alter table public.articles enable row level security;
    alter table public.article_facts enable row level security;
    alter table public.article_prices enable row level security;
    create policy "anon_read_articles" on public.articles for select using (true);
    create policy "Service full access articles" on public.articles for all using (true) with check (true);
    create policy "service_full_facts" on public.article_facts for all using (true) with check (true);          -- odczyt publiczny TYLKO przez ALL
    create policy "svc_only_prices" on public.article_prices for all to service_role using (true) with check (true); -- BEZ publicznego odczytu
    grant all on public.articles, public.article_facts, public.article_prices to anon, authenticated, service_role;
    grant usage, select on all sequences in schema public to anon, authenticated, service_role;
    insert into public.articles(title) values ('istniejący');
    insert into public.article_facts(article_id, fact) values (1, 'fakt');
    insert into public.article_prices(article_id, price) values (1, 9.5);
    create table public.reminder_calls (at timestamptz default now());
    create function public.fm_14d_reminder_job() returns void language sql security definer as $$ insert into public.reminder_calls default values $$;
    grant execute on function public.fm_14d_reminder_job() to public, anon, authenticated, service_role;
  `);
  await asRole(db, "anon");
  ok((await tryq(db, "insert into public.articles(title) values ('anon-before')")).res === "ok", "B) przed: anon wstawia artykuł (dziura potwierdzona)");
  ok((await tryq(db, "select public.fm_14d_reminder_job()")).res === "ok", "B) przed: anon woła fm_14d_reminder_job (dziura potwierdzona)");
  ok((await privs(db, "anon", "articles")) === PRIVS.slice().sort().join(","), "B) przed: anon ma pełne ACL (arwdDxtm, w tym MAINTAIN)");
  const factsBefore = (await tryq(db, "select count(*)::int c from public.article_facts")).rows[0].c;
  await db.query("reset role");

  // ── obie migracje, dwukrotnie (tryb ścisły) ──
  for (const m of [M1, M2, M1, M2]) await db.query(read(m));
  ok(true, "obie migracje zastosowane dwukrotnie w trybie ścisłym bez błędu");

  const pols = await db.query(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname='public' and tablename in ('articles','article_facts','article_prices') order by 1,2`);
  const write = pols.rows.filter((r) => r.cmd !== "SELECT");
  const perTable = Object.fromEntries(["articles", "article_facts", "article_prices"].map((t) => [t, write.filter((r) => r.tablename === t).length]));
  ok(write.every((r) => r.roles === "{service_role}") && Object.values(perTable).every((n) => n >= 1) && perTable.articles === 1 && perTable.article_facts === 1, "polityki zapisu: wszystkie {service_role}; istniejąca polityka service_role (article_prices) zachowana obok nowej");
  const sel = Object.fromEntries(["articles", "article_facts", "article_prices"].map((t) => [t, pols.rows.filter((r) => r.tablename === t && r.cmd === "SELECT").map((r) => r.policyname)]));
  ok(sel.articles.length === 1 && sel.articles[0] === "anon_read_articles", "articles: istniejąca polityka SELECT zachowana bez zmian");
  ok(sel.article_facts.length === 1 && sel.article_facts[0] === "anon_read_article_facts", "article_facts: odczyt był tylko przez ALL → odtworzony jako anon_read_article_facts");
  ok(sel.article_prices.length === 0, "article_prices: nie miała publicznego odczytu → żadna polityka SELECT NIE została dodana");

  for (const role of ["anon", "authenticated"]) {
    await asRole(db, role);
    ok((await privs(db, role, "articles")) === "SELECT" && (await privs(db, role, "article_facts")) === "SELECT", role + ": na articles/article_facts wyłącznie SELECT (MAINTAIN i reszta odebrane)");
    ok((await privs(db, role, "article_prices")) === "", role + ": na article_prices żadnych uprawnień (bez publicznego odczytu)");
    ok((await tryq(db, "select count(*)::int c from public.articles")).rows[0].c >= 1, role + ": widzi wiersze articles");
    ok((await tryq(db, "select count(*)::int c from public.article_facts")).rows[0].c === factsBefore, role + ": nadal widzi " + factsBefore + " wiersz article_facts (regresja RLS wykluczona)");
    ok((await tryq(db, "select count(*) from public.article_prices")).res === "42501", role + ": article_prices niedostępne (42501)");
    ok((await tryq(db, "insert into public.articles(title) values ('x')")).res === "42501", role + ": INSERT articles 42501");
    ok((await tryq(db, "update public.article_facts set fact='y'")).res === "42501", role + ": UPDATE article_facts 42501");
    ok((await tryq(db, "delete from public.articles")).res === "42501", role + ": DELETE articles 42501");
    ok((await tryq(db, "select public.fm_14d_reminder_job()")).res === "42501", role + ": fm_14d_reminder_job 42501");
    await db.query("reset role");
  }
  await asRole(db, "service_role");
  ok((await privs(db, "service_role", "articles")) === PRIVS.slice().sort().join(","), "service_role: pełne ACL na articles");
  ok((await tryq(db, "insert into public.articles(title) values ('scraper')")).res === "ok" && (await tryq(db, "update public.article_prices set price=1")).res === "ok" && (await tryq(db, "insert into public.article_facts(article_id,fact) values (1,'f2')")).res === "ok", "service_role: zapis na 3 tabelach działa (scraper/Netlify)");
  ok((await tryq(db, "select public.fm_14d_reminder_job()")).res === "ok", "service_role: fm_14d_reminder_job wykonywalna (Edge/serwer)");
  await db.query("reset role");
  const before = (await db.query("select count(*)::int c from public.reminder_calls")).rows[0].c;
  await db.query("select public.fm_14d_reminder_job()");
  ok((await db.query("select count(*)::int c from public.reminder_calls")).rows[0].c === before + 1, "postgres (pg_cron): fm_14d_reminder_job wykonywalna");
  const fp = await db.query(`select has_function_privilege('anon','public.fm_14d_reminder_job()','execute') a, has_function_privilege('authenticated','public.fm_14d_reminder_job()','execute') b, has_function_privilege('service_role','public.fm_14d_reminder_job()','execute') s`);
  ok(fp.rows[0].a === false && fp.rows[0].b === false && fp.rows[0].s === true, "has_function_privilege: anon=f, authenticated=f (także przez PUBLIC), service_role=t");
  console.log("PASS legacy hardening v2: strict mode, full ACL incl. MAINTAIN revoked, exact read scope preserved (kept / recreated / not added), rows visible, service_role writes, reminder job locked for client roles");
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await db?.end(); if (created) await root.query("drop database " + name + " with (force)"); await root.end(); }
