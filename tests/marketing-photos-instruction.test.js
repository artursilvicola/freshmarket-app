// [feat/marketing-photos] Instrukcja administratora: rozdział o bibliotece zdjęć + ostrzeżenie w panelu (notatka Codexa 07.11, pkt 7).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getInstruction } from "../src/content/instructions/index.js";

const legacy = (lang) => JSON.parse(fs.readFileSync(new URL(`../src/i18n/${lang}/legacy.json`, import.meta.url), "utf8")).admin.marketing;

describe("biblioteka zdjęć w instrukcji administratora PreConnect", () => {
  for (const lang of ["pl", "en"]) {
    it(`rozdział stoi zaraz po marketingu i używa etykiet z panelu (${lang})`, () => {
      const ids = getInstruction("preconnect", "admin", lang).chapters.map((c) => c.id);
      expect(ids.indexOf("marketing-zdjecia")).toBe(ids.indexOf("marketing") + 1);
      const ch = getInstruction("preconnect", "admin", lang).chapters.find((c) => c.id === "marketing-zdjecia");
      const text = JSON.stringify(ch);
      const m = legacy(lang);
      for (const k of ["photos_upload", "ph_save", "ph_approve", "photo_pick", "photo_auto", "photo_remove", "ph_disable", "ph_enable", "ph_edit", "ph_usage", "ph_similar_force", "ph_status_pending", "ph_status_ready"]) {
        expect(text).toContain(m[k]);
      }
      // prywatne przed zatwierdzeniem, publiczne po; zamrożenie; brak zmiany kadru w panelu
      expect(text).toMatch(lang === "pl" ? /prywatnym magazynie/ : /private storage/);
      expect(text).toMatch(lang === "pl" ? /zamraża zdjęcie/ : /freezes its photo/);
      expect(text).toMatch(lang === "pl" ? /nie zmienisz w panelu/ : /cannot change the crop/);
    });
  }

  it("instrukcje uczestników nie mają rozdziału o bibliotece", () => {
    for (const role of ["supplier", "buyer"]) for (const lang of ["pl", "en"]) {
      expect(getInstruction("preconnect", role, lang).chapters.some((c) => c.id === "marketing-zdjecia")).toBe(false);
    }
  });

  it("ostrzeżenie w panelu: oczekujące prywatne, zatwierdzone publiczne", () => {
    expect(legacy("pl").photos_public_warning).toMatch(/^Nowe pliki czekają w prywatnym magazynie.*Dopiero zatwierdzony kadr dostaje stały, publiczny adres HTTPS/);
    expect(legacy("en").photos_public_warning).toMatch(/^New files wait in private storage.*Only an approved crop gets a fixed public HTTPS address/);
    for (const lang of ["pl", "en"]) expect(legacy(lang).photos_public_warning).not.toMatch(/Każdy plik|Every file/);
  });
});
