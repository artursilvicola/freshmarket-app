// [audyt 28.09] Test migracji 20260928120000_legacy_shared_db_hardening na lokalnym embedded PostgreSQL
// (127.0.0.1:54329, jak pozostałe runnery). Obiekty scrapera i starego crona NIE istnieją w migracjach
// tego repo, więc runner odtwarza je jako atrapy o PIERWOTNYM, dziurawym kształcie (polityki FOR ALL
// USING (true) bez TO; funkcja SECURITY DEFINER z EXECUTE dla PUBLIC), potwierdza dziurę, stosuje
// migrację (dwa razy — idempotencja) i sprawdza:
//   a) anon/authenticated: SELECT działa, INSERT/UPDATE/DELETE odrzucone (RLS + GRANT),
//   b) service_role: pełny zapis działa (scraper Python + funkcje Netlify),
//   c) fm_14d_reminder_job: EXECUTE odebrane anon/authenticated/PUBLIC, wykonanie jako postgres działa,
//   d) pusta baza bez tych obiektów: migracja przechodzi bez błędu (tylko NOTICE).
// Nigdy nie kieruj tego na produkcję.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
const opts = { host: "127.0.0.1", port: 54329, user: "postgres", password: "pw" };
const name = "legacy_hardening_test_" + Date.now();
const root = new pg.Client({ ...opts, database: "postgres" });
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const ok = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok   " + msg); };
const MIG = "supabase/migrations/20260928120000_legacy_shared_db_hardening.sql";
let db, created = false, clients = [];
const asRole = async (c, role) => { await c.query("reset role"); await c.query("set role " + role); };
const tryq = (c, sql) => c.query(sql).then(() => "ok", (e) => e.code);
try {
  await root.connect(); await root.query("create database " + name); created = true;
  db = new pg.Client({ ...opts, database: name }); await db.connect();
  await db.query(read("supabase/tests/000_supabase_shim.sql"));
  const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await db.query("begin;" + read("supabase/migrations/" + f) + ";commit;");
  ok(true, "d) wszystkie migracje od zera (w tym hardening na pustej bazie: NOTICE, bez błędu)");

  // ── atrapy jak w produkcji (supabase_migration_v2.sql scrapera + funkcja crona) ──
  await db.query(`
    create table public.articles (id bigserial primary key, title text, status text default 'new');
    create table public.article_facts (id bigserial primary key, article_id bigint, fact text);
    create table public.article_prices (id bigserial primary key, article_id bigint, price numeric);
    alter table public.articles enable row level security;
    alter table public.article_facts enable row level security;
    alter table public.article_prices enable row level security;
    create policy "anon_read_articles" on public.articles for select using (true);
    create policy "Service full access articles" on public.articles for all using (true) with check (true);
    create policy "anon_read_facts" on public.article_facts for select using (true);
    create policy "service_full_facts" on public.article_facts for all using (true) with check (true);
    create policy "anon_read_prices" on public.article_prices for select using (true);
    create policy "service_full_prices" on public.article_prices for all using (true) with check (true);
    grant select, insert, update, delete on public.articles, public.article_facts, public.article_prices to anon, authenticated;
    grant all on public.articles, public.article_facts, public.article_prices to service_role;
    grant usage, select on all sequences in schema public to anon, authenticated, service_role;
    create table public.reminder_calls (at timestamptz default now());
    create function public.fm_14d_reminder_job() returns void language sql security definer as $$ insert into public.reminder_calls default values $$;
    grant execute on function public.fm_14d_reminder_job() to public;
  `);
  await asRole(db, "anon");
  ok((await tryq(db, "insert into public.articles(title) values ('anon-before')")) === "ok", "przed: anon MOŻE wstawić artykuł (dziura potwierdzona)");
  ok((await tryq(db, "select public.fm_14d_reminder_job()")) === "ok", "przed: anon MOŻE wywołać fm_14d_reminder_job (dziura potwierdzona)");
  await db.query("reset role");

  // ── migracja (dwa razy) ──
  await db.query(read(MIG));
  await db.query(read(MIG));
  ok(true, "migracja utwardzająca zastosowana dwukrotnie bez błędu");

  const pols = await db.query(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname='public' and tablename in ('articles','article_facts','article_prices') order by 1,2`);
  const writePols = pols.rows.filter((r) => r.cmd !== "SELECT");
  ok(writePols.length === 3 && writePols.every((r) => r.roles === "{service_role}"), "polityki zapisu: dokładnie jedna per tabela, tylko {service_role}");
  ok(pols.rows.filter((r) => r.cmd === "SELECT").length === 3, "polityki odczytu publicznego zachowane");

  for (const role of ["anon", "authenticated"]) {
    await asRole(db, role);
    ok((await tryq(db, "select count(*) from public.articles")) === "ok", role + ": SELECT nadal działa");
    ok((await tryq(db, "insert into public.articles(title) values ('x')")) === "42501", role + ": INSERT odrzucony (42501)");
    ok((await tryq(db, "update public.articles set title='y'")) === "42501", role + ": UPDATE odrzucony");
    ok((await tryq(db, "delete from public.article_facts")) === "42501", role + ": DELETE odrzucony");
    ok((await tryq(db, "select public.fm_14d_reminder_job()")) === "42501", role + ": fm_14d_reminder_job bez EXECUTE (42501)");
    await db.query("reset role");
  }
  await asRole(db, "service_role");
  ok((await tryq(db, "insert into public.articles(title) values ('scraper')")) === "ok" && (await tryq(db, "update public.article_prices set price=1")) === "ok", "service_role: zapis działa (scraper/Netlify)");
  await db.query("reset role");
  const before = (await db.query("select count(*)::int c from public.reminder_calls")).rows[0].c;
  await db.query("select public.fm_14d_reminder_job()");
  ok((await db.query("select count(*)::int c from public.reminder_calls")).rows[0].c === before + 1, "postgres (pg_cron): fm_14d_reminder_job nadal wykonywalna");
  const priv = await db.query(`select has_function_privilege('anon','public.fm_14d_reminder_job()','execute') a, has_function_privilege('authenticated','public.fm_14d_reminder_job()','execute') b`);
  ok(priv.rows[0].a === false && priv.rows[0].b === false, "has_function_privilege: anon=f, authenticated=f (także przez PUBLIC)");
  console.log("PASS legacy hardening: articles write = service_role only, public read kept, reminder job not callable by client roles, idempotent, no-op on empty DB");
} catch (e) { console.error(e); process.exitCode = 1; }
finally { for (const c of clients) await c.end().catch(() => {}); await db?.end(); if (created) await root.query("drop database " + name + " with (force)"); await root.end(); }
