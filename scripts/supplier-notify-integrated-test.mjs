// Prawdziwy notifier na PRAWDZIWYM SQL-u (PGlite). Udawane są tylko dane firmy
// i poczta — zero sieci, zero maili.
//
// Powód istnienia: testy na atrapie bazy i testy samego SQL-a przechodziły, a mimo
// to zostawała luka MIĘDZY nimi — rezerwacja mieściła się w oknie idempotencji,
// ale wysyłka wypadała już po jego końcu (znalezisko Codexa, tura 5). Żadna z tych
// warstw osobno tego nie widzi: to styk kodu z zegarem bazy.
//
// Uruchomienie:
//   PGLITE_PATH=/sciezka/do/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/supplier-notify-integrated-test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { notifySupplierOffersRead, RETRY_WINDOW_SECONDS } from "../netlify/functions/_shared/supplier-read-notify.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = path.join(here, "..", "supabase", "migrations", "20261013090000_supplier_notify_claim.sql");

async function loadPGlite() {
  for (const c of [process.env.PGLITE_PATH, "@electric-sql/pglite"].filter(Boolean)) {
    try {
      const mod = await import(c.startsWith("@") ? c : pathToFileURL(path.resolve(c)).href);
      if (mod?.PGlite) return mod.PGlite;
    } catch { /* próbujemy dalej */ }
  }
  return null;
}
const PGlite = await loadPGlite();
if (!PGlite) {
  console.error("BRAK PGlite — testu NIE wykonano. Podaj PGLITE_PATH.");
  process.exit(2);
}

const HOUR = 3600_000;
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create table public.legacy_sends (
    legacy_id bigint primary key,
    data jsonb not null default '{}',
    updated_at timestamptz not null default now()
  );
`);
await db.exec(await readFile(migration, "utf8"));

// Typy argumentów RPC — PGlite nie ma PostgREST, więc wołamy po nazwach parametrów.
const RPC = {
  claim_legacy_sends_supplier_notify: { p_legacy_ids: "bigint[]", p_claim_token: "text", p_new_message_id: "text", p_claimed_at: "timestamptz", p_lease_seconds: "integer", p_idempotency_window_seconds: "integer" },
  ensure_legacy_send_notify_message: { p_message_id: "text", p_to_email: "text", p_subject: "text", p_html: "text", p_legacy_ids: "bigint[]" },
  confirm_legacy_sends_supplier_notified: { p_legacy_ids: "bigint[]", p_claim_token: "text", p_via: "text", p_batch_size: "integer", p_notified_at: "timestamptz" },
  release_legacy_sends_supplier_notify_claim: { p_legacy_ids: "bigint[]", p_claim_token: "text" },
  mark_legacy_sends_supplier_notify_uncertain: { p_legacy_ids: "bigint[]", p_claim_token: "text", p_reason: "text", p_at: "timestamptz" },
};
const ZWRACA_TABELE = new Set(["claim_legacy_sends_supplier_notify", "ensure_legacy_send_notify_message"]);

// Zegar testu. Kod produkcyjny czyta Date.now(), więc podmieniamy go na sterowany —
// inaczej nie da się stanąć sekundę przed końcem doby.
let teraz = Date.parse("2026-10-13T10:00:00Z");   // zegar BAZY (stąd supplierNotifyFirstClaimAt)
let rozjazdZegaraAplikacji = 0;                    // o tyle zegar Netlify spóźnia się za bazą
const realNow = Date.now;
Date.now = () => teraz - rozjazdZegaraAplikacji;
let opoznienieOdczytuTresci = 0;   // ile „trwa" ensure_... zanim wrócimy do kodu

const supa = {
  from(table) {
    return {
      select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
      async in(_col, ids) {
        if (table === "legacy_sends") {
          const { rows } = await db.query("select legacy_id, data from legacy_sends where legacy_id = any($1::bigint[]) order by legacy_id", [ids]);
          return { data: rows.map((r) => ({ ...r, status: "read", supplier_legacy_id: "supplier-1", retailer_id: 1, offer_legacy_id: Number(r.legacy_id) + 100 })), error: null };
        }
        if (table === "legacy_offers") return { data: [1, 2].map((id) => ({ legacy_id: id + 100, data: { title: `PROPOZYCJA-${id}` } })), error: null };
        if (table === "retailers") return { data: [{ id: 1, name: "Sieć testowa" }], error: null };
        throw new Error(`nieoczekiwana tabela ${table}`);
      },
      async maybeSingle() {
        return { data: table === "profiles"
          ? { name: "Dostawca", email: "nobody@example.invalid", active: true, locale: "pl" }
          : { id: "company-1", name: "Firma testowa", legacy_supplier_id: "supplier-1" }, error: null };
      },
    };
  },
  async rpc(name, podane) {
    const defs = RPC[name];
    assert.ok(defs, `nieznane RPC ${name}`);
    const args = { ...podane };
    // zegar bazy = zegar testu
    if (name === "claim_legacy_sends_supplier_notify") args.p_claimed_at = new Date(teraz).toISOString();
    if (name === "mark_legacy_sends_supplier_notify_uncertain") args.p_at = new Date(teraz).toISOString();
    const keys = Object.keys(args);
    for (const k of keys) assert.ok(defs[k], `nieoczekiwany argument ${k} w ${name}`);
    const binding = keys.map((k, i) => `${k} => $${i + 1}::${defs[k]}`).join(", ");
    const tabela = ZWRACA_TABELE.has(name);
    try {
      const sql = tabela ? `select * from public.${name}(${binding})` : `select public.${name}(${binding}) as n`;
      const { rows } = await db.query(sql, keys.map((k) => args[k]));
      if (name === "ensure_legacy_send_notify_message") teraz += opoznienieOdczytuTresci;
      return { data: tabela ? rows : rows[0].n, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// Poczta z regułami Resend: klucz ważny 24 h, ten sam ładunek = deduplikacja.
// `przesuniecieZegaraPoczty` modeluje rozjazd zegarów i opóźnienie sieci: u Resend
// jest nieco później niż u nas. To jest powód, dla którego nasze okno ponowień ma
// GODZINĘ ZAPASU — sama kontrola przed wysyłką porównuje do NASZEGO zegara i tej
// różnicy z definicji nie widzi.
let utworzone, poKluczu, przesuniecieZegaraPoczty;
globalThis.fetch = async (_url, init) => {
  const key = init.headers["Idempotency-Key"];
  const body = JSON.parse(init.body);
  const odcisk = JSON.stringify([body.to, body.subject, body.html]);
  const uPoczty = teraz + przesuniecieZegaraPoczty;
  const zapis = key ? poKluczu.get(key) : null;
  if (zapis && uPoczty - zapis.at < 24 * HOUR) {
    if (zapis.odcisk !== odcisk) return { ok: false, status: 409, text: async () => JSON.stringify({ name: "invalid_idempotent_request" }) };
    return { ok: true, json: async () => ({ id: zapis.id }) };
  }
  const id = `mail-${utworzone.length + 1}`;
  utworzone.push({ key, at: uPoczty, html: body.html });
  if (key) poKluczu.set(key, { id, odcisk, at: uPoczty });
  return { ok: true, json: async () => ({ id }) };
};

const env = { resendApiKey: "fake", b2bAppUrl: "https://example.invalid" };
const notify = (ids, via = "app_list") => notifySupplierOffersRead({ supaSvc: supa, env, legacyIds: ids, openedVia: via });

const wyniki = [];
async function test(nazwa, fn) {
  utworzone = []; poKluczu = new Map(); opoznienieOdczytuTresci = 0; przesuniecieZegaraPoczty = 0; rozjazdZegaraAplikacji = 0;
  await db.exec("truncate public.legacy_sends; truncate public.legacy_send_notify_messages;");
  await db.exec("insert into public.legacy_sends(legacy_id) values (1), (2);");
  try { await fn(); wyniki.push(["OK", nazwa]); }
  catch (e) { wyniki.push(["BŁĄD", `${nazwa} — ${e.message}`]); }
}

await test("zwykła ścieżka: jeden mail, wiersze potwierdzone", async () => {
  teraz = Date.parse("2026-10-13T10:00:00Z");
  const r = await notify([1, 2]);
  assert.equal(utworzone.length, 1);
  assert.equal(r.notifications[0].status, "sent");
  assert.equal(r.notifications[0].confirm_ok, true);
  const { rows } = await db.query("select data from legacy_sends order by legacy_id");
  assert.ok(rows.every((x) => x.data.supplierNotifiedAt), "oba wiersze powiadomione");
});

await test("odpowiedź ginie, ponowienie po dzierżawie → nadal JEDEN mail", async () => {
  teraz = Date.parse("2026-10-13T10:00:00Z");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => { await realFetch(u, i); throw new Error("ECONNRESET"); };
  await notify([1]);
  globalThis.fetch = realFetch;
  assert.equal(utworzone.length, 1);

  teraz += 20 * 60 * 1000;                  // dzierżawa wygasła
  const r = await notify([1]);
  assert.equal(utworzone.length, 1, "poczta nie utworzyła drugiej wiadomości");
  assert.equal(r.notifications[0].status, "sent");
});

// ── znalezisko Codexa, tura 5 ────────────────────────────────────────────────
await test("próba, która wysłałaby PO terminie, jest zatrzymana przed wysyłką", async () => {
  teraz = Date.parse("2026-10-13T10:00:00Z");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => { await realFetch(u, i); throw new Error("ECONNRESET"); };
  await notify([1]);
  globalThis.fetch = realFetch;
  assert.equal(utworzone.length, 1);

  // Start sekundę przed końcem NASZEGO okna ponowień (23 h), odczyt zapisanej treści
  // trwa dwie sekundy — wysyłka wypadłaby już po terminie. Rezerwacja przechodzi,
  // bo w jej momencie termin jeszcze był; zatrzymać musi kontrola przed wysyłką.
  teraz = Date.parse("2026-10-13T10:00:00Z") + 23 * HOUR - 1000;
  opoznienieOdczytuTresci = 2000;
  const r = await notify([1]);

  assert.equal(utworzone.length, 1, "nic nowego nie poszło");
  assert.equal(r.notifications[0].status, "needs_review");
  assert.equal(r.notifications[0].reason, "retry_window_elapsed_before_send");
  const { rows } = await db.query("select data from legacy_sends where legacy_id = 1");
  assert.ok(rows[0].data.supplierNotifyMessageId, "tożsamość zachowana");
  assert.ok(!rows[0].data.supplierNotifiedAt, "nie udajemy, że powiadomiliśmy");
});

await test("po oknie rezerwacja w ogóle nie dochodzi do skutku (needs_review z SQL)", async () => {
  teraz = Date.parse("2026-10-13T10:00:00Z");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => { await realFetch(u, i); throw new Error("ECONNRESET"); };
  await notify([1]);
  globalThis.fetch = realFetch;

  teraz += 25 * HOUR;
  const r = await notify([1]);
  assert.equal(utworzone.length, 1);
  assert.equal(r.notifications[0].status, "needs_review");
  assert.equal(r.notifications[0].reason, "uncertain_outside_idempotency_window");
});

await test("okno ponowień jest KRÓTSZE niż ochrona poczty", async () => {
  // To jest warunek na stałą, nie dowód z zachowania — i tak go nazywam.
  //
  // Kontrola przed wysyłką porównuje czas z bazy (supplierNotifyFirstClaimAt)
  // z zegarem funkcji Netlify i wysyła żądanie, które dopiero leci do Resend.
  // Rozjazdu tych trzech zegarów ani czasu lotu żądania nie da się odtworzyć
  // w tym harnessie — stąd godzina zapasu. Ten warunek pilnuje, żeby ktoś jej
  // później nie skasował, podnosząc okno do pełnej doby.
  assert.ok(RETRY_WINDOW_SECONDS < 24 * 3600,
    `okno ponowień (${RETRY_WINDOW_SECONDS} s) musi być krótsze niż 24 h ochrony Resend`);
  assert.ok(RETRY_WINDOW_SECONDS >= 12 * 3600,
    "zbyt krótkie okno zamieniłoby zwykłe opóźnienia w sprawy do ręcznego sprawdzenia");
});

await test("409 o innej treści nie zapisuje powiadomienia", async () => {
  teraz = Date.parse("2026-10-13T10:00:00Z");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    poKluczu.set(i.headers["Idempotency-Key"], { id: "obcy", odcisk: "INNY", at: teraz });
    return realFetch(u, i);
  };
  const r = await notify([1]);
  globalThis.fetch = realFetch;
  assert.equal(r.notifications[0].status, "needs_review");
  assert.equal(r.notifications[0].reason, "idempotency_payload_conflict");
  const { rows } = await db.query("select data from legacy_sends where legacy_id = 1");
  assert.ok(!rows[0].data.supplierNotifiedAt);
});

Date.now = realNow;
await db.close();
for (const [status, nazwa] of wyniki) console.log(`${status.padEnd(5)} ${nazwa}`);
const bledy = wyniki.filter(([s]) => s !== "OK").length;
console.log(`\n${wyniki.length - bledy}/${wyniki.length} przeszło`);
process.exit(bledy ? 1 : 0);
