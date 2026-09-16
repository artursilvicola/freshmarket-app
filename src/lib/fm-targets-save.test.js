import { describe, it, expect, vi, beforeEach } from "vitest";

// [fix/security-hotfix] setCompanyTargetRetailers: zapis wyborów TYLKO przez RPC —
// żaden błąd (walidacja, uprawnienia, zamknięta faza, brak RPC, sieć) nie może
// uruchomić kasowania starej listy (review Codexa c8842c8, P1).
const rpc = vi.fn();
const from = vi.fn(() => { throw new Error("bezpośredni zapis do tabeli jest zabroniony"); });
vi.mock("./supabase", () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: (k) => k } }));
const { setCompanyTargetRetailers } = await import("./db.js");

beforeEach(() => { rpc.mockReset(); from.mockClear(); });

describe("zapis wyborów przez RPC fm_set_company_targets", () => {
  it("sukces: przekazuje listę i zwraca wiersze zapisane w bazie", async () => {
    rpc.mockResolvedValue({ data: [{ company_id: "co1", retailer_id: 100, priority: 1000, note: "chain:ch1" }], error: null });
    const out = await setCompanyTargetRetailers("co1", [{ retailer_id: 100, priority: 1000, note: "chain:ch1" }, { retailer_id: 101 }]);
    expect(rpc).toHaveBeenCalledWith("fm_set_company_targets", { p_company_id: "co1", p_items: [
      { retailer_id: 100, priority: 1000, note: "chain:ch1" }, { retailer_id: 101, priority: 0, note: null } ] });
    expect(out).toEqual([{ company_id: "co1", retailer_id: 100, priority: 1000, note: "chain:ch1" }]);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["błąd walidacji z nazwą funkcji w treści", { code: "P0001", message: "fm_set_company_targets: nieznana sieć: 123" }],
    ["brak uprawnień", { code: "42501", message: "fm_set_company_targets: brak uprawnień do tej firmy" }],
    ["zamknięta faza", { code: "P0001", message: "fm_inputs_locked" }],
    ["brak prawa udziału", { code: "42501", message: "fm_inputs_forbidden", hint: "company_suspended" }],
    ["błąd sieci", { message: "TypeError: Failed to fetch" }],
  ])("%s → błąd idzie dalej, tabela NIE jest dotykana", async (_n, error) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(setCompanyTargetRetailers("co1", [])).rejects.toBe(error);
    expect(from).not.toHaveBeenCalled();
  });

  it("brak RPC (front przed migracją 055) → czytelny błąd, bez DELETE + INSERT", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.fm_set_company_targets(p_company_id, p_items) in the schema cache" } });
    await expect(setCompanyTargetRetailers("co1", [{ retailer_id: 100 }])).rejects.toMatchObject({ code: "FM_TARGETS_RPC_MISSING", message: "legacy:errors.db.fm_targets_rpc_missing" });
    expect(from).not.toHaveBeenCalled();
  });

  it("brak companyId = błąd programisty, bez wywołań", async () => {
    await expect(setCompanyTargetRetailers(null, [])).rejects.toThrow("companyId");
    expect(rpc).not.toHaveBeenCalled();
  });
});
