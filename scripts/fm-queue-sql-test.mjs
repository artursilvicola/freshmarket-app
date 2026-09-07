#!/usr/bin/env node
// [feat/fm-queue] Instalacja migracji od pustej bazy + testy SQL modulu kolejek.
//
// Uzycie:
//   DATABASE_URL=postgres://postgres:pw@localhost:5432/fmtest node scripts/fm-queue-sql-test.mjs [--shim] [--only-test] [--from 052]
//
//   --shim       najpierw supabase/tests/000_supabase_shim.sql (ZWYKLY Postgres, NIE Supabase)
//   --only-test  pomija migracje, uruchamia tylko supabase/tests/053_fm_queue_test.sql
//   --from NNN   migracje od numeru NNN (np. --from 052 gdy 001..051 juz sa)
//   --skip a,b   pomin migracje o tych prefiksach (np. --skip 030)
//
// Nigdy nie kieruj tego na produkcje: skrypt odmawia, gdy host zawiera ref projektu prod.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const url = process.env.DATABASE_URL;
if (!url) { console.error("Ustaw DATABASE_URL (baza TESTOWA)."); process.exit(2); }
if (/sklyfuvzjikkqerxtulo/.test(url)) { console.error("ODMOWA: DATABASE_URL wskazuje na projekt produkcyjny."); process.exit(2); }

const client = new pg.Client({ connectionString: url });
await client.connect();
const runFile = async (path, label) => {
  const sql = readFileSync(path, "utf8");
  const t0 = Date.now();
  try {
    const res = await client.query(sql);
    const arr = Array.isArray(res) ? res : [res];
    const notices = arr.flatMap(r => r.rows || []).filter(r => r.wynik);
    console.log(`ok   ${label} (${Date.now() - t0} ms)${notices.length ? " → " + notices.map(n => n.wynik).join(" | ") : ""}`);
    return true;
  } catch (e) {
    console.error(`FAIL ${label}: ${e.message}${e.position ? ` (pozycja ${e.position})` : ""}`);
    for (const k of ["where", "hint", "detail", "internalQuery", "routine"]) if (e[k]) console.error(`     ${k}: ${String(e[k]).slice(0, 600)}`);
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    return false;
  }
};
client.on("notice", (n) => { if (/WARNING|TEST/.test(n.severity || "") || /TEST|handle_new_user/.test(n.message || "")) console.log(`     [${n.severity}] ${n.message}`); });

let okAll = true;
if (flag("--shim")) okAll = await runFile(resolve(root, "supabase/tests/000_supabase_shim.sql"), "000_supabase_shim.sql") && okAll;
if (!flag("--only-test") && okAll) {
  const from = opt("--from", "000");
  const skip = (opt("--skip", "") || "").split(",").filter(Boolean);
  const files = readdirSync(resolve(root, "supabase/migrations")).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (f.slice(0, 3) < from) continue;
    if (skip.some(s => f.startsWith(s))) { console.log(`skip ${f}`); continue; }
    // 052 (ALTER TYPE ... ADD VALUE) musi byc osobna transakcja — kazdy plik i tak idzie osobno
    if (!(await runFile(resolve(root, "supabase/migrations", f), f))) { okAll = false; break; }
  }
}
if (okAll) okAll = await runFile(resolve(root, "supabase/tests/053_fm_queue_test.sql"), "053_fm_queue_test.sql");
await client.end();
console.log(okAll ? "✅ SQL: migracje + testy OK" : "❌ SQL: FAIL");
process.exit(okAll ? 0 : 1);
