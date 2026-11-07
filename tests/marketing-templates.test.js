// [feat/marketing-activation] Szablony PL/EN per grupa odbiorców (Artur 5.11): treść domyślna + edycja bez HTML,
// symbole z danych odczytu, bez obietnic i bez „kupcy szukają”, wypis, wersja tekstowa, determinizm.
import { describe, it, expect } from "vitest";
import { renderMarketingTemplate, validateContent, defaultContent, effectiveContent, creditsWord, esc, emailLogoUrl, TEMPLATE_KEYS, AUDIENCE_TEMPLATE_KEYS, PLACEHOLDERS } from "../netlify/functions/_shared/marketing-templates.js";
import { nextBuyerMailingDate, formatLongDate } from "../netlify/functions/_shared/marketing-dates.js";

const base = { companyName: "Sad <Kowalski> & Syn", creditsRemaining: 5, creditsReserved: 1, expiringCredits: 2, creditsExpiry: "2026-12-27", snapshotAt: "2026-11-04T10:00:00Z", now: new Date(2026, 10, 4), appUrl: "https://b2b.freshmarket.eu", unsubscribeUrl: "https://b2b.freshmarket.eu/.netlify/functions/marketing-unsubscribe?m=x&t=y", replyTo: "preconnect@freshmarket.eu" };
const BANNED = /gwarant|na pewno przeczyta|guarantee|właśnie szukają|are looking for your|nowej dla|new to your company|zamówieni[ea] gwarantowan/i;

describe("daty", () => {
  it("pierwszy wtorek: 4.11.2026 → 1 grudnia 2026 (nie 2 grudnia); 3.11.2026 (wtorek) → 3 listopada", () => {
    expect(formatLongDate(nextBuyerMailingDate(new Date(2026, 10, 4)), "pl")).toBe("1 grudnia 2026");
    expect(formatLongDate(nextBuyerMailingDate(new Date(2026, 10, 3)), "pl")).toBe("3 listopada 2026");
    expect(formatLongDate(nextBuyerMailingDate(new Date(2026, 11, 2)), "en")).toBe("5 January 2027");
  });
});

describe("pięć grup — domyślna treść PL i EN", () => {
  it("każda grupa renderuje się w PL i EN z głównym przekazem, regułą rozliczania, wypisem i bez zakazanych obietnic", () => {
    for (const key of AUDIENCE_TEMPLATE_KEYS) {
      for (const locale of ["pl", "en"]) {
        const r = renderMarketingTemplate({ ...base, templateKey: key, locale });
        expect(r.subject.length).toBeGreaterThan(10);
        expect(r.html).toContain(locale === "pl" ? "PreConnect pomaga zrobić pierwszy krok" : "PreConnect helps you take the first step");
        expect(r.text).toContain(locale === "pl" ? "przedstawiasz kupcom swoje produkty i możliwości firmy" : "you present your products and your company's capabilities"); // w HTML apostrof jest escapowany
        expect(r.html).toContain(locale === "pl" ? "Kredyt rozliczamy dopiero po zarejestrowanym odczycie" : "A credit is settled only after a registered read");
        expect(r.html).toContain(locale === "pl" ? "pozostają zarezerwowane" : "stay reserved");
        expect(r.html).toContain("1 grudnia 2026".replace("grudnia", locale === "pl" ? "grudnia" : "December"));
        expect(r.html).toContain("Sad &lt;Kowalski&gt; &amp; Syn");
        expect(r.html).not.toContain("<Kowalski>");
        expect(r.html).toContain(esc(base.unsubscribeUrl));
        expect(r.text).toContain(locale === "pl" ? "Wypisz się z informacji o PreConnect: " + base.unsubscribeUrl : "Unsubscribe from PreConnect information: " + base.unsubscribeUrl);
        expect(r.html).not.toMatch(BANNED);
        expect(r.text).not.toMatch(BANNED);
        expect(r.html).not.toContain("{{");
        expect(r.text).not.toContain("**");
        expect(r.meta).toMatchObject({ locale, templateKey: key, customContent: false });
      }
    }
    expect(TEMPLATE_KEYS).toEqual([...AUDIENCE_TEMPLATE_KEYS, "start_with_credits", "return_active"]);
  });
  it("wezwania per grupa: przygotuj propozycję / wybierz sieci / sprawdź pakiety; grupa „wygasają” ma prawdziwą datę i liczbę z tym terminem", () => {
    const cta = (key, locale) => renderMarketingTemplate({ ...base, templateKey: key, locale }).text.split("\n").find((l) => l.includes(": https://b2b.freshmarket.eu"));
    expect(cta("credits_no_proposal", "pl")).toBe("Przygotuj propozycję: https://b2b.freshmarket.eu");
    expect(cta("credits_proposal_ready", "pl")).toBe("Wybierz sieci: https://b2b.freshmarket.eu");
    expect(cta("no_valid_credits", "en")).toBe("See packages: https://b2b.freshmarket.eu");
    const exp = renderMarketingTemplate({ ...base, templateKey: "credits_expiring", locale: "pl" });
    expect(exp.subject).toBe("Termin ważności kredytów PreConnect: 27 grudnia 2026");
    expect(exp.html).toContain("Kredyty PreConnect z terminem ważności do <strong>27 grudnia 2026</strong>: <strong>2</strong>");
    expect(exp.html).toContain("wszystkie dostępne kredyty: 5");
    const none = renderMarketingTemplate({ ...base, templateKey: "no_valid_credits", locale: "pl", creditsRemaining: 0, creditsExpiry: null, expiringCredits: 0 });
    expect(none.html).toContain("nie ma ważnych kredytów PreConnect");
    expect(none.html).toContain("możesz kupić pakiet kredytów w panelu");
  });
  it("odmiana: 1 kredyt, 2 kredyty, 5 kredytów, 12 kredytów, 22 kredyty; EN credit/credits", () => {
    const s = (n) => renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", creditsRemaining: n }).subject;
    expect(s(1)).toContain("masz 1 kredyt ");
    expect(s(2)).toContain("masz 2 kredyty ");
    expect(s(5)).toContain("masz 5 kredytów ");
    expect(s(12)).toContain("masz 12 kredytów ");
    expect(s(22)).toContain("masz 22 kredyty ");
    expect(creditsWord(1, "en")).toBe("credit"); expect(creditsWord(3, "en")).toBe("credits");
  });
});

describe("treść edytowana w panelu (bez HTML)", () => {
  const custom = () => ({
    pl: { subject: "Hej {{company}} — {{credits}} do {{expiry}}", body: "Akapit pierwszy z **pogrubieniem**.\n\nDrugi akapit, mailing {{mailing_date}},\nnowa linia w akapicie.", cta: "Wejdź" },
    en: { subject: "Hi {{company}}", body: "One.\n\nTwo {{credits_n}}.", cta: "Enter" },
  });
  it("własna treść: symbole podstawione z danych, akapity → <p>, ** → <strong>, nowa linia → <br>, wszystko escapowane", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", content: custom() });
    expect(r.subject).toBe("Hej Sad <Kowalski> & Syn — 5 kredytów do 27 grudnia 2026");
    expect(r.html).toContain("<p style=\"margin:0 0 14px;\">Akapit pierwszy z <strong>pogrubieniem</strong>.</p>");
    expect(r.html).toContain("Drugi akapit, mailing 1 grudnia 2026,<br>nowa linia w akapicie.");
    expect(r.html).toContain(">Wejdź</a>");
    expect(r.text).toContain("Akapit pierwszy z pogrubieniem.");
    expect(r.text).toContain("Wejdź: https://b2b.freshmarket.eu");
    expect(r.html).toContain("Wypisz się z informacji o PreConnect"); // stopka stała
    expect(r.meta.customContent).toBe(true);
    const en = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "en", content: custom() });
    expect(en.subject).toBe("Hi Sad <Kowalski> & Syn");
    expect(en.html).toContain("<p style=\"margin:0 0 14px;\">Two 5.</p>");
  });
  it("walidacja: puste pola, HTML, nieznany symbol, niedomknięty symbol, za długie, wieloliniowy temat", () => {
    expect(validateContent(custom())).toEqual([]);
    expect(validateContent(null)).toEqual(["content_required"]);
    const bad = custom(); bad.pl.subject = ""; bad.en.body = "<b>x</b>"; bad.pl.cta = "{{kredyty}}"; bad.en.cta = "{{credits";
    const errs = validateContent(bad);
    expect(errs).toContain("pl.subject.empty");
    expect(errs).toContain("en.body.html_not_allowed");
    expect(errs).toContain("pl.cta.unknown_placeholder:kredyty");
    expect(errs).toContain("en.cta.unclosed_placeholder");
    const long = custom(); long.pl.body = "x".repeat(4001); long.en.subject = "a\nb";
    expect(validateContent(long)).toEqual(expect.arrayContaining(["pl.body.too_long", "en.subject.multiline"]));
    const missing = { pl: custom().pl };
    expect(validateContent(missing)).toContain("en.missing");
    expect(PLACEHOLDERS).toEqual(["company", "credits", "credits_n", "valid_credits", "expiry", "expiring_credits", "expiring_n", "reserved_n", "mailing_date", "snapshot_date"]);
  });
  it("niepoprawna zapisana treść nie psuje renderu — używana jest domyślna; defaultContent zwraca kopię", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", content: { pl: { subject: "<x>" } } });
    expect(r.meta.customContent).toBe(false);
    expect(r.subject).toBe("Daj się poznać sieciom handlowym — masz 5 kredytów w PreConnect");
    const d = defaultContent("credits_expiring"); d.pl.subject = "zmienione";
    expect(defaultContent("credits_expiring").pl.subject).not.toBe("zmienione");
    expect(effectiveContent("credits_expiring", null).pl.cta).toBe("Przygotuj propozycję");
  });
  it("brak linku wypisu = błąd; nieznany szablon = błąd; nieznany język → pl; determinizm", () => {
    expect(() => renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", unsubscribeUrl: "" })).toThrow(/unsubscribe_url_required/);
    expect(() => renderMarketingTemplate({ ...base, templateKey: "sprzedaz" })).toThrow(/unknown_template/);
    expect(renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "de" }).meta.locale).toBe("pl");
    const a = renderMarketingTemplate({ ...base, templateKey: "used_before_free_credits", locale: "pl" });
    const b = renderMarketingTemplate({ ...base, templateKey: "used_before_free_credits", locale: "pl" });
    expect(a.html).toBe(b.html); expect(a.text).toBe(b.text); expect(a.subject).toBe(b.subject);
  });
  it("{{credits}} = WOLNE kredyty (ważne − rezerwacje), {{valid_credits}} = wszystkie ważne; bez creditsAvailable = ważne", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "used_before_free_credits", locale: "pl", creditsRemaining: 4, creditsAvailable: 3, creditsReserved: 1, content: { pl: { subject: "wolne {{credits}} / ważne {{valid_credits}} / rez {{reserved_n}} / n {{credits_n}}", body: "x", cta: "y" }, en: { subject: "s", body: "b", cta: "c" } } });
    expect(r.subject).toBe("wolne 3 kredyty / ważne 4 kredyty / rez 1 / n 3");
    expect(renderMarketingTemplate({ ...base, templateKey: "used_before_free_credits", locale: "en", creditsRemaining: 4, creditsAvailable: 3 }).subject).toBe("Another proposal in PreConnect — you still have 3 credits");
    expect(renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", creditsRemaining: 5 }).subject).toContain("masz 5 kredytów");
  });
  it("czapka v2: białe logo z aplikacji (/brand/fm-email-logo-white.png), „PreConnect” i hasło o łączeniu dostawców z kupcami; stopka z małym logo", () => {
    const pl = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl" });
    expect(pl.html).toContain('<img src="https://b2b.freshmarket.eu/brand/fm-email-logo-white.png" alt="Fresh Market" width="140"');
    expect(pl.html).toContain('width="104"'); // stopka
    expect(pl.html).toContain(">PreConnect</div>");
    expect(pl.html).toContain("Łączymy dostawców owoców, warzyw i kwiatów z kupcami sieci handlowych.");
    expect(pl.html).not.toContain("rgba(255,255,255,0.96)"); // bez białego pola pod logo
    const en = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "en" });
    expect(en.html).toContain("We connect fruit, vegetable and flower suppliers with retail chain buyers.");
    const custom = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", appUrl: "http://localhost:8888/", logoUrl: "https://x.test/w.png?a=1&b=2" });
    expect(custom.html).toContain('<img src="https://x.test/w.png?a=1&amp;b=2" alt="Fresh Market" width="140"');
    expect(emailLogoUrl("http://localhost:8888/")).toBe("http://localhost:8888/brand/fm-email-logo-white.png");
    expect(pl.text).not.toContain("<img");
  });
  it("szablon ręczny („Do wybranych firm”): zdanie o sprawdzeniu kredytów PL/EN, bez twierdzenia, że odbiorca ma kredyty", () => {
    const pl = renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "pl", creditsRemaining: 0, creditsAvailable: 0 });
    expect(pl.html).toContain("Przed zgłoszeniem propozycji sprawdź dostępne kredyty w panelu. Jeśli nie masz wolnych, ważnych kredytów, możesz wybrać odpowiedni pakiet.");
    expect(pl.html).not.toMatch(/dostępne są|masz \d+ kredyt/i);
    const en = renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "en", creditsRemaining: 0, creditsAvailable: 0 });
    expect(en.html).toContain("Before submitting a proposal, check your available credits in the panel. If you have no free, valid credits, you can choose a suitable package.");
    expect(en.html).not.toMatch(/you have \d+ credit/i);
    expect(pl.html).not.toMatch(BANNED); expect(en.html).not.toMatch(BANNED);
  });
  it("stare szablony (kampanie sprzed 5.11) nadal się renderują z regułą rozliczania", () => {
    for (const key of ["start_with_credits", "return_active"]) {
      const r = renderMarketingTemplate({ ...base, templateKey: key, locale: "pl" });
      expect(r.html).toContain("Kredyt rozliczamy po zarejestrowanym odczycie");
      expect(r.html).toContain("27 grudnia 2026");
    }
  });
});
