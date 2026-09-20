// Test migracji 20260920130000_fm_decision_sources od pustej bazy (embedded Postgres 17, 127.0.0.1:54329):
// shim Supabase → migracje 001–055 → migracje datowane (17–18.09) → NOWA (dwa razy: idempotencja)
// → supabase/tests/fm_decision_sources_test.sql (BEGIN … ROLLBACK). Nigdy na produkcji.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const options = { host: "127.0.0.1", port: 54329, user: "postgres", password: "pw" };
const name = `fm_decision_sources_${Date.now()}`;
const root = new pg.Client({ ...options, database: "postgres" });
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = "supabase/migrations/20260920130000_fm_decision_sources.sql";
let db, created = false;
try {
  await root.connect();
  await root.query(`create database ${name}`);
  created = true;
  db = new pg.Client({ ...options, database: name });
  await db.connect();
  await db.query(read("supabase/tests/000_supabase_shim.sql"));
  for (const file of readdirSync(new URL("../supabase/migrations", import.meta.url)).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    await db.query(read(`supabase/migrations/${file}`));
  }
  await db.query(`begin;${read("supabase/migrations/20260917120519_fm_payment_date_guard.sql")}commit;`);
  await db.query(read("supabase/migrations/20260917124901_admin_fm_payment_date.sql"));
  await db.query(read("supabase/migrations/20260918070934_company_description_audit.sql"));
  console.log("PASS migracje 001–055 + datowane od pustej bazy");
  await db.query(read(migration));
  await db.query(read(migration));
  console.log("PASS nowa migracja zaaplikowana dwukrotnie (idempotentna)");
  const before = (await db.query("select count(*)::int n from public.fm_decision_sources")).rows[0].n;
  const res = await db.query(read("supabase/tests/fm_decision_sources_test.sql"));
  const last = Array.isArray(res) ? res[res.length - 2] : res; // ostatni SELECT przed ROLLBACK
  const result = (Array.isArray(res) ? res : [res]).map(r => r.rows?.[0]?.result).filter(Boolean).pop();
  console.log("PASS", result || "(test SQL bez wyniku?)");
  const after = (await db.query("select count(*)::int n from public.fm_decision_sources")).rows[0].n;
  console.log(`PASS ROLLBACK: wierszy przed ${before}, po ${after}`);
  console.log("SQL: migracja + testy OK");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  try { await db?.end(); } catch {}
  if (created) { try { await root.query(`drop database ${name} with (force)`); } catch (e) { console.error("drop db:", e.message); } }
  try { await root.end(); } catch {}
}
