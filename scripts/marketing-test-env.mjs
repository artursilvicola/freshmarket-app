#!/usr/bin/env node
// [feat/marketing-activation] Stawia IZOLOWANE środowisko odbiorowe na BAZIE TESTOWEJ:
//   migracje repo (łącznie z marketingową) → seed.sql → konta e2e → seed odbiorowy.
//
//   node scripts/marketing-test-env.mjs            (czyta .env.test z katalogu repo)
//
// Cienki wrapper: sprawdzenie .env.test (scripts/lib/test-env.mjs) + połączenie `pg`;
// cała logika i kody wyjścia w scripts/lib/test-env-runner.mjs (testowana na atrapie).
// Kody: 0 OK · 1 błąd migracji/seedu/stanu (transakcja wycofana) · 2 brak .env.test · 3 odmowa.
// Nic nie wysyła, nie dotyka Resend ani produkcji.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { parseDotenv, validateTestEnv, dbUrlRef, PROD_REF } from "./lib/test-env.mjs";
import { prepareTestDatabase } from "./lib/test-env-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Client } = require("pg");

async function main() {
  const file = path.join(root, ".env.test");
  if (!existsSync(file)) { console.error("Brak .env.test — skopiuj .env.test.example i uzupełnij projektem TESTOWYM."); return 2; }
  const fileEnv = parseDotenv(readFileSync(file, "utf8"));
  const check = validateTestEnv(fileEnv);
  if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); return 3; }
  const url = fileEnv.TEST_DATABASE_URL;
  if (url.includes(PROD_REF) || !dbUrlRef(url)) { console.error("ODMOWA: TEST_DATABASE_URL nieprawidłowy albo produkcyjny."); return 3; }

  const read = (p) => readFileSync(path.join(root, p), "utf8");
  const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const seeds = ["supabase/seed.sql", "supabase/tests/e2e_create_test_accounts.sql", "supabase/tests/marketing_acceptance_seed.sql"].map((name) => ({ name, sql: read(name) }));

  const client = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const who = await client.query("select current_database() as db, version() as v");
    console.log(`połączono: db=${who.rows[0].db} (${String(who.rows[0].v).slice(0, 28)}) ref=${dbUrlRef(url)}`);
    const code = await prepareTestDatabase({ client, files, readMigration: (f) => read("supabase/migrations/" + f), seeds, log: console.log, err: console.error });
    if (code === 0) console.log("konto admina do odbioru: codex.admin@freshmarket.test (hasło w supabase/tests/e2e_create_test_accounts.sql)");
    return code;
  } finally {
    await client.end().catch(() => {});
  }
}

let code = 1;
try { code = await main(); }
catch (e) { console.error("STOP: nieoczekiwany błąd:", e?.message || e); code = 1; }
process.exit(code);
