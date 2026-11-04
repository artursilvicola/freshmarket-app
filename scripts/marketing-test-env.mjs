#!/usr/bin/env node
// [feat/marketing-activation] Stawia IZOLOWANE środowisko odbiorowe na BAZIE TESTOWEJ:
//   migracje repo (łącznie z marketingową) → seed.sql → konta e2e → seed odbiorowy.
//
//   node scripts/marketing-test-env.mjs            (czyta .env.test z katalogu repo)
//
// Bezpieczniki (review Codexa):
//  * .env.test sprawdzany tą samą logiką co dev-test (scripts/lib/test-env.mjs): komplet wartości
//    z pliku, jeden projekt testowy dla frontu/backendu/bazy, ref produkcyjny odrzucany;
//  * REJESTR migracji `public._test_env_migrations`: każdy plik wykonywany dokładnie raz, zapis
//    do rejestru tylko po pełnym sukcesie; KAŻDY błąd zatrzymuje skrypt (bez zgadywania po
//    tekście błędu). Pierwsze uruchomienie wymaga PUSTEJ bazy (bez public.companies);
//  * seedy wykonywane w transakcji, każdy błąd zatrzymuje; seedy są idempotentne same w sobie.
// Nic nie wysyła, nie dotyka Resend ani produkcji.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { parseDotenv, validateTestEnv, dbUrlRef, PROD_REF } from "./lib/test-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const file = path.join(root, ".env.test");
if (!existsSync(file)) { console.error("Brak .env.test — skopiuj .env.test.example i uzupełnij projektem TESTOWYM."); process.exit(2); }
const fileEnv = parseDotenv(readFileSync(file, "utf8"));
const check = validateTestEnv(fileEnv);
if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); process.exit(3); }
const url = fileEnv.TEST_DATABASE_URL;
if (url.includes(PROD_REF) || !dbUrlRef(url)) { console.error("ODMOWA: TEST_DATABASE_URL nieprawidłowy albo produkcyjny."); process.exit(3); }

const read = (p) => readFileSync(path.join(root, p), "utf8");
async function main() {
const client = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
let exitCode = 0;
try {
  const who = await client.query("select current_database() as db, version() as v");
  console.log(`połączono: db=${who.rows[0].db} (${String(who.rows[0].v).slice(0, 28)}) ref=${dbUrlRef(url)}`);

  // rejestr migracji — jedyny dowód, co już zastosowano
  const reg = await client.query("select to_regclass('public._test_env_migrations') is not null as ok");
  const hasCompanies = (await client.query("select to_regclass('public.companies') is not null as ok")).rows[0].ok;
  if (!reg.rows[0].ok) {
    if (hasCompanies) { console.error("ODMOWA: baza nie jest pusta (jest public.companies), a nie ma rejestru _test_env_migrations — to nie jest baza przygotowana tym skryptem."); process.exit(3); }
    await client.query("create table public._test_env_migrations (filename text primary key, applied_at timestamptz not null default now())");
    console.log("rejestr migracji utworzony (pusta baza)");
  }
  const done = new Set((await client.query("select filename from public._test_env_migrations")).rows.map((r) => r.filename));

  const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = read("supabase/migrations/" + f);
    try {
      await client.query(sql);                                  // plik ma własne begin/commit albo jest pojedynczą transakcją
      await client.query("insert into public._test_env_migrations (filename) values ($1)", [f]);
      applied++;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      console.error(`STOP: migracja ${f} padła: ${e.message}`);
      console.error("Rejestr nie zawiera tego pliku — po naprawie uruchom ponownie; wcześniejsze pliki nie powtórzą się.");
      exitCode = 1; return;
    }
  }
  console.log(`migracje: ${applied} zastosowanych teraz, ${done.size} było wcześniej, razem ${files.length} w repo`);

  for (const f of ["supabase/seed.sql", "supabase/tests/e2e_create_test_accounts.sql", "supabase/tests/marketing_acceptance_seed.sql"]) {
    try { await client.query(read(f)); console.log("seed OK:", f); }
    catch (e) { await client.query("rollback").catch(() => {}); console.error(`STOP: seed ${f} padł: ${e.message}`); exitCode = 1; return; }
  }

  const c = await client.query(`select
    (select count(*)::int from public.companies where name like 'TEST %' or name like 'ZZZ TEST%') as test_companies,
    (select count(*)::int from public.profiles where role = 'supplier' and email like '%@example.test') as test_operators,
    (select count(*)::int from public.profiles where role = 'admin') as admins,
    (select count(*)::int from public.packages) as packages,
    (select count(*)::int from public.marketing_suppressions) as suppressions,
    (select to_regclass('public.marketing_messages') is not null) as marketing_tables,
    (select count(*)::int from public._test_env_migrations) as migrations_registered`);
  console.log("stan:", c.rows[0]);
  const expect = { test_companies: 9, test_operators: 10, marketing_tables: true, migrations_registered: files.length };
  const bad = Object.entries(expect).filter(([k, v]) => c.rows[0][k] !== v);
  if (bad.length) { console.error("STOP: stan końcowy niezgodny z oczekiwanym:", bad.map(([k, v]) => `${k}=${c.rows[0][k]} (oczekiwano ${v})`).join(", ")); exitCode = 1; return; }
  console.log("konto admina do odbioru: codex.admin@freshmarket.test (hasło w supabase/tests/e2e_create_test_accounts.sql)");
} finally { await client.end(); }
  return exitCode;
}

process.exit(await main());
