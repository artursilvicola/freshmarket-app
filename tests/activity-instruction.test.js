// [feat/admin-activity] Rozdział instrukcji administratora „Aktywność kont”: widoczny tylko przy włączonej
// zakładce (flaga ADMIN_ACTIVITY), opisuje ograniczoną historię wyświetleń propozycji i zakres retencji.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import preconnectAdmin from "../src/content/instructions/preconnect-admin.js";
import { getInstruction, withFlags } from "../src/content/instructions/index.js";

const legacy = (lang) => JSON.parse(fs.readFileSync(new URL(`../src/i18n/${lang}/legacy.json`, import.meta.url), "utf8")).admin.activity;

describe("instrukcja: rozdział Aktywność kont", () => {
  it("bez flagi rozdziału nie ma (produkcja przed włączeniem zakładki)", () => {
    // flaga podana jawnie: lokalny .env.test (podgląd testowy) włącza zakładkę także w vitest
    for (const lang of ["pl", "en"]) {
      const off = withFlags(preconnectAdmin[lang], { ADMIN_ACTIVITY: false });
      expect(off.chapters.some((c) => c.id === "aktywnosc")).toBe(false);
      expect(off.chapters.map((c) => c.id)).toEqual(preconnectAdmin[lang].chapters.filter((c) => c.id !== "aktywnosc").map((c) => c.id));
    }
    // getInstruction korzysta z tej samej funkcji z flagą ze środowiska
    const env = getInstruction("preconnect", "admin", "pl").chapters.some((c) => c.id === "aktywnosc");
    expect(env).toBe(import.meta.env?.VITE_ADMIN_ACTIVITY === "true");
  });

  for (const lang of ["pl", "en"]) {
    it(`z flagą: rozdział po bibliotece zdjęć, etykiety jak w panelu, ograniczona historia wyświetleń (${lang})`, () => {
      const content = withFlags(preconnectAdmin[lang], { ADMIN_ACTIVITY: true });
      const ids = content.chapters.map((c) => c.id);
      expect(ids.indexOf("aktywnosc")).toBe(ids.indexOf("marketing-zdjecia") + 1);
      const text = JSON.stringify(content.chapters.find((c) => c.id === "aktywnosc"));
      const m = legacy(lang);
      for (const v of [m.col.visits, m.col.viewed, m.show_test, m.export_summary, m.export_events, m.period_custom, m.col.legacy]) expect(text).toContain(v);
      expect(text).toMatch(lang === "pl"
        ? /tylko datę pierwszego i ostatniego wyświetlenia\. Nie ma w nim pełnej historii ani dokładnej liczby wyświetleń/
        : /only the date of the first and last view\. It holds no full history and no exact number of views/);
      expect(text).toMatch(lang === "pl" ? /Rejestrów poczty, odczytów i rozliczeń to nie dotyczy/ : /does not apply to e-mail, read or billing registers/);
      expect(text).toMatch(lang === "pl" ? /podgląd cudzego konta nie jest zapisywany/ : /preview of someone else's account is not recorded/);
    });
  }

  it("rozdziału nie ma w instrukcjach uczestników", () => {
    for (const role of ["supplier", "buyer"]) for (const lang of ["pl", "en"]) {
      expect(getInstruction("preconnect", role, lang).chapters.some((c) => c.id === "aktywnosc")).toBe(false);
    }
  });
});
