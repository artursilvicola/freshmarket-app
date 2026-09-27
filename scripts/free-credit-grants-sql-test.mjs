// [feat/free-credit-grants] Test migracji 20260927120000_free_credit_grants na lokalnym embedded
// PostgreSQL (127.0.0.1:54329, jak pozostałe runnery):
//   faza 1: pusta baza, shim Supabase, wszystkie migracje, nowa migracja drugi raz (idempotencja),
//           test SQL w transakcji ROLLBACK;
//   faza 2: RÓWNOLEGŁOŚĆ na osobnych połączeniach (prawdziwe transakcje, nie sekwencja):
//           a) dwa odczyty dwóch propozycji walczą o OSTATNI kredyt → dokładnie jedno pobranie,
//           b) dwa odczyty TEJ SAMEJ propozycji → jedno pobranie, drugie already_charged,
//           c) dwa przyznania z tym samym kluczem idempotencji → jedna partia, jeden komplet pakietów.
// Baza tymczasowa usuwana na końcu. Nigdy nie kieruj tego na produkcję.
import fs, { readFileSync, readdirSync } from "node:fs";
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
  // ── faza 3: historyczne RPC — równoległość i kontekst zaufany ──────────────
  // f) ten sam klucz z dwóch sesji → jedna partia, drugie already_done, bez 23505
  const HP1 = "44444444-4444-4444-8444-444444444441", HP2 = "44444444-4444-4444-8444-444444444442", HP3 = "44444444-4444-4444-8444-444444444443";
  await db.query(`insert into public.packages(id,company_id,plan,qty_total,qty_used,price_paid,currency,purchased_at,expires_at) values
    ('${HP1}','${CO}','std_5',5,3,0,'EUR','2026-07-02T07:18:42Z','2026-12-31'),
    ('${HP2}','${CO}','std_5',5,0,0,'EUR','2026-07-03T07:18:42Z','2026-12-31'),
    ('${HP3}','${CO}','std_1',1,0,0,'EUR','2026-07-09T10:00:00Z','2026-12-31')`);
  const rec = (c, reason, ids, key) => c.query(`select public.admin_record_historical_grants('${reason}', array[${ids.map((x) => "'" + x + "'").join(",")}]::uuid[], '${key}') as r`).then((r) => r.rows[0].r, (e) => ({ error: e.code }));
  // blokada wiersza trzecim połączeniem, żeby obie sesje weszły równocześnie
  await db.query("begin"); await db.query(`select id from public.packages where id='${HP1}' for update`);
  const hs1 = rec(c1, "registration", [HP1], "hist-same-key-000001"), hs2 = rec(c2, "registration", [HP1], "hist-same-key-000001");
  await new Promise((r) => setTimeout(r, 300)); await db.query("commit");
  const [hr1, hr2] = await Promise.all([hs1, hs2]);
  ok([hr1, hr2].filter((x) => x.recorded === 1).length === 1 && [hr1, hr2].filter((x) => x.already_done).length === 1 && !hr1.error && !hr2.error, "historia: ten sam klucz równolegle → jedno odnotowanie, drugie already_done, bez 23505");
  const hb = await db.query(`select count(*)::int as b from public.package_grant_batches where idempotency_key='hist-same-key-000001'`);
  const hp = await db.query(`select source, grant_reason, qty_total, qty_used from public.packages where id='${HP1}'`);
  ok(hb.rows[0].b === 1 && hp.rows[0].source === "grant" && hp.rows[0].grant_reason === "registration" && hp.rows[0].qty_total === 5 && hp.rows[0].qty_used === 3, "historia: jedna partia, pakiet 5/3 zachowany");
  // g) różne klucze, różne powody, ta sama lista → jedno odnotowanie, drugie odrzucone bez drugiej partii i bez nadpisania
  await db.query("begin"); await db.query(`select id from public.packages where id='${HP2}' for update`);
  const ht1 = rec(c1, "registration", [HP2], "hist-race-a-000001"), ht2 = rec(c2, "compensation", [HP2], "hist-race-b-000001");
  await new Promise((r) => setTimeout(r, 300)); await db.query("commit");
  const [hq1, hq2] = await Promise.all([ht1, ht2]);
  const okOne = [hq1, hq2].filter((x) => x.recorded === 1).length === 1, rejected = [hq1, hq2].filter((x) => x.error === "22023" || x.error === "40001").length === 1;
  const hp2 = await db.query(`select source, grant_reason, (select count(*)::int from public.package_grant_batches where idempotency_key in ('hist-race-a-000001','hist-race-b-000001')) as b, (select count(*)::int from public.wallet_tx where meta->>'kind'='historical_grant_record' and reference_id='${HP2}') as tx from public.packages where id='${HP2}'`);
  const winner = hq1.recorded === 1 ? "registration" : "compensation";
  ok(okOne && rejected && hp2.rows[0].grant_reason === winner && hp2.rows[0].b === 1 && hp2.rows[0].tx === 1, "historia: sprzeczne powody równolegle → jedno odnotowanie, drugie 22023, jedna partia, bez nadpisania (" + winner + ")");
  // h) kontekst zaufany: rola 'authenticator' (jak PostgREST) bez sub → 42501 mimo podania admina; z sub admina → OK
  await root.query(`drop role if exists authenticator_test`).catch(() => {});
  await db.query(`create role authenticator_test login password 'pw' noinherit; grant authenticated to authenticator_test; grant usage on schema public to authenticator_test;`);
  const ca = new pg.Client({ ...opts, user: "authenticator_test", password: "pw", database: name }); await ca.connect(); clients.push(ca);
  await ca.query("set role authenticated");
  const noSub = await ca.query(`select public.admin_record_historical_grants('legacy', array['${HP3}']::uuid[], 'hist-auth-000001', null, '${ADMIN}') as r`).then(() => "ok", (e) => e.code);
  ok(noSub === "42501", "historia: rola authenticated bez sub (PostgREST) → 42501, p_recorded_by nie jest dowodem uprawnień");
  await ca.query(`select set_config('request.jwt.claim.sub','${ADMIN}',false), set_config('request.jwt.claims','{"sub":"${ADMIN}","role":"authenticated"}',false)`);
  const withSub = await ca.query(`select public.admin_record_historical_grants('legacy', array['${HP3}']::uuid[], 'hist-auth-000002') as r`).then((r) => r.rows[0].r, (e) => ({ error: e.code }));
  ok(withSub.recorded === 1, "historia: authenticated z sub admina → odnotowane (legacy)");
  await ca.end(); clients.splice(clients.indexOf(ca), 1);

  // ── faza 4: pliki uzgodnienia na archiwum 23.09 (schemat SPRZED migracji → zapis PO) ──
  const arch = "C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/outputs/";
  const A = read("docs/production/sql/HISTORYCZNE_KREDYTY_2026-09-27_UZGODNIENIE.sql");
  const B = read("docs/production/sql/HISTORYCZNE_KREDYTY_2026-09-27_ZAPIS.sql");
  const liveFile = arch + "kredyty-produkcja-odczyt-2026-09-27.json", archFile = arch + "kredyty-preconnect-po-2026-09-23.json";
  if (fs.existsSync(liveFile) || fs.existsSync(archFile)) {
    const po = fs.existsSync(liveFile) ? JSON.parse(fs.readFileSync(liveFile, "utf8")).packages : JSON.parse(fs.readFileSync(archFile, "utf8")).data.packages_after;
    // Artur confirmed only the original 75 registration gifts. The additional
    // 33 std_5 packages have an unconfirmed reason and must stay neutral.
    const confirmedRegistration = new Set(JSON.parse(fs.readFileSync(archFile, "utf8")).data.packages_after
      .filter((p) => p.plan === "std_5" && Number(p.qty_total) === 5 && Number(p.price_paid) === 0 && !p.payment_ref)
      .map((p) => p.id));
    const isReg = (p) => confirmedRegistration.has(p.id);
    const isComp = (p) => String(p.payment_ref || "").startsWith("compensation:fm2026:");
    const isLeg = (p) => !isReg(p) && Number(p.price_paid) === 0 && !p.payment_ref;
    const EXP = { reg: po.filter(isReg).length, comp: po.filter(isComp).length, leg: po.filter(isLeg).length };
    EXP.marked = EXP.reg + EXP.comp + EXP.leg;
    console.log("fixture:", fs.existsSync(liveFile) ? "odczyt produkcji 27.09" : "archiwum 23.09", po.length, "pakietów; oczekiwane", JSON.stringify(EXP));
    const setup = async (client) => {
      await client.query(read("supabase/tests/000_supabase_shim.sql"));
      for (const f of files.filter((f) => f !== "20260927120000_free_credit_grants.sql")) await client.query("begin;" + read("supabase/migrations/" + f) + ";commit;");
      for (const cid of new Set(po.map((p) => p.company_id))) await client.query("insert into public.companies(id,name) values($1,'ARCHIVE FIXTURE') on conflict do nothing", [cid]);
      for (const p of po) await client.query("insert into public.packages(id,company_id,plan,qty_total,qty_used,price_paid,currency,purchased_at,expires_at,payment_ref) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [p.id, p.company_id, p.plan, Number(p.qty_total), Number(p.qty_used), Number(p.price_paid), p.currency, p.purchased_at, p.expires_at, p.payment_ref || null]);
      await client.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
        values ('${ADMIN}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','artur.stasiak@freshmarket.eu','',now(),now(),now(),'{"role":"admin"}','{}')`);
      await client.query(`update public.profiles set role='admin', email='artur.stasiak@freshmarket.eu' where id='${ADMIN}'`).catch(async () => { await client.query(`update public.profiles set role='admin' where id='${ADMIN}'`); });
    };
    const rowsOf = (res, col) => (Array.isArray(res) ? res : [res]).filter((r) => r.rows?.length && col in r.rows[0]).map((r) => r.rows);
    // 4a. czysty przebieg
    const n2 = name + "_arch"; await root.query("create database " + n2); const d2 = new pg.Client({ ...opts, database: n2 }); await d2.connect(); clients.push(d2);
    try {
      await setup(d2);
      const resA = await d2.query(A);
      const a1 = rowsOf(resA, "brakujacych")[0], a2 = rowsOf(resA, "d_firma")[0] || [], a3 = rowsOf(resA, "tylko_w_bazie")[0][0], a4 = rowsOf(resA, "firma").filter((x) => x.length && "payment_ref" in x[0] && !("d_firma" in x[0]))[0] || [];
      ok(a1.every((x) => Number(x.brakujacych) === 0) && a1.length === 3 && a2.length === 0 && Number(a3.tylko_w_bazie) === 0 && Number(a3.tylko_w_manifescie) === 0 && a4.length === 0, "uzgodnienie A na schemacie sprzed migracji: 0 brakujących, 0 różnic, " + EXP.comp + "/" + EXP.comp + ", 0 spoza list");
      await d2.query(read("supabase/migrations/20260927120000_free_credit_grants.sql"));
      const resB = await d2.query(B);
      const ctrl = rowsOf(resB, "historyczne")[0];
      const byL = Object.fromEntries(ctrl.map((x) => [x.lista, x]));
      ok(Number(byL.rejestracja.pakietow) === EXP.reg && byL.rejestracja.source === "grant" && byL.rejestracja.grant_reason === "registration" && byL.rejestracja.historyczne && byL.rejestracja.bez_banera
        && Number(byL.rekompensata.pakietow) === EXP.comp && byL.rekompensata.grant_reason === "compensation" && Number(byL.nieustalone.pakietow) === EXP.leg && byL.nieustalone.source === "legacy", "zapis B po migracji: " + EXP.reg + " rejestracja / " + EXP.comp + " rekompensata / " + EXP.leg + " nieustalone, bez banera");
      const actualPackages = (await d2.query("select id, source, grant_reason, grant_historical, grant_seen_at, qty_total, qty_used, expires_at::text from packages order by id")).rows;
      const beforeById = new Map(po.map((p) => [p.id, p]));
      const unconfirmedFive = po.filter((p) => isLeg(p) && p.plan === "std_5");
      ok(unconfirmedFive.length === (fs.existsSync(liveFile) ? 33 : 0), "fixture zawiera 33 dodatkowe pakiety std_5 bez potwierdzonego powodu");
      ok(actualPackages.every((p) => {
        const previous = beforeById.get(p.id);
        const expectedSource = isReg(previous) || isComp(previous) ? "grant" : isLeg(previous) ? "legacy" : "purchase";
        const expectedReason = isReg(previous) ? "registration" : isComp(previous) ? "compensation" : null;
        return p.source === expectedSource && p.grant_reason === expectedReason
          && p.qty_total === Number(previous.qty_total) && p.qty_used === Number(previous.qty_used)
          && p.expires_at === String(previous.expires_at).slice(0, 10)
          && (expectedSource !== "grant" || (p.grant_historical && p.grant_seen_at));
      }), "każdy ID: 33 dodatkowe std_5 neutralne, 75 prezentów i 123 rekompensaty zachowane; salda, zużycie i terminy bez zmian, brak nowego banera");
      const sums = await d2.query("select sum(qty_total)::int t, sum(qty_used)::int u from public.packages");
      const expT = po.reduce((a, p) => a + Number(p.qty_total), 0), expU = po.reduce((a, p) => a + Number(p.qty_used), 0);
      ok(sums.rows[0].t === expT && sums.rows[0].u === expU, "zapis B nie zmienia sald ani zużycia (" + expT + "/" + expU + ")");
      const again = await d2.query(B).then(() => "ok", (e) => e.message);
      await d2.query("rollback").catch(() => {});
      ok(/już oznaczonych/.test(again), "powtórny zapis B przerwany: pakiety już oznaczone");
    } finally { await d2.end(); clients.splice(clients.indexOf(d2), 1); await root.query("drop database " + n2 + " with (force)"); }
    // 4b. zmieniony wiersz w bazie → A pokazuje różnicę, B się wycofuje
    const n3 = name + "_arch2"; await root.query("create database " + n3); const d3 = new pg.Client({ ...opts, database: n3 }); await d3.connect(); clients.push(d3);
    try {
      await setup(d3);
      const altered = po.find(isReg);
      const other = [...new Set(po.map((p) => p.company_id))].find((x) => x !== altered.company_id);
      await d3.query("update public.packages set qty_total=9, company_id=$2, payment_ref='ZMIENIONE' where id=$1", [altered.id, other]);
      const resA = await d3.query(A);
      const diffs = rowsOf(resA, "d_firma")[0] || [];
      ok(diffs.length === 1 && diffs[0].id === altered.id && diffs[0].d_qty && diffs[0].d_firma && diffs[0].d_ref, "uzgodnienie A wykrywa zmienioną ilość, właściciela i referencję jednego pakietu");
      await d3.query(read("supabase/migrations/20260927120000_free_credit_grants.sql"));
      const bFail = await d3.query(B).then(() => "ok", (e) => e.message);
      await d3.query("rollback").catch(() => {});
      const marked = await d3.query("select count(*)::int c from public.packages where source <> 'purchase'");
      ok(/niezgodnych 1/.test(bFail) && marked.rows[0].c === 0, "zapis B przy różnicy: wyjątek, nic nie oznaczone");
    } finally { await d3.end(); clients.splice(clients.indexOf(d3), 1); await root.query("drop database " + n3 + " with (force)"); }
    // 4c. nadmiarowa rekompensata spoza manifestu → B odmawia; wzrost qty_used (odczyty) → B przechodzi
    const n4 = name + "_arch3"; await root.query("create database " + n4); const d4 = new pg.Client({ ...opts, database: n4 }); await d4.connect(); clients.push(d4);
    try {
      await setup(d4);
      await d4.query(read("supabase/migrations/20260927120000_free_credit_grants.sql"));
      const comp0 = po.find(isComp);
      const EXTRA = "55555555-5555-4555-8555-555555555551";
      await d4.query("insert into public.packages(id,company_id,plan,qty_total,qty_used,price_paid,currency,purchased_at,expires_at,payment_ref) values($1,$2,'std_1',1,0,0,'EUR',now(),'2026-12-31',$3)", [EXTRA, comp0.company_id, "compensation:fm2026:retailer:100:company:" + comp0.company_id + ":extra"]);
      const bExtra = await d4.query(B).then(() => "ok", (e) => e.message); await d4.query("rollback").catch(() => {});
      const marked4 = await d4.query("select count(*)::int c from public.packages where source <> 'purchase'");
      ok(/rekompensaty spoza manifestu: 1/.test(bExtra) && marked4.rows[0].c === 0, "zapis B: nowa rekompensata spoza manifestu → wyjątek, nic nie oznaczone");
      await d4.query("delete from public.packages where id=$1", [EXTRA]);
      const regRow = po.find(isReg);
      await d4.query("update public.packages set qty_used = qty_used + 1 where id=$1", [regRow.id]);       // zwykły odczyt propozycji
      const bGrow = await d4.query(B).then(() => "ok", (e) => e.message);
      const after4 = await d4.query("select count(*)::int c, sum(qty_used)::int u from public.packages where source <> 'purchase'");
      ok(bGrow === "ok" && after4.rows[0].c === EXP.marked && after4.rows[0].u === po.reduce((a, p) => a + Number(p.qty_used), 0) + 1, "zapis B: wzrost qty_used między A i B jest dozwolony; " + EXP.marked + " oznaczonych, zużycie zachowane (+1)");
    } finally { await d4.end(); clients.splice(clients.indexOf(d4), 1); await root.query("drop database " + n4 + " with (force)"); }
    // 4d. zmiana pakietu PO kontroli, gdy B czeka na blokadę → B wykrywa i wycofuje (LOCK TABLE ... EXCLUSIVE przed kontrolą)
    const n5 = name + "_arch4"; await root.query("create database " + n5); const d5 = new pg.Client({ ...opts, database: n5 }); await d5.connect(); clients.push(d5);
    const d5b = new pg.Client({ ...opts, database: n5 });
    try {
      await setup(d5);
      await d5.query(read("supabase/migrations/20260927120000_free_credit_grants.sql"));
      await d5b.connect(); clients.push(d5b);
      const regRow = po.find(isReg);
      const other = [...new Set(po.map((p) => p.company_id))].find((x) => x !== regRow.company_id);
      await d5b.query("begin"); await d5b.query("select id from public.packages where id=$1 for update", [regRow.id]);   // inna sesja trzyma wiersz
      const bRace = d5.query(B).then(() => "ok", (e) => e.message);                                                       // B czeka na LOCK TABLE
      let waiting = 0;
      for (let i = 0; i < 100; i++) { const q = await root.query("select count(*)::int n from pg_stat_activity where datname=$1 and wait_event_type='Lock'", [n5]); waiting = q.rows[0].n; if (waiting >= 1) break; await new Promise((r) => setTimeout(r, 50)); }
      await d5b.query("update public.packages set qty_total=9, company_id=$2, payment_ref='CHANGED-AFTER-VALIDATION' where id=$1", [regRow.id, other]);
      await d5b.query("commit");
      const res5 = await bRace; await d5.query("rollback").catch(() => {});
      const marked5 = await d5.query("select count(*)::int c from public.packages where source <> 'purchase'");
      ok(waiting >= 1 && /niezgodnych 1/.test(res5) && marked5.rows[0].c === 0, "zapis B: zmiana pakietu podczas oczekiwania na blokadę → wykryta pod blokadą, nic nie oznaczone");
    } finally { await d5b.end().catch(() => {}); clients.splice(clients.indexOf(d5b), 1); await d5.end(); clients.splice(clients.indexOf(d5), 1); await root.query("drop database " + n5 + " with (force)"); }
  } else {
    console.log("skip faza 4: brak archiwum 1FMK2026/outputs (uruchom na komputerze Artura)");
  }
  console.log("PASS all migrations from empty database; new migration twice; ROLLBACK; concurrency (grant key, last credit, same send, app+email, notify+charge, historical key/overlap, trusted context); reconciliation A/B on archive fixture (+ extra compensation, qty_used growth, change while waiting for lock)");
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  for (const c of clients) await c.end().catch(() => {});
  await db?.end();
  if (created) await root.query("drop database " + name + " with (force)");
  await root.end();
}
