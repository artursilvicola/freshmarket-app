// [feat/free-credit-grants] Test migracji 20260927120000_free_credit_grants na lokalnym embedded
// PostgreSQL (127.0.0.1:54329, jak pozostałe runnery): pusta baza, shim Supabase, wszystkie migracje,
// nowa migracja drugi raz (idempotencja), test w transakcji ROLLBACK, baza tymczasowa usunięta.
// Nigdy nie kieruj tego na produkcję.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
const opts = { host: "127.0.0.1", port: 54329, user: "postgres", password: "pw" };
const name = "free_credit_grants_test_" + Date.now();
const root = new pg.Client({ ...opts, database: "postgres" });
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
let db, created = false;
try {
  await root.connect(); await root.query("create database " + name); created = true;
  db = new pg.Client({ ...opts, database: name }); await db.connect();
  await db.query(read("supabase/tests/000_supabase_shim.sql"));
  const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await db.query("begin;" + read("supabase/migrations/" + f) + ";commit;");
  await db.query(read("supabase/migrations/20260927120000_free_credit_grants.sql"));
  const res = await db.query(read("supabase/tests/free_credit_grants_test.sql"));
  console.log(res.map((r) => r.rows?.[0]?.result).filter(Boolean).join("\n"));
  console.log("PASS all migrations from empty database; new migration twice; ROLLBACK");
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await db?.end(); if (created) await root.query("drop database " + name + " with (force)"); await root.end(); }
