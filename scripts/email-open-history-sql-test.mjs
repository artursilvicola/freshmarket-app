// Migracja 20261022120000 (historia otwarć per kupiec) na PRAWDZIWYM Postgresie (PGlite).
//
//   PGLITE_PATH=/sciezka/do/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/email-open-history-sql-test.mjs
// Bez PGlite skrypt kończy się kodem 2 — nie udaje, że przeszedł.
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = path.join(here, "..", "supabase", "migrations", "20261022120000_email_open_history.sql");

async function loadPGlite() {
  for (const c of [process.env.PGLITE_PATH, "@electric-sql/pglite"].filter(Boolean)) {
    try {
      const mod = await import(c.startsWith("@") ? c : pathToFileURL(path.resolve(c)).href);
      if (mod?.PGlite) return mod.PGlite;
    } catch { /* dalej */ }
  }
  return null;
}
const PGlite = await loadPGlite();
if (!PGlite) { console.error("BRAK PGlite — testu SQL NIE wykonano. Podaj PGLITE_PATH."); process.exit(2); }

const db = new PGlite();
const wyniki = [];
async function test(nazwa, fn) {
  try { await fn(); wyniki.push(["OK", nazwa]); }
  catch (e) { wyniki.push(["BŁĄD", `${nazwa} — ${e.message}`]); }
}

const ADMIN = "11111111-1111-4111-8111-111111111111";
const BUYER_A = "22222222-2222-4222-8222-222222222222";
const BUYER_B = "33333333-3333-4333-8333-333333333333";

// Minimum schematu, którego dotyka migracja: retailers, profiles, legacy_sends, is_admin(), role.
await db.exec(`
  -- (PGlite nie ma uuid-ossp; gen_random_uuid jest wbudowane)
  create role anon; create role authenticated; create role service_role bypassrls;
  create table public.retailers (id integer primary key, name text);
  create table public.profiles (id uuid primary key, role text, name text, email text, active boolean default true, retailer_id integer);
  create table public.legacy_sends (
    id uuid primary key default gen_random_uuid(),
    legacy_id bigint unique not null, supplier_legacy_id text not null default 's', offer_legacy_id bigint,
    retailer_id integer, status text, data jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now()
  );
  -- zamiast auth.uid(): zmienna sesyjna, którą test ustawia per rola
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create or replace function public.is_admin() returns boolean language sql security definer stable as $$
    select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;
  insert into public.retailers values (1, 'Sieć testowa'), (2, 'Inna sieć');
  insert into public.profiles (id, role, name, email, active, retailer_id) values
    ('${ADMIN}', 'admin', 'Admin', 'admin@example.invalid', true, null),
    ('${BUYER_A}', 'buyer', 'Anna Kupiec', 'anna@example.invalid', true, 1),
    ('${BUYER_B}', 'buyer', 'Bartek Kupiec', 'bartek@example.invalid', true, 1);
  insert into public.legacy_sends (legacy_id, retailer_id, status) values (101, 1, 'sent'), (102, 1, 'sent'), (201, 2, 'sent');
`);
await db.exec(await readFile(migration, "utf8"));
console.log("Postgres:", (await db.query("select version() as v")).rows[0].v.split(",")[0]);

const j = async (sql, params) => (await db.query(sql, params)).rows[0].r;

await test("zdarzenie PRZED powiązaniem zostaje jako orphan, nie przepada", async () => {
  const r = await j("select public.ingest_legacy_send_email_event($1,$2,$3,$4::timestamptz,$5::jsonb) as r",
    ["svix-1", "msg-A", "email.sent", "2026-10-22T10:00:00Z", { data: { email_id: "msg-A" } }]);
  assert.equal(r.duplicate, false);
  assert.equal(r.status, "orphan");
  assert.equal(r.message_known, false);
});

await test("powiązanie wiadomości: zapis + sierota wraca do pending i jest oddana wołającemu", async () => {
  const r = await j("select public.record_legacy_send_message($1,$2,$3::uuid,$4,$5::bigint[],$6::timestamptz,$7,$8) as r",
    ["msg-A", 1, BUYER_A, "anna@example.invalid", [102, 101, 101], "2026-10-22T09:59:00Z", "key-A", "pl"]);
  assert.equal(r.recorded, true);
  assert.deepEqual(r.message.legacy_ids, [101, 102], "id posortowane i bez duplikatów");
  assert.equal(r.pending_events.length, 1);
  assert.equal(r.pending_events[0].event_id, "svix-1");
  const st = await db.query("select status from public.legacy_send_email_events where event_id='svix-1'");
  assert.equal(st.rows[0].status, "pending");
});

await test("powtórne powiązanie tej samej wiadomości nic nie zmienia", async () => {
  const r = await j("select public.record_legacy_send_message($1,$2,$3::uuid,$4,$5::bigint[]) as r",
    ["msg-A", 1, BUYER_B, "ktos-inny@example.invalid", [999]]);
  assert.equal(r.recorded, false);
  assert.equal(r.message.to_email, "anna@example.invalid", "pierwszy zapis wygrywa");
  assert.deepEqual(r.message.legacy_ids, [101, 102]);
});

await test("zdarzenie po powiązaniu: pending z legacy_ids z wiadomości; powtórka = duplicate", async () => {
  const r = await j("select public.ingest_legacy_send_email_event($1,$2,$3,$4::timestamptz,$5::jsonb) as r",
    ["svix-2", "msg-A", "email.opened", "2026-10-22T10:05:00Z", {}]);
  assert.equal(r.status, "pending");
  assert.deepEqual(r.legacy_ids, [101, 102]);
  assert.equal(r.buyer_profile_id, BUYER_A);
  const d = await j("select public.ingest_legacy_send_email_event($1,$2,$3,$4::timestamptz,$5::jsonb) as r",
    ["svix-2", "msg-A", "email.opened", "2026-10-22T10:05:00Z", {}]);
  assert.equal(d.duplicate, true);
  assert.equal(d.status, "pending");
  const n = await db.query("select count(*)::int as n from public.legacy_send_email_events where event_id='svix-2'");
  assert.equal(n.rows[0].n, 1);
});

await test("nieznany typ zdarzenia = ignored; finish zmienia status i liczy próby", async () => {
  const r = await j("select public.ingest_legacy_send_email_event($1,$2,$3,$4::timestamptz,$5::jsonb) as r",
    ["svix-3", "msg-A", "email.something_new", null, {}]);
  assert.equal(r.status, "ignored");
  const n1 = await db.query("select public.finish_legacy_send_email_event($1,$2,$3::jsonb,$4) as n", ["svix-2", "error", null, "chwilowy"]);
  assert.equal(n1.rows[0].n, 1);
  const n2 = await db.query("select public.finish_legacy_send_email_event($1,$2,$3::jsonb,$4) as n", ["svix-2", "processed", { ok: true }, null]);
  assert.equal(n2.rows[0].n, 1);
  const e = await db.query("select status, attempts, processed_at is not null as done, last_error from public.legacy_send_email_events where event_id='svix-2'");
  assert.equal(e.rows[0].status, "processed");
  assert.equal(e.rows[0].attempts, 2);
  assert.equal(e.rows[0].done, true);
  assert.equal(e.rows[0].last_error, null);
});

await test("wejście do aplikacji: pierwsze tworzy wiersz, kolejne podbija licznik; różni kupcy = różne wiersze", async () => {
  const a1 = await j("select public.record_legacy_send_app_read($1,$2::uuid,$3,$4,$5::timestamptz) as r", [101, BUYER_A, "buyer", "app_list", "2026-10-22T11:00:00Z"]);
  assert.equal(a1.first, true);
  const a2 = await j("select public.record_legacy_send_app_read($1,$2::uuid,$3,$4,$5::timestamptz) as r", [101, BUYER_A, "buyer", "app_list", "2026-10-22T11:30:00Z"]);
  assert.equal(a2.first, false);
  const b1 = await j("select public.record_legacy_send_app_read($1,$2::uuid,$3,$4,$5::timestamptz) as r", [101, BUYER_B, "buyer", "app_list", "2026-10-22T12:00:00Z"]);
  assert.equal(b1.first, true);
  const adm = await j("select public.record_legacy_send_app_read($1,null,$2,$3,$4::timestamptz) as r", [101, "admin", "app_detail", "2026-10-22T12:10:00Z"]);
  assert.equal(adm.first, true);
  const rows = await db.query("select buyer_profile_id, channel, read_count from public.legacy_send_app_reads where legacy_id=101 order by first_read_at");
  assert.equal(rows.rows.length, 3);
  assert.equal(rows.rows[0].read_count, 2);
});

await test("admin_retailer_email_history: tylko admin; agregaty zdarzeń i wejścia osobno", async () => {
  await db.exec("select set_config('test.uid', '" + BUYER_A + "', false)");
  await assert.rejects(db.query("select public.admin_retailer_email_history(1)"), { code: "42501" }, "kupiec nie czyta historii");
  await db.exec("select set_config('test.uid', '" + ADMIN + "', false)");
  await db.query("select public.ingest_legacy_send_email_event($1,$2,$3,$4::timestamptz,$5::jsonb)", ["svix-4", "msg-A", "email.delivered", "2026-10-22T10:01:00Z", {}]);
  await db.query("select public.ingest_legacy_send_email_event($1,$2,$3,$4::timestamptz,$5::jsonb)", ["svix-5", "msg-A", "email.opened", "2026-10-22T13:00:00Z", {}]);
  const h = await j("select public.admin_retailer_email_history(1) as r");
  assert.equal(h.messages.length, 1);
  const m = h.messages[0];
  assert.equal(m.buyer_name, "Anna Kupiec");
  assert.equal(m.to_email, "anna@example.invalid");
  assert.equal(m.open_count, 2);
  assert.equal(new Date(m.first_opened_at).toISOString(), "2026-10-22T10:05:00.000Z");
  assert.equal(new Date(m.last_opened_at).toISOString(), "2026-10-22T13:00:00.000Z");
  assert.equal(new Date(m.delivered_at).toISOString(), "2026-10-22T10:01:00.000Z");
  assert.equal(h.app_reads.length, 3);
  assert.equal(h.app_reads.find((r) => r.buyer_profile_id === BUYER_B).buyer_name, "Bartek Kupiec");
  const other = await j("select public.admin_retailer_email_history(2) as r");
  assert.equal(other.messages.length, 0, "inna sieć nie widzi cudzej historii");
  await db.exec("select set_config('test.uid', '', false)");
});

await test("RLS: anon/authenticated bez dostępu do tabel i RPC backendu; admin SELECT przez RLS", async () => {
  for (const rola of ["anon", "authenticated"]) {
    await db.exec(`set role ${rola}`);
    await assert.rejects(db.query("select public.record_legacy_send_message('x',1,null,'x',array[1]::bigint[])"), { code: "42501" }, `${rola} record`);
    await assert.rejects(db.query("select public.ingest_legacy_send_email_event('x','x','email.opened',null,'{}')"), { code: "42501" }, `${rola} ingest`);
    await assert.rejects(db.query("select public.record_legacy_send_app_read(1,null,'buyer','app_list')"), { code: "42501" }, `${rola} app_read`);
    if (rola === "anon") {
      await assert.rejects(db.query("select * from public.legacy_send_messages"), { code: "42501" }, "anon tabela");
      await assert.rejects(db.query("select public.admin_retailer_email_history(1)"), { code: "42501" }, "anon admin RPC");
    }
    await db.exec("reset role");
  }
  // authenticated bez roli admin: SELECT przechodzi, ale RLS oddaje 0 wierszy
  await db.exec("set role authenticated");
  await db.exec("select set_config('test.uid', '" + BUYER_A + "', false)");
  const r = await db.query("select count(*)::int as n from public.legacy_send_messages");
  assert.equal(r.rows[0].n, 0, "kupiec nie widzi wiadomości przez RLS");
  await db.exec("select set_config('test.uid', '" + ADMIN + "', false)");
  const a = await db.query("select count(*)::int as n from public.legacy_send_messages");
  assert.equal(a.rows[0].n, 1, "admin widzi przez RLS");
  await db.exec("reset role");
});

await test("migracja jest idempotentna (drugie uruchomienie bez błędu i bez zmian)", async () => {
  const przed = await db.query("select count(*)::int as n from public.legacy_send_email_events");
  await db.exec(await readFile(migration, "utf8"));
  const po = await db.query("select count(*)::int as n from public.legacy_send_email_events");
  assert.equal(po.rows[0].n, przed.rows[0].n);
});

await db.close();
for (const [s, n] of wyniki) console.log(`${s.padEnd(5)} ${n}`);
const bledy = wyniki.filter(([s]) => s !== "OK").length;
console.log(`\n${wyniki.length - bledy}/${wyniki.length} przeszło`);
process.exit(bledy ? 1 : 0);
