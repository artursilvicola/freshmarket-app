import { describe, it, expect } from "vitest";
import { compareInputs, formatReport, SPEC } from "./fm-inputs-compare.js";

function full(overrides = {}) {
  const base = {};
  for (const t of Object.keys(SPEC)) base[t] = [];
  base.company_target_retailers = [{ company_id: "co1", retailer_id: 100, priority: 1000, note: "chain:ch1" }];
  base.fm_resps = [{ retailer_id: 100, supplier_company_id: "co1", zone: "green", status: "green", position: 1, meta: { supplier_legacy_id: "s1", chain_id: "ch1" } }];
  base.companies = [{ id: "co1", fm_selection_confirmed_at: null, fm_b2b_enabled: true, fm_b2b_tier: "business", fm_b2b_packages: 1, account_status: "active", legacy_fm_id: null, legacy_supplier_id: null }];
  base.profiles = [{ id: "u1", role: "supplier", company_id: "co1", retailer_id: null, active: true, fm26_active: false }];
  base.retailers = [{ id: 100, active: true, fm26_active: true, fm26_chain_id: "ch1", legacy_chain_id: null, fm_gate: null }];
  base.fm_settings = [{ id: "s", algo_phase: "preferences_open", selection_deadline: null, event_date: "2026-09-24" }];
  return { ...base, ...overrides };
}

describe("porównanie wejść algorytmu przed/po", () => {
  it("dwa puste pliki NIE są zgodne — brak sekcji to błąd", () => {
    const r = compareInputs({}, {});
    expect(r.errors.length).toBeGreaterThan(0);
    expect(formatReport(r)).toContain("NIEWIARYGODNE");
  });

  it("identyczne pełne eksporty = zgodne, wszystkie sekcje policzone", () => {
    const r = compareInputs(full(), full());
    expect(r.errors).toEqual([]);
    expect(r.diffs).toBe(0);
    expect(Object.keys(r.tables).sort()).toEqual(Object.keys(SPEC).sort());
    expect(formatReport(r)).toContain("Zgodne wybór po wyborze");
  });

  it("zmiana meta.supplier_legacy_id w odpowiedzi kupca jest różnicą", () => {
    const after = full();
    after.fm_resps = [{ ...after.fm_resps[0], meta: { supplier_legacy_id: "INNY", chain_id: "ch1" } }];
    const r = compareInputs(full(), after);
    expect(r.diffs).toBe(1);
    expect(r.tables.fm_resps.changed[0]).toContain("meta");
  });

  it("usunięty wybór i zmieniony priorytet są wskazane po kluczu firma|sieć", () => {
    const after = full();
    after.company_target_retailers = [{ company_id: "co1", retailer_id: 100, priority: 100, note: "chain:ch1" }];
    const r1 = compareInputs(full(), after);
    expect(r1.tables.company_target_retailers.changed[0]).toContain("co1|100");
    expect(r1.tables.company_target_retailers.changed[0]).toContain("priority: 1000 → 100");
    const gone = full(); gone.company_target_retailers = [];
    const r2 = compareInputs(full(), gone);
    expect(r2.tables.company_target_retailers.removed).toEqual(["co1|100"]);
  });

  it("zduplikowany klucz, brak klucza i brak kolumny = błędy formatu", () => {
    const dup = full();
    dup.company_target_retailers = [dup.company_target_retailers[0], { ...dup.company_target_retailers[0] }];
    expect(compareInputs(dup, full()).errors.some(e => e.includes("zduplikowany"))).toBe(true);
    const noKey = full();
    noKey.fm_resps = [{ ...noKey.fm_resps[0], retailer_id: null }];
    expect(compareInputs(noKey, full()).errors.some(e => e.includes("brak klucza retailer_id"))).toBe(true);
    const noCol = full();
    noCol.fm_resps = [{ retailer_id: 100, supplier_company_id: "co1", zone: "green" }];
    expect(compareInputs(noCol, full()).errors.some(e => e.includes("brak kolumny meta"))).toBe(true);
  });

  it("kolejność kluczy w meta nie robi różnicy", () => {
    const after = full();
    after.fm_resps = [{ ...after.fm_resps[0], meta: { chain_id: "ch1", supplier_legacy_id: "s1" } }];
    expect(compareInputs(full(), after).diffs).toBe(0);
  });
});
