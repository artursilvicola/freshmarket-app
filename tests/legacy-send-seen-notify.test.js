// [feat/free-credit-grants v4] Ścieżka „odczytano” z PRAWDZIWYM notifierem (supplier-read-notify.js),
// atrapą bazy/RPC i atrapą fetch (zero ruchu sieciowego, zero maili). Reprodukcja z review Codexa v3:
// odczyt A bez kredytów uruchamia powiadomienie i czeka na pocztę → admin przyznaje → odczyt B rozlicza →
// notifier A kończy → odczyt C. Oczekiwane: JEDNO pobranie; znacznik rozliczenia B nie znika;
// notifier nigdy nie woła update() na legacy_sends — znacznik powiadomienia idzie przez RPC scalające 3 pola.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markLegacySendsSeen } from "../netlify/functions/_shared/legacy-send-seen.js";

function fakeDb({ credits = 0, locale = 'pl' } = {}) {
  const state = { credits, charges: 0, updates: 0, notifyRpc: 0, row: { id: "send-1", legacy_id: 1, supplier_legacy_id: "supplier-1", retailer_id: 1, offer_legacy_id: 77, status: "sent", data: {} } };
  const supa = {
    from(table) {
      return {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        in() { return Promise.resolve({ data: table === "legacy_sends" ? [structuredClone(state.row)] : table === "retailers" ? [{ id: 1, name: "Test retailer" }] : table === "legacy_offers" ? [{ legacy_id: 77, data: { title: "Avocado" } }] : [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === "profiles" ? { name: "Test", email: "nobody@example.invalid", active: true, locale } : { id: "company-1", name: "Test company", legacy_supplier_id: "supplier-1" }, error: null }); },
        update() { state.updates += 1; return { eq: async () => ({ error: null }) }; },
      };
    },
    async rpc(name, args) {
      const row = state.row;
      if (name === "mark_legacy_sends_supplier_notified") {
        state.notifyRpc += 1;
        if (row.data.supplierNotifiedAt) return { data: 0, error: null };
        // scalanie TYLKO 3 pól z AKTUALNYM wierszem (jak w bazie)
        row.data = { ...row.data, supplierNotifiedAt: args.p_notified_at, supplierNotifiedVia: args.p_via, supplierNotifiedBatchSize: args.p_batch_size };
        return { data: 1, error: null };
      }
      if (name !== "mark_legacy_send_seen") return { data: null, error: { code: "PGRST202", message: "not found" } };
      const prev = row.status; const next = ["sent", "opened"].includes(prev) ? "read" : prev;
      row.data = { ...row.data, status: next, seenAt: row.data.seenAt || args.p_now, readAt: row.data.readAt || args.p_now, readType: row.data.readType || "auto_buyer_preconnect_list" }; row.status = next;
      let billing;
      if (row.data.billingStatus === "charged") billing = { charged: false, already_charged: true, billing_status: "charged", charge_at: row.data.chargeAt, package_id: "pkg", package_source: "grant", charge_tx_id: row.data.chargeTxId };
      else if (state.credits > 0) { state.credits -= 1; state.charges += 1; row.data = { ...row.data, billingStatus: "charged", chargeAt: args.p_now, packageId: "pkg", packageSource: "grant", chargeTxId: "tx-" + state.charges }; billing = { charged: true, already_charged: false, billing_status: "charged", charge_at: args.p_now, package_id: "pkg", package_source: "grant", charge_tx_id: row.data.chargeTxId, charge_amount: 0, currency: "EUR" }; }
      else { billing = { charged: false, already_charged: false, billing_status: "no_package_available" }; row.data = { ...row.data, billingStatus: "no_package_available" }; }
      return { data: { skipped: false, previous_status: prev, status: next, data: structuredClone(row.data), billing, supplier_notified_before: !!row.data.supplierNotifiedAt }, error: null };
    },
  };
  return { supa, state };
}
const env = { resendApiKey: "fake-not-a-key", b2bAppUrl: "https://example.invalid" };
const call = (supa, notifySupplier) => markLegacySendsSeen({ supaSvc: supa, env, legacyIds: [1], channel: "app_list", notifySupplier });

describe("markLegacySendsSeen + prawdziwy notifier (fetch = atrapa)", () => {
  let realFetch, fetchCalls;
  beforeEach(() => { realFetch = globalThis.fetch; fetchCalls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it.each([
    ['pl','pl','zobaczyła'],
    ['en','en','saw your submission'],
    [null,'pl','zobaczyła'],
  ])('keeps the read notification in supplier profile locale %s',async (locale, lang, subject) => {
    const {supa} = fakeDb({credits:1,locale});
    globalThis.fetch = vi.fn(async () => ({ok:true,json:async () => ({id:'mock-mail'})}));
    const result = await call(supa,true);
    expect(result.notificationSummary.status).toBe('sent');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const mail = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(mail.to).toEqual(['nobody@example.invalid']);
    expect(mail.html).toContain(`<html lang="${lang}">`);
    expect(mail.subject).toContain(subject);
  });

  it("reprodukcja Codexa v3: powiadomienie kończące się po rozliczeniu B nie kasuje znacznika; C = already_charged; jedno pobranie", async () => {
    const { supa, state } = fakeDb({ credits: 0 });
    let release, entered; const reached = new Promise((r) => { entered = r; }); const resume = new Promise((r) => { release = r; });
    globalThis.fetch = async (url, init) => { fetchCalls.push({ url, init }); entered(); await resume; return { ok: true, json: async () => ({ id: "mock-mail" }) }; };

    const a = call(supa, true);            // A: brak kredytów → notifier czeka na pocztę
    await reached;
    expect(state.row.data.billingStatus).toBe("no_package_available");
    state.credits = 2;                      // admin przyznaje
    const b = await call(supa, false);      // B: rozlicza
    expect(b.results[0].billing).toMatchObject({ charged: true, billingStatus: "charged" });
    expect(state.row.data.chargeTxId).toBe("tx-1");
    release(); const ra = await a;          // notifier A kończy i zapisuje znacznik przez RPC
    expect(ra.results[0].billing.billingStatus).toBe("no_package_available");
    expect(ra.notificationSummary?.status).toBe("sent");
    expect(state.row.data).toMatchObject({ billingStatus: "charged", chargeTxId: "tx-1", packageSource: "grant", supplierNotifiedVia: "app_list", supplierNotifiedBatchSize: 1 });
    expect(state.row.data.supplierNotifiedAt).toBeTruthy();
    const c = await call(supa, false);      // C: nie pobiera drugi raz
    expect(c.results[0].billing).toMatchObject({ charged: false, alreadyCharged: true, billingStatus: "charged" });
    expect(state.charges).toBe(1);
    expect(state.updates).toBe(0);          // ani seen, ani notifier nie robią update() na legacy_sends
    expect(state.notifyRpc).toBe(1);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("api.resend.com");
    expect(JSON.parse(fetchCalls[0].init.body).to).toEqual(["nobody@example.invalid"]);
  });

  it("drugi odczyt nie wysyła drugiego maila (supplier_notified_before), a błąd RPC znacznika nie udaje sukcesu", async () => {
    const { supa, state } = fakeDb({ credits: 1 });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) });
    const r1 = await call(supa, true);
    expect(r1.results[0].notification).toEqual({ status: "queued" });
    expect(state.notifyRpc).toBe(1);
    const r2 = await call(supa, true);
    expect(r2.results[0].notification).toBeNull();
    expect(r2.notificationSummary).toBeNull();
    expect(state.notifyRpc).toBe(1);

    // [fix/supplier-read-notify-once] Znacznik jest ZAJMOWANY PRZED wysyłką. Gdy RPC
    // znacznika padnie, nie wiemy czy usiadł — więc maila NIE wysyłamy. Wcześniej mail
    // szedł mimo błędu znacznika i kolejny odczyt wysyłał go po raz drugi.
    const { supa: supa2 } = fakeDb({ credits: 1 });
    const origRpc = supa2.rpc.bind(supa2);
    supa2.rpc = async (name, args) => (name === "mark_legacy_sends_supplier_notified" ? { data: null, error: { message: "boom" } } : origRpc(name, args));
    const wyslane = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = wyslane;
    const r3 = await call(supa2, true);
    const n = r3.notificationSummary.notifications[0];
    expect(n).toMatchObject({ ok: false, status: "error", reason: "marker_failed", marker_error: "boom" });
    expect(wyslane).not.toHaveBeenCalled();
  });

  // Odczyt wyzwalają dwie niezależne ścieżki: webhook Resend (email.opened) i panel
  // kupca. Przy kolejności „sprawdź → wyślij → oznacz" obie widziały pusty znacznik
  // i dostawca dostawał DWA maile o jednym odczycie.
  it("dwie ścieżki odczytu naraz → dostawca dostaje DOKŁADNIE jeden mail", async () => {
    const { supa, state } = fakeDb({ credits: 1 });
    const wyslane = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = wyslane;

    const [a, b] = await Promise.all([call(supa, true), call(supa, true)]);

    expect(wyslane).toHaveBeenCalledTimes(1);
    const statusy = [a, b]
      .map(r => r.notificationSummary?.notifications?.[0]?.status ?? r.results[0].notification?.status ?? null);
    // jedna ścieżka wysyła, druga widzi zajęty znacznik — i to NIE jest błąd
    expect(statusy.filter(x => x === "sent")).toHaveLength(1);
    expect([a, b].every(r => (r.notificationSummary?.notifications || []).every(n => n.ok !== false))).toBe(true);
    expect(state.charges).toBe(1);   // rozliczenie też tylko raz
  });
});
