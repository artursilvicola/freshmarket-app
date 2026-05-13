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

const FOOTER = (appUrl) => `
<tr><td style="background:#0f172a;padding:18px 28px;text-align:center;">
  <div style="color:rgba(255,255,255,0.92);font-weight:700;font-size:13px;margin-bottom:4px;">Fresh Market PreConnect</div>
  <div style="color:rgba(255,255,255,0.45);font-size:11px;line-height:1.7;">
    KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Polska<br>
    <a href="${esc(appUrl)}" style="color:rgba(255,255,255,0.7);text-decoration:none;">freshmarket.eu</a> ·
    <a href="mailto:newsletter@freshmarket.eu" style="color:rgba(255,255,255,0.7);text-decoration:none;">newsletter@freshmarket.eu</a>
  </div>
</td></tr>`;

function shell({ title, accent = "#0d9488", body, appUrl }) {
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#ececec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececec;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.08);">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,${accent} 100%);padding:24px 32px;text-align:center;">
        <div style="color:white;font-weight:800;font-size:20px;letter-spacing:-0.4px;">Fresh Market <span style="color:rgba(255,255,255,0.6);font-weight:600;font-size:12px;">PreConnect</span></div>
      </td></tr>
      ${body}
      ${FOOTER(appUrl)}
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
export function tplRegistrationAccepted({ companyName, contactName, appUrl }) {
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
  return { subject, html: shell({ title: subject, body, appUrl }) };
}

// ── B. Account activated ──────────────────────────────────────────────────
export function tplAccountActivated({ companyName, contactName, preconnectEnabled, fmB2bEnabled, appUrl }) {
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
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl }) };
}

// ── C1. Account rejected (przy rejestracji) ───────────────────────────────
export function tplAccountRejected({ companyName, contactName, statusNote, appUrl }) {
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
  return { subject, html: shell({ title: subject, accent: "#dc2626", body, appUrl }) };
}

// ── C2. Account suspended (aktywne konto wstrzymane) ──────────────────────
export function tplAccountSuspended({ companyName, contactName, statusNote, appUrl }) {
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
  return { subject, html: shell({ title: subject, accent: "#dc2626", body, appUrl }) };
}

// ── D. Offer to moderation ────────────────────────────────────────────────
export function tplOfferToModeration({ companyName, offerTitle, retailerName, appUrl }) {
  const subject = "Fresh Market – oferta została przyjęta do moderacji";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(`Twoja oferta <strong>${esc(offerTitle)}</strong>${retailerName ? ` skierowana do sieci <strong>${esc(retailerName)}</strong>` : ""} została przyjęta do moderacji.`)}
  ${pBlock("Zespół Fresh Market sprawdza dopasowanie oferty do kategorii zakupowej tej sieci. O decyzji poinformujemy mailem.")}
  ${ctaButton("Zobacz w panelu", `${appUrl}/dostawca`)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl }) };
}

// ── E. Offer approved by admin ────────────────────────────────────────────
export function tplOfferApproved({ companyName, offerTitle, retailerName, appUrl }) {
  const subject = "Fresh Market – oferta została zatwierdzona";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(`Twoja oferta <strong>${esc(offerTitle)}</strong>${retailerName ? ` dla sieci <strong>${esc(retailerName)}</strong>` : ""} została zatwierdzona przez administratora.`)}
  ${pBlock("Oferta jest gotowa do wysyłki w najbliższym mailu zbiorczym do tej sieci. Otrzymasz potwierdzenie, gdy wiadomość zostanie wysłana.")}
  ${ctaButton("Otwórz panel dostawcy", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl }) };
}

// ── F. Offer sent to retailer ────────────────────────────────────────────
function offerItemsList(offers = []) {
  const items = (offers || []).filter(Boolean);
  if (!items.length) return "";
  const visible = items.slice(0, 8);
  const extra = items.length - visible.length;
  return `<ul style="color:#334155;font-size:14px;line-height:1.7;padding-left:18px;margin:8px 0 12px;">
    ${visible.map((o) => `<li><strong>${esc(o.title || o.offerTitle || o.product || "Oferta")}</strong></li>`).join("")}
    ${extra > 0 ? `<li>+ ${extra} kolejne</li>` : ""}
  </ul>`;
}

function pluralOffers(count) {
  const n = Math.abs(Number(count || 0));
  if (n === 1) return "ofertę";
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return "oferty";
  return "ofert";
}

export function tplOffersSentToRetailer({ companyName, offerTitle, offers, offerCount, retailerName, sentAt, appUrl }) {
  const count = Number(offerCount || (offers || []).length || 1);
  const subject = count === 1
    ? `Fresh Market – oferta została wysłana do ${retailerName || "sieci"}`
    : `Fresh Market – wysłaliśmy ${count} ${pluralOffers(count)} do ${retailerName || "sieci"}`;
  const list = offerItemsList(offers?.length ? offers : [{ title: offerTitle }]);
  const intro = count === 1
    ? `Twoja oferta została wysłana do sieci <strong>${esc(retailerName || "")}</strong>${sentAt ? ` w dniu ${esc(sentAt)}` : ""}.`
    : `Wysłaliśmy do sieci <strong>${esc(retailerName || "")}</strong> <strong>${count} ${pluralOffers(count)}</strong>${sentAt ? ` w dniu ${esc(sentAt)}` : ""}.`;
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock("Dzień dobry,")}
  ${pBlock(intro)}
  ${list}
  ${pBlock("Kupiec otrzymał zbiorczy mail Fresh Market PreConnect. Gdy otworzy mail albo wejdzie na listę ofert w panelu, oznaczymy wysyłkę jako dostarczoną i pokażemy rozliczenie w panelu.")}
  ${ctaButton("Zobacz w panelu", `${appUrl}/dostawca`, "#059669")}
</td></tr>`;
  return { subject, html: shell({ title: subject, accent: "#059669", body, appUrl }) };
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
export function tplOffersReadByBuyer({ companyName, offerTitle, offers, offerCount, retailerName, openedVia, openedAt, appUrl }) {
  const count = Number(offerCount || (offers || []).length || 1);
  const channel = openedVia === "email"
    ? "otworzył mail Fresh Market PreConnect z Twoimi propozycjami"
    : openedVia === "app_list"
      ? "wszedł na listę ofert PreConnect i zobaczył Twoje propozycje"
      : "otworzył Twoją propozycję w panelu PreConnect";
  const subject = count === 1
    ? `Fresh Market – ${retailerName || "sieć"} zobaczyła Twoją ofertę`
    : `Fresh Market – ${retailerName || "sieć"} zobaczyła Twoje oferty`;
  const list = offerItemsList(offers?.length ? offers : [{ title: offerTitle }]);
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
  return { subject, html: shell({ title: subject, accent: "#7c3aed", body, appUrl }) };
}

export function tplOfferReadByBuyer(payload) {
  return tplOffersReadByBuyer({
    ...payload,
    offers: payload?.offers || [{ title: payload?.offerTitle }],
    offerCount: payload?.offerCount || 1,
  });
}

// ── G. Offer expired ──────────────────────────────────────────────────────
export function tplOfferExpired({ companyName, offerTitle, retailerName, refunded, appUrl }) {
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
  return { subject, html: shell({ title: subject, accent: "#d97706", body, appUrl }) };
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
