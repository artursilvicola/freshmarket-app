#!/usr/bin/env node
// [fix/buyer-entry-seen] WYŚCIG: odczyt kupca kontra cofnięcie ręcznego potwierdzenia — dwa PRAWDZIWE
// połączenia do Postgresa (baza testowa z .env.test), obie kolejności, mail i aplikacja.
// Review Codexa 13.11 (P1): cofnięcie nie może zwrócić kredytu ani przywrócić „sent”, jeśli kupiec
// propozycję odczytał — niezależnie od tego, która transakcja pierwsza weźmie blokadę wiersza.
//
//   node scripts/manual-read-confirm-race-test.mjs
//
// Wymaga migracji 20261113120000 wgranej na bazę testową. Tworzy własne dane „ZZZ RACE” (zatwierdzone,
// bo widzą je dwa połączenia) i usuwa je na końcu. Kody: 0 OK · 1 niezaliczone · 2 brak .env.test · 3 odmowa.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { parseDotenv, validateTestEnv, dbUrlRef, PROD_REF } from "./lib/test-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.test");
if (!existsSync(envFile)) { console.error("Brak .env.test — testu NIE wykonano."); process.exit(2); }
const fileEnv = parseDotenv(readFileSync(envFile, "utf8"));
const ref = dbUrlRef(fileEnv.TEST_DATABASE_URL);
if (!validateTestEnv(fileEnv).ok || !ref || ref === PROD_REF) { console.error("ODMOWA: .env.test nie wskazuje projektu testowego."); process.exit(3); }

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const open = async () => { const c = new Client({ connectionString: fileEnv.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RID = 9921;
const COMPANY = "c0000000-0000-4000-8000-00000000e201";
const SUP = "sup-race-1";
const IDS = [881001, 881002, 881003, 881004];
const main = await open();
const a = await open(); // odczyt kupca
const b = await open(); // cofnięcie administratora

async function cleanup() {
  await main.query(`delete from wallet_tx where company_id = $1`, [COMPANY]);
  await main.query(`delete from legacy_sends where legacy_id = any($1::bigint[])`, [IDS]);
  await main.query(`delete from packages where company_id = $1`, [COMPANY]);
  await main.query(`delete from companies where id = $1`, [COMPANY]);
  await main.query(`delete from retailers where id = $1`, [RID]);
}
const used = async () => Number((await main.query(`select coalesce(sum(qty_used),0)::int n from packages where company_id = $1`, [COMPANY])).rows[0].n);
const row = async (legacyId) => (await main.query(`select id, status, data from legacy_sends where legacy_id = $1`, [legacyId])).rows[0];
const txCount = async (id, type) => Number((await main.query(`select count(*) n from wallet_tx where reference_id = $1 and type = $2::wallet_tx_type`, [id, type])).rows[0].n);
async function prepare(legacyId) {
  const data = { id: legacyId, supplierId: SUP, retailerId: RID, status: "sent", sentAt: "2026-11-10", sendDate: "2026-11-10", daysLeft: 11, confirmHistory: [] };
  await main.query(`insert into legacy_sends (legacy_id, supplier_legacy_id, retailer_id, status, data) values ($1,$2,$3,'sent',$4::jsonb)`, [legacyId, SUP, RID, JSON.stringify(data)]);
  const id = (await row(legacyId)).id;
  const c = (await main.query(`select public.confirm_legacy_send_manual($1,$2,'manual_phone','wyścig', now()) r`, [id, COMPANY])).rows[0].r;
  assert.equal(c.billing.charged, true, "ręczne potwierdzenie powinno pobrać kredyt");
  return id;
}
// Pierwsza transakcja bierze blokadę wiersza i NIE zatwierdza; druga startuje i musi czekać; potem commit pierwszej.
async function race({ first, second }) {
  await first.conn.query("begin");
  const r1 = (await first.conn.query(first.sql, first.args)).rows[0].r;
  let done = false;
  const p2 = second.conn.query(second.sql, second.args).then((r) => { done = true; return r.rows[0].r; });
  await sleep(900);
  const blocked = !done;
  await first.conn.query("commit");
  const r2 = await p2;
  return { r1, r2, blocked };
}
const SEEN = `select public.mark_legacy_send_seen($1,$2,$3, now()) r`;
const UNDO = `select public.undo_legacy_send_manual_confirm($1, now()) r`;

const wyniki = [];
async function test(nazwa, fn) {
  try { await fn(); wyniki.push([true, nazwa]); console.log("  OK   " + nazwa); }
  catch (e) { wyniki.push([false, nazwa]); console.log("  ŹLE  " + nazwa + " — " + (e?.message || e)); try { await a.query("rollback"); } catch {} try { await b.query("rollback"); } catch {} }
}

console.log(`Wyścig odczyt kupca / cofnięcie — projekt testowy ${ref}, dwa połączenia`);
try {
  await cleanup();
  const fn = Number((await main.query(`select count(*) n from pg_proc where proname in ('confirm_legacy_send_manual','undo_legacy_send_manual_confirm')`)).rows[0].n);
  const stamped = (await main.query(`select prosrc like '%buyerSeenAt%' ok from pg_proc where proname = 'mark_legacy_send_seen'`)).rows[0]?.ok;
  if (fn !== 2 || !stamped) { console.error("Baza testowa nie ma aktualnej migracji 20261113120000 — testu NIE wykonano."); process.exitCode = 3; throw new Error("brak migracji"); }
  await main.query(`insert into retailers (id, name, country, active) values ($1,'ZZZ RACE sieć','PL',true)`, [RID]);
  await main.query(`insert into companies (id, name, legacy_supplier_id, account_status, preconnect_enabled) values ($1,'ZZZ RACE dostawca',$2,'active',true)`, [COMPANY, SUP]);
  await main.query(`insert into packages (company_id, plan, qty_total, qty_used, source, purchased_at, expires_at) values ($1,'std_20',20,0,'purchase',now(), current_date + 300)`, [COMPANY]);

  for (const [legacyId, channel, wantStatus] of [[881001, "email", "opened"], [881002, "app_list", "read"]]) {
    await test(`odczyt (${channel}) trzyma blokadę, cofnięcie czeka → kredyt ZOSTAJE, status „${wantStatus}”`, async () => {
      const id = await prepare(legacyId);
      const before = await used();
      const { r1, r2, blocked } = await race({ first: { conn: a, sql: SEEN, args: [id, COMPANY, channel] }, second: { conn: b, sql: UNDO, args: [id] } });
      assert.equal(blocked, true, "cofnięcie powinno czekać na blokadę wiersza");
      assert.equal(r1.billing.already_charged, true);
      assert.equal(r2.skipped, false); assert.equal(r2.refunded, false); assert.equal(r2.kept_reason, "buyer_read"); assert.equal(r2.status, wantStatus);
      const s = await row(legacyId);
      assert.equal(s.status, wantStatus); assert.equal(s.data.billingStatus, "charged"); assert.equal(s.data.chargeChannel, channel);
      assert.equal(await used(), before, "kredyt nie wraca");
      assert.equal(await txCount(id, "refund"), 0); assert.equal(await txCount(id, "send_charge"), 1);
    });
  }
  for (const [legacyId, channel, wantStatus] of [[881003, "email", "opened"], [881004, "app_list", "read"]]) {
    await test(`cofnięcie trzyma blokadę, odczyt (${channel}) czeka → zwrot, potem JEDNO nowe rozliczenie, status „${wantStatus}”`, async () => {
      const id = await prepare(legacyId);
      const before = await used();
      const { r1, r2, blocked } = await race({ first: { conn: b, sql: UNDO, args: [id] }, second: { conn: a, sql: SEEN, args: [id, COMPANY, channel] } });
      assert.equal(blocked, true, "odczyt powinien czekać na blokadę wiersza");
      assert.equal(r1.refunded, true); assert.equal(r1.status, "sent");
      assert.equal(r2.status, wantStatus); assert.equal(r2.billing.charged, true, "odczyt po cofnięciu rozlicza od nowa");
      const s = await row(legacyId);
      assert.equal(s.status, wantStatus); assert.equal(s.data.billingStatus, "charged");
      assert.equal(s.data.chargeChannel, undefined, "nowe rozliczenie nie jest ręczne");
      assert.equal(s.data.buyerSeenChannel, channel);
      assert.equal(await used(), before, "netto jeden kredyt: zwrot i ponowne pobranie");
      assert.equal(await txCount(id, "refund"), 1); assert.equal(await txCount(id, "send_charge"), 2);
    });
  }
} catch (e) {
  if (e?.message !== "brak migracji") { console.error("BŁĄD TESTU:", e?.message || e); wyniki.push([false, "przebieg"]); }
} finally {
  try { await a.query("rollback"); } catch {} try { await b.query("rollback"); } catch {}
  try { await cleanup(); console.log("dane „ZZZ RACE” usunięte"); } catch (e) { console.log("sprzątanie nieudane: " + e.message); }
  await a.end(); await b.end(); await main.end();
}
const bad = wyniki.filter(([ok]) => !ok);
console.log(`\nWynik: ${wyniki.length - bad.length}/${wyniki.length}${bad.length ? " — NIEZALICZONE" : ""}`);
process.exit(process.exitCode || (bad.length || !wyniki.length ? 1 : 0));
