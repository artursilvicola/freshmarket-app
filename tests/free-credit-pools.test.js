// [feat/free-credit-grants] Pule kredytów dostawcy (summarizeCreditPools), arytmetyka miesięcy
// kalendarzowych (addCalendarMonthsISO) i wrapper RPC przyznania (adminGrantFreeCredits).
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/lib/supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() }, isSupabaseConfigured: true }));
import { summarizeCreditPools, adminGrantFreeCredits, addCalendarMonthsISO, businessTodayISO } from "../src/lib/db.js";
import { supabase } from "../src/lib/supabase";

const T = "2026-09-27";
describe("summarizeCreditPools", () => {
  it("rozdziela bezpłatne (grant) i kupione, pomija wygasłe, liczy najbliższą ważność puli z wolnym kredytem", () => {
    const pools = summarizeCreditPools([
      { id: "g1", source: "grant", qty_total: 2, qty_used: 1, expires_at: "2026-12-27" },
      { id: "g2", source: "grant", qty_total: 1, qty_used: 1, expires_at: "2026-10-01" },   // zużyty → nie wpływa na expiry
      { id: "g3", source: "grant", qty_total: 3, qty_used: 0, expires_at: "2026-09-01" },   // wygasły → pominięty
      { id: "p1", source: "purchase", qty_total: 5, qty_used: 2, expires_at: "2027-03-31" },
      { id: "p2", qty_total: 10, qty_used: 10, expires_at: "2026-11-30" },                  // brak source = purchase
      { id: "p3", source: "purchase", qty_total: 1, qty_used: 0, expires_at: null },        // bez daty = nie wygasa
    ], T);
    expect(pools.free).toMatchObject({ total: 3, used: 2, remaining: 1, expiry: "2026-12-27" });
    expect(pools.paid).toMatchObject({ total: 16, used: 12, remaining: 4, expiry: "2027-03-31" });
    expect(pools.free.rows.map((r) => r.id)).toEqual(["g1", "g2"]);
  });
  it("byExpiry: pozostałe kredyty rozbite po terminach, rosnąco, bez terminu na końcu (1 do października ≠ 10 wygasających w październiku)", () => {
    const pools = summarizeCreditPools([
      { source: "grant", qty_total: 9, qty_used: 0, expires_at: "2026-12-27" },
      { source: "grant", qty_total: 1, qty_used: 0, expires_at: "2026-10-15" },
      { source: "grant", qty_total: 2, qty_used: 0, expires_at: "2026-12-27" },
      { source: "purchase", qty_total: 3, qty_used: 1, expires_at: null },
      { source: "purchase", qty_total: 4, qty_used: 0, expires_at: "2027-01-31" },
      { source: "purchase", qty_total: 5, qty_used: 5, expires_at: "2026-10-01" },          // zużyty → brak wpisu
    ], T);
    expect(pools.free.byExpiry).toEqual([{ expiry: "2026-10-15", remaining: 1 }, { expiry: "2026-12-27", remaining: 11 }]);
    expect(pools.free.expiry).toBe("2026-10-15");
    expect(pools.paid.byExpiry).toEqual([{ expiry: "2027-01-31", remaining: 4 }, { expiry: null, remaining: 2 }]);
  });
  it("puste wejście → zera, bez dat", () => {
    expect(summarizeCreditPools([], T)).toMatchObject({ free: { remaining: 0, expiry: null, byExpiry: [] }, paid: { remaining: 0, expiry: null, byExpiry: [] } });
    expect(summarizeCreditPools(null, T).paid.total).toBe(0);
  });
  it("qty_used większe niż qty_total nie daje ujemnych pozostałości", () => {
    expect(summarizeCreditPools([{ source: "grant", qty_total: 1, qty_used: 3, expires_at: "2027-01-01" }], T).free).toMatchObject({ remaining: 0, used: 1, byExpiry: [] });
  });
});

describe("addCalendarMonthsISO — jak Postgres (koniec miesiąca obcinany)", () => {
  it("koniec miesiąca", () => {
    expect(addCalendarMonthsISO("2026-01-31", 3)).toBe("2026-04-30");
    expect(addCalendarMonthsISO("2026-08-31", 3)).toBe("2026-11-30");
    expect(addCalendarMonthsISO("2026-11-30", 3)).toBe("2027-02-28");
    expect(addCalendarMonthsISO("2027-11-29", 3)).toBe("2028-02-29");
    expect(addCalendarMonthsISO("2028-02-29", 3)).toBe("2028-05-29");
  });
  it("zwykłe dni, przejście roku, wejście z czasem, śmieci", () => {
    expect(addCalendarMonthsISO("2026-09-27", 3)).toBe("2026-12-27");
    expect(addCalendarMonthsISO("2026-10-15", 3)).toBe("2027-01-15");
    expect(addCalendarMonthsISO("2026-09-27T23:59:00Z", 3)).toBe("2026-12-27");
    expect(addCalendarMonthsISO("2026-03-05", 0)).toBe("2026-03-05");
    expect(addCalendarMonthsISO("nope", 3)).toBeNull();
  });
  it("businessTodayISO: dzień w Europe/Warsaw, nie UTC (23:30 UTC 27.09 = 28.09 w Warszawie)", () => {
    expect(businessTodayISO(new Date("2026-09-27T23:30:00Z"))).toBe("2026-09-28");
    expect(businessTodayISO(new Date("2026-09-27T21:59:00Z"))).toBe("2026-09-27");
    expect(businessTodayISO(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});

describe("adminGrantFreeCredits (front → RPC)", () => {
  it("waliduje wejście zanim dotknie bazy", async () => {
    supabase.rpc.mockReset();
    await expect(adminGrantFreeCredits({ companyIds: [], qty: 1, reason: "gift", idempotencyKey: "k-12345678" })).rejects.toThrow();
    await expect(adminGrantFreeCredits({ companyIds: ["c1"], qty: 0, reason: "gift", idempotencyKey: "k-12345678" })).rejects.toThrow();
    await expect(adminGrantFreeCredits({ companyIds: ["c1"], qty: 1, reason: "bonus", idempotencyKey: "k-12345678" })).rejects.toThrow();
    await expect(adminGrantFreeCredits({ companyIds: ["c1"], qty: 1, reason: "gift", idempotencyKey: "short" })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it("deduplikuje firmy, normalizuje pola, null zamiast domyślnej daty, ten sam klucz idempotencji", async () => {
    supabase.rpc.mockReset().mockResolvedValue({ data: { batch_id: "b1", created: 1, already_done: false }, error: null });
    const res = await adminGrantFreeCredits({ companyIds: ["c1", "c1", " ", null], qty: "2", reason: "compensation", message: "  Rekompensata  ", note: "", expiresAt: null, idempotencyKey: "k-12345678" });
    expect(res).toMatchObject({ batch_id: "b1", created: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith("admin_grant_free_credits", {
      p_company_ids: ["c1"], p_qty: 2, p_reason: "compensation", p_idempotency_key: "k-12345678",
      p_message: "Rekompensata", p_note: null, p_expires_at: null,
    });
    await adminGrantFreeCredits({ companyIds: ["c1"], qty: 2, reason: "compensation", expiresAt: "2026-12-27T10:00:00Z", idempotencyKey: "k-12345678" });
    expect(supabase.rpc.mock.calls[1][1].p_expires_at).toBe("2026-12-27");
  });
  it("błąd RPC jest propagowany", async () => {
    supabase.rpc.mockReset().mockResolvedValue({ data: null, error: new Error("42501") });
    await expect(adminGrantFreeCredits({ companyIds: ["c1"], qty: 1, reason: "gift", idempotencyKey: "k-12345678" })).rejects.toThrow("42501");
  });
});
