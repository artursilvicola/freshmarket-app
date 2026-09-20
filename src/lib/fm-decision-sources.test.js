// [feat/fm-decision-source] Źródła decyzji: grupowanie, wyszukiwanie, widoczność po roli
// (dostawca nigdy nie dostaje źródeł decyzji kupca, kupiec nigdy źródeł wyborów dostawcy).
import { describe, it, expect } from "vitest";
import { groupDecisionSources, targetSource, respSource, isAdminSet, sourcesVisibleTo, formatSourceMeta } from "./fm-decision-sources.js";

const CO1 = "11111111-1111-4111-8111-111111111111", CO2 = "22222222-2222-4222-8222-222222222222";
const rows = [
  { entity: "target", company_id: CO1, retailer_id: 100, decision: "star", source: "admin", source_user_id: "aaaaaaaa-0000-4000-8000-000000000000", source_at: "2026-09-20T10:00:00Z" },
  { entity: "target", company_id: CO1, retailer_id: 101, decision: "thumb", source: "supplier", source_user_id: "bbbbbbbb-0000-4000-8000-000000000000", source_at: "2026-09-20T10:01:00Z" },
  { entity: "resp", company_id: CO1, retailer_id: 100, decision: "remove", source: "admin", source_user_id: "aaaaaaaa-0000-4000-8000-000000000000", source_at: "2026-09-20T10:02:00Z" },
  { entity: "resp", company_id: CO2, retailer_id: 100, decision: "want", source: "buyer", source_user_id: null, source_at: "2026-09-20T10:03:00Z" },
  { entity: "target", company_id: CO2, retailer_id: 101, decision: "star", source: "admin", source_user_id: null, source_at: "2026-09-20T10:04:00Z" },
  { entity: "bogus", company_id: CO2, retailer_id: 101, source: "admin" },
];

describe("fm-decision-sources", () => {
  it("grupuje po encji i kluczach (numer sieci jako string), ignoruje nieznane encje", () => {
    const g = groupDecisionSources(rows);
    expect(Object.keys(g.target)).toEqual([CO1, CO2]);
    expect(Object.keys(g.target[CO1])).toEqual(["100", "101"]);
    expect(Object.keys(g.resp)).toEqual(["100"]);
    expect(Object.keys(g.resp["100"])).toEqual([CO1, CO2]);
    expect(groupDecisionSources(null)).toEqual({ target: {}, resp: {} });
  });

  it("wyszukuje źródło wyboru dostawcy i decyzji kupca niezależnie od typu identyfikatora", () => {
    const g = groupDecisionSources(rows);
    expect(targetSource(g, CO1, 100)?.source).toBe("admin");
    expect(targetSource(g, CO1, "100")?.source).toBe("admin");
    expect(targetSource(g, CO1, 999)).toBeNull();
    expect(respSource(g, 100, CO1)?.decision).toBe("remove");
    expect(respSource(g, "100", CO2)?.source).toBe("buyer");
    expect(respSource(g, 101, CO1)).toBeNull();
    expect(targetSource(null, CO1, 100)).toBeNull();
  });

  it("isAdminSet tylko dla źródła admin", () => {
    expect(isAdminSet({ source: "admin" })).toBe(true);
    expect(isAdminSet({ source: "supplier" })).toBe(false);
    expect(isAdminSet({ source: "buyer" })).toBe(false);
    expect(isAdminSet({ source: "automatic" })).toBe(false);
    expect(isAdminSet(null)).toBe(false);
  });

  it("dostawca widzi wyłącznie źródła WŁASNYCH wyborów — zero źródeł decyzji kupców, zero cudzych firm", () => {
    const v = sourcesVisibleTo("supplier", groupDecisionSources(rows), { companyId: CO1 });
    expect(Object.keys(v.target)).toEqual([CO1]);
    expect(v.resp).toEqual({});
    expect(respSource(v, 100, CO1)).toBeNull();     // decyzja kupca o tej firmie — niewidoczna dla dostawcy
    expect(targetSource(v, CO2, 101)).toBeNull();   // wybór innej firmy — niewidoczny
    expect(targetSource(v, CO1, 100)?.source).toBe("admin");
  });

  it("kupiec widzi wyłącznie źródła WŁASNYCH decyzji — zero źródeł wyborów dostawców", () => {
    const v = sourcesVisibleTo("buyer", groupDecisionSources(rows), { retailerId: 100 });
    expect(v.target).toEqual({});
    expect(Object.keys(v.resp)).toEqual(["100"]);
    expect(targetSource(v, CO1, 100)).toBeNull();   // wybór dostawcy (admin) — niewidoczny dla kupca
    expect(respSource(v, 100, CO1)?.source).toBe("admin");
    expect(sourcesVisibleTo("buyer", groupDecisionSources(rows), { retailerId: 101 })).toEqual({ target: {}, resp: {} });
  });

  it("admin widzi wszystko; inne role i brak danych — nic", () => {
    const g = groupDecisionSources(rows);
    expect(sourcesVisibleTo("admin", g)).toBe(g);
    expect(sourcesVisibleTo("staff", g, { companyId: CO1, retailerId: 100 })).toEqual({ target: {}, resp: {} });
    expect(sourcesVisibleTo(undefined, g)).toEqual({ target: {}, resp: {} });
    expect(sourcesVisibleTo("supplier", null, { companyId: CO1 })).toEqual({ target: {}, resp: {} });
  });

  it("meta dla admina: nazwa/e-mail autora z profilu, skrót identyfikatora albo placeholder; czas wg języka", () => {
    expect(formatSourceMeta({ source_user_id: "aaaaaaaa-0000-4000-8000-000000000000", source_at: "2026-09-20T10:00:00Z", author: { name: "Oksana K.", email: "o@x" } }).who).toBe("Oksana K.");
    expect(formatSourceMeta({ source_user_id: "aaaaaaaa-0000-4000-8000-000000000000", source_at: "2026-09-20T10:00:00Z", author: { email: "o@x" } }).who).toBe("o@x");
    expect(formatSourceMeta({ source_user_id: "aaaaaaaa-0000-4000-8000-000000000000", source_at: "2026-09-20T10:00:00Z" }).who).toBe("aaaaaaaa…");
    expect(formatSourceMeta({ source_user_id: null, source_at: "2026-09-20T10:00:00Z" }, { unknownAuthor: "(bez identyfikatora)" }).who).toBe("(bez identyfikatora)");
    expect(formatSourceMeta({ source_at: "2026-09-20T10:00:00Z" }, { locale: "en" }).when).toMatch(/2026|20\/09/);
    expect(formatSourceMeta(null, { unknownAuthor: "x" })).toEqual({ who: "x", when: "" });
  });
});
