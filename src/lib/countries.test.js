import { describe, it, expect } from "vitest";
import { FLAGS, CNAMES, CNAMES_EN } from "./countries-data.js";

// [feat/country-kyrgyzstan] Lista krajów jest jednym źródłem dla panelu
// (kraj firmy, kraj sieci, filtry) i publicznej rejestracji dostawcy — brak
// kodu = kraju nie da się wybrać, a istniejące rekordy pokazują goły kod.
describe("lista krajów", () => {
  it("każdy kod ma flagę i nazwę PL/EN", () => {
    const codes = Object.keys(CNAMES);
    expect(codes.length).toBeGreaterThan(40);
    for (const code of codes) {
      expect(code, `kod ${code} nie jest ISO alpha-2`).toMatch(/^[A-Z]{2}$/);
      expect(FLAGS[code], `brak flagi dla ${code}`).toBeTruthy();
      expect(CNAMES_EN[code], `brak nazwy EN dla ${code}`).toBeTruthy();
      expect(String(CNAMES[code]).trim()).not.toBe("");
    }
    // zbiory kluczy są identyczne we wszystkich trzech mapach
    expect(Object.keys(FLAGS).sort()).toEqual(codes.slice().sort());
    expect(Object.keys(CNAMES_EN).sort()).toEqual(codes.slice().sort());
  });

  it("zawiera kraje uczestników FM 2026, w tym Kirgistan (Umai Group)", () => {
    for (const code of ["KG", "CH", "PL", "NL", "ES", "IT", "CL", "EG", "IN", "MA", "ZA", "EC", "PE", "UA", "BY", "LT", "LV", "RO", "BG", "CZ", "GR"]) {
      expect(CNAMES[code], `brak kraju ${code}`).toBeTruthy();
    }
    expect(CNAMES.KG).toBe("Kirgistan");
    expect(CNAMES_EN.KG).toBe("Kyrgyzstan");
    expect(FLAGS.KG).toBe("🇰🇬");
    expect(CNAMES.CH).toBe("Szwajcaria");
    expect(CNAMES_EN.CH).toBe("Switzerland");
  });
});
