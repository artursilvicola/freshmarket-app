#!/usr/bin/env node
// [feat/admin-activity] Kontrola deduplikacji wizyt przy RÓWNOCZESNYCH połączeniach na prawdziwym
// Postgresie (PGlite wykonuje zapytania po kolei, więc nie sprawdzi blokady). TYLKO baza testowa:
//   node scripts/app-activity-concurrency-check.mjs
// N osobnych połączeń jednocześnie woła record_app_visit() jako ten sam kupiec i dostawca
// (rola authenticated + sub w JWT, jak PostgREST). Oczekiwane: 1 wizyta na konto, hit_count = N.
// Na koniec usuwa wyłącznie wizyty utworzone przez tę kontrolę.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
  let ok = true;
  try {
    const pick = async (role) => (await admin.query(
      `select p.id from public.profiles p where p.role::text = $1 and p.email like '%freshmarket.test' order by p.email limit 1`, [role])).rows[0]?.id;
    const buyer = await pick("buyer"), supplier = await pick("supplier"), adm = await pick("admin");
    if (!buyer || !supplier || !adm) { console.error("Brak kont e2e (buyer/supplier/admin) na bazie testowej."); return 1; }
    const ids = [buyer, supplier, adm];
    const startedAt = (await admin.query("select now() as t")).rows[0].t;
    await admin.query("delete from public.app_visits where profile_id = any($1::uuid[]) and last_seen_at > now() - interval '30 minutes'", [ids]);

    const clients = await Promise.all(Array.from({ length: N * 3 }, async () => { const c = new Client({ connectionString: url, ssl }); await c.connect(); return c; }));
    const call = async (c, uid) => {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
      await c.query("set local role authenticated");
      const r = await c.query("select public.record_app_visit() as r");
      await c.query("commit");
      return r.rows[0].r;
    };
    const jobs = clients.map((c, i) => call(c, ids[i % 3]));
    const results = await Promise.all(jobs);
    await Promise.all(clients.map((c) => c.end().catch(() => {})));

    const rows = (await admin.query(
      "select profile_id, count(*)::int as visits, sum(hit_count)::int as hits from public.app_visits where profile_id = any($1::uuid[]) and started_at >= $2 group by profile_id", [ids, startedAt])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.profile_id, r]));
    const line = (label, uid, expVisits, expHits) => {
      const got = by[uid] || { visits: 0, hits: 0 };
      const pass = got.visits === expVisits && got.hits === expHits;
      ok = ok && pass;
      console.log(`${pass ? "OK  " : "BŁĄD"} ${label}: wizyty ${got.visits} (oczek. ${expVisits}), wejścia ${got.hits} (oczek. ${expHits})`);
    };
    line(`kupiec, ${N} równoczesnych połączeń`, buyer, 1, N);
    line(`dostawca, ${N} równoczesnych połączeń`, supplier, 1, N);
    line(`admin, ${N} równoczesnych połączeń (nie zapisuje)`, adm, 0, 0);
    const newFlags = results.filter((r, i) => i % 3 === 0 && r.new_visit).length;
    const pass2 = newFlags === 1; ok = ok && pass2;
    console.log(`${pass2 ? "OK  " : "BŁĄD"} dokładnie jedno wywołanie kupca utworzyło wizytę (${newFlags})`);

    const del = await admin.query("delete from public.app_visits where profile_id = any($1::uuid[]) and started_at >= $2", [ids, startedAt]);
    console.log(`sprzątanie: usunięto ${del.rowCount} wizyt utworzonych przez kontrolę`);
  } finally {
    await admin.end().catch(() => {});
  }
  console.log(ok ? "WSZYSTKO OK" : "SĄ BŁĘDY");
  return ok ? 0 : 1;
}

let code = 1;
try { code = await main(); } catch (e) { console.error("STOP:", e?.message || e); code = 1; }
process.exit(code);
