// [feat/marketing-photos] Teksty domyślne odporne na liczbę kredytów, układ 1 i 2 (review Codexa 07.11):
// liczba stoi po dwukropku, więc nie musi się zgadzać z czasownikiem ani przymiotnikiem.
import { describe, it, expect } from "vitest";
import { renderMarketingTemplate, creditsWord, validateContent, TEMPLATE_KEYS } from "../netlify/functions/_shared/marketing-templates.js";

const NUMBERS = [0, 1, 2, 4, 5, 12, 22];
const WITH_CREDITS = ["credits_no_proposal", "credits_proposal_ready", "used_before_free_credits", "start_with_credits", "return_active"];
const render = (templateKey, locale, n, extra = {}) => renderMarketingTemplate({
  templateKey, locale, companyName: "Sady Przykładowe", content: null,
  creditsRemaining: n, creditsAvailable: n, creditsReserved: 0, expiringCredits: n,
  creditsExpiry: "2026-12-15", snapshotAt: "2026-11-07T08:00:00Z", now: new Date("2026-11-07T08:00:00Z"),
  appUrl: "https://b2b.freshmarket.eu", unsubscribeUrl: "https://b2b.freshmarket.eu/u", layoutVersion: 2, photo: null, ...extra,
});
const BAD = /dostępne są|Korzystałeś|ma termin ważności|are valid until|kredyty PreConnect wygasają|credits expire on|\{\{/;

for (const layoutVersion of [1, 2]) {
  describe(`układ ${layoutVersion}: liczba kredytów 0, 1, 2, 4, 5, 12, 22`, () => {
    for (const key of TEMPLATE_KEYS) for (const locale of ["pl", "en"]) for (const n of NUMBERS) {
      it(`${key} ${locale} ${n}`, () => {
        const r = render(key, locale, n, { layoutVersion });
        // znane błędne konstrukcje z 07.11 nie wracają (tekst, HTML i temat)
        expect(r.text).not.toMatch(BAD);
        expect(r.subject).not.toMatch(BAD);
        expect(r.html.replace(/<[^>]+>/g, "")).not.toMatch(BAD);
        if (locale === "pl" && WITH_CREDITS.includes(key)) {
          expect(r.text).toMatch(new RegExp(`dostępne kredyty PreConnect: ${n} \\(stan na 7 listopada 2026\\)`, "i"));
        }
        if (locale === "en" && WITH_CREDITS.includes(key)) {
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
  });
}

describe("odmiana i zwroty", () => {
  it("temat PL: 0 kredytów, 1 kredyt, 2 kredyty, 4 kredyty, 5 kredytów, 12 kredytów, 22 kredyty (oba układy)", () => {
    const want = { 0: "kredytów", 1: "kredyt", 2: "kredyty", 4: "kredyty", 5: "kredytów", 12: "kredytów", 22: "kredyty" };
    for (const layoutVersion of [1, 2]) for (const n of NUMBERS) {
      expect(render("credits_no_proposal", "pl", n, { layoutVersion }).subject).toBe(`Daj się poznać sieciom handlowym — masz ${n} ${want[n]} w PreConnect`);
      expect(render("used_before_free_credits", "pl", n, { layoutVersion }).subject).toBe(`Kolejna propozycja w PreConnect — masz jeszcze ${n} ${want[n]}`);
      expect(render("credits_no_proposal", "en", n, { layoutVersion }).subject).toBe(`Introduce your company to retail chains — you have ${n} ${n === 1 ? "credit" : "credits"} in PreConnect`);
    }
  });

  it("powrót: zwrot do firmy, nie do osoby (oba układy)", () => {
    expect(render("used_before_free_credits", "pl", 4, { layoutVersion: 1 }).text).toContain("Twoja firma korzystała już z PreConnect.");
    expect(render("used_before_free_credits", "pl", 4, { layoutVersion: 2 }).text).toContain("Twoja firma korzystała już z PreConnect — dostępne kredyty PreConnect: 4");
  });
});

describe("treść własna i zamrożona", () => {
  const custom = {
    pl: { subject: "Własny temat {{expiring_n}}", body: "Dzień dobry, {{company}},\n\nWłasna treść: wygasające {{expiring_n}} z {{credits_n}}.", cta: "Przejdź" },
    en: { subject: "Own subject {{expiring_n}}", body: "Hello, {{company}},\n\nOwn text: expiring {{expiring_n}} of {{credits_n}}.", cta: "Go" },
  };

  it("{{expiring_n}} przechodzi walidację treści z panelu", () => {
    expect(validateContent(custom)).toEqual([]);
    expect(validateContent({ ...custom, pl: { ...custom.pl, body: "{{expiring_x}}" } })).toContain("pl.body.unknown_placeholder:expiring_x");
  });

  for (const layoutVersion of [1, 2]) for (const locale of ["pl", "en"]) {
    it(`{{expiring_n}} w treści własnej daje samą liczbę: układ ${layoutVersion} ${locale}`, () => {
      const r = render("credits_expiring", locale, 12, { content: custom, expiringCredits: 3, layoutVersion });
      expect(r.meta.customContent).toBe(true);
      expect(r.subject).toBe(locale === "pl" ? "Własny temat 3" : "Own subject 3");
      expect(r.text).toContain(locale === "pl" ? "Własna treść: wygasające 3 z 12." : "Own text: expiring 3 of 12.");
    });
  }

  it("treść zapisana w kampanii (zamrożona) zostaje dosłownie, także stare brzmienie", () => {
    const frozen = { pl: { subject: "Stary temat {{credits}}", body: "Dzień dobry, {{company}},\n\nW Twoim koncie dostępne są **{{credits}}**.", cta: "Przejdź" },
      en: { subject: "Old subject {{credits}}", body: "Hello, {{company}},\n\nYou have **{{credits}}**.", cta: "Go" } };
    for (const layoutVersion of [1, 2]) {
      const r = render("credits_no_proposal", "pl", 4, { content: frozen, layoutVersion });
      expect(r.subject).toBe("Stary temat 4 kredyty");
      expect(r.text).toContain("W Twoim koncie dostępne są 4 kredyty.");
    }
  });
});
