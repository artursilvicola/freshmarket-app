// [feat/free-credit-grants] Kolejność zużycia kredytów przy pierwszym odczycie propozycji:
// najpierw bezpłatne (grant), wewnątrz puli najbliższa data ważności, remis = najstarszy zakup.
import { describe, it, expect } from "vitest";
import { pickPackageForCharge } from "../netlify/functions/_shared/legacy-send-seen.js";

const pkg = (id, o = {}) => ({ id, qty_total: 5, qty_used: 0, purchased_at: "2026-01-01T00:00:00Z", expires_at: "2026-12-31", source: "purchase", ...o });

describe("pickPackageForCharge", () => {
  it("bierze bezpłatny przed kupionym, nawet gdy kupiony jest starszy i wygasa wcześniej", () => {
    const paid = pkg("paid", { purchased_at: "2025-01-01T00:00:00Z", expires_at: "2026-10-01" });
    const free = pkg("free", { source: "grant", purchased_at: "2026-09-27T10:00:00Z", expires_at: "2026-12-27" });
    expect(pickPackageForCharge([paid, free]).id).toBe("free");
  });
  it("wewnątrz puli bezpłatnej wybiera najbliższą datę ważności", () => {
    const a = pkg("a", { source: "grant", expires_at: "2026-12-27", purchased_at: "2026-09-01T00:00:00Z" });
    const b = pkg("b", { source: "grant", expires_at: "2026-11-15", purchased_at: "2026-09-27T00:00:00Z" });
    expect(pickPackageForCharge([a, b]).id).toBe("b");
  });
  it("wewnątrz puli kupionej też najbliższa data ważności; brak daty na końcu; remis = najstarszy", () => {
    const noExp = pkg("noexp", { expires_at: null, purchased_at: "2024-01-01T00:00:00Z" });
    const late = pkg("late", { expires_at: "2027-06-30", purchased_at: "2025-01-01T00:00:00Z" });
    const soon1 = pkg("soon1", { expires_at: "2026-12-31", purchased_at: "2026-03-01T00:00:00Z" });
    const soon2 = pkg("soon2", { expires_at: "2026-12-31", purchased_at: "2026-02-01T00:00:00Z" });
    expect(pickPackageForCharge([noExp, late, soon1, soon2]).id).toBe("soon2");
    expect(pickPackageForCharge([noExp, late]).id).toBe("late");
    expect(pickPackageForCharge([noExp]).id).toBe("noexp");
  });
  it("pomija pakiety bez wolnych kredytów; brak wolnych → null; brak source = kupiony", () => {
    const usedFree = pkg("usedfree", { source: "grant", qty_total: 2, qty_used: 2 });
    const legacy = pkg("legacy", { source: undefined, qty_total: 1, qty_used: 0 });
    expect(pickPackageForCharge([usedFree, legacy]).id).toBe("legacy");
    expect(pickPackageForCharge([usedFree])).toBeNull();
    expect(pickPackageForCharge([])).toBeNull();
    expect(pickPackageForCharge(null)).toBeNull();
  });
  it("nie modyfikuje wejścia", () => {
    const rows = [pkg("p1"), pkg("g1", { source: "grant" })];
    const snapshot = JSON.stringify(rows);
    pickPackageForCharge(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});
