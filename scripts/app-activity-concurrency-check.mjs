#!/usr/bin/env node
// [feat/admin-activity] Kontrola deduplikacji wizyt przy RÓWNOCZESNYCH połączeniach na prawdziwym
// Postgresie (PGlite wykonuje zapytania po kolei, więc nie sprawdzi blokady). TYLKO baza testowa:
//   node scripts/app-activity-concurrency-check.mjs
// Tworzy TYMCZASOWE konta (kupiec, dostawca, admin) z adresami @example.invalid, z kilku osobnych
// połączeń jednocześnie woła record_app_visit() jako każde z nich (rola authenticated + sub w JWT,
// jak PostgREST), sprawdza wynik i w `finally` usuwa te konta (kaskadowo ich wizyty).
// Nie dotyka istniejących kont ani ich historii. Wymaga włączonego zapisu (app_activity_settings.enabled).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parseDotenv, validateTestEnv, dbUrlRef, PROD_REF } from "./lib/test-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Client } = createRequire(import.meta.url)("pg");
const N = 4;   // pooler sesyjny bazy testowej: maks. 15 połączeń (3 konta × 4 + kontrolne)

async function main() {
  const file = path.join(root, ".env.test");
  if (!existsSync(file)) { console.error("Brak .env.test"); return 2; }
  const env = parseDotenv(readFileSync(file, "utf8"));
  const check = validateTestEnv(env);
  if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); return 3; }
  const url = env.TEST_DATABASE_URL;
  if (url.includes(PROD_REF) || !dbUrlRef(url)) { console.error("ODMOWA: baza nie jest testowa."); return 3; }
  const ssl = /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };

  const admin = new Client({ connectionString: url, ssl });
  await admin.connect();
  const run = randomUUID().slice(0, 8);
  const acc = { buyer: randomUUID(), supplier: randomUUID(), admin: randomUUID() };
  const ids = Object.values(acc);
  let ok = true;
  try {
    const enabled = (await admin.query("select enabled from public.app_activity_settings where id")).rows[0]?.enabled;
    if (!enabled) { console.error("STOP: zapis wejść wyłączony (app_activity_settings.enabled = false) — kontrola nie ma sensu."); return 4; }
    const retailer = (await admin.query("select id from public.retailers order by id limit 1")).rows[0]?.id ?? null;
    const company = (await admin.query("select id from public.companies order by created_at limit 1")).rows[0]?.id ?? null;
    for (const [role, id] of Object.entries(acc)) {
      const email = `activity-check-${run}-${role}@example.invalid`;
      await admin.query("insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now())", [id, email]);
      await admin.query(`insert into public.profiles (id, role, name, email, active, retailer_id, company_id) values ($1, $2::user_role, $3, $4, true, $5, $6)
        on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email, retailer_id = excluded.retailer_id, company_id = excluded.company_id`,
        [id, role, `Kontrola równoległości ${run}`, email, role === "buyer" ? retailer : null, role === "supplier" ? company : null]);
    }
    console.log(`konta tymczasowe: 3 (przebieg ${run})`);

    const clients = await Promise.all(Array.from({ length: N * 3 }, async () => { const c = new Client({ connectionString: url, ssl }); await c.connect(); return c; }));
    const call = async (c, uid) => {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
      await c.query("set local role authenticated");
      const r = await c.query("select public.record_app_visit() as r");
      await c.query("commit");
      return r.rows[0].r;
    };
    let results;
    try { results = await Promise.all(clients.map((c, i) => call(c, ids[i % 3]))); }
    finally { await Promise.all(clients.map((c) => c.end().catch(() => {}))); }

    const rows = (await admin.query("select profile_id, count(*)::int as visits, sum(hit_count)::int as hits from public.app_visits where profile_id = any($1::uuid[]) group by profile_id", [ids])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.profile_id, r]));
    const line = (label, uid, expVisits, expHits) => {
      const got = by[uid] || { visits: 0, hits: 0 };
      const pass = got.visits === expVisits && got.hits === expHits;
      ok = ok && pass;
      console.log(`${pass ? "OK  " : "BŁĄD"} ${label}: wizyty ${got.visits} (oczek. ${expVisits}), wejścia ${got.hits} (oczek. ${expHits})`);
    };
    line(`kupiec, ${N} równoczesnych połączeń`, acc.buyer, 1, N);
    line(`dostawca, ${N} równoczesnych połączeń`, acc.supplier, 1, N);
    line(`admin, ${N} równoczesnych połączeń (nie zapisuje)`, acc.admin, 0, 0);
    const newFlags = results.filter((r, i) => i % 3 === 0 && r.new_visit).length;
    const pass2 = newFlags === 1; ok = ok && pass2;
    console.log(`${pass2 ? "OK  " : "BŁĄD"} dokładnie jedno wywołanie kupca utworzyło wizytę (${newFlags})`);
  } finally {
    const del = await admin.query("delete from auth.users where id = any($1::uuid[])", [ids]).catch((e) => ({ rowCount: `błąd: ${e.message}` }));
    const left = (await admin.query("select count(*)::int as n from public.app_visits where profile_id = any($1::uuid[])", [ids]).catch(() => ({ rows: [{ n: "?" }] }))).rows[0].n;
    console.log(`sprzątanie: usunięte konta tymczasowe ${del.rowCount}, pozostałe wizyty tych kont ${left}`);
    await admin.end().catch(() => {});
  }
  console.log(ok ? "WSZYSTKO OK" : "SĄ BŁĘDY");
  return ok ? 0 : 1;
}

let code = 1;
try { code = await main(); } catch (e) { console.error("STOP:", e?.message || e); code = 1; }
process.exit(code);
