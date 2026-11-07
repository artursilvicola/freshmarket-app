// [feat/marketing-photos] Teksty domyślne układu 2 odporne na liczbę kredytów (review Codexa 07.11):
// liczba stoi po dwukropku, więc nie musi się zgadzać z czasownikiem ani przymiotnikiem.
import { describe, it, expect } from "vitest";
import { renderMarketingTemplate, creditsWord, DEFAULT_CONTENT_V2 } from "../netlify/functions/_shared/marketing-templates.js";

const NUMBERS = [0, 1, 2, 4, 5, 12, 22];
const GROUPS = ["credits_no_proposal", "credits_proposal_ready", "used_before_free_credits", "credits_expiring", "no_valid_credits", "selected_companies"];
const render = (templateKey, locale, n, extra = {}) => renderMarketingTemplate({
  templateKey, locale, companyName: "Sady Przykładowe", content: null,
  creditsRemaining: n, creditsAvailable: n, creditsReserved: 0, expiringCredits: n,
  creditsExpiry: "2026-12-15", snapshotAt: "2026-11-07T08:00:00Z", now: new Date("2026-11-07T08:00:00Z"),
  appUrl: "https://b2b.freshmarket.eu", unsubscribeUrl: "https://b2b.freshmarket.eu/u", layoutVersion: 2, photo: null, ...extra,
});

describe("układ 2: liczba kredytów 0, 1, 2, 4, 5, 12, 22", () => {
  for (const key of GROUPS) for (const locale of ["pl", "en"]) for (const n of NUMBERS) {
    it(`${key} ${locale} ${n}`, () => {
      const r = render(key, locale, n);
      // znane błędne konstrukcje z 07.11 nie wracają
      expect(r.text).not.toMatch(/dostępne są|Korzystałeś|ma termin ważności|are valid until|\{\{/);
      if (locale === "pl" && ["credits_no_proposal", "credits_proposal_ready", "used_before_free_credits"].includes(key)) {
        expect(r.text).toMatch(new RegExp(`dostępne kredyty PreConnect: ${n} \\(stan na 7 listopada 2026\\)`, "i"));
      }
      if (locale === "en" && ["credits_no_proposal", "credits_proposal_ready", "used_before_free_credits"].includes(key)) {
        expect(r.text).toContain(`${n} ${n === 1 ? "credit" : "credits"} available`);
      }
      if (key === "credits_expiring") {
        expect(r.text).toContain(locale === "pl"
          ? `Kredyty PreConnect z terminem ważności do 15 grudnia 2026: ${n} (wszystkie dostępne kredyty: ${n}, stan na 7 listopada 2026)`
          : `PreConnect credits expiring on 15 December 2026: ${n} (all available credits: ${n}, as of 7 November 2026)`);
        expect(r.subject).toBe(locale === "pl" ? "Termin ważności kredytów PreConnect: 15 grudnia 2026" : "PreConnect credit expiry date: 15 December 2026");
      }
      // temat z liczbą: słowo zgodne z liczbą
      const m = r.subject.match(/(\d+) (kredyt\S*|credits?)(?=\s|$)/);
      if (m) expect(m[2]).toBe(creditsWord(Number(m[1]), locale));
    });
  }

  it("odmiana w temacie PL: 0 kredytów, 1 kredyt, 2 kredyty, 4 kredyty, 5 kredytów, 12 kredytów, 22 kredyty", () => {
    const want = { 0: "kredytów", 1: "kredyt", 2: "kredyty", 4: "kredyty", 5: "kredytów", 12: "kredytów", 22: "kredyty" };
    for (const n of NUMBERS) {
      expect(render("credits_no_proposal", "pl", n).subject).toBe(`Daj się poznać sieciom handlowym — masz ${n} ${want[n]} w PreConnect`);
      expect(render("used_before_free_credits", "pl", n).subject).toBe(`Kolejna propozycja w PreConnect — masz jeszcze ${n} ${want[n]}`);
      expect(render("credits_no_proposal", "en", n).subject).toBe(`Introduce your company to retail chains — you have ${n} ${n === 1 ? "credit" : "credits"} in PreConnect`);
    }
  });

  it("powrót: zwrot do firmy, nie do osoby", () => {
    expect(render("used_before_free_credits", "pl", 4).text).toContain("Twoja firma korzystała już z PreConnect — dostępne kredyty PreConnect: 4");
  });

  it("treść zapisana w kampanii (zamrożona) nie zmienia się po zmianie tekstów domyślnych", () => {
    const frozen = { pl: { subject: "Stary temat {{credits}}", body: "Dzień dobry, {{company}},\n\nW Twoim koncie dostępne są **{{credits}}**.", cta: "Przejdź" },
      en: { subject: "Old subject {{credits}}", body: "Hello, {{company}},\n\nYou have **{{credits}}**.", cta: "Go" } };
    const r = render("credits_no_proposal", "pl", 4, { content: frozen });
    expect(r.subject).toBe("Stary temat 4 kredyty");
    expect(r.text).toContain("W Twoim koncie dostępne są 4 kredyty.");
  });

  it("nowy symbol {{expiring_n}} jest dozwolony w treści z panelu i daje samą liczbę", () => {
    const c = JSON.parse(JSON.stringify(DEFAULT_CONTENT_V2.credits_expiring));
    const r = render("credits_expiring", "pl", 12, { content: c, expiringCredits: 3 });
    expect(r.text).toContain("do 15 grudnia 2026: 3 (wszystkie dostępne kredyty: 12,");
  });
});
