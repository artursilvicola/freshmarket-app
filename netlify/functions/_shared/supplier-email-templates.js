/**
 * Templates dla maili transakcyjnych dostawcy.
 * [B2B Round supplier-onboarding-access-and-communication]
 *
 * Wszystkie szablony zwracają { subject, html }. HTML jest tabelarycznie
 * pisany — działa w większości klientów pocztowych bez polegania na CSS
 * w <head>.
 *
 * Templates:
 *   A. registration_accepted    — po self-registration (czeka na zatwierdzenie)
 *   B. account_activated        — admin zatwierdził konto
 *   C1. account_rejected        — admin odrzucił rejestrację (nie aktywuje)
 *   C2. account_suspended       — admin zawiesił aktywne konto
 *   D. offer_to_moderation      — supplier wysłał ofertę → admin moderuje
 *   E. offer_approved           — admin zaakceptował ofertę
 *   F. offer_sent_to_retailer   — admin wysłał maila zbiorczego do sieci
 *   G. offer_expired            — oferta wygasła (14 dni bez odczytu)
 */

// [B2B Round prod-rollout / i18n MVP — Krok 6]
// Wybór języka maili transakcyjnych. Hierarchia (zgodnie z planem):
//   1) payload.locale (z body request /register-supplier-self albo z
//      backendu który już wie locale usera — najwyższy priorytet),
//   2) user_metadata.locale jeśli kiedyś dorzucimy do wywołania,
//   3) profiles.locale jeśli wywołujący backend już dołączy do payloadu,
//   4) fallback 'pl'.
// Funkcja po prostu normalizuje string do supported locales — nie sięga
// do DB, bo render template'a jest synchroniczny i lekki.
const SUPPORTED_TPL_LOCALES = ["pl", "en"];
function pickLocale(input) {
  if (!input) return "pl";
  const raw = String(input).trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_TPL_LOCALES.includes(raw) ? raw : "pl";
}

const FOOTER = (appUrl, locale = "pl") => {
  const addressLine = locale === "en"
    ? "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Poland"
    : "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Polska";
  return `
<tr><td style="background:#0f172a;padding:18px 28px;text-align:center;">
  <div style="color:rgba(255,255,255,0.92);font-weight:700;font-size:13px;margin-bottom:4px;">Fresh Market PreConnect</div>
  <div style="color:rgba(255,255,255,0.45);font-size:11px;line-height:1.7;">
    ${addressLine}<br>
    <a href="${esc(appUrl)}" style="color:rgba(255,255,255,0.7);text-decoration:none;">freshmarket.eu</a> ·
    <a href="mailto:newsletter@freshmarket.eu" style="color:rgba(255,255,255,0.7);text-decoration:none;">newsletter@freshmarket.eu</a>
  </div>
</td></tr>`;
};

function shell({ title, accent = "#0d9488", body, appUrl, locale = "pl" }) {
  return `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#ececec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececec;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.08);">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,${accent} 100%);padding:24px 32px;text-align:center;">
        <div style="color:white;font-weight:800;font-size:20px;letter-spacing:-0.4px;">Fresh Market <span style="color:rgba(255,255,255,0.6);font-weight:600;font-size:12px;">PreConnect</span></div>
      </td></tr>
      ${body}
      ${FOOTER(appUrl, locale)}
    </table>
  </td></tr>
</table>
</body></html>`;
}

function pBlock(text) {
  return `<p style="margin:0 0 10px;color:#334155;line-height:1.65;font-size:14px;">${text}</p>`;
}

function ctaButton(label, url, color = "#0d9488") {
  return `<div style="margin:18px 0 8px;text-align:center;">
    <a href="${esc(url)}" style="display:inline-block;background:${color};color:white;padding:11px 24px;border-radius:7px;font-weight:700;font-size:13px;text-decoration:none;">${esc(label)}</a>
  </div>`;
}

// ── A. Registration accepted ──────────────────────────────────────────────
// [B2B Round prod-rollout / i18n MVP — Krok 6]
// Welcome mail po self-registration dostawcy. Locale-aware: dispatch
// na pl/en po payload.locale (z register-supplier-self.js, który czyta
// z body request po Kroku 3b). Fallback do 'pl' gdy locale brak / inny.
//
// Treść EN zgodna z terminologią v1.1: Submission (nie Shipment),
// Retailer (nie Network), Admin review (nie Administrator).
export function tplRegistrationAccepted({ companyName, contactName, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplRegistrationAcceptedEN({ companyName, contactName, appUrl });
  return tplRegistrationAcceptedPL({ companyName, contactName, appUrl });
}

function tplRegistrationAcceptedPL({ companyName, contactName, appUrl }) {
  const subject = "Fresh Market – otrzymaliśmy zgłoszenie rejestracyjne";
  const greet = contactName ? `Dzień dobry ${esc(contactName)},` : "Dzień dobry,";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`dziękujemy za rejestrację firmy <strong>${esc(companyName)}</strong> na platformie Fresh Market PreConnect.`)}
  ${pBlock("Twoje konto zostało utworzone i czeka na <strong>zatwierdzenie przez administratora</strong>. W tym czasie możesz zalogować się do panelu i uzupełnić profil firmy: dane podstawowe, logo, certyfikaty, opis. Im pełniejszy profil, tym szybciej decyzja zatwierdzająca.")}
  ${pBlock("Po zatwierdzeniu konta otrzymasz osobnego maila i odblokujemy:")}
  <ul style="color:#334155;font-size:14px;line-height:1.7;padding-left:18px;margin:0 0 10px;">
    <li>dostęp do PreConnect — wysyłka ofert do sieci handlowych,</li>
    <li>dostęp do Spotkań B2B Fresh Market 2026 (aktywowany indywidualnie).</li>
  </ul>
  ${ctaButton("Otwórz panel dostawcy", `${appUrl}/dostawca`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl, locale: "pl" }) };
}

function tplRegistrationAcceptedEN({ companyName, contactName, appUrl }) {
  const subject = "Fresh Market – we received your registration";
  const greet = contactName ? `Hello ${esc(contactName)},` : "Hello,";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`thank you for registering <strong>${esc(companyName)}</strong> on the Fresh Market PreConnect platform.`)}
  ${pBlock("Your account has been created and is awaiting <strong>admin approval</strong>. In the meantime you can sign in to the panel and complete your company profile: basic details, logo, certificates, description. The more complete the profile, the faster the approval decision.")}
  ${pBlock("Once your account is approved you will receive a separate email and we will unlock:")}
  <ul style="color:#334155;font-size:14px;line-height:1.7;padding-left:18px;margin:0 0 10px;">
    <li>access to PreConnect — submissions to retailers,</li>
    <li>access to Fresh Market 2026 B2B Meetings (activated individually).</li>
  </ul>
  ${ctaButton("Open supplier panel", `${appUrl}/dostawca`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl, locale: "en" }) };
}

// ── B. Account activated ──────────────────────────────────────────────────
// [B2B Round backend-mails / i18n] Locale-aware dispatcher po payload.locale
// (z send-supplier-notification.js, który czyta profiles.locale po company_id).
// Fallback do 'pl'. Terminologia EN v1.1: Retailer (nie Network), Admin review.
export function tplAccountActivated({ companyName, contactName, preconnectEnabled, fmB2bEnabled, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplAccountActivatedEN({ companyName, contactName, preconnectEnabled, fmB2bEnabled, appUrl });
  return tplAccountActivatedPL({ companyName, contactName, preconnectEnabled, fmB2bEnabled, appUrl });
}

function tplAccountActivatedPL({ companyName, contactName, preconnectEnabled, fmB2bEnabled, appUrl }) {
  const subject = "Fresh Market – Twoje konto zostało aktywowane";
  const greet = contactName ? `Dzień dobry ${esc(contactName)},` : "Dzień dobry,";
  const enabledLines = [
    preconnectEnabled ? "✓ <strong>PreConnect</strong> — możesz wysyłać oferty do sieci handlowych" : null,
    fmB2bEnabled ? "✓ <strong>Spotkania B2B Fresh Market 2026</strong> — dopuszczeni do harmonogramu spotkań" : null,
  ].filter(Boolean);
  const enabledBlock = enabledLines.length
    ? `<ul style="color:#0d9488;font-size:14px;line-height:1.8;padding-left:18px;margin:6px 0 10px;list-style:none;">${enabledLines.map(l => `<li>${l}</li>`).join("")}</ul>`
    : "";
  const disabledNote = !preconnectEnabled && !fmB2bEnabled
    ? pBlock("Aktywne moduły dla Twojej firmy zostaną dodane przez administratora w kolejnym kroku.")
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`konto firmy <strong>${esc(companyName)}</strong> zostało <strong style="color:#059669;">zatwierdzone</strong> przez administratora Fresh Market.`)}
  ${enabledBlock}
  ${disabledNote}
  ${pBlock("Zaloguj się do panelu, sprawdź profil firmy i ustaw preferencje. Jeśli któryś moduł nie jest jeszcze aktywny, zostanie odblokowany przez administratora po stronie Fresh Market.")}
  ${ctaButton("Otwórz panel dostawcy", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl, locale: "pl" }) };
}

function tplAccountActivatedEN({ companyName, contactName, preconnectEnabled, fmB2bEnabled, appUrl }) {
  const subject = "Fresh Market – your account has been activated";
  const greet = contactName ? `Hello ${esc(contactName)},` : "Hello,";
  const enabledLines = [
    preconnectEnabled ? "✓ <strong>PreConnect</strong> — you can send submissions to retailers" : null,
    fmB2bEnabled ? "✓ <strong>Fresh Market 2026 B2B Meetings</strong> — admitted to the meeting schedule" : null,
  ].filter(Boolean);
  const enabledBlock = enabledLines.length
    ? `<ul style="color:#0d9488;font-size:14px;line-height:1.8;padding-left:18px;margin:6px 0 10px;list-style:none;">${enabledLines.map(l => `<li>${l}</li>`).join("")}</ul>`
    : "";
  const disabledNote = !preconnectEnabled && !fmB2bEnabled
    ? pBlock("Active modules for your company will be added by the administrator in the next step.")
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`the account for <strong>${esc(companyName)}</strong> has been <strong style="color:#059669;">approved</strong> by the Fresh Market administrator.`)}
  ${enabledBlock}
  ${disabledNote}
  ${pBlock("Sign in to the panel, review the company profile and set preferences. If a module isn't active yet, the administrator will unlock it on the Fresh Market side.")}
  ${ctaButton("Open supplier panel", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl, locale: "en" }) };
}

// ── C1. Account rejected (przy rejestracji) ───────────────────────────────
export function tplAccountRejected({ companyName, contactName, statusNote, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplAccountRejectedEN({ companyName, contactName, statusNote, appUrl });
  return tplAccountRejectedPL({ companyName, contactName, statusNote, appUrl });
}

function tplAccountRejectedPL({ companyName, contactName, statusNote, appUrl }) {
  const subject = "Fresh Market – rejestracja wymaga uzupełnienia";
  const greet = contactName ? `Dzień dobry ${esc(contactName)},` : "Dzień dobry,";
  const noteBlock = statusNote
    ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:12px 0;color:#78350f;font-size:13px;line-height:1.65;">${esc(statusNote)}</div>`
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`niestety nie możemy w tej chwili aktywować konta firmy <strong>${esc(companyName)}</strong> na platformie Fresh Market PreConnect.`)}
  ${noteBlock || pBlock("Powód: prosimy o kontakt w celu uzupełnienia danych firmy lub sprawdzenia statusu rejestracji.")}
  ${pBlock("Skontaktuj się z nami pod adresem <a href='mailto:newsletter@freshmarket.eu' style='color:#0d9488;'>newsletter@freshmarket.eu</a> — pomożemy doprowadzić rejestrację do końca.")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#dc2626", body, appUrl, locale: "pl" }) };
}

function tplAccountRejectedEN({ companyName, contactName, statusNote, appUrl }) {
  const subject = "Fresh Market – registration needs to be completed";
  const greet = contactName ? `Hello ${esc(contactName)},` : "Hello,";
  const noteBlock = statusNote
    ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:12px 0;color:#78350f;font-size:13px;line-height:1.65;">${esc(statusNote)}</div>`
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`unfortunately we are not able to activate the account for <strong>${esc(companyName)}</strong> on the Fresh Market PreConnect platform at this moment.`)}
  ${noteBlock || pBlock("Reason: please contact us to complete the company details or check the registration status.")}
  ${pBlock("Contact us at <a href='mailto:newsletter@freshmarket.eu' style='color:#0d9488;'>newsletter@freshmarket.eu</a> — we will help you finalise the registration.")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#dc2626", body, appUrl, locale: "en" }) };
}

// ── C2. Account suspended (aktywne konto wstrzymane) ──────────────────────
export function tplAccountSuspended({ companyName, contactName, statusNote, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplAccountSuspendedEN({ companyName, contactName, statusNote, appUrl });
  return tplAccountSuspendedPL({ companyName, contactName, statusNote, appUrl });
}

function tplAccountSuspendedPL({ companyName, contactName, statusNote, appUrl }) {
  const subject = "Fresh Market – konto zostało wstrzymane";
  const greet = contactName ? `Dzień dobry ${esc(contactName)},` : "Dzień dobry,";
  const noteBlock = statusNote
    ? `<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px 16px;margin:12px 0;color:#991b1b;font-size:13px;line-height:1.65;">${esc(statusNote)}</div>`
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`konto firmy <strong>${esc(companyName)}</strong> zostało tymczasowo wstrzymane przez administratora.`)}
  ${noteBlock}
  ${pBlock("Wstrzymane konto nadal pozwala zalogować się do panelu i uzupełnić profil, ale wstrzymujemy wysyłkę ofert i Spotkania B2B do czasu wyjaśnienia. Skontaktuj się z <a href='mailto:newsletter@freshmarket.eu' style='color:#0d9488;'>newsletter@freshmarket.eu</a>.")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#dc2626", body, appUrl, locale: "pl" }) };
}

function tplAccountSuspendedEN({ companyName, contactName, statusNote, appUrl }) {
  const subject = "Fresh Market – account suspended";
  const greet = contactName ? `Hello ${esc(contactName)},` : "Hello,";
  const noteBlock = statusNote
    ? `<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px 16px;margin:12px 0;color:#991b1b;font-size:13px;line-height:1.65;">${esc(statusNote)}</div>`
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`the account for <strong>${esc(companyName)}</strong> has been temporarily suspended by the administrator.`)}
  ${noteBlock}
  ${pBlock("A suspended account still lets you sign in to the panel and update the profile, but submissions and B2B Meetings are paused until further notice. Contact <a href='mailto:newsletter@freshmarket.eu' style='color:#0d9488;'>newsletter@freshmarket.eu</a>.")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#dc2626", body, appUrl, locale: "en" }) };
}

// ── D. Offer to moderation ────────────────────────────────────────────────
export function tplOfferToModeration({ companyName, offerTitle, retailerName, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplOfferToModerationEN({ companyName, offerTitle, retailerName, appUrl });
  return tplOfferToModerationPL({ companyName, offerTitle, retailerName, appUrl });
}

function tplOfferToModerationPL({ companyName, offerTitle, retailerName, appUrl }) {
  const subject = "Fresh Market – oferta została przyjęta do moderacji";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(`Twoja oferta <strong>${esc(offerTitle)}</strong>${retailerName ? ` skierowana do sieci <strong>${esc(retailerName)}</strong>` : ""} została przyjęta do moderacji.`)}
  ${pBlock("Zespół Fresh Market sprawdza dopasowanie oferty do kategorii zakupowej tej sieci. O decyzji poinformujemy mailem.")}
  ${ctaButton("Zobacz w panelu", `${appUrl}/dostawca`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl, locale: "pl" }) };
}

function tplOfferToModerationEN({ companyName, offerTitle, retailerName, appUrl }) {
  const subject = "Fresh Market – submission accepted for review";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Hello,")}
  ${pBlock(`your submission <strong>${esc(offerTitle)}</strong>${retailerName ? ` addressed to <strong>${esc(retailerName)}</strong>` : ""} has been accepted for review.`)}
  ${pBlock("The Fresh Market team is checking whether the submission fits the retailer's buying category. We'll let you know the decision by email.")}
  ${ctaButton("View in panel", `${appUrl}/dostawca`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl, locale: "en" }) };
}

// ── E. Offer approved by admin ────────────────────────────────────────────
export function tplOfferApproved({ companyName, offerTitle, retailerName, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplOfferApprovedEN({ companyName, offerTitle, retailerName, appUrl });
  return tplOfferApprovedPL({ companyName, offerTitle, retailerName, appUrl });
}

function tplOfferApprovedPL({ companyName, offerTitle, retailerName, appUrl }) {
  const subject = "Fresh Market – oferta została zatwierdzona";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(`Twoja oferta <strong>${esc(offerTitle)}</strong>${retailerName ? ` dla sieci <strong>${esc(retailerName)}</strong>` : ""} została zatwierdzona przez administratora.`)}
  ${pBlock("Oferta jest gotowa do wysyłki w najbliższym mailu zbiorczym do tej sieci. Otrzymasz potwierdzenie, gdy wiadomość zostanie wysłana.")}
  ${ctaButton("Otwórz panel dostawcy", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl, locale: "pl" }) };
}

function tplOfferApprovedEN({ companyName, offerTitle, retailerName, appUrl }) {
  const subject = "Fresh Market – submission approved";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Hello,")}
  ${pBlock(`your submission <strong>${esc(offerTitle)}</strong>${retailerName ? ` for <strong>${esc(retailerName)}</strong>` : ""} has been approved by the administrator.`)}
  ${pBlock("The submission is ready to be sent in the next batch email to that retailer. You'll get a confirmation once the message goes out.")}
  ${ctaButton("Open supplier panel", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl, locale: "en" }) };
}

// ── F. Offer sent to retailer ────────────────────────────────────────────
function offerItemsList(offers = [], locale = "pl") {
  const items = (offers || []).filter(Boolean);
  if (!items.length) return "";
  const visible = items.slice(0, 8);
  const extra = items.length - visible.length;
  const moreLabel = locale === "en" ? `+ ${extra} more` : `+ ${extra} kolejne`;
  const fallbackTitle = locale === "en" ? "Submission" : "Oferta";
  return `<ul style="color:#334155;font-size:14px;line-height:1.7;padding-left:18px;margin:8px 0 12px;">
    ${visible.map((o) => `<li><strong>${esc(o.title || o.offerTitle || o.product || fallbackTitle)}</strong></li>`).join("")}
    ${extra > 0 ? `<li>${moreLabel}</li>` : ""}
  </ul>`;
}

function pluralOffersPL(count) {
  const n = Math.abs(Number(count || 0));
  if (n === 1) return "ofertę";
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return "oferty";
  return "ofert";
}

function pluralOffersEN(count) {
  return Number(count) === 1 ? "submission" : "submissions";
}

export function tplOffersSentToRetailer({ companyName, offerTitle, offers, offerCount, retailerName, sentAt, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplOffersSentToRetailerEN({ companyName, offerTitle, offers, offerCount, retailerName, sentAt, appUrl });
  return tplOffersSentToRetailerPL({ companyName, offerTitle, offers, offerCount, retailerName, sentAt, appUrl });
}

function tplOffersSentToRetailerPL({ companyName, offerTitle, offers, offerCount, retailerName, sentAt, appUrl }) {
  const count = Number(offerCount || (offers || []).length || 1);
  const subject = count === 1
    ? `Fresh Market – oferta została wysłana do ${retailerName || "sieci"}`
    : `Fresh Market – wysłaliśmy ${count} ${pluralOffersPL(count)} do ${retailerName || "sieci"}`;
  const list = offerItemsList(offers?.length ? offers : [{ title: offerTitle }], "pl");
  const intro = count === 1
    ? `Twoja oferta została wysłana do sieci <strong>${esc(retailerName || "")}</strong>${sentAt ? ` w dniu ${esc(sentAt)}` : ""}.`
    : `Wysłaliśmy do sieci <strong>${esc(retailerName || "")}</strong> <strong>${count} ${pluralOffersPL(count)}</strong>${sentAt ? ` w dniu ${esc(sentAt)}` : ""}.`;
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(intro)}
  ${list}
  ${pBlock("Kupiec otrzymał zbiorczy mail Fresh Market PreConnect. Gdy otworzy mail albo wejdzie na listę ofert w panelu, oznaczymy wysyłkę jako dostarczoną i pokażemy rozliczenie w panelu.")}
  ${ctaButton("Zobacz w panelu", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl, locale: "pl" }) };
}

function tplOffersSentToRetailerEN({ companyName, offerTitle, offers, offerCount, retailerName, sentAt, appUrl }) {
  const count = Number(offerCount || (offers || []).length || 1);
  const subject = count === 1
    ? `Fresh Market – submission sent to ${retailerName || "retailer"}`
    : `Fresh Market – ${count} ${pluralOffersEN(count)} sent to ${retailerName || "retailer"}`;
  const list = offerItemsList(offers?.length ? offers : [{ title: offerTitle }], "en");
  const intro = count === 1
    ? `Your submission has been sent to <strong>${esc(retailerName || "")}</strong>${sentAt ? ` on ${esc(sentAt)}` : ""}.`
    : `We sent <strong>${count} ${pluralOffersEN(count)}</strong> to <strong>${esc(retailerName || "")}</strong>${sentAt ? ` on ${esc(sentAt)}` : ""}.`;
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Hello,")}
  ${pBlock(intro)}
  ${list}
  ${pBlock("The buyer received the Fresh Market PreConnect batch email. When they open the email or visit the offer list in the panel, we'll mark the submission as delivered and show the billing in your panel.")}
  ${ctaButton("View in panel", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl, locale: "en" }) };
}

export function tplOfferSentToRetailer(payload) {
  return tplOffersSentToRetailer({
    ...payload,
    offers: payload?.offers || [{ title: payload?.offerTitle }],
    offerCount: payload?.offerCount || 1,
  });
}

// ── H. Offer read by buyer ────────────────────────────────────────────────
// [B2B Round prod-rollout / email-open-tracking]
// Wysyłane gdy kupiec zobaczy ofertę: otworzy mail, wejdzie na listę
// PreConnect albo otworzy szczegóły w panelu. To jest zdarzenie dostarczenia
// i rozliczenia, więc nie obiecujemy późniejszego zwrotu kredytu.
export function tplOffersReadByBuyer({ companyName, offerTitle, offers, offerCount, retailerName, openedVia, openedAt, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplOffersReadByBuyerEN({ companyName, offerTitle, offers, offerCount, retailerName, openedVia, openedAt, appUrl });
  return tplOffersReadByBuyerPL({ companyName, offerTitle, offers, offerCount, retailerName, openedVia, openedAt, appUrl });
}

function tplOffersReadByBuyerPL({ companyName, offerTitle, offers, offerCount, retailerName, openedVia, openedAt, appUrl }) {
  const count = Number(offerCount || (offers || []).length || 1);
  const channel = openedVia === "email"
    ? "otworzył mail Fresh Market PreConnect z Twoimi propozycjami"
    : openedVia === "app_list"
      ? "wszedł na listę ofert PreConnect i zobaczył Twoje propozycje"
      : "otworzył Twoją propozycję w panelu PreConnect";
  const subject = count === 1
    ? `Fresh Market – ${retailerName || "sieć"} zobaczyła Twoją ofertę`
    : `Fresh Market – ${retailerName || "sieć"} zobaczyła Twoje oferty`;
  const list = offerItemsList(offers?.length ? offers : [{ title: offerTitle }], "pl");
  const intro = count === 1
    ? `Kupiec sieci <strong>${esc(retailerName || "")}</strong> ${channel}${openedAt ? ` (${esc(openedAt)})` : ""}.`
    : `Kupiec sieci <strong>${esc(retailerName || "")}</strong> ${channel}${openedAt ? ` (${esc(openedAt)})` : ""}. Zobaczone oferty:`;
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(intro)}
  ${list}
  ${pBlock("To oznacza, że wysyłka została dostarczona. Rozliczenie z pakietu jest widoczne w panelu Fresh Market PreConnect.")}
  ${pBlock("Nie musisz nic robić od razu — miej tylko pod ręką aktualne ceny, wolumeny, certyfikaty i kalendarz dostaw, jeśli kupiec poprosi o szczegóły.")}
  ${ctaButton("Zobacz w panelu", `${appUrl}/dostawca`, "#7c3aed")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#7c3aed", body, appUrl, locale: "pl" }) };
}

function tplOffersReadByBuyerEN({ companyName, offerTitle, offers, offerCount, retailerName, openedVia, openedAt, appUrl }) {
  const count = Number(offerCount || (offers || []).length || 1);
  const channel = openedVia === "email"
    ? "opened the Fresh Market PreConnect email with your submissions"
    : openedVia === "app_list"
      ? "visited the PreConnect submissions list and saw your submissions"
      : "opened your submission in the PreConnect panel";
  const subject = count === 1
    ? `Fresh Market – ${retailerName || "retailer"} saw your submission`
    : `Fresh Market – ${retailerName || "retailer"} saw your submissions`;
  const list = offerItemsList(offers?.length ? offers : [{ title: offerTitle }], "en");
  const intro = count === 1
    ? `The buyer at <strong>${esc(retailerName || "")}</strong> ${channel}${openedAt ? ` (${esc(openedAt)})` : ""}.`
    : `The buyer at <strong>${esc(retailerName || "")}</strong> ${channel}${openedAt ? ` (${esc(openedAt)})` : ""}. Submissions seen:`;
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Hello,")}
  ${pBlock(intro)}
  ${list}
  ${pBlock("This means the submission was delivered. The package billing is visible in the Fresh Market PreConnect panel.")}
  ${pBlock("You don't have to act right away — just keep current prices, volumes, certificates and delivery calendar ready in case the buyer asks for details.")}
  ${ctaButton("View in panel", `${appUrl}/dostawca`, "#7c3aed")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#7c3aed", body, appUrl, locale: "en" }) };
}

export function tplOfferReadByBuyer(payload) {
  return tplOffersReadByBuyer({
    ...payload,
    offers: payload?.offers || [{ title: payload?.offerTitle }],
    offerCount: payload?.offerCount || 1,
  });
}

// ── G. Offer expired ──────────────────────────────────────────────────────
export function tplOfferExpired({ companyName, offerTitle, retailerName, refunded, appUrl, locale }) {
  const lng = pickLocale(locale);
  if (lng === "en") return tplOfferExpiredEN({ companyName, offerTitle, retailerName, refunded, appUrl });
  return tplOfferExpiredPL({ companyName, offerTitle, retailerName, refunded, appUrl });
}

function tplOfferExpiredPL({ companyName, offerTitle, retailerName, refunded, appUrl }) {
  const subject = "Fresh Market – oferta wygasła";
  const refundLine = refunded
    ? pBlock("✓ Środki za niewykorzystaną wysyłkę zostały zwrócone na Twój portfel kredytów.")
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(`Twoja oferta <strong>${esc(offerTitle)}</strong>${retailerName ? ` wysłana do sieci <strong>${esc(retailerName)}</strong>` : ""} wygasła — kupiec nie odczytał wiadomości w terminie 14 dni.`)}
  ${refundLine}
  ${pBlock("Możesz przygotować zaktualizowaną ofertę i zlecić ponowną wysyłkę z poziomu panelu.")}
  ${ctaButton("Otwórz panel dostawcy", `${appUrl}/dostawca`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#d97706", body, appUrl, locale: "pl" }) };
}

function tplOfferExpiredEN({ companyName, offerTitle, retailerName, refunded, appUrl }) {
  const subject = "Fresh Market – submission expired";
  const refundLine = refunded
    ? pBlock("✓ The credits for the unused submission have been returned to your credit wallet.")
    : "";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Hello,")}
  ${pBlock(`your submission <strong>${esc(offerTitle)}</strong>${retailerName ? ` sent to <strong>${esc(retailerName)}</strong>` : ""} has expired — the buyer didn't open the message within 14 days.`)}
  ${refundLine}
  ${pBlock("You can prepare an updated submission and trigger a new send from the panel.")}
  ${ctaButton("Open supplier panel", `${appUrl}/dostawca`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#d97706", body, appUrl, locale: "en" }) };
}

// ── Admin notification: new self-registration ─────────────────────────────
export function tplAdminNewRegistration({ companyName, contactEmail, country, appUrl }) {
  const subject = `Fresh Market – nowa rejestracja: ${companyName}`;
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(`Nowa rejestracja w panelu Fresh Market wymaga zatwierdzenia.`)}
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 12px;font-size:13px;color:#334155;">
    <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Firma:</td><td style="padding:4px 0;font-weight:700;">${esc(companyName)}</td></tr>
    <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Kontakt:</td><td style="padding:4px 0;">${esc(contactEmail)}</td></tr>
    <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Kraj:</td><td style="padding:4px 0;">${esc(country || "—")}</td></tr>
  </table>
  ${ctaButton("Otwórz panel administratora → Firmy", `${appUrl}/admin`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl }) };
}

export function pickTemplate(name, payload) {
  switch (name) {
    case "registration_accepted":  return tplRegistrationAccepted(payload);
    case "account_activated":      return tplAccountActivated(payload);
    case "account_rejected":       return tplAccountRejected(payload);
    case "account_suspended":      return tplAccountSuspended(payload);
    case "offer_to_moderation":    return tplOfferToModeration(payload);
    case "offer_approved":         return tplOfferApproved(payload);
    case "offer_sent_to_retailer": return tplOfferSentToRetailer(payload);
    case "offers_sent_to_retailer": return tplOffersSentToRetailer(payload);
    case "offer_read_by_buyer":    return tplOfferReadByBuyer(payload);
    case "offers_read_by_buyer":   return tplOffersReadByBuyer(payload);
    case "offer_expired":          return tplOfferExpired(payload);
    case "admin_new_registration": return tplAdminNewRegistration(payload);
    default:                       return null;
  }
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
