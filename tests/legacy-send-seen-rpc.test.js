// [feat/free-credit-grants v3] Ścieżka „odczytano” w Netlify po przeniesieniu zapisu do RPC.
// Odtwarza scenariusz z review Codexa v2 (P1): wywołanie A bez kredytów zwleka, admin przyznaje,
// B rozlicza, A kończy, C odczytuje ponownie → dokładnie JEDNO pobranie. Atrapa bazy emuluje
// semantykę RPC (scalanie tylko pól odczytu; znacznik zapisuje wyłącznie rozliczenie).
// Dodatkowo: moduł NIGDY nie wywołuje update() na legacy_sends; e-mail po odczycie nie cofa statusu.
import { describe, it, expect, vi } from "vitest";
vi.mock("../netlify/functions/_shared/supplier-read-notify.js", () => ({ notifySupplierOffersRead: vi.fn(async ({ legacyIds }) => ({ queued: legacyIds })) }));
import { markLegacySendsSeen, mapBilling } from "../netlify/functions/_shared/legacy-send-seen.js";
import { notifySupplierOffersRead } from "../netlify/functions/_shared/supplier-read-notify.js";

// Atrapa: jeden wiersz wysyłki + licznik kredytów; rpc('mark_legacy_send_seen') działa jak baza
// (blokada = sekwencja, scalanie pól odczytu, rozliczenie tylko gdy brak znacznika).
function fakeDb({ credits = 0, delayFirstNoCredit = false } = {}) {
  const state = { credits, charges: 0, updates: 0, rpcCalls: 0, row: { id: "send-1", legacy_id: 1, supplier_legacy_id: "supplier-1", retailer_id: 1, status: "sent", data: {} } };
  let release = null, entered = null;
  const reached = new Promise((r) => { entered = r; });
  const resume = new Promise((r) => { release = r; });
  const nextStatus = (prev, ch) => (ch === "email" ? (prev === "sent" ? "opened" : prev) : ["sent", "opened"].includes(prev) ? "read" : prev);
  const supa = {
    from(table) {
      return {
        select() { return this; }, eq() { return this; }, in() { return Promise.resolve({ data: [structuredClone(state.row)], error: null }); },
        maybeSingle() { return Promise.resolve({ data: { id: "company-1" }, error: null }); },
        update() { state.updates += 1; return { eq: async () => ({ error: null }) }; },
      };
    },
    async rpc(name, args) {
      state.rpcCalls += 1;
      if (name !== "mark_legacy_send_seen") return { data: null, error: { code: "PGRST202", message: "not found" } };
      const row = state.row; const prev = row.status; const next = nextStatus(prev, args.p_channel);
      const d = row.data; const now = args.p_now;
      const patch = { status: next, seenAt: d.seenAt || now, seenChannel: d.seenChannel || args.p_channel };
      if (args.p_channel === "email") patch.emailOpenedAt = d.emailOpenedAt || now;
      if (args.p_channel !== "email") { patch.readAt = d.readAt || now; patch.readType = d.readType || "auto_buyer_preconnect_list"; }
      row.data = { ...d, ...patch }; row.status = next;
      let billing;
      if (row.data.billingStatus === "charged") billing = { charged: false, already_charged: true, billing_status: "charged", charge_at: row.data.chargeAt, package_id: row.data.packageId, package_source: row.data.packageSource, charge_tx_id: row.data.chargeTxId };
      else if (state.credits > 0) { state.credits -= 1; state.charges += 1; row.data = { ...row.data, billingStatus: "charged", chargeAt: now, packageId: "pkg", packageSource: "grant", chargeTxId: "tx" }; billing = { charged: true, already_charged: false, billing_status: "charged", charge_at: now, package_id: "pkg", package_source: "grant", charge_tx_id: "tx", charge_amount: 0, currency: "EUR" }; }
      else { billing = { charged: false, already_charged: false, billing_status: "no_package_available" }; if (row.data.billingStatus !== "charged") row.data = { ...row.data, billingStatus: "no_package_available" }; }
      const result = { data: { skipped: false, previous_status: prev, status: next, data: structuredClone(row.data), billing, supplier_notified_before: !!row.data.supplierNotifiedAt }, error: null };
      if (delayFirstNoCredit && billing.billing_status === "no_package_available" && entered) { const e = entered; entered = null; e(); await resume; }
      return result;
    },
  };
  return { supa, state, reached, release: () => release() };
}
const call = (supa, channel = "app_list") => markLegacySendsSeen({ supaSvc: supa, env: {}, legacyIds: [1], channel, notifySupplier: false });

describe("markLegacySendsSeen (RPC)", () => {
  it("scenariusz Codexa: spóźnione A bez kredytów nie kasuje znacznika B; C = already_charged; jedno pobranie", async () => {
    const { supa, state, reached, release } = fakeDb({ credits: 0, delayFirstNoCredit: true });
    const first = call(supa);
    await reached;                      // A wisi po decyzji "no_package_available"
    state.credits = 2;                  // admin przyznaje kredyty
    const b = await call(supa);         // B rozlicza
    expect(b.results[0].billing).toMatchObject({ charged: true, billingStatus: "charged", packageSource: "grant" });
    release(); const a = await first;   // A kończy — nie ma żadnego zapisu poza RPC
    expect(a.results[0].billing.billingStatus).toBe("no_package_available");
    expect(state.row.data.billingStatus).toBe("charged");
    const c = await call(supa);
    expect(c.results[0].billing).toMatchObject({ charged: false, alreadyCharged: true, billingStatus: "charged" });
    expect(state.charges).toBe(1);
    expect(state.updates).toBe(0);      // moduł nie robi update() na legacy_sends
  });
  it("e-mail po odczycie w aplikacji nie cofa statusu ani readAt; wynik ma dotychczasowy kształt", async () => {
    const { supa, state } = fakeDb({ credits: 1 });
    const r1 = await call(supa, "app_list");
    expect(r1.results[0]).toMatchObject({ ok: true, previousStatus: "sent", status: "read", billing: { charged: true } });
    const readAt = state.row.data.readAt;
    const r2 = await call(supa, "email");
    expect(r2.results[0]).toMatchObject({ previousStatus: "read", status: "read", billing: { alreadyCharged: true, billingStatus: "charged" } });
    expect(state.row.data.readAt).toBe(readAt);
    expect(state.row.data.emailOpenedAt).toBeTruthy();
    expect(state.charges).toBe(1);
  });
  it("brak RPC (deploy przed migracją) = wynik error dla wiersza, nic nie rozliczone na ślepo", async () => {
    const { supa, state } = fakeDb({ credits: 5 });
    supa.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.mark_legacy_send_seen" } });
    const r = await call(supa);
    expect(r.results[0]).toMatchObject({ ok: false, status: "error" });
    expect(state.charges).toBe(0); expect(state.updates).toBe(0);
  });
  it("powiadomienie dostawcy kolejkowane raz (supplier_notified_before)", async () => {
    const { supa, state } = fakeDb({ credits: 1 });
    notifySupplierOffersRead.mockClear();
    const r = await markLegacySendsSeen({ supaSvc: supa, env: {}, legacyIds: [1], channel: "app_detail", notifySupplier: true });
    expect(r.results[0].notification).toEqual({ status: "queued" });
    expect(notifySupplierOffersRead).toHaveBeenCalledTimes(1);
    state.row.data.supplierNotifiedAt = "2026-09-27T10:00:00Z";
    const r2 = await markLegacySendsSeen({ supaSvc: supa, env: {}, legacyIds: [1], channel: "app_detail", notifySupplier: true });
    expect(r2.results[0].notification).toBeNull();
    expect(notifySupplierOffersRead).toHaveBeenCalledTimes(1);
  });
  it("mapBilling: snake_case → dotychczasowy kształt", () => {
    expect(mapBilling({ charged: true, billing_status: "charged", charge_at: "t", package_id: "p", package_source: "grant", charge_tx_id: "x", charge_amount: "45", currency: "EUR" }))
      .toEqual({ charged: true, billingStatus: "charged", chargeAt: "t", packageId: "p", packageSource: "grant", chargeTxId: "x", chargeAmount: 45, currency: "EUR" });
    expect(mapBilling({ charged: false, billing_status: "company_not_found" })).toEqual({ charged: false, billingStatus: "company_not_found" });
    expect(mapBilling(null)).toEqual({ charged: false, billingStatus: "no_package_available" });
  });
});
