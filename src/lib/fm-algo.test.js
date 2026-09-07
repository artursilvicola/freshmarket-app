import { describe, it, expect } from "vitest";
import {
  buildFMData, chainCapacity, scoreMatch, isPairExcluded, isSupplierEligible, getFMZone,
  FM_SCORE, FM_MIN_GAP, FM_MAX_M, FM_MEETINGS_PER_STATION,
} from "./fm-algo.js";

// ── helpery testowe ──────────────────────────────────────────────────────────
const chain = (id, extra = {}) => ({ id, name: `Sieć ${id}`, ...extra });
const supp = (id, extra = {}) => ({ id, name: `Firma ${id}`, pkg: "Business", ...extra });

// wszyscy chcą wszystkich: ⭐ + ✅ (kategoria A)
function mutualAll(suppliers, chains) {
  const prefs = {}, resps = {};
  chains.forEach(c => { resps[c.id] = {}; });
  suppliers.forEach(s => {
    prefs[s.id] = {};
    chains.forEach(c => { prefs[s.id][c.id] = "star"; resps[c.id][s.id] = "want"; });
  });
  return { prefs, resps };
}

describe("scoreMatch — hierarchia A–F", () => {
  it("mutual zawsze bije jednostronne", () => {
    expect(scoreMatch("star", "want")).toBe(FM_SCORE.MUTUAL_STAR_WANT);
    expect(scoreMatch("thumb", "want")).toBe(FM_SCORE.MUTUAL_THUMB_WANT);
    expect(scoreMatch("star", "chance")).toBe(FM_SCORE.MUTUAL_STAR_CHANCE);
    expect(scoreMatch("thumb", "chance")).toBe(FM_SCORE.MUTUAL_THUMB_CHANCE);
    expect(scoreMatch(undefined, "want")).toBe(FM_SCORE.ONE_SIDE_WANT);
    expect(scoreMatch(undefined, "chance")).toBe(FM_SCORE.ONE_SIDE_CHANCE);
    expect(scoreMatch("star", undefined)).toBe(0);
    expect(FM_SCORE.MUTUAL_THUMB_CHANCE).toBeGreaterThan(FM_SCORE.ONE_SIDE_WANT);
  });
  it("Zasada 0: wykluczenia per-pair i per-supplier", () => {
    expect(isPairExcluded("star", "remove")).toBe(true);
    expect(isPairExcluded("exclude", "want")).toBe(true);
    expect(isPairExcluded("star", "want")).toBe(false);
    expect(isSupplierEligible(supp("s1", { pkg: "Standard" }))).toBe(false);
    expect(isSupplierEligible(supp("s1", { fmB2bEnabled: false }))).toBe(false);
    expect(isSupplierEligible(supp("s1"))).toBe(true);
  });
  it("strefy numerków", () => {
    expect(getFMZone(null)).toBe("blocked");
    expect(getFMZone(25)).toBe("green");
    expect(getFMZone(26)).toBe("orange");
    expect(getFMZone(36)).toBe("red");
  });
});

describe("chainCapacity — pojemność = spotkania/stanowisko × aktywne stanowiska", () => {
  it("1 → 60, 2 → 120, 3 → 180 przy domyślnym parametrze (60/stanowisko)", () => {
    expect(FM_MEETINGS_PER_STATION).toBe(60);
    expect(chainCapacity(chain("c1", { stations: 1 })).cap).toBe(1 * FM_MEETINGS_PER_STATION);
    expect(chainCapacity(chain("c1", { stations: 2 })).cap).toBe(2 * FM_MEETINGS_PER_STATION);
    expect(chainCapacity(chain("c1", { stations: 3 })).cap).toBe(3 * FM_MEETINGS_PER_STATION);
  });
  it("brak konfiguracji → jawny fallback 1 stanowisko, configured=false", () => {
    const c = chainCapacity(chain("c1"));
    expect(c).toMatchObject({ stations: 1, cap: FM_MEETINGS_PER_STATION, configured: false });
    expect(chainCapacity(chain("c1", { stations: 0 })).configured).toBe(false);
    expect(chainCapacity(chain("c1", { stations: "abc" })).configured).toBe(false);
  });
  it("jawna pojemność (suma po grupach split) ma pierwszeństwo", () => {
    // Dino: Owoce 2 stanowiska × 5 + Kwiaty 1 stanowisko × 8 = 18
    expect(chainCapacity(chain("c1", { stations: 3, capacity: 18 })).cap).toBe(18);
    expect(chainCapacity(chain("c1", { stations: 3, capacity: 18 })).configured).toBe(true);
  });
  it("parametr per sieć i globalny (opts) nadpisują domyślne 5", () => {
    expect(chainCapacity(chain("c1", { stations: 2, meetingsPerStation: 8 })).cap).toBe(16);
    expect(chainCapacity(chain("c1"), { stationsByChain: { c1: 2 }, meetingsPerStation: 7 }).cap).toBe(14);
    // per sieć ma pierwszeństwo przed globalnym
    expect(chainCapacity(chain("c1", { stations: 1, meetingsPerStation: 3 }), { meetingsPerStation: 9 }).cap).toBe(3);
  });
});

describe("buildFMData — pojemność sieci", () => {
  it("sieć z 1 stanowiskiem i 5 spotk./stan. przyjmuje dokładnie 5, reszta dostaje ostrzeżenie chain_full", () => {
    const chains = [chain("c1", { stations: 1, meetingsPerStation: 5 })];
    const suppliers = Array.from({ length: 8 }, (_, i) => supp(`s${i + 1}`, { paymentDate: `2026-08-0${i + 1}` }));
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers);
    expect(out.cs.c1.n).toBe(5);
    expect(out.cs.c1.cap).toBe(5);
    const full = out.warnings.find(w => w.type === "chain_full");
    expect(full).toBeTruthy();
    expect(full.rejected).toBe(3);
    // kto wcześniej zapłacił, ten wszedł (s1..s5), s6..s8 poza pojemnością
    expect(out.cs.c1.list).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(out.warnings.filter(w => w.type === "no_meetings").map(w => w.supplierId)).toEqual(["s6", "s7", "s8"]);
  });
  it("2 stanowiska (parallel, np. Auchan ×2) → 120 miejsc; 70 firm wchodzi w całości", () => {
    const chains = [chain("c1", { stations: 2 })];
    const suppliers = Array.from({ length: 70 }, (_, i) => supp(`s${i + 1}`));
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers);
    expect(out.cs.c1.cap).toBe(120);
    expect(out.cs.c1.n).toBe(70);
    expect(out.warnings.some(w => w.type === "chain_full")).toBe(false);
  });
  it("1 stanowisko (60) przy 70 chętnych → 60 wchodzi, ostrzeżenie chain_full z liczbą odrzuconych", () => {
    const chains = [chain("c1", { stations: 1 })];
    const suppliers = Array.from({ length: 70 }, (_, i) => supp(`s${i + 1}`));
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers);
    expect(out.cs.c1.n).toBe(60);
    expect(out.warnings.find(w => w.type === "chain_full")?.rejected).toBe(10);
  });
  it("stanowiska z opts.stationsByChain (konfiguracja po fm26_chain_id)", () => {
    const chains = [chain("c1")];
    const suppliers = Array.from({ length: 12 }, (_, i) => supp(`s${i + 1}`));
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers, { stationsByChain: { c1: 2 }, meetingsPerStation: 5 });
    expect(out.cs.c1.n).toBe(10);
    expect(out.warnings.some(w => w.type === "no_station_config")).toBe(false);
  });
  it("brak konfiguracji stanowisk → fallback 1 + ostrzeżenie no_station_config dla admina", () => {
    const chains = [chain("c1"), chain("c2", { stations: 1 })];
    const suppliers = [supp("s1")];
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers);
    const w = out.warnings.filter(x => x.type === "no_station_config");
    expect(w.map(x => x.chainId)).toEqual(["c1"]);
    expect(out.cs.c1.cap).toBe(FM_MEETINGS_PER_STATION);
  });
  it("puste listy dają pusty plan (bez danych demo)", () => {
    const out = buildFMData({}, {}, [], []);
    expect(out).toEqual({ res: {}, cs: {}, nums: {}, cq: {}, warnings: [] });
  });
});

describe("buildFMData — reguły przydziału i numeracji", () => {
  it("firma nie przekracza FM_MAX_M spotkań (1 pakiet) i 2×FM_MAX_M przy 2 pakietach", () => {
    const chains = Array.from({ length: 12 }, (_, i) => chain(`c${i + 1}`, { stations: 1 }));
    const suppliers = [supp("s1"), supp("s2", { fmPackages: 2 })];
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers);
    expect(out.res.s1.m.length).toBe(FM_MAX_M);
    expect(out.res.s2.m.length).toBe(2 * FM_MAX_M);
  });
  it("spotkania jednej firmy mają odstęp ≥ FM_MIN_GAP, a numer w sieci jest unikalny", () => {
    const chains = Array.from({ length: 5 }, (_, i) => chain(`c${i + 1}`, { stations: 2 }));
    const suppliers = Array.from({ length: 10 }, (_, i) => supp(`s${i + 1}`, { paymentDate: `2026-08-${String(i + 1).padStart(2, "0")}` }));
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers);
    for (const sid of Object.keys(out.nums)) {
      const ns = Object.values(out.nums[sid]).sort((a, b) => a - b);
      for (let i = 1; i < ns.length; i++) expect(ns[i] - ns[i - 1]).toBeGreaterThanOrEqual(FM_MIN_GAP);
    }
    for (const cid of Object.keys(out.cq)) {
      const taken = out.cq[cid].filter(Boolean);
      expect(new Set(taken).size).toBe(taken.length);
      expect(taken.length).toBe(out.cs[cid].n);
    }
  });
  it("Premium wygrywa remis (ta sama kategoria, ta sama data płatności)", () => {
    const chains = [chain("c1", { stations: 1 })];
    const suppliers = [
      supp("s1", { pkg: "Business", paymentDate: "2026-08-01", _sortIdx: 0 }),
      supp("s2", { pkg: "Premium", paymentDate: "2026-08-01", _sortIdx: 1 }),
    ];
    const { prefs, resps } = mutualAll(suppliers, chains);
    const out = buildFMData(prefs, resps, chains, suppliers);
    expect(out.nums.s2.c1).toBe(1);
    expect(out.nums.s1.c1).toBe(2);
  });
  it("Standard i sieci z 'remove' nigdy nie wchodzą do planu", () => {
    const chains = [chain("c1", { stations: 1 })];
    const suppliers = [supp("s1", { pkg: "Standard" }), supp("s2")];
    const prefs = { s1: { c1: "star" }, s2: { c1: "star" } };
    const resps = { c1: { s1: "want", s2: "remove" } };
    const out = buildFMData(prefs, resps, chains, suppliers);
    expect(out.res.s1.m).toEqual([]);
    expect(out.res.s2.m).toEqual([]);
    expect(out.cs.c1.n).toBe(0);
  });
  it("mutual (👍+🤝) idzie przed jednostronnym (✅ bez wyboru firmy) mimo późniejszej płatności", () => {
    const chains = [chain("c1", { stations: 1 })];
    const suppliers = [supp("s1", { paymentDate: "2026-07-01" }), supp("s2", { paymentDate: "2026-08-30" })];
    const prefs = { s1: {}, s2: { c1: "thumb" } };
    const resps = { c1: { s1: "want", s2: "chance" } };
    const out = buildFMData(prefs, resps, chains, suppliers);
    expect(out.nums.s2.c1).toBe(1);
    expect(out.nums.s1.c1).toBe(2);
  });
});
