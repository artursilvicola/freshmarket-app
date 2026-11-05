// [feat/marketing-activation] Przygotowanie BAZY TESTOWEJ — logika z wstrzykiwanym klientem
// (testy: tests/marketing-test-env-runner.test.js, atrapa klienta bez bazy).
//
// Gwarancje (review Codexa, runda 2 skryptów):
//  * każda ścieżka zwraca JAWNY kod wyjścia: 0 = OK, 1 = błąd SQL/seedu/stanu, 3 = odmowa;
//  * migracja + wpis do rejestru w JEDNEJ transakcji: BEGIN → SQL pliku (bez własnych
//    begin/commit) → INSERT do rejestru → COMMIT; każdy błąd → ROLLBACK (nic nie zostaje
//    wykonane „bez wpisu”, więc „dokładnie raz” jest prawdziwe);
//  * pierwsze uruchomienie wymaga pustej bazy (jest public.companies bez rejestru → 3);
//  * seedy: każdy w transakcji, każdy błąd → ROLLBACK i 1; kontrola stanu końcowego → 1 przy rozjeździe.
//
// Uwaga: ALTER TYPE … ADD VALUE (052) działa w transakcji na PG ≥ 12, o ile nowa wartość
// nie jest użyta w tej samej transakcji — 052 jest osobnym plikiem, 053 osobną transakcją.

export const REGISTRY = "public._test_env_migrations";

/** Usuwa samodzielne linie `begin;` / `commit;` (plik dostaje jedną wspólną transakcję). */
export function stripTxWrappers(sql) {
  return String(sql || "").split(/\r?\n/).filter((l) => !/^\s*(begin|commit)\s*;\s*(--.*)?$/i.test(l)).join("\n").replace(/\s+$/, "");
}

export const EXPECTED_STATE = Object.freeze({ test_companies: 11, test_operators: 12, marketing_tables: true });

/**
 * @param {object} a
 * @param {{query:(sql:string, params?:any[])=>Promise<{rows:any[]}>}} a.client
 * @param {string[]} a.files        nazwy plików migracji (posortowane)
 * @param {(name:string)=>string} a.readMigration
 * @param {Array<{name:string, sql:string}>} a.seeds
 * @param {(msg:string)=>void} [a.log]
 * @param {(msg:string)=>void} [a.err]
 * @returns {Promise<0|1|3>}
 */
export async function prepareTestDatabase({ client, files, readMigration, seeds, log = () => {}, err = () => {} }) {
  const reg = await client.query(`select to_regclass('${REGISTRY}') is not null as ok`);
  const hasCompanies = (await client.query("select to_regclass('public.companies') is not null as ok")).rows[0]?.ok === true;
  if (reg.rows[0]?.ok !== true) {
    if (hasCompanies) { err("ODMOWA: baza nie jest pusta (jest public.companies), a nie ma rejestru _test_env_migrations — to nie jest baza przygotowana tym skryptem."); return 3; }
    await client.query(`create table ${REGISTRY} (filename text primary key, applied_at timestamptz not null default now())`);
    log("rejestr migracji utworzony (pusta baza)");
  }
  const done = new Set((await client.query(`select filename from ${REGISTRY}`)).rows.map((r) => r.filename));

  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = stripTxWrappers(readMigration(f));
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into ${REGISTRY} (filename) values ($1)`, [f]);
      await client.query("commit");
      applied++;
    } catch (e) {
      try { await client.query("rollback"); } catch { /* połączenie mogło paść — i tak kończymy błędem */ }
      err(`STOP: migracja ${f} padła: ${e?.message || e}`);
      err("Transakcja wycofana — plik NIE jest w rejestrze i NIE został częściowo zastosowany. Po naprawie uruchom ponownie.");
      return 1;
    }
  }
  log(`migracje: ${applied} zastosowanych teraz, ${done.size} było wcześniej, razem ${files.length} w repo`);

  for (const s of seeds) {
    try {
      await client.query("begin");
      await client.query(stripTxWrappers(s.sql));
      await client.query("commit");
      log("seed OK: " + s.name);
    } catch (e) {
      try { await client.query("rollback"); } catch { /* j.w. */ }
      err(`STOP: seed ${s.name} padł: ${e?.message || e}`);
      return 1;
    }
  }

  const c = await client.query(`select
    (select count(*)::int from public.companies where name like 'TEST %' or name like 'ZZZ TEST%') as test_companies,
    (select count(*)::int from public.profiles where role = 'supplier' and email like '%@example.test') as test_operators,
    (select count(*)::int from public.profiles where role = 'admin') as admins,
    (select count(*)::int from public.packages) as packages,
    (select count(*)::int from public.marketing_suppressions) as suppressions,
    (select to_regclass('public.marketing_messages') is not null) as marketing_tables,
    (select count(*)::int from ${REGISTRY}) as migrations_registered`);
  const state = c.rows[0] || {};
  log("stan: " + JSON.stringify(state));
  const expected = { ...EXPECTED_STATE, migrations_registered: files.length };
  const bad = Object.entries(expected).filter(([k, v]) => state[k] !== v);
  if (bad.length) { err("STOP: stan końcowy niezgodny z oczekiwanym: " + bad.map(([k, v]) => `${k}=${state[k]} (oczekiwano ${v})`).join(", ")); return 1; }
  return 0;
}
