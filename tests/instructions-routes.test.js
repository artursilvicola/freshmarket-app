import { describe, it, expect } from "vitest";
import {
  instructionPath, parseInstructionLocation, instructionPageKey, normalizeInstructionKey,
  isInstructionPage, instructionDocForPage, panelBasePath, panelRoleFromPath,
} from "../src/lib/instructions-routes.js";
import { B2B_INSTRUCTION_EDITION_YEAR } from "../src/content/instructions/index.js";

describe("adresy instrukcji", () => {
  it("każda rola i każdy dokument mają osobny, stały adres", () => {
    expect(instructionPath({ panelRole: "supplier", doc: "preconnect" })).toBe("/dostawca/instrukcja/preconnect");
    expect(instructionPath({ panelRole: "supplier", doc: "b2b" })).toBe("/dostawca/instrukcja/spotkania-b2b");
    expect(instructionPath({ panelRole: "buyer", doc: "preconnect" })).toBe("/kupiec/instrukcja/preconnect");
    expect(instructionPath({ panelRole: "buyer", doc: "b2b" })).toBe("/kupiec/instrukcja/spotkania-b2b");
    expect(instructionPath({ panelRole: "admin", doc: "preconnect" })).toBe("/admin/instrukcja/preconnect");
    expect(instructionPath({ panelRole: "admin", doc: "b2b", viewRole: "admin" })).toBe("/admin/instrukcja/spotkania-b2b");
  });

  it("archiwum instrukcji 2026 ma własny adres, osobny od instrukcji PreConnect", () => {
    expect(instructionPath({ panelRole: "supplier", doc: "archive2026" })).toBe("/dostawca/instrukcja/archiwum-2026");
    expect(instructionPath({ panelRole: "buyer", doc: "archive2026" })).toBe("/kupiec/instrukcja/archiwum-2026");
    expect(instructionPath({ panelRole: "admin", doc: "archive2026", viewRole: "buyer" })).toBe("/admin/instrukcja/archiwum-2026?rola=kupiec");
    expect(parseInstructionLocation("/kupiec/instrukcja/archiwum-2026")).toEqual({ panelRole: "buyer", doc: "archive2026", pg: "instr-archive2026", viewRole: "buyer" });
    expect(instructionPageKey("archive2026", "admin")).toBe("a-instr-archive2026");
    expect(isInstructionPage("instr-archive2026")).toBe(true);
  });

  it("admin wybiera wersję uczestnika parametrem, uczestnik nie ma takiego parametru", () => {
    expect(instructionPath({ panelRole: "admin", doc: "preconnect", viewRole: "supplier" })).toBe("/admin/instrukcja/preconnect?rola=dostawca");
    expect(instructionPath({ panelRole: "admin", doc: "b2b", viewRole: "buyer" })).toBe("/admin/instrukcja/spotkania-b2b?rola=kupiec");
    expect(instructionPath({ panelRole: "supplier", doc: "preconnect", viewRole: "buyer" })).toBe("/dostawca/instrukcja/preconnect");
  });

  it("rozpoznaje adres i odtwarza klucz strony oraz rolę widoku", () => {
    expect(parseInstructionLocation("/dostawca/instrukcja/preconnect")).toEqual({ panelRole: "supplier", doc: "preconnect", pg: "instr-preconnect", viewRole: "supplier" });
    expect(parseInstructionLocation("/kupiec/instrukcja/spotkania-b2b/")).toEqual({ panelRole: "buyer", doc: "b2b", pg: "instr-b2b", viewRole: "buyer" });
    expect(parseInstructionLocation("/admin/instrukcja/spotkania-b2b", "?rola=kupiec")).toEqual({ panelRole: "admin", doc: "b2b", pg: "a-instr-b2b", viewRole: "buyer" });
    expect(parseInstructionLocation("/admin/instrukcja/preconnect", "?rola=cokolwiek")).toMatchObject({ viewRole: "admin" });
    expect(parseInstructionLocation("/admin/instrukcja/preconnect", "")).toMatchObject({ viewRole: "admin" });
    // ?print=1 nie przeszkadza w rozpoznaniu adresu
    expect(parseInstructionLocation("/dostawca/instrukcja/preconnect", "?print=1")).toMatchObject({ pg: "instr-preconnect" });
  });

  it("parametr roli w adresie uczestnika jest ignorowany (nie da się podejrzeć wersji admina)", () => {
    expect(parseInstructionLocation("/dostawca/instrukcja/preconnect", "?rola=admin")).toMatchObject({ viewRole: "supplier" });
    expect(parseInstructionLocation("/kupiec/instrukcja/preconnect", "?rola=admin")).toMatchObject({ viewRole: "buyer" });
  });

  it("obce adresy i nieznane dokumenty → null", () => {
    expect(parseInstructionLocation("/dostawca/instrukcja/nieistnieje")).toBeNull();
    expect(parseInstructionLocation("/dostawca")).toBeNull();
    expect(parseInstructionLocation("/obsluga/instrukcja/preconnect")).toBeNull();
    expect(instructionPath({ panelRole: "staff", doc: "preconnect" })).toBeNull();
  });

  it("stary klucz „instructions” prowadzi do instrukcji PreConnect właściwej dla panelu", () => {
    expect(normalizeInstructionKey("instructions", "supplier")).toBe("instr-preconnect");
    expect(normalizeInstructionKey("instructions", "buyer")).toBe("instr-preconnect");
    expect(normalizeInstructionKey("instructions", "admin")).toBe("a-instr-preconnect");
    expect(normalizeInstructionKey("wysylki", "supplier")).toBe("wysylki");
  });

  it("pomocnicze: klucze stron, dokumenty, adresy bazowe", () => {
    expect(instructionPageKey("b2b", "buyer")).toBe("instr-b2b");
    expect(instructionPageKey("b2b", "admin")).toBe("a-instr-b2b");
    expect(instructionPageKey("x", "admin")).toBeNull();
    expect(isInstructionPage("instr-b2b")).toBe(true);
    expect(isInstructionPage("b-offers")).toBe(false);
    expect(instructionDocForPage("a-instr-preconnect")).toBe("preconnect");
    expect(panelBasePath("buyer")).toBe("/kupiec");
    expect(panelRoleFromPath("/admin/instrukcja/preconnect")).toBe("admin");
    expect(panelRoleFromPath("/kupiec")).toBe("buyer");
    expect(panelRoleFromPath("/tablice")).toBeNull();
  });
});

describe("edycja instrukcji", () => {
  it("rok edycji instrukcji B2B to stała treści, niezależna od konfiguracji wydarzenia", async () => {
    expect(B2B_INSTRUCTION_EDITION_YEAR).toBe(2027);
    // brak modułu, który czytałby rok z fm_settings (event_date / fazy / plany)
    const mods = import.meta.glob("../src/lib/fm-edition*.js");
    expect(Object.keys(mods)).toHaveLength(0);
  });
});
