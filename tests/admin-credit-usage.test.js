// [fix/admin-credits-display] Panel admina: wykorzystanie kredytów liczone z zużytych kredytów
// (qty_used), nie z wysyłek; „Kupione” → „Wszystkie” (kredyty bezpłatne + kupione).
// Przypadek z produkcji 10.11.2026: El Roda — 3 przyznania (5+1+1 = 7, wszystkie bezpłatne),
// 5 wysyłek: 3 odczytane (pobrały kredyt), 2 wygasłe bez odczytu (kredyt wrócił).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { adminCreditUsage, adminCreditTotalLabel } from "../src/lib/admin-credit-usage.js";

const legacy = (lang) => JSON.parse(fs.readFileSync(new URL(`../src/i18n/${lang}/legacy.json`, import.meta.url), "utf8")).admin;
const src = fs.readFileSync(new URL("../src/legacy/PreconnectFM.jsx", import.meta.url), "utf8");

describe("adminCreditUsage", () => {
  it("El Roda: 3 z 7 kredytów (43%), nie 5/7 wysyłek (71%)", () => {
    expect(adminCreditUsage({ max: 7, used: 3 })).toEqual({ used: 3, max: 7, remaining: 4, pct: 43 });
  });
  it("brak kredytów i braki danych nie dają NaN ani dzielenia przez zero", () => {
    expect(adminCreditUsage({ max: 0, used: 0 })).toEqual({ used: 0, max: 0, remaining: 0, pct: 0 });
    expect(adminCreditUsage(null)).toEqual({ used: 0, max: 0, remaining: 0, pct: 0 });
    expect(adminCreditUsage({ max: "5", used: "5" })).toEqual({ used: 5, max: 5, remaining: 0, pct: 100 });
  });
});

describe("panel admina — źródło liczb i etykiety", () => {
  it("pasek i licznik nie liczą już wysyłek (zwrócone wysyłki nie zawyżają wykorzystania)", () => {
    expect(src).not.toMatch(/filter\(s ?=> ?!\["rejected","refunded","queued"\]\.includes\(s\.status\)\)\.length/);
    expect((src.match(/adminCreditUsage\(/g) || []).length).toBe(3);   // karta 2.0, szczegóły firmy, starsza lista
  });
  it("„Kupione” zastąpione „Wszystkie” z wyjaśnieniem w podpowiedzi (PL i EN)", () => {
    expect(legacy("pl").pipeline.credits_settle.bought).toBe("Wszystkie");
    expect(legacy("en").pipeline.credits_settle.bought).toBe("All");
    expect(legacy("pl").pipeline.credits_settle.hint).toContain("„Wszystkie” = kredyty z aktualnie ważnych pakietów, przyznane bezpłatnie przez organizatora i kupione, razem (nie suma historyczna).");
    expect(legacy("en").pipeline.credits_settle.hint).toContain("“All” = credits from currently valid packages, granted free by the organiser and bought, together (not a historical total).");
  });
  it("nagłówek karty: sama suma kredytów, BEZ daty (najpóźniejszy termin nie jest ważnością całego salda)", () => {
    expect(legacy("pl").firmy.list_credits_total_format).toBe("Kredyty: {{max}}");
    expect(legacy("en").firmy.list_credits_total_format).toBe("Credits: {{max}}");
    for (const l of ["pl", "en"]) expect(legacy(l).firmy.list_credits_total_format).not.toMatch(/expiry|ważne|valid/);
    expect(legacy("pl").firmy.list_used_unit).toBe("kredytów wykorzystanych");
    expect(legacy("en").firmy.list_used_unit).toBe("credits used");
    expect((src.match(/adminCreditTotalLabel\(t, lim\)/g) || []).length).toBe(2);   // karta 2.0 + starsza lista
    expect(src).not.toMatch(/list_credits_total_format[^\n]*expiry/);
  });

  it("dwa pakiety z różnymi terminami: nagłówek nie pokazuje żadnej daty", () => {
    // company_capacity: qty_total = 5 + 2 (oba ważne), pkg_expiry = najpóźniejszy (31.12) — pakiet 2 kredytów wygasa 20.11
    const lim = { max: 7, used: 1, pkgExpiry: "2026-12-31" };
    const t = (k, o) => (k === "admin.firmy.list_credits_total_format" ? `Kredyty: ${o.max}` : k) + (o && "expiry" in o ? ` · ${o.expiry}` : "");
    expect(adminCreditTotalLabel(t, lim)).toBe("Kredyty: 7");
    expect(adminCreditTotalLabel(t, lim)).not.toContain("2026-12-31");
  });
});
