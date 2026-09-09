import { describe, it, expect } from "vitest";
import { buildFMData, scoreMatch, isAutomaticChance, FM_MIN_GAP } from "./fm-algo.js";

const chain = (id, extra = {}) => ({ id, name: id, stations: 1, ...extra });
const supplier = (id, extra = {}) => ({ id, name: id, pkg: "Business", ...extra });

describe("brak odpowiedzi = szansa tylko dla zgłoszonej firmy", () => {
  it.each([undefined, null, ""])("pusta odpowiedź %s jest równoważna jawnej szansie", response => {
    for (const pref of ["star", "thumb"]) {
      expect(isAutomaticChance(pref, response)).toBe(true);
      expect(scoreMatch(pref, response)).toBe(scoreMatch(pref, "chance"));
    }
  });

  it("brak wyboru sieci przez dostawcę nie tworzy automatycznego spotkania", () => {
    for (const pref of [undefined, null, "", "unknown"]) {
      expect(isAutomaticChance(pref, undefined)).toBe(false);
      expect(scoreMatch(pref, undefined)).toBe(0);
    }
    const plan = buildFMData({ s: { a: "star" } }, {}, [chain("a"), chain("b")], [supplier("s")]);
    expect(plan.res.s.m).toEqual(["a"]);
    expect(plan.cs.b.n).toBe(0);
  });

  it("jawne odmowy i nieznane statusy nigdy nie stają się automatyczną szansą", () => {
    for (const response of ["remove", "rejected", "pending", "unknown", false, 0]) {
      expect(isAutomaticChance("star", response)).toBe(false);
      expect(scoreMatch("star", response)).toBe(0);
    }
    for (const pref of ["exclude", "remove", "rejected"]) {
      expect(scoreMatch(pref, undefined)).toBe(0);
      expect(scoreMatch(pref, "want")).toBe(0);
    }
  });

  it("20 zgłoszeń i milcząca sieć daje 20 spotkań, bez zapisu fikcyjnych odpowiedzi", () => {
    const suppliers = Array.from({ length: 20 }, (_, i) => supplier(`s${i}`));
    const prefs = Object.fromEntries(suppliers.map(s => [s.id, { a: "star" }]));
    const resps = {};
    const before = structuredClone({ prefs, resps });
    const plan = buildFMData(prefs, resps, [chain("a")], suppliers);
    expect(plan.cs.a.n).toBe(20);
    expect(plan.cs.a.list).toHaveLength(20);
    expect(new Set(Object.values(plan.nums).map(n => n.a)).size).toBe(20);
    expect(plan.warnings).toEqual([]);
    expect({ prefs, resps }).toEqual(before);
  });

  it("cały plan jest identyczny dla milczenia i jawnej szansy", () => {
    const chains = [chain("a"), chain("b")];
    const suppliers = [supplier("s1"), supplier("s2")];
    const prefs = { s1: { a: "star", b: "thumb" }, s2: { a: "thumb" } };
    expect(buildFMData(prefs, {}, chains, suppliers)).toEqual(buildFMData(
      prefs, { a: { s1: "chance", s2: "chance" }, b: { s1: "chance" } }, chains, suppliers,
    ));
  });

  it("wykluczenia pakietu i fmB2bEnabled pozostają twarde także przy milczeniu", () => {
    const suppliers = [supplier("standard", { pkg: "Standard" }), supplier("disabled", { fmB2bEnabled: false })];
    const prefs = Object.fromEntries(suppliers.map(s => [s.id, { a: "star" }]));
    const plan = buildFMData(prefs, {}, [chain("a")], suppliers);
    expect(plan.cs.a.n).toBe(0);
  });
});

describe("akceptacje zawsze przed szansami w przydziale i numeracji", () => {
  it("mieszane odpowiedzi: akceptacja, jawna szansa, milczenie, odmowa", () => {
    const suppliers = [
      supplier("yes", { paymentDate: "2026-09-09" }),
      supplier("chance", { paymentDate: "2026-07-01" }),
      supplier("silent", { paymentDate: "2026-07-02" }),
      supplier("no"),
    ];
    const prefs = Object.fromEntries(suppliers.map(s => [s.id, { a: "star" }]));
    const plan = buildFMData(prefs, { a: { yes: "want", chance: "chance", no: "remove" } }, [chain("a")], suppliers);
    expect(plan.cs.a.list).toEqual(["yes", "chance", "silent"]);
    expect(plan.nums).toEqual({ yes: { a: 1 }, chance: { a: 2 }, silent: { a: 3 }, no: {} });
  });

  it("akceptacja zapasowej sieci ma pierwszeństwo przed szansą głównej", () => {
    const plan = buildFMData(
      { yes: { a: "thumb" }, silent: { a: "star" } }, { a: { yes: "want" } },
      [chain("a", { capacity: 1 })], [supplier("silent"), supplier("yes")],
    );
    expect(plan.cs.a.list).toEqual(["yes"]);
  });

  it("kolejny obieg round-robin nie pozwala szansie zająć miejsca akceptacji", () => {
    // s1 ma już spotkanie w a, ale jego akceptacja w b nadal wygrywa z szansą s2.
    const prefs = { s1: { a: "star", b: "star" }, s2: { b: "star" } };
    const plan = buildFMData(prefs, { a: { s1: "want" }, b: { s1: "want" } },
      [chain("a"), chain("b", { capacity: 1 })], [supplier("s1"), supplier("s2")]);
    expect(plan.cs.b.list).toEqual(["s1"]);
    expect(plan.res.s2.m).toEqual([]);
  });

  it("szansa nie wypełnia niższego numeru pozostawionego przez odstęp między sieciami", () => {
    const plan = buildFMData(
      { s1: { a: "star", b: "star" }, s2: { b: "star" } },
      { a: { s1: "want" }, b: { s1: "want" } },
      [chain("a"), chain("b")], [supplier("s1"), supplier("s2")],
    );
    expect(plan.nums.s1).toEqual({ a: 1, b: 3 });
    expect(plan.nums.s2.b).toBe(4);
    expect(plan.cq.b.slice(0, 4)).toEqual([null, null, "s1", "s2"]);
  });

  it("szanse mieszczą się w pozostałej pojemności, nadal obowiązuje kolejność płatności", () => {
    const suppliers = [supplier("late", { paymentDate: "2026-09-01" }), supplier("early", { paymentDate: "2026-08-01" }), supplier("yes")];
    const prefs = Object.fromEntries(suppliers.map(s => [s.id, { a: "star" }]));
    const plan = buildFMData(prefs, { a: { yes: "want" } }, [chain("a", { capacity: 2 })], suppliers);
    expect(plan.cs.a.list).toEqual(["yes", "early"]);
    expect(plan.res.late.m).toEqual([]);
    expect(plan.warnings.find(w => w.type === "chain_full").rejected).toBe(1);
  });

  it("mieszany większy plan zachowuje limity, odstępy i akceptacje przed każdą szansą", () => {
    const chains = Array.from({ length: 8 }, (_, i) => chain(`c${i}`, { capacity: 12 }));
    const suppliers = Array.from({ length: 30 }, (_, i) => supplier(`s${i}`, { fmPackages: i % 3 === 0 ? 2 : 1 }));
    const prefs = {}, resps = {};
    suppliers.forEach((s, i) => {
      prefs[s.id] = {};
      chains.forEach((c, j) => {
        prefs[s.id][c.id] = (i + j) % 2 ? "star" : "thumb";
        resps[c.id] ||= {};
        const response = ["want", "chance", undefined, "remove"][(i * 3 + j) % 4];
        if (response) resps[c.id][s.id] = response;
      });
    });
    const plan = buildFMData(prefs, resps, chains, suppliers);
    for (const s of suppliers) {
      expect(plan.res[s.id].m.length).toBeLessThanOrEqual(5 * s.fmPackages);
      const numbers = Object.values(plan.nums[s.id]).sort((a, b) => a - b);
      for (let n = 1; n < numbers.length; n++) expect(numbers[n] - numbers[n - 1]).toBeGreaterThanOrEqual(FM_MIN_GAP);
    }
    for (const c of chains) {
      expect(plan.cs[c.id].n).toBeLessThanOrEqual(12);
      const numbers = plan.cs[c.id].list.map(sid => plan.nums[sid][c.id]);
      expect(new Set(numbers).size).toBe(numbers.length);
      const accepted = [], chances = [];
      for (const sid of plan.cs[c.id].list) {
        expect(resps[c.id][sid]).not.toBe("remove");
        (resps[c.id][sid] === "want" ? accepted : chances).push(plan.nums[sid][c.id]);
      }
      if (accepted.length && chances.length) expect(Math.min(...chances)).toBeGreaterThan(Math.max(...accepted));
    }
  });
});
