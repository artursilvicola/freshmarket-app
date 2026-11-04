// [feat/marketing-activation] Przygotowanie bazy testowej na PRAWDZIWYM SQL (PGlite): 71+ migracji
// w transakcjach z rejestrem, seedy, kontrola stanu, drugi przebieg idempotentny. Bez PGLITE_PATH pomijany.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { prepareTestDatabase, REGISTRY } from "../scripts/lib/test-env-runner.mjs";

const PGLITE_PATH = process.env.PGLITE_PATH;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?(pgcrypto|pg_trgm|citext)"?\s*;/gi, "");

describe.skipIf(!PGLITE_PATH)("środowisko odbiorowe — przygotowanie bazy na prawdziwym SQL", () => {
  it("migracje w transakcjach z rejestrem + seedy + stan; drugi przebieg nic nie powtarza", async () => {
    const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
    const db = new PGlite();
    await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
    // shim PGlite nie ma auth.identities ani pgcrypto (na Supabase są) — atrapy tylko do tego testu
    await db.exec(`create table if not exists auth.identities (id uuid primary key, user_id uuid, identity_data jsonb, provider text, provider_id text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
      create or replace function public.gen_salt(text) returns text language sql as $$ select 'salt' $$;
      create or replace function public.crypt(text, text) returns text language sql as $$ select 'hash-' || $1 $$;`);
    const calls = [];
    // PGlite: wiele poleceń bez parametrów = exec (prawdziwy `pg` robi to samo protokołem prostym)
    const client = { query: async (sql, params) => { calls.push(sql); if (params) return db.query(sql, params); const r = await db.exec(sql); const last = r[r.length - 1]; return { rows: last?.rows || [] }; } };
    const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    const seeds = ["supabase/seed.sql", "supabase/tests/e2e_create_test_accounts.sql", "supabase/tests/marketing_acceptance_seed.sql"].map((name) => ({ name, sql: read(name) }));
    const args = { client, files, readMigration: (f) => patch(read("supabase/migrations/" + f)), seeds, log: () => {}, err: (m) => console.error(m) };
    expect(await prepareTestDatabase(args)).toBe(0);
    expect(calls.filter((s) => s === "begin")).toHaveLength(files.length + seeds.length);
    expect(calls.filter((s) => s === "commit")).toHaveLength(files.length + seeds.length);
    expect(calls).not.toContain("rollback");
    const reg = (await db.query(`select count(*)::int as n from ${REGISTRY}`)).rows[0].n;
    expect(reg).toBe(files.length);
    const before = calls.length;
    expect(await prepareTestDatabase(args)).toBe(0);
    // drugi przebieg: zero migracji (tylko seedy, które są idempotentne) i zero nowych wpisów
    expect(calls.slice(before).filter((s) => s.startsWith(`insert into ${REGISTRY}`))).toHaveLength(0);
    expect((await db.query(`select count(*)::int as n from ${REGISTRY}`)).rows[0].n).toBe(files.length);
    expect((await db.query(`select count(*)::int as n from public.companies where name like 'TEST %'`)).rows[0].n).toBe(8);
    await db.close();
  }, 240_000);
});
