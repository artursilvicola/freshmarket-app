// [fix/supplier-read-notify-once v2] Powiadomienie dostawcy o odczycie — rezerwacja.
//
// Dwa znaleziska z review Codexa 13.10, każde odtworzone osobno:
//
//  1. Powiadomienie przepadało: znacznik „powiadomiono" szedł PRZED mailem, więc
//     odmowa poczty blokowała wysyłkę na zawsze.
//  2. Mail mógł zawierać cudze propozycje: RPC zwracał samą LICZBĘ zajętych wierszy,
//     a mail opisywał całą grupę. Odczyt A równolegle z paczką A+B dawał dwa maile,
//     oba z A.
//
// Atrapa bazy odwzorowuje warunki RPC z migracji 20261013090000 (rezerwacja z
// dzierżawą, potwierdzenie i zwolnienie tylko po własnym tokenie). Zero sieci.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notifySupplierOffersRead } from "../netlify/functions/_shared/supplier-read-notify.js";

const LEASE_MS = 900 * 1000;

function fakeDb(sendDefs) {
  // sendDefs: [{ legacy_id, offer_legacy_id, title }] — jeden dostawca, jedna sieć,
  // czyli wszystkie wiersze trafiają do tej samej grupy (jeden mail).
  const rows = sendDefs.map((d) => ({
    legacy_id: d.legacy_id,
    supplier_legacy_id: "supplier-1",
    retailer_id: 1,
    offer_legacy_id: d.offer_legacy_id,
    status: "read",
    data: {},
  }));
  const state = { rows, claims: 0, confirms: 0, releases: 0 };
  const byId = (id) => rows.find((r) => Number(r.legacy_id) === Number(id));

  const supa = {
    from(table) {
      return {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        in(_col, ids) {
          if (table === "legacy_sends") return Promise.resolve({ data: ids.map((id) => structuredClone(byId(id))).filter(Boolean), error: null });
          if (table === "retailers") return Promise.resolve({ data: [{ id: 1, name: "Test retailer" }], error: null });
          if (table === "legacy_offers") return Promise.resolve({ data: sendDefs.map((d) => ({ legacy_id: d.offer_legacy_id, data: { title: d.title } })), error: null });
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          return Promise.resolve({
            data: table === "profiles"
              ? { name: "Test", email: "nobody@example.invalid", active: true, locale: "pl" }
              : { id: "company-1", name: "Test company", legacy_supplier_id: "supplier-1" },
            error: null,
          });
        },
      };
    },
    async rpc(name, args) {
      if (name === "claim_legacy_sends_supplier_notify") {
        state.claims += 1;
        const now = Date.now();
        const claimed = [];
        for (const id of args.p_legacy_ids) {
          const row = byId(id);
          if (!row || row.data.supplierNotifiedAt) continue;
          const token = row.data.supplierNotifyClaimToken;
          const at = row.data.supplierNotifyClaimedAt ? Date.parse(row.data.supplierNotifyClaimedAt) : null;
          const wolny = !token || at === null || token === args.p_claim_token || at < now - LEASE_MS;
          if (!wolny) continue;
          row.data = { ...row.data, supplierNotifyClaimToken: args.p_claim_token, supplierNotifyClaimedAt: new Date(now).toISOString() };
          claimed.push(Number(row.legacy_id));
        }
        return { data: claimed, error: null };
      }
      if (name === "confirm_legacy_sends_supplier_notified") {
        state.confirms += 1;
        let n = 0;
        for (const id of args.p_legacy_ids) {
          const row = byId(id);
          if (!row || row.data.supplierNotifyClaimToken !== args.p_claim_token || row.data.supplierNotifiedAt) continue;
          const { supplierNotifyClaimToken, supplierNotifyClaimedAt, ...reszta } = row.data;
          row.data = { ...reszta, supplierNotifiedAt: args.p_notified_at, supplierNotifiedVia: args.p_via, supplierNotifiedBatchSize: args.p_batch_size };
          n += 1;
        }
        return { data: n, error: null };
      }
      if (name === "release_legacy_sends_supplier_notify_claim") {
        state.releases += 1;
        let n = 0;
        for (const id of args.p_legacy_ids) {
          const row = byId(id);
          if (!row || row.data.supplierNotifyClaimToken !== args.p_claim_token || row.data.supplierNotifiedAt) continue;
          const { supplierNotifyClaimToken, supplierNotifyClaimedAt, ...reszta } = row.data;
          row.data = reszta;
          n += 1;
        }
        return { data: n, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "not found" } };
    },
  };
  return { supa, state };
}

const env = { resendApiKey: "fake-not-a-key", b2bAppUrl: "https://example.invalid" };
const notify = (supa, legacyIds, openedVia = "app_list") =>
  notifySupplierOffersRead({ supaSvc: supa, env, legacyIds, openedVia });
const mailBody = (mock, i = 0) => JSON.parse(mock.mock.calls[i][1].body);

describe("powiadomienie dostawcy o odczycie — rezerwacja", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  // ── znalezisko 2 Codexa ───────────────────────────────────────────────────
  it("odczyt A równolegle z paczką A+B: DWA maile, ale A tylko w jednym z nich", async () => {
    const { supa, state } = fakeDb([
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ]);
    const poczta = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = poczta;

    // ścieżka 1: webhook o samym A; ścieżka 2: panel kupca o paczce A+B
    await Promise.all([notify(supa, [1], "resend_webhook"), notify(supa, [1, 2], "app_list")]);

    expect(poczta).toHaveBeenCalledTimes(2);
    const tresci = poczta.mock.calls.map((_, i) => mailBody(poczta, i).html);
    expect(tresci.filter((h) => h.includes("Awokado"))).toHaveLength(1);
    expect(tresci.filter((h) => h.includes("Banany"))).toHaveLength(1);
    // oba wiersze oznaczone, każdy przez swoją ścieżkę
    expect(state.rows.every((r) => r.data.supplierNotifiedAt)).toBe(true);
    expect(state.releases).toBe(0);
  });

  it("obie ścieżki o tej samej pojedynczej propozycji → dokładnie jeden mail", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const poczta = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = poczta;

    const [a, b] = await Promise.all([notify(supa, [1], "resend_webhook"), notify(supa, [1], "app_list")]);

    expect(poczta).toHaveBeenCalledTimes(1);
    const statusy = [a, b].map((r) => r.notifications[0]?.status ?? r.reason);
    expect(statusy.filter((s) => s === "sent")).toHaveLength(1);
    // druga ścieżka nie zgłasza błędu — zajęty wiersz to normalny stan
    expect([a, b].every((r) => r.notifications.every((n) => n.ok !== false))).toBe(true);
    expect(state.rows[0].data.supplierNotifiedVia).toBeTruthy();
  });

  // ── znalezisko 1 Codexa ───────────────────────────────────────────────────
  it("odmowa poczty zwalnia rezerwację i KOLEJNA próba wysyła — powiadomienie nie przepada", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, text: async () => "odmowa" }));

    const pierwsza = await notify(supa, [1]);
    expect(pierwsza.notifications[0]).toMatchObject({ ok: false, status: "error", delivery: "no", claim_released: true });
    expect(state.releases).toBe(1);
    // wiersz czysty: ani znacznika wysłania, ani zawieszonej rezerwacji
    expect(state.rows[0].data.supplierNotifiedAt).toBeUndefined();
    expect(state.rows[0].data.supplierNotifyClaimToken).toBeUndefined();

    const udana = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = udana;
    const druga = await notify(supa, [1]);
    expect(druga.notifications[0]).toMatchObject({ status: "sent", confirm_ok: true, confirm_rows: 1 });
    expect(udana).toHaveBeenCalledTimes(1);
    expect(mailBody(udana).html).toContain("Awokado");
  });

  it("brak odpowiedzi poczty (sieć): rezerwacja ZOSTAJE, natychmiastowe ponowienie nie dokłada maila", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNRESET"); });

    const pierwsza = await notify(supa, [1]);
    expect(pierwsza.notifications[0]).toMatchObject({ ok: false, status: "error", delivery: "unknown", claim_released: false });
    expect(state.releases).toBe(0);
    expect(state.rows[0].data.supplierNotifyClaimToken).toBeTruthy();

    // mail mógł pójść — do wygaśnięcia dzierżawy nie wysyłamy drugiego
    const udana = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = udana;
    const druga = await notify(supa, [1]);
    expect(udana).not.toHaveBeenCalled();
    expect(druga.notifications[0]?.status ?? druga.reason).toBe("already_notified");
  });

  it("po wygaśnięciu dzierżawy porzucona rezerwacja wraca do obiegu", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    state.rows[0].data = {
      supplierNotifyClaimToken: "porzucony",
      supplierNotifyClaimedAt: new Date(Date.now() - LEASE_MS - 60_000).toISOString(),
    };
    const udana = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = udana;

    const r = await notify(supa, [1]);
    expect(udana).toHaveBeenCalledTimes(1);
    expect(r.notifications[0]).toMatchObject({ status: "sent", confirm_ok: true });
  });

  it("błąd RPC rezerwacji: maila NIE wysyłamy", async () => {
    const { supa } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "claim_legacy_sends_supplier_notify" ? { data: null, error: { message: "boom" } } : origRpc(name, args));
    const poczta = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = poczta;

    const r = await notify(supa, [1]);
    expect(r.notifications[0]).toMatchObject({ ok: false, status: "error", reason: "claim_failed", claim_error: "boom" });
    expect(poczta).not.toHaveBeenCalled();
  });

  it("mail poszedł, potwierdzenie padło: status pozostaje sent, ale raport to odnotowuje", async () => {
    const { supa } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "confirm_legacy_sends_supplier_notified" ? { data: null, error: { message: "boom" } } : origRpc(name, args));
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));

    const r = await notify(supa, [1]);
    expect(r.notifications[0]).toMatchObject({ status: "sent", ok: false, confirm_ok: false, confirm_error: "boom" });
  });

  it("mail opisuje tylko propozycje z WŁASNEJ rezerwacji, gdy część zajęła inna ścieżka", async () => {
    const { supa, state } = fakeDb([
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ]);
    // A już zajęte przez cudzą, świeżą rezerwację
    state.rows[0].data = { supplierNotifyClaimToken: "cudzy", supplierNotifyClaimedAt: new Date().toISOString() };
    const poczta = vi.fn(async () => ({ ok: true, json: async () => ({ id: "mock-mail" }) }));
    globalThis.fetch = poczta;

    const r = await notify(supa, [1, 2]);
    expect(poczta).toHaveBeenCalledTimes(1);
    const html = mailBody(poczta).html;
    expect(html).toContain("Banany");
    expect(html).not.toContain("Awokado");
    expect(r.notifications[0]).toMatchObject({ status: "sent", legacy_ids: [2], offer_count: 1 });
  });
});
