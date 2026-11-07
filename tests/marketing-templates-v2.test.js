// [feat/marketing-photos] Układ v2 maila (makieta 06.11): jasny nagłówek z zielonym logo, zdjęcie z biblioteki (alt/podpis
// w języku maila, HTTPS), dopisek, hasło, treść = powitanie + dwa zdania, data mailingu + przycisk, pomoc, zasady,
// jasna stopka z wypisem; bez zdjęcia blok znika; układ 1 bez zmian; treść własna; wersja tekstowa.
import { describe, it, expect } from "vitest";
import { renderMarketingTemplate, defaultContent, effectiveContent, normalizeLayoutVersion, emailLogoGreenUrl, V2_TEXT, DEFAULT_CONTENT, DEFAULT_CONTENT_V2, AUDIENCE_TEMPLATE_KEYS, DEFAULT_LAYOUT_VERSION, esc } from "../netlify/functions/_shared/marketing-templates.js";

const base = { companyName: "Sad <Kowalski> & Syn", creditsRemaining: 5, creditsReserved: 1, expiringCredits: 2, creditsExpiry: "2026-12-27", snapshotAt: "2026-11-06T10:00:00Z", now: new Date(2026, 10, 6), appUrl: "https://b2b.freshmarket.eu", unsubscribeUrl: "https://b2b.freshmarket.eu/.netlify/functions/marketing-unsubscribe?m=x&t=y", replyTo: "preconnect@freshmarket.eu", layoutVersion: 2 };
const photo = { url: "https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/p/v1-abc.jpg", alt_pl: "Rozmowy dostawców z kupcami", alt_en: "Suppliers talking to buyers", caption_pl: "Zdjęcie archiwalne: rozmowy B2B na Fresh Market 2026", caption_en: "Archive photo: B2B meetings at Fresh Market 2026", width: 1200, height: 800 };
const BANNED = /gwarant|na pewno przeczyta|guarantee|właśnie szukają|are looking for your|nowej dla|new to your company/i;

describe("układ v2 — każda grupa PL/EN ze zdjęciem", () => {
  it("nagłówek jasny z zielonym logo, zdjęcie HTTPS z alt/podpisem w języku maila, dopisek, hasło, data + przycisk, pomoc, zasady, stopka z wypisem; bez ciemnego nagłówka", () => {
    for (const key of AUDIENCE_TEMPLATE_KEYS) for (const locale of ["pl", "en"]) {
      const r = renderMarketingTemplate({ ...base, templateKey: key, locale, photo });
      const t = V2_TEXT[locale];
      expect(r.html).toContain(emailLogoGreenUrl(base.appUrl));
      expect(r.html).not.toContain("fm-email-logo-white.png");
      expect(r.html).not.toContain("linear-gradient"); // stary ciemny nagłówek
      expect(r.html).not.toContain("#0f172a;padding");
      expect(r.html).toContain(`src="${photo.url}"`);
      expect(r.html).toContain(`alt="${locale === "pl" ? photo.alt_pl : photo.alt_en}"`);
      expect(r.html).toContain(locale === "pl" ? photo.caption_pl : photo.caption_en);
      expect(r.html).toContain('height="400"'); // 600 × 800/1200
      expect(r.html).toContain(esc(t.subline)); expect(r.html).toContain(esc(t.headline));
      expect(r.html).toContain(`${esc(t.mailing)} <strong>${locale === "pl" ? "1 grudnia 2026" : "1 December 2026"}</strong>`);
      expect(r.html).toContain(locale === "pl" ? "<strong>Odpowiedz na tę wiadomość</strong>" : "<strong>Reply to this e-mail</strong>");
      expect(r.html).toContain(esc(t.rules_title)); expect(r.html).toContain(locale === "pl" ? "Ta wiadomość nie pobiera kredytów." : "This message does not use credits.");
      expect(r.html).toContain("Sad &lt;Kowalski&gt; &amp; Syn"); expect(r.html).not.toContain("<Kowalski>");
      expect(r.html).toContain(esc(base.unsubscribeUrl)); expect(r.html).toContain("mailto:preconnect@freshmarket.eu");
      expect(r.html).toContain("KJOW Sp. z o.o.");
      expect(r.html).not.toContain("{{"); expect(r.html).not.toMatch(BANNED); expect(r.text).not.toMatch(BANNED);
      expect(r.meta).toMatchObject({ locale, templateKey: key, layoutVersion: 2, customContent: false, photo: { url: photo.url } });
      // treść = powitanie + jeden akapit (dwa zdania)
      const body = effectiveContent(key, null, 2)[locale].body;
      expect(body.split(/\n[ \t]*\n/)).toHaveLength(2);
      expect(body.split(/\n[ \t]*\n/)[1].split(/[.!?](\s|$)/).filter((s) => s && s.trim().length > 1).length).toBeLessThanOrEqual(2);
      // temat jak w układzie 1 (zatwierdzony 5.11)
      // temat jak w układzie 1; wyjątek: wygasające mają temat bez „Twoje kredyty … wygasają” (liczba pojedyncza, review Codexa 07.11)
      if (key !== "credits_expiring") expect(r.subject).toBe(renderMarketingTemplate({ ...base, templateKey: key, locale, layoutVersion: 1 }).subject);
    }
  });
  it("wersja tekstowa: dopisek, hasło, [Zdjęcie: alt], treść, mailing, przycisk z adresem, pomoc, zasady, reply-to, wypis", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", photo });
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("ZAPREZENTUJ SWOJĄ FIRMĘ KUPCOM ONLINE");
    expect(lines[1]).toBe("Pierwszy krok do nowej sieci handlowej.");
    expect(r.text).toContain("[Zdjęcie: Rozmowy dostawców z kupcami]");
    expect(r.text).toContain("Dzień dobry, Sad <Kowalski> & Syn,");
    expect(r.text).toContain("Dostępne kredyty PreConnect: 5 (stan na 6 listopada 2026)");
    expect(r.text).toContain("Najbliższy mailing do kupców: 1 grudnia 2026");
    expect(r.text).toContain("Przygotuj propozycję: https://b2b.freshmarket.eu");
    expect(r.text).toContain("Zasady kredytów PreConnect: Jedna propozycja");
    expect(r.text).toContain("Odpowiedz na tę wiadomość albo napisz na preconnect@freshmarket.eu.");
    expect(r.text.trim().endsWith("Wypisz się z informacji o PreConnect: " + base.unsubscribeUrl)).toBe(true);
    expect(r.text).not.toContain("**");
  });
});

describe("układ v2 — zdjęcie", () => {
  it("bez zdjęcia (null): brak <img> poza logo, brak podpisu, reszta bez zmian; meta.photo = null", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "pl", photo: null });
    expect(r.html.match(/<img /g)).toHaveLength(2); // logo w nagłówku + logo w stopce
    expect(r.html).not.toContain("Zdjęcie archiwalne");
    expect(r.text).not.toContain("[Zdjęcie");
    expect(r.meta.photo).toBeNull();
  });
  it("adres http (nie HTTPS) → błąd; brak altu → błąd; brak podpisu → podpis zastępczy; alt tylko PL → użyty także w EN", () => {
    expect(() => renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "pl", photo: { ...photo, url: "http://x/y.jpg" } })).toThrow("photo_url_not_https");
    expect(() => renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "pl", photo: { ...photo, alt_pl: "", alt_en: "" } })).toThrow("photo_alt_required");
    const noCap = renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "en", photo: { ...photo, caption_pl: null, caption_en: null } });
    expect(noCap.html).toContain("Archive photo: B2B meetings at Fresh Market");
    const plOnly = renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "en", photo: { ...photo, alt_en: "" } });
    expect(plOnly.html).toContain(`alt="${photo.alt_pl}"`);
  });
  it("alt i podpis są escapowane (bez wstrzyknięcia HTML)", () => {
    const r = renderMarketingTemplate({ ...base, templateKey: "selected_companies", locale: "pl", photo: { ...photo, alt_pl: 'x" onerror="alert(1)', caption_pl: "<script>1</script>" } });
    expect(r.html).toContain('alt="x&quot; onerror=&quot;alert(1)"');
    expect(r.html).not.toContain("<script>"); expect(r.html).toContain("&lt;script&gt;1&lt;/script&gt;");
  });
});

describe("układ v2 — treść własna i zgodność z układem 1", () => {
  it("treść własna w układzie 2: akapity → <p>, ** → <strong>, symbole podstawione; stałe bloki (hasło, zasady, mailing) zostają", () => {
    const content = { pl: { subject: "Hej {{company}}", body: "Dzień dobry.\n\nMasz **{{credits}}** do {{expiry}}.", cta: "Wejdź" }, en: { subject: "Hi", body: "One.\n\nTwo.", cta: "Enter" } };
    const r = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", photo, content });
    expect(r.subject).toBe("Hej Sad <Kowalski> & Syn");
    expect(r.html).toContain('<p style="margin:0 0 10px;font-size:15px;line-height:1.6;">Masz <strong>5 kredytów</strong> do 27 grudnia 2026.</p>');
    expect(r.html).toContain(">Wejdź</a>"); expect(r.html).toContain(esc(V2_TEXT.pl.headline)); expect(r.html).toContain("Zasady kredytów PreConnect");
    expect(r.meta.customContent).toBe(true);
  });
  it("normalizeLayoutVersion: 2 → 2, wszystko inne → 1; domyślny układ nowych kampanii = 2; układ 1 renderuje jak dotąd (ciemny nagłówek, białe logo, długa treść)", () => {
    expect([normalizeLayoutVersion(2), normalizeLayoutVersion("2"), normalizeLayoutVersion(1), normalizeLayoutVersion(null), normalizeLayoutVersion(7), normalizeLayoutVersion(undefined)]).toEqual([2, 2, 1, 1, 1, 1]);
    expect(DEFAULT_LAYOUT_VERSION).toBe(2);
    const v1 = renderMarketingTemplate({ ...base, templateKey: "credits_no_proposal", locale: "pl", layoutVersion: 1, photo });
    expect(v1.html).toContain("linear-gradient"); expect(v1.html).toContain("fm-email-logo-white.png"); expect(v1.html).not.toContain(photo.url);
    expect(v1.html).toContain("PreConnect pomaga zrobić pierwszy krok"); expect(v1.meta.layoutVersion).toBe(1);
  });
  it("defaultContent(key, 2) ≠ defaultContent(key, 1) dla grup; stare klucze mają w układzie 2 tę samą treść co w 1; effectiveContent dziedziczy układ", () => {
    for (const key of AUDIENCE_TEMPLATE_KEYS) {
      expect(defaultContent(key, 2).pl.body).not.toBe(defaultContent(key, 1).pl.body);
      if (key !== "credits_expiring") expect(defaultContent(key, 2).pl.subject).toBe(defaultContent(key, 1).pl.subject);
      expect(defaultContent(key, 2).pl.body.length).toBeLessThan(defaultContent(key, 1).pl.body.length);
    }
    expect(DEFAULT_CONTENT_V2.start_with_credits).toBe(DEFAULT_CONTENT.start_with_credits);
    expect(effectiveContent("credits_expiring", null, 2)).toEqual(defaultContent("credits_expiring", 2));
    expect(effectiveContent("credits_expiring", { pl: { subject: "S", body: "B", cta: "C" }, en: { subject: "S", body: "B", cta: "C" } }, 2).pl).toEqual({ subject: "S", body: "B", cta: "C" });
    expect(() => defaultContent("nope", 2)).toThrow("unknown_template:nope");
  });
});
