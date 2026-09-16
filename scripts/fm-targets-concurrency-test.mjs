#!/usr/bin/env node
// [fix/security-hotfix] Test równoległych zapisów wyborów tej samej firmy przez RPC
// fm_set_company_targets (migracja 055) — na bazie TESTOWEJ (nigdy produkcja).
//
//   DATABASE_URL=postgres://postgres:pw@127.0.0.1:54329/fmtest node scripts/fm-targets-concurrency-test.mjs
//
// Dwa niezależne połączenia symulują dwie karty / dwa konta tej samej firmy
// (rola authenticated + claims JWT jak z PostgREST). Sprawdzane reguły:
//   (1) pusta lista: A zapisuje [A], B równocześnie [B] → w bazie DOKŁADNIE jedna z list, nigdy [A,B]
//   (2) istniejąca lista [A,B]: A→[A], B→[B,C] równolegle → dokładnie jedna z list
//   (3) nakładające się: A→[A,B], B→[B] → dokładnie jedna z list, bez wierszy spoza niej
//   (4) drugi zapis czeka na zatwierdzenie pierwszego (blokada wiersza firmy)
// Fixtures z prefiksem CONC-TARGETS są tworzone w transakcjach i sprzątane na końcu.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Ustaw DATABASE_URL (baza TESTOWA)."); process.exit(2); }
if (/sklyfuvzjikkqerxtulo|b2b\.freshmarket\.eu/.test(url)) { console.error("ODMOWA: DATABASE_URL wskazuje na produkcję."); process.exit(2); }

const admin = new pg.Client({ connectionString: url });
await admin.connect();
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };

// fixtures (jako postgres)
const ids = (await admin.query("select gen_random_uuid() as co, gen_random_uuid() as u1, gen_random_uuid() as u2")).rows[0];
await admin.query("insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$3,'',now(),now(),now(),'{\"provider\":\"email\"}','{}'), ($2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now(),now(),'{\"provider\":\"email\"}','{}')",
  [ids.u1, ids.u2, `conc-targets-1-${Date.now()}@test.local`, `conc-targets-2-${Date.now()}@test.local`]);
await admin.query("insert into public.companies (id, name, fm_b2b_enabled, account_status) values ($1, 'CONC-TARGETS firma', true, 'active')", [ids.co]);
await admin.query("update public.profiles set role = 'supplier', company_id = $1, active = true where id in ($2, $3)", [ids.co, ids.u1, ids.u2]);
await admin.query("insert into public.retailers (id, name, fm26_active, fm26_chain_id) values (990201,'CONC-TARGETS A',true,'conc-a'),(990202,'CONC-TARGETS B',true,'conc-b'),(990203,'CONC-TARGETS C',true,'conc-c') on conflict (id) do nothing");
const settings = await admin.query("select count(*)::int as n from public.fm_settings");
if (!settings.rows[0].n) await admin.query("insert into public.fm_settings (algo_phase, event_date) values ('preferences_open', '2026-09-24')");
await admin.query("update public.fm_settings set algo_phase = 'preferences_open', selection_deadline = null");

async function session(uid) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)",
    [JSON.stringify({ sub: uid, role: "authenticated" }), uid]);
  await c.query("set local role authenticated");
  return c;
}
const items = (...rids) => JSON.stringify(rids.map((rid, i) => ({ retailer_id: rid, priority: i === 0 ? 1000 : 100 })));
const current = async () => (await admin.query("select array_agg(retailer_id order by retailer_id) as l from public.company_target_retailers where company_id = $1", [ids.co])).rows[0].l || [];
const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function race(listA, listB, label) {
  const a = await session(ids.u1), b = await session(ids.u2);
  const t0 = Date.now();
  const pa = a.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(...listA)]);
  await new Promise(r => setTimeout(r, 150)); // A trzyma blokadę firmy (transakcja otwarta), B próbuje
  let bDone = false;
  const pb = b.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(...listB)]).then(r => { bDone = true; return r; });
  await pa;
  await new Promise(r => setTimeout(r, 300));
  ok(!bDone, `${label}: drugi zapis czeka, dopóki pierwszy nie jest zatwierdzony`);
  await a.query("commit");
  await pb;
  const tB = Date.now() - t0;
  await b.query("commit");
  await a.end(); await b.end();
  const got = await current();
  const A = [...listA].sort((x, y) => x - y), B = [...listB].sort((x, y) => x - y);
  ok(sameSet(got, A) || sameSet(got, B), `${label}: w bazie dokładnie jedna z list (${JSON.stringify(got)}; A=${JSON.stringify(A)}, B=${JSON.stringify(B)})`);
  ok(sameSet(got, B), `${label}: wygrywa ostatni zatwierdzony zapis w całości (B)`);
  ok(tB >= 400, `${label}: B zakończył się po zatwierdzeniu A (${tB} ms)`);
}

try {
  await admin.query("delete from public.company_target_retailers where company_id = $1", [ids.co]);
  await race([990201], [990202], "(1) pusta lista");
  await admin.query("delete from public.company_target_retailers where company_id = $1", [ids.co]);
  await admin.query("insert into public.company_target_retailers (company_id, retailer_id, priority) values ($1, 990201, 1000), ($1, 990202, 100)", [ids.co]);
  await race([990201], [990202, 990203], "(2) istniejąca lista [A,B]");
  await race([990201, 990202], [990202], "(3) nakładające się listy");
  // zablokowana faza w trakcie: A zaczyna przy otwartej fazie, admin zamyka, B dostaje fm_inputs_locked, lista A zostaje w całości
  await admin.query("delete from public.company_target_retailers where company_id = $1", [ids.co]);
  {
    const a = await session(ids.u1);
    await a.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(990201, 990202)]);
    await a.query("commit"); await a.end();
    await admin.query("update public.fm_settings set algo_phase = 'matching'");
    const b = await session(ids.u2);
    let err = null;
    try { await b.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(990203)]); } catch (e) { err = e; }
    await b.query("rollback"); await b.end();
    ok(err && /fm_inputs_locked/.test(err.message), "(4) po zamknięciu fazy zapis odrzucony (fm_inputs_locked)");
    ok(sameSet(await current(), [990201, 990202]), "(4) poprzednia lista nietknięta");
    await admin.query("update public.fm_settings set algo_phase = 'preferences_open'");
  }
  // (5) review P1/2: zapis czeka na blokadę firmy, W TYM CZASIE admin zamyka fazę → po zwolnieniu blokady zapis ODRZUCONY
  {
    const holder = new pg.Client({ connectionString: url }); await holder.connect();
    await holder.query("begin"); await holder.query("select id from public.companies where id = $1 for update", [ids.co]);
    const b = await session(ids.u2);
    let bErr = null, bDone = false;
    const pb = b.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(990203)]).then(() => { bDone = true; }).catch(e => { bErr = e; bDone = true; });
    await new Promise(r => setTimeout(r, 300));
    ok(!bDone, "(5) zapis czeka na blokadę firmy");
    await admin.query("update public.fm_settings set algo_phase = 'matching'");
    await holder.query("commit"); await holder.end();
    await pb;
    await b.query("rollback"); await b.end();
    ok(bErr && /fm_inputs_locked/.test(bErr.message), "(5) faza zamknięta w czasie oczekiwania → fm_inputs_locked (kontrola PO blokadzie)");
    ok(sameSet(await current(), [990201, 990202]), "(5) lista nietknięta");
    await admin.query("update public.fm_settings set algo_phase = 'preferences_open'");
  }
  // (6) review P1/2: niezatwierdzone odebranie udziału (fm_b2b_enabled=false) w czasie oczekiwania → zapis ODRZUCONY
  {
    const holder = new pg.Client({ connectionString: url }); await holder.connect();
    await holder.query("begin"); await holder.query("update public.companies set fm_b2b_enabled = false where id = $1", [ids.co]);
    const b = await session(ids.u2);
    let bErr = null, bDone = false;
    const pb = b.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(990203)]).then(() => { bDone = true; }).catch(e => { bErr = e; bDone = true; });
    await new Promise(r => setTimeout(r, 300));
    ok(!bDone, "(6) zapis czeka na niezatwierdzoną zmianę firmy");
    await holder.query("commit"); await holder.end();
    await pb;
    await b.query("rollback"); await b.end();
    ok(bErr && /fm_inputs_forbidden/.test(bErr.message), "(6) udział odebrany w czasie oczekiwania → fm_inputs_forbidden");
    ok(sameSet(await current(), [990201, 990202]), "(6) lista nietknięta");
    await admin.query("update public.companies set fm_b2b_enabled = true where id = $1", [ids.co]);
  }
  // (7) zmiana fazy przez admina CZEKA na zapisy w toku (FOR SHARE na fm_settings) — algorytm nie startuje na zmiennych wejściach
  {
    const a = await session(ids.u1);
    await a.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(990201, 990202, 990203)]);   // transakcja otwarta = zapis w toku
    let phaseDone = false;
    const pPhase = admin.query("update public.fm_settings set algo_phase = 'matching'").then(() => { phaseDone = true; });
    await new Promise(r => setTimeout(r, 300));
    ok(!phaseDone, "(7) zmiana fazy czeka, dopóki zapis w toku nie jest zatwierdzony");
    await a.query("commit"); await a.end();
    await pPhase;
    ok(phaseDone, "(7) zmiana fazy przeszła po zatwierdzeniu zapisu");
    ok(sameSet(await current(), [990201, 990202, 990203]), "(7) zapis w toku zaliczony w całości");
    const b = await session(ids.u2);
    let err = null;
    try { await b.query("select public.fm_set_company_targets($1, $2::jsonb)", [ids.co, items(990201)]); } catch (e) { err = e; }
    await b.query("rollback"); await b.end();
    ok(err && /fm_inputs_locked/.test(err.message), "(7) zapis rozpoczęty po zmianie fazy → fm_inputs_locked");
    await admin.query("update public.fm_settings set algo_phase = 'preferences_open'");
  }
  // (8) review 78e9dc9 P1: odpowiedź KUPCA w toku — zamknięcie fazy czeka na jej zatwierdzenie; po zamknięciu nowa odpowiedź odrzucona
  {
    const bu = (await admin.query("select gen_random_uuid() as u")).rows[0].u;
    await admin.query("insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now(),'{\"provider\":\"email\"}','{}')", [bu, `conc-targets-buyer-${Date.now()}@test.local`]);
    await admin.query("update public.profiles set role = 'buyer', retailer_id = 990201, active = true, fm26_active = true where id = $1", [bu]);
    await admin.query("delete from public.fm_resps where retailer_id = 990201 and supplier_company_id = $1", [ids.co]);
    const b = await session(bu);
    await b.query("insert into public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) values (990201, $1, 'green', 'green', '{}'::jsonb)", [ids.co]);  // transakcja otwarta = odpowiedź w toku
    // osobne połączenie do obserwacji: połączenie admina jest zajęte czekającym UPDATE
    const obs = new pg.Client({ connectionString: url }); await obs.connect();
    let phaseDone = false;
    const pPhase = admin.query("update public.fm_settings set algo_phase = 'matching'").then(() => { phaseDone = true; });
    await new Promise(r => setTimeout(r, 300));
    ok(!phaseDone, "(8) zamknięcie fazy czeka na odpowiedź kupca w toku");
    const visibleBefore = (await obs.query("select count(*)::int as n from public.fm_resps where retailer_id = 990201 and supplier_company_id = $1", [ids.co])).rows[0].n;
    await b.query("commit"); await b.end();
    await pPhase;
    const visibleAfter = (await obs.query("select zone from public.fm_resps where retailer_id = 990201 and supplier_company_id = $1", [ids.co])).rows;
    await obs.end();
    ok(phaseDone && visibleBefore === 0 && visibleAfter.length === 1 && visibleAfter[0].zone === "green", "(8) po zamknięciu fazy odpowiedź jest już zatwierdzona i widoczna (nie „spóźniona”)");
    const b2 = await session(bu);
    let err = null;
    try { await b2.query("update public.fm_resps set zone = 'red', status = 'red' where retailer_id = 990201 and supplier_company_id = $1", [ids.co]); } catch (e) { err = e; }
    await b2.query("rollback"); await b2.end();
    ok(err && /fm_inputs_locked/.test(err.message), "(8) nowa zmiana odpowiedzi po zamknięciu → fm_inputs_locked");
    ok((await admin.query("select zone from public.fm_resps where retailer_id = 990201 and supplier_company_id = $1", [ids.co])).rows[0].zone === "green", "(8) decyzja kupca nietknięta");
    await admin.query("update public.fm_settings set algo_phase = 'preferences_open'");
    await admin.query("delete from public.fm_resps where retailer_id = 990201 and supplier_company_id = $1", [ids.co]);
    await admin.query("delete from public.profiles where id = $1", [bu]);
    await admin.query("delete from auth.users where id = $1", [bu]);
  }
} finally {
  await admin.query("delete from public.company_target_retailers where company_id = $1", [ids.co]);
  await admin.query("delete from public.profiles where id in ($1, $2)", [ids.u1, ids.u2]);
  await admin.query("delete from auth.users where id in ($1, $2)", [ids.u1, ids.u2]);
  await admin.query("delete from public.companies where id = $1", [ids.co]);
  await admin.query("delete from public.retailers where id in (990201, 990202, 990203)");
  await admin.end();
}
console.log(fails ? `\n❌ ${fails} FAIL` : "\n✅ równoległe zapisy wyborów: OK");
process.exit(fails ? 1 : 0);
