// [feat/free-credit-grants] Test migracji 20260927120000_free_credit_grants na lokalnym embedded
// PostgreSQL (127.0.0.1:54329, jak pozostałe runnery):
//   faza 1: pusta baza, shim Supabase, wszystkie migracje, nowa migracja drugi raz (idempotencja),
//           test SQL w transakcji ROLLBACK;
//   faza 2: RÓWNOLEGŁOŚĆ na osobnych połączeniach (prawdziwe transakcje, nie sekwencja):
//           a) dwa odczyty dwóch propozycji walczą o OSTATNI kredyt → dokładnie jedno pobranie,
//           b) dwa odczyty TEJ SAMEJ propozycji → jedno pobranie, drugie already_charged,
//           c) dwa przyznania z tym samym kluczem idempotencji → jedna partia, jeden komplet pakietów.
// Baza tymczasowa usuwana na końcu. Nigdy nie kieruj tego na produkcję.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
const opts = { host: "127.0.0.1", port: 54329, user: "postgres", password: "pw" };
const name = "free_credit_grants_test_" + Date.now();
const root = new pg.Client({ ...opts, database: "postgres" });
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const ok = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok   " + msg); };
let db, created = false, clients = [];
try {
  await root.connect(); await root.query("create database " + name); created = true;
  db = new pg.Client({ ...opts, database: name }); await db.connect();
  await db.query(read("supabase/tests/000_supabase_shim.sql"));
  const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await db.query("begin;" + read("supabase/migrations/" + f) + ";commit;");
  await db.query(read("supabase/migrations/20260927120000_free_credit_grants.sql"));
  const res = await db.query(read("supabase/tests/free_credit_grants_test.sql"));
  console.log(res.map((r) => r.rows?.[0]?.result).filter(Boolean).join("\n"));

  // ── faza 2: równoległość ──────────────────────────────────────────────────
  const ADMIN = "11111111-1111-4111-8111-111111111111";
  const CO = "22222222-2222-4222-8222-222222222222";
  await db.query(`
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
    values ('${ADMIN}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@conc.test','',now(),now(),now(),'{"role":"admin"}','{}');
    update public.profiles set role='admin' where id='${ADMIN}';
    insert into public.companies(id,name,account_status,preconnect_enabled,legacy_supplier_id) values ('${CO}','Concurrency co','active',true,'legacy-conc');
    insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values
      ('33333333-3333-4333-8333-333333333331',990101,'legacy-conc',1,'sent','{}'),
      ('33333333-3333-4333-8333-333333333332',990102,'legacy-conc',1,'sent','{}'),
      ('33333333-3333-4333-8333-333333333333',990103,'legacy-conc',1,'sent','{}');
  `);
  const conn = async () => { const c = new pg.Client({ ...opts, database: name }); await c.connect(); clients.push(c); return c; };
  const [c1, c2] = [await conn(), await conn()];
  const asAdmin = async (c) => { await c.query(`select set_config('request.jwt.claim.sub','${ADMIN}',false), set_config('request.jwt.claims','{"sub":"${ADMIN}","role":"authenticated"}',false)`); };
  await asAdmin(c1); await asAdmin(c2);

  // c) dwa przyznania z tym samym kluczem — równolegle
  const grant = (c) => c.query(`select public.admin_grant_free_credits(array['${CO}']::uuid[],1,'gift','conc-key-00000001','wiadomość','notatka') as r`).then((r) => r.rows[0].r);
  const [g1, g2] = await Promise.all([grant(c1), grant(c2)]);
  const gCreated = [g1, g2].filter((g) => g.created === 1).length, gDone = [g1, g2].filter((g) => g.already_done).length;
  ok(gCreated === 1 && gDone === 1 && g1.batch_id === g2.batch_id, "równoległe przyznanie z tym samym kluczem: jedna partia, drugie = already_done, bez 23505");
  const cnt = await db.query(`select (select count(*) from public.package_grant_batches where idempotency_key='conc-key-00000001')::int as b, (select count(*) from public.packages where company_id='${CO}' and source='grant')::int as p, (select sum(qty_total-qty_used) from public.packages where company_id='${CO}')::int as rem`);
  ok(cnt.rows[0].b === 1 && cnt.rows[0].p === 1 && cnt.rows[0].rem === 1, "po równoległym przyznaniu: 1 partia, 1 pakiet, 1 wolny kredyt");

  // a) dwa odczyty DWÓCH propozycji walczą o ostatni (bezpłatny) kredyt
  const charge = (c, id) => c.query(`select public.charge_legacy_send_first_seen('${id}','${CO}') as r`).then((r) => r.rows[0].r);
  const [a1, a2] = await Promise.all([charge(c1, "33333333-3333-4333-8333-333333333331"), charge(c2, "33333333-3333-4333-8333-333333333332")]);
  const charged = [a1, a2].filter((x) => x.charged), none = [a1, a2].filter((x) => x.billing_status === "no_package_available");
  ok(charged.length === 1 && none.length === 1 && charged[0].package_source === "grant", "ostatni kredyt: dokładnie jedno pobranie, drugi odczyt = no_package_available");
  const after = await db.query(`select (select qty_used from public.packages where company_id='${CO}' and source='grant')::int as used, (select count(*) from public.wallet_tx where type='send_charge' and company_id='${CO}')::int as tx, (select count(*) from public.legacy_sends where supplier_legacy_id='legacy-conc' and data->>'billingStatus'='charged')::int as marked`);
  ok(after.rows[0].used === 1 && after.rows[0].tx === 1 && after.rows[0].marked === 1, "qty_used=1, jeden wallet_tx, jeden znacznik");

  // b) dwa odczyty TEJ SAMEJ propozycji (nowy kredyt) — równolegle
  await db.query(`update public.packages set qty_total = qty_total + 1 where company_id='${CO}' and source='grant'`);
  const [b1, b2] = await Promise.all([charge(c1, "33333333-3333-4333-8333-333333333333"), charge(c2, "33333333-3333-4333-8333-333333333333")]);
  ok([b1, b2].filter((x) => x.charged).length === 1 && [b1, b2].filter((x) => x.already_charged).length === 1, "ta sama propozycja z dwóch sesji: jedno pobranie, drugie already_charged");
  const after2 = await db.query(`select (select qty_used from public.packages where company_id='${CO}' and source='grant')::int as used, (select count(*) from public.wallet_tx where type='send_charge' and company_id='${CO}')::int as tx`);
  ok(after2.rows[0].used === 2 && after2.rows[0].tx === 2, "po dwóch propozycjach: qty_used=2, dwa wallet_tx (nie trzy)");

  // d) ta sama propozycja: odczyt w aplikacji i otwarcie e-maila RÓWNOLEGLE (mark_legacy_send_seen)
  await db.query(`update public.packages set qty_total = qty_total + 1 where company_id='${CO}' and source='grant'`);
  await db.query(`insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values ('33333333-3333-4333-8333-333333333334',990104,'legacy-conc',1,'sent','{"custom":"x"}')`);
  const mark = (c, ch) => c.query(`select public.mark_legacy_send_seen('33333333-3333-4333-8333-333333333334','${CO}','${ch}') as r`).then((r) => r.rows[0].r);
  const [m1, m2] = await Promise.all([mark(c1, "app_list"), mark(c2, "email")]);
  const fin = await db.query(`select status, data, (select qty_used from public.packages where company_id='${CO}' and source='grant')::int as used, (select count(*) from public.wallet_tx where type='send_charge' and company_id='${CO}')::int as tx from public.legacy_sends where legacy_id=990104`);
  const row = fin.rows[0];
  ok(row.status === "read" && row.data.status === "read" && row.data.readAt && row.data.emailOpenedAt && row.data.custom === "x", "równolegle app+email: status read (email nie cofa), readAt i emailOpenedAt oba zapisane, reszta JSON zachowana");
  ok(row.data.billingStatus === "charged" && row.used === 3 && row.tx === 3 && [m1, m2].filter((x) => x.billing.charged).length === 1, "równolegle app+email: dokładnie jedno pobranie, znacznik nienaruszony");
  // e) znacznik powiadomienia równolegle z rozliczeniem tego samego wiersza
  await db.query(`update public.packages set qty_total = qty_total + 1 where company_id='${CO}' and source='grant'`);
  await db.query(`insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values ('33333333-3333-4333-8333-333333333335',990105,'legacy-conc',1,'sent','{"custom":"y"}')`);
  const [n1, s1] = await Promise.all([
    c1.query(`select public.mark_legacy_sends_supplier_notified(array[990105]::bigint[],'app_list',1) as r`).then((r) => r.rows[0].r),
    c2.query(`select public.mark_legacy_send_seen('33333333-3333-4333-8333-333333333335','${CO}','app_list') as r`).then((r) => r.rows[0].r),
  ]);
  const fin2 = await db.query(`select status, data from public.legacy_sends where legacy_id=990105`);
  const r2 = fin2.rows[0];
  ok(n1 === 1 && s1.billing.charged && r2.status === "read" && r2.data.billingStatus === "charged" && r2.data.chargeTxId && r2.data.supplierNotifiedAt && r2.data.readAt && r2.data.custom === "y", "równolegle powiadomienie + odczyt: oba znaczniki na wierszu, rozliczenie nienaruszone");
  console.log("PASS all migrations from empty database; new migration twice; ROLLBACK; concurrency (grant key, last credit, same send, app+email, notify+charge)");
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  for (const c of clients) await c.end().catch(() => {});
  await db?.end();
  if (created) await root.query("drop database " + name + " with (force)");
  await root.end();
}
