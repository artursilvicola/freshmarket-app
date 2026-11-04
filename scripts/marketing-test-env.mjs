#!/usr/bin/env node
// [feat/marketing-activation] Stawia IZOLOWANE środowisko odbiorowe na BAZIE TESTOWEJ:
//   wszystkie migracje repo (łącznie z marketingową) → seed.sql → konta e2e → seed odbiorowy.
//
//   TEST_DATABASE_URL="postgresql://postgres:<haslo>@db.<ref>.supabase.co:5432/postgres" node scripts/marketing-test-env.mjs
//   (albo w .env.test — skrypt czyta .env.test z katalogu repo)
//
// BEZPIECZNIKI: odmawia pracy, gdy adres wskazuje produkcyjny projekt (sklyfuvzjikkqerxtulo)
// albo gdy w bazie są prawdziwe firmy (companies bez „TEST” poza seedem) — żeby nikt
// nie uruchomił tego na produkcji przez pomyłkę. Nic nie wysyła, nie dotyka Resend.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Client } = require("pg");

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotenv(path.join(root, ".env.test"));

const PROD_REF = "sklyfuvzjikkqerxtulo";
const url = process.env.TEST_DATABASE_URL || "";
if (!url) { console.error("Brak TEST_DATABASE_URL (w env albo .env.test)."); process.exit(2); }
if (url.includes(PROD_REF)) { console.error("ODMOWA: adres wskazuje PRODUKCYJNY projekt Supabase."); process.exit(3); }
if ((process.env.SUPABASE_URL || "").includes(PROD_REF) || (process.env.VITE_SUPABASE_URL || "").includes(PROD_REF)) {
  console.error("ODMOWA: .env.test wskazuje produkcyjny projekt w SUPABASE_URL / VITE_SUPABASE_URL."); process.exit(3);
}

const read = (p) => readFileSync(path.join(root, p), "utf8");
const client = new Client({ connectionString: url, ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  const who = await client.query("select current_database() as db, inet_server_addr()::text as addr, version() as v");
  console.log(`połączono: db=${who.rows[0].db} ${who.rows[0].addr || ""} (${String(who.rows[0].v).slice(0, 30)})`);

  // bezpiecznik 2: baza z prawdziwymi firmami = nie testowa
  const hasCompanies = await client.query(`select to_regclass('public.companies') is not null as ok`);
  if (hasCompanies.rows[0].ok) {
    const real = await client.query(`select count(*)::int as n from public.companies where name not like 'TEST %' and name not like 'ZZZ TEST%' and id::text not in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333')`);
    if (real.rows[0].n > 0) { console.error(`ODMOWA: w bazie jest ${real.rows[0].n} firm spoza seedów — to nie wygląda na bazę testową.`); process.exit(3); }
  }

  // 1) migracje (idempotentne; kolejność alfabetyczna jak w repo)
  const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0, skipped = 0;
  for (const f of files) {
    const sql = read("supabase/migrations/" + f);
    try { await client.query(sql); applied++; }
    catch (e) {
      // powtórne uruchomienie: część migracji nie jest idempotentna (create table bez IF NOT EXISTS) — pomijamy już zastosowane
      if (/already exists|duplicate_object|duplicate key/i.test(e.message)) { skipped++; await client.query("rollback").catch(() => {}); continue; }
      console.error("migracja padła:", f, e.message); process.exit(1);
    }
  }
  console.log(`migracje: ${applied} zastosowanych, ${skipped} pominiętych (już były) z ${files.length}`);

  // 2) seed bazowy, konta e2e, seed odbiorowy
  for (const f of ["supabase/seed.sql", "supabase/tests/e2e_create_test_accounts.sql", "supabase/tests/marketing_acceptance_seed.sql"]) {
    try { await client.query(read(f)); console.log("seed OK:", f); }
    catch (e) { await client.query("rollback").catch(() => {}); if (/already exists|duplicate key/i.test(e.message)) console.log("seed już był:", f); else { console.error("seed padł:", f, e.message); process.exit(1); } }
  }

  // 3) kontrola
  const c = await client.query(`select
    (select count(*)::int from public.companies where name like 'TEST %') as test_companies,
    (select count(*)::int from public.profiles where role = 'supplier' and email like '%@example.test') as test_operators,
    (select count(*)::int from public.profiles where role = 'admin') as admins,
    (select count(*)::int from public.packages) as packages,
    (select count(*)::int from public.marketing_suppressions) as suppressions,
    (select to_regclass('public.marketing_messages') is not null) as marketing_tables`);
  console.log("stan:", c.rows[0]);
  console.log("konto admina do odbioru: codex.admin@freshmarket.test (hasło w supabase/tests/e2e_create_test_accounts.sql)");
} finally { await client.end(); }
