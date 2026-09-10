import { describe, it, expect } from "vitest";
import { FM_MAX_M } from "./fm-algo.js";
import { FM_STARS_MIN, fmPackagesOf, fmStarsMax, fmStarsState, findSupplierCompany } from "./fm-stars.js";

describe("limit sieci głównych (⭐) z pakietów", () => {
  it("liczba pakietów jest przycięta do 1–5, brak/zero/śmieci = 1", () => {
    expect(fmPackagesOf(undefined)).toBe(1);
    expect(fmPackagesOf({})).toBe(1);
    expect(fmPackagesOf({ fm_b2b_packages: 0 })).toBe(1);
    expect(fmPackagesOf({ fm_b2b_packages: "abc" })).toBe(1);
    expect(fmPackagesOf({ fm_b2b_packages: "2" })).toBe(2);
    expect(fmPackagesOf({ fm_b2b_packages: 9 })).toBe(5);
  });

  it("limit ⭐ = 5 × pakiety; 2 pakiety Business = 10 sieci głównych", () => {
    expect(FM_MAX_M).toBe(5);
    expect(fmStarsMax(null)).toBe(5);
    expect(fmStarsMax({ fm_b2b_packages: 1 })).toBe(5);
    expect(fmStarsMax({ fm_b2b_packages: 2 })).toBe(10);
    expect(fmStarsMax({ fm_b2b_packages: 5 })).toBe(25);
  });

  it("minimum do potwierdzenia jest stałe (5) i niezależne od limitu", () => {
    expect(FM_STARS_MIN).toBe(5);
    expect(fmStarsState(4, 10)).toBe("pending");
    expect(fmStarsState(5, 10)).toBe("min_reached");
    expect(fmStarsState(9, 10)).toBe("min_reached");
    expect(fmStarsState(10, 10)).toBe("full");
    // 1 pakiet: minimum i limit to ta sama liczba — od razu „full”
    expect(fmStarsState(5, 5)).toBe("full");
    expect(fmStarsState(0, 5)).toBe("pending");
    // limit nigdy nie spada poniżej minimum
    expect(fmStarsState(5, 0)).toBe("full");
  });
});

describe("firma dostawcy", () => {
  const dup = { id: "c-old", name: "P.W. KRZYŚ-MAR", fm_b2b_packages: 1, legacy_fm_id: "s9" };
  const mine = { id: "c-new", name: "PRZEDSIĘBIORSTWO WIELOBRANŻOWE KRZYŚ-MAR", fm_b2b_packages: 2 };

  it("dokładny identyfikator konta wygrywa z kluczami legacy", () => {
    expect(findSupplierCompany([dup, mine], { accountId: "c-new", fmId: "s9" })).toBe(mine);
    expect(findSupplierCompany([mine, dup], { accountId: "c-new", fmId: "s9" })).toBe(mine);
  });

  it("bez dopasowania po koncie sięga do fmId / legacy_fm_id / legacy_supplier_id", () => {
    expect(findSupplierCompany([dup, mine], { accountId: "brak", fmId: "s9" })).toBe(dup);
    expect(findSupplierCompany([dup, mine], { fmId: "c-new" })).toBe(mine);
    expect(findSupplierCompany([{ ...dup, legacy_supplier_id: "sup-s9" }], { legacySupplierId: "sup-s9" })?.id).toBe("c-old");
  });

  it("brak firmy = null (limit domyślny 5), pusta lista nie wywraca", () => {
    expect(findSupplierCompany([], { accountId: "x" })).toBeNull();
    expect(findSupplierCompany(null, { accountId: "x" })).toBeNull();
    expect(fmStarsMax(findSupplierCompany([], { accountId: "x" }))).toBe(5);
  });
});
