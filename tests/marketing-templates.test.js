// [feat/marketing-activation] Szablony PL/EN: dane z odczytu, daty, wypis, wersja tekstowa.
import { describe, it, expect } from "vitest";
import { renderMarketingTemplate, TEMPLATE_KEYS, esc } from "../netlify/functions/_shared/marketing-templates.js";
import { nextBuyerMailingDate, formatLongDate } from "../netlify/functions/_shared/marketing-dates.js";

const base = { companyName: "Sad <Kowalski> & Syn", creditsRemaining: 5, creditsExpiry: "2026-12-27", snapshotAt: "2026-11-04T10:00:00Z", now: new Date(2026, 10, 4), appUrl: "https://b2b.freshmarket.eu", unsubscribeUrl: "https://b2b.freshmarket.eu/.netlify/functions/marketing-unsubscribe?m=x&t=y", replyTo: "preconnect@freshmarket.eu" };

describe("daty", () => {
  it("pierwszy wtorek: 4.11.2026 → 1 grudnia 2026 (nie 2 grudnia); 3.11.2026 (wtorek) → 3 listopada", () => {
    expect(formatLongDate(nextBuyerMailingDate(new Date(2026, 10, 4)), "pl")).toBe("1 grudnia 2026");
    expect(formatLongDate(nextBuyerMailingDate(new Date(2026, 10, 3)), "pl")).toBe("3 listopada 2026");
    expect(formatLongDate(nextBuyerMailingDate(new Date(2026, 11, 2)), "en")).toBe("5 January 2027");
  });
});

describe("render", () => {
  it("PL start: temat z liczbą kredytów i datą mailingu, treść z terminem ważności, bez obietnic odczytu", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "start_with_credits", locale: "pl" });
    expect(r.subject).toBe("Masz 5 kredytów PreConnect — najbliższy mailing do kupców 1 grudnia 2026");
    expect(r.html).toContain("27 grudnia 2026");
    expect(r.html).toContain("Sad &lt;Kowalski&gt; &amp; Syn");
    expect(r.html).not.toContain("<Kowalski>");
    expect(r.html).toContain(esc(base.unsubscribeUrl)); // w HTML & jest zakodowane
    expect(r.html).toContain("Wypisz się");
    expect(r.text).toContain("Wypisz się z informacji o PreConnect: " + base.unsubscribeUrl);
    expect(r.text).toContain("preconnect@freshmarket.eu");
    expect(r.html.toLowerCase()).not.toMatch(/gwarant|na pewno przeczyta|guarantee/);
    // [r3 #3] rozliczanie opisane zgodnie z regułami (e-mail LUB lista w panelu), bez obietnicy wysyłki
    expect(r.html).toContain("Kredyt rozliczamy po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca.");
    expect(r.html).toContain("Do wysyłki kwalifikujemy propozycje zgodnie z ich aktualnym statusem.");
    expect(r.html).not.toMatch(/dopiero wtedy, gdy kupiec otworzy|trafią do najbliższego mailingu/);
  });
  it("[r3 #3] EN i szablon powrotu mają tę samą regułę rozliczania", () => {
    for (const templateKey of ["start_with_credits", "return_active"]) {
      const en = renderMarketingTemplate({ ...base, templateKey, locale: "en" });
      expect(en.html).toContain("The credit is settled after a registered read: the buyer opening the e-mail or viewing the proposal on the list in their panel.".replace("The credit", templateKey === "return_active" ? "A credit" : "The credit"));
      expect(en.html).toContain("Proposals qualify for the mailing according to their current status.");
      expect(en.html).not.toMatch(/charged only when a buyer opens|go out in the next/);
      const pl = renderMarketingTemplate({ ...base, templateKey, locale: "pl" });
      expect(pl.html).toContain("Kredyt rozliczamy po zarejestrowanym odczycie");
    }
  });
  it("EN return: temat i CTA po angielsku, odmiana credits", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "return_active", locale: "en", creditsRemaining: 1, creditsExpiry: null });
    expect(r.subject).toBe("Buyer mailing on 1 December 2026 — add a new proposal in PreConnect?");
    expect(r.html).toContain("<strong>1 credit</strong>");
    expect(r.html).not.toContain("nearest expiry");
    expect(r.text).toContain("Go to PreConnect: https://b2b.freshmarket.eu");
  });
  it("odmiana PL: 1 kredyt, 2 kredyty, 5 kredytów, 12 kredytów, 22 kredyty", () => {
    const s = (n) => renderMarketingTemplate({ ...base, templateKey: "start_with_credits", locale: "pl", creditsRemaining: n }).subject;
    expect(s(1)).toContain("Masz 1 kredyt ");
    expect(s(2)).toContain("Masz 2 kredyty ");
    expect(s(5)).toContain("Masz 5 kredytów ");
    expect(s(12)).toContain("Masz 12 kredytów ");
    expect(s(22)).toContain("Masz 22 kredyty ");
  });
  it("brak linku wypisu = błąd; nieznany szablon = błąd; nieznany język → pl", () => {
    expect(() => renderMarketingTemplate({ ...base, templateKey: "start_with_credits", unsubscribeUrl: "" })).toThrow(/unsubscribe_url_required/);
    expect(() => renderMarketingTemplate({ ...base, templateKey: "sprzedaz" })).toThrow(/unknown_template/);
    expect(renderMarketingTemplate({ ...base, templateKey: "start_with_credits", locale: "de" }).meta.locale).toBe("pl");
    expect(TEMPLATE_KEYS).toEqual(["start_with_credits", "return_active"]);
  });
  it("ten sam wynik dla tych samych danych (treść da się zamrozić i sprawdzić hashem)", () => {
    const a = renderMarketingTemplate({ ...base, templateKey: "start_with_credits", locale: "pl" });
    const b = renderMarketingTemplate({ ...base, templateKey: "start_with_credits", locale: "pl" });
    expect(a.html).toBe(b.html); expect(a.text).toBe(b.text); expect(a.subject).toBe(b.subject);
  });
});
