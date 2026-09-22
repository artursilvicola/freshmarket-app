// [feat/fm-plan-send-server-card] Test migracji fm_plan_deliveries na lokalnym embedded PostgreSQL
// (127.0.0.1:54329, jak pozostałe runnery): pusta baza, shim Supabase, wszystkie migracje,
// nowa migracja drugi raz (idempotencja), test w transakcji ROLLBACK, baza tymczasowa usunięta.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
const opts = { host: "127.0.0.1", port: 54329, user: "postgres", password: "pw" };
const name = "fm_deliveries_test_" + Date.now();
const root = new pg.Client({ ...opts, database: "postgres" });
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
let db, created = false;
try {
  await root.connect(); await root.query("create database " + name); created = true;
  db = new pg.Client({ ...opts, database: name }); await db.connect();
  await db.query(read("supabase/tests/000_supabase_shim.sql"));
  const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await db.query("begin;" + read("supabase/migrations/" + f) + ";commit;");
  await db.query(read("supabase/migrations/20260922100000_fm_plan_deliveries.sql"));
  const res = await db.query(read("supabase/tests/fm_plan_deliveries_test.sql"));
  console.log(res.map((r) => r.rows?.[0]?.result).filter(Boolean).join("\n"));
  console.log("PASS all migrations from empty database; new migration twice; ROLLBACK");
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await db?.end(); if (created) await root.query("drop database " + name + " with (force)"); await root.end(); }
