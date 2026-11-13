#!/usr/bin/env node
// [fix/buyer-entry-seen] Migracja 20261113120000 na PRAWDZIWYM Postgresie (baza testowa z .env.test),
// nie na atrapie. Całość w JEDNEJ transakcji zakończonej ROLLBACK: migracja, dane i wyniki
// nie zostają w bazie.
//
//   node scripts/manual-read-confirm-sql-test.mjs
//
// Kody: 0 OK · 1 niezaliczone · 2 brak .env.test · 3 odmowa (nie projekt testowy).
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { parseDotenv, validateTestEnv, dbUrlRef, PROD_REF } from "./lib/test-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.test");
if (!existsSync(envFile)) { console.error("Brak .env.test — testu SQL NIE wykonano."); process.exit(2); }
const fileEnv = parseDotenv(readFileSync(envFile, "utf8"));
const check = validateTestEnv(fileEnv);
const ref = dbUrlRef(fileEnv.TEST_DATABASE_URL);
if (!check.ok || !ref || ref === PROD_REF) { console.error("ODMOWA: .env.test nie wskazuje projektu testowego."); process.exit(3); }

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const db = new Client({ connectionString: fileEnv.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const migration = readFileSync(path.join(root, "supabase", "migrations", "20261113120000_manual_read_confirm.sql"), "utf8");
const COMPANY = "c0000000-0000-4000-8000-00000000e101";
const COMPANY_EMPTY = "c0000000-0000-4000-8000-00000000e102";
const RID = 9911;
const NOW = "2026-11-13T10:00:00Z";
const wyniki = [];
let nr = 0;
async function test(nazwa, fn) {
  nr += 1;
  await db.query(`savepoint t${nr}`);
  try { await fn(); wyniki.push([true, nazwa]); console.log("  OK   " + nazwa); }
  catch (e) { wyniki.push([false, nazwa]); console.log("  ŹLE  " + nazwa + " — " + (e?.message || e)); await db.query(`rollback to savepoint t${nr}`); }
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const send = async (legacyId) => one(`select id, status, data from legacy_sends where legacy_id = $1`, [legacyId]);
const used = async (company = COMPANY) => Number((await one(`select coalesce(sum(qty_used),0)::int n from packages where company_id = $1`, [company])).n);
const rpc = async (fn, args) => (await one(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).r;
async function newSend(legacyId, supplier, status = "sent", extra = {}) {
  const data = { id: legacyId, supplierId: supplier, retailerId: RID, status, sentAt: "2026-11-10", sendDate: "2026-11-10", daysLeft: 11, price: 40, confirmHistory: [], ...extra };
  await db.query(`insert into legacy_sends (legacy_id, supplier_legacy_id, retailer_id, status, data) values ($1,$2,$3,$4,$5::jsonb)`, [legacyId, supplier, RID, status, JSON.stringify(data)]);
  return (await send(legacyId)).id;
}

console.log(`Test SQL ręcznego potwierdzenia — projekt testowy ${ref} (transakcja wycofywana)`);
await db.query("begin");
try {
  await db.query(migration);
  await db.query(`insert into retailers (id, name, country, active) values ($1,'ZZZ SQL TEST sieć','PL',true)`, [RID]);
  await db.query(`insert into companies (id, name, legacy_supplier_id, account_status, preconnect_enabled) values ($1,'ZZZ SQL TEST dostawca','sup-sqltest-1','active',true), ($2,'ZZZ SQL TEST bez pakietu','sup-sqltest-2','active',true)`, [COMPANY, COMPANY_EMPTY]);
  await db.query(`insert into packages (company_id, plan, qty_total, qty_used, source, purchased_at, expires_at) values ($1,'std_5',5,0,'purchase',now(), current_date + 300)`, [COMPANY]);
  const A = await newSend(880001, "sup-sqltest-1");
  const B = await newSend(880002, "sup-sqltest-1");
  const C = await newSend(880003, "sup-sqltest-1", "read");
  const D = await newSend(880004, "sup-sqltest-2");

  await test("uprawnienia: tylko service_role", async () => {
    for (const [fn, sig] of [["confirm_legacy_send_manual", "uuid, uuid, text, text, timestamptz"], ["undo_legacy_send_manual_confirm", "uuid, timestamptz"]]) {
      const r = await one(`select has_function_privilege('authenticated', 'public.${fn}(${sig})', 'execute') a, has_function_privilege('anon', 'public.${fn}(${sig})', 'execute') n, has_function_privilege('service_role', 'public.${fn}(${sig})', 'execute') s`);
      assert.deepEqual([r.a, r.n, r.s], [false, false, true], fn);
    }
  });

  await test("potwierdzenie wysłanej: read_manual, 1 kredyt, znacznik manual, wpis w historii", async () => {
    const r = await rpc("confirm_legacy_send_manual", [A, COMPANY, "manual_phone", "rozmowa z kupcem", NOW]);
    assert.equal(r.skipped, false); assert.equal(r.status, "read_manual"); assert.equal(r.previous_status, "sent");
    assert.equal(r.billing.charged, true); assert.equal(r.supplier_notified_before, false);
    const s = await send(880001);
    assert.equal(s.status, "read_manual");
    assert.equal(s.data.status, "read_manual"); assert.equal(s.data.readType, "manual_phone"); assert.equal(s.data.manualNote, "rozmowa z kupcem");
    assert.equal(s.data.billingStatus, "charged"); assert.equal(s.data.chargeChannel, "manual"); assert.equal(s.data.seenChannel, "manual");
    assert.equal(s.data.manualPrevStatus, "sent"); assert.equal(s.data.daysLeft, 0);
    assert.equal(s.data.confirmHistory.length, 1); assert.equal(s.data.confirmHistory[0].action, "confirm");
    assert.equal(s.data.id, 880001, "pozostałe pola JSON-u nietknięte");
    assert.equal(await used(), 1);
    assert.equal(Number((await one(`select count(*) n from wallet_tx where reference_id = $1 and type = 'send_charge'`, [A])).n), 1);
  });

  await test("powtórne potwierdzenie: pominięte, bez drugiego kredytu", async () => {
    const r = await rpc("confirm_legacy_send_manual", [A, COMPANY, "manual_email", "", NOW]);
    assert.equal(r.skipped, true); assert.equal(r.reason, "status_read_manual");
    assert.equal(await used(), 1);
    assert.equal((await send(880001)).data.readType, "manual_phone");
  });

  await test("nieznany rodzaj potwierdzenia i brak wysyłki: błąd, nic nie zapisane", async () => {
    await db.query("savepoint bad");
    await assert.rejects(rpc("confirm_legacy_send_manual", [B, COMPANY, "cokolwiek", "", NOW]), /nieznany rodzaj/);
    await db.query("rollback to savepoint bad");
    await assert.rejects(rpc("confirm_legacy_send_manual", ["00000000-0000-4000-8000-000000000000", COMPANY, "manual_phone", "", NOW]), /nie istnieje/);
    await db.query("rollback to savepoint bad");
    assert.equal((await send(880002)).status, "sent");
  });

  await test("propozycja już przeczytana przez kupca: ręczne potwierdzenie pominięte", async () => {
    const r = await rpc("confirm_legacy_send_manual", [C, COMPANY, "manual_phone", "", NOW]);
    assert.equal(r.skipped, true); assert.equal(r.reason, "status_read");
    assert.equal(await used(), 1);
  });

  await test("po otwarciu maila (kredyt już pobrany): potwierdzenie bez drugiego kredytu i bez znacznika manual", async () => {
    const m = await rpc("mark_legacy_send_seen", [B, COMPANY, "email", NOW]);
    assert.equal(m.status, "opened"); assert.equal(m.billing.charged, true);
    assert.equal(await used(), 2);
    const r = await rpc("confirm_legacy_send_manual", [B, COMPANY, "manual_meeting", "", NOW]);
    assert.equal(r.skipped, false); assert.equal(r.previous_status, "opened");
    assert.equal(r.billing.charged, false); assert.equal(r.billing.already_charged, true);
    const s = await send(880002);
    assert.equal(s.status, "read_manual"); assert.equal(s.data.chargeChannel, undefined); assert.equal(s.data.seenChannel, "email");
    assert.equal(await used(), 2);
  });

  await test("cofnięcie ręcznego potwierdzenia: status „sent”, kredyt wraca, znaczniki znikają", async () => {
    await db.query(`update legacy_sends set data = data || '{"supplierNotifiedAt":"2026-11-13T10:00:05Z","supplierNotifiedVia":"manual","supplierNotifyMessageId":"m-1"}'::jsonb where id = $1`, [A]);
    const r = await rpc("undo_legacy_send_manual_confirm", [A, NOW]);
    assert.equal(r.skipped, false); assert.equal(r.status, "sent"); assert.equal(r.refunded, true);
    const s = await send(880001);
    assert.equal(s.status, "sent"); assert.equal(s.data.status, "sent");
    for (const k of ["billingStatus", "chargeAt", "packageId", "chargeTxId", "chargeChannel", "readAt", "readType", "manualNote", "manualPrevStatus", "seenAt", "seenChannel", "supplierNotifiedAt", "supplierNotifiedVia", "supplierNotifyMessageId"]) {
      assert.equal(k in s.data, false, `pole ${k} powinno zniknąć`);
    }
    assert.equal(s.data.daysLeft, 11, "14 dni od 10.11, liczone 13.11");
    assert.equal(s.data.confirmHistory.length, 2); assert.equal(s.data.confirmHistory[1].action, "undo"); assert.equal(s.data.confirmHistory[1].refunded, true);
    assert.equal(await used(), 1);
    const tx = await one(`select type::text, meta from wallet_tx where reference_id = $1 and type = 'refund'`, [A]);
    assert.equal(tx.type, "refund"); assert.equal(tx.meta.reason, "manual_confirm_undo");
  });

  await test("powtórne cofnięcie: pominięte, bez drugiego zwrotu", async () => {
    const r = await rpc("undo_legacy_send_manual_confirm", [A, NOW]);
    assert.equal(r.skipped, true); assert.equal(r.reason, "status_sent"); assert.equal(r.refunded, false);
    assert.equal(await used(), 1);
  });

  await test("cofnięcie po mailu: status wraca do „opened”, kredyt z otwarcia maila ZOSTAJE", async () => {
    const r = await rpc("undo_legacy_send_manual_confirm", [B, NOW]);
    assert.equal(r.status, "opened"); assert.equal(r.refunded, false);
    const s = await send(880002);
    assert.equal(s.status, "opened"); assert.equal(s.data.billingStatus, "charged"); assert.equal(s.data.seenChannel, "email");
    assert.equal(await used(), 1);
  });

  await test("po cofnięciu prawdziwy odczyt kupca rozlicza od nowa (raz)", async () => {
    const r = await rpc("mark_legacy_send_seen", [A, COMPANY, "app_list", NOW]);
    assert.equal(r.status, "read"); assert.equal(r.billing.charged, true); assert.equal(r.supplier_notified_before, false);
    assert.equal(await used(), 2);
    const again = await rpc("mark_legacy_send_seen", [A, COMPANY, "app_list", NOW]);
    assert.equal(again.billing.already_charged, true);
    assert.equal(await used(), 2);
  });

  await test("dostawca bez wolnego kredytu: potwierdzenie zapisane, nic nie pobrane; cofnięcie bez zwrotu", async () => {
    const r = await rpc("confirm_legacy_send_manual", [D, COMPANY_EMPTY, "manual_phone", null, NOW]);
    assert.equal(r.status, "read_manual"); assert.equal(r.billing.charged, false); assert.equal(r.billing.billing_status, "no_package_available");
    const s = await send(880004);
    assert.equal(s.data.billingStatus, "no_package_available"); assert.equal(s.data.chargeChannel, undefined); assert.equal(s.data.manualNote, "");
    const u = await rpc("undo_legacy_send_manual_confirm", [D, NOW]);
    assert.equal(u.status, "sent"); assert.equal(u.refunded, false);
    assert.equal(Number((await one(`select count(*) n from wallet_tx where company_id = $1`, [COMPANY_EMPTY])).n), 0);
  });
} finally {
  await db.query("rollback");
  const left = await one(`select (select count(*) from legacy_sends where legacy_id between 880001 and 880004)::int s, (select count(*) from pg_proc where proname in ('confirm_legacy_send_manual','undo_legacy_send_manual_confirm'))::int f`);
  console.log(`po wycofaniu: wysyłki testowe ${left.s}, funkcje w bazie ${left.f}`);
  await db.end();
}
const bad = wyniki.filter(([ok]) => !ok);
console.log(`\nWynik: ${wyniki.length - bad.length}/${wyniki.length}${bad.length ? " — NIEZALICZONE" : ""}`);
process.exit(bad.length || !wyniki.length ? 1 : 0);
