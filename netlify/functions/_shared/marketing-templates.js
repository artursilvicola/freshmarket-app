/**
 * [feat/marketing-activation] Szablony kampanii aktywizacyjnej PreConnect (PL/EN).
 *
 * Dwa szablony (decyzja Artura 4.11): `start_with_credits` (pierwsza propozycja)
 * i `return_active` (powrót z nowym asortymentem). Treść proponuje pomoc, nie
 * obiecuje odczytu, spotkania ani zakupu. Liczba kredytów i daty pochodzą z danych
 * odczytanych tuż przed zatwierdzeniem (snapshot) — nigdy wpisane na sztywno.
 *
 * Każdy render zwraca { subject, html, text } — wersja tekstowa jest pełna.
 * Stopka: wypis (link one-click) + adres do odpowiedzi. Układ HTML jak w
 * supplier-email-templates.js (tabele, bez CSS w <head>).
 *
 * Szablony są w kodzie (nie w UI) — zmiana = zmiana w repo + review.
 */
import { formatLongDate, nextBuyerMailingDate, parseISODate } from "./marketing-dates.js";

export const TEMPLATE_KEYS = Object.freeze(["start_with_credits", "return_active"]);

export function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pickLocale(input) {
  const raw = String(input || "").trim().toLowerCase().split(/[-_]/)[0];
  return raw === "en" ? "en" : "pl";
}

function creditsWord(n, locale) {
  if (locale === "en") return n === 1 ? "credit" : "credits";
  const t = n % 10, h = n % 100;
  if (n === 1) return "kredyt";
  if (t >= 2 && t <= 4 && !(h >= 12 && h <= 14)) return "kredyty";
  return "kredytów";
}

function shell({ title, body, locale, unsubscribeUrl, replyTo, appUrl }) {
  const addr = locale === "en"
    ? "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Poland"
    : "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Polska";
  const unsub = locale === "en"
    ? `You receive this message as the operator of a supplier account in Fresh Market B2B. <a href="${esc(unsubscribeUrl)}" style="color:rgba(255,255,255,0.75);">Unsubscribe from PreConnect information</a>.`
    : `Otrzymujesz tę wiadomość jako operator konta dostawcy w Fresh Market B2B. <a href="${esc(unsubscribeUrl)}" style="color:rgba(255,255,255,0.75);">Wypisz się z informacji o PreConnect</a>.`;
  const reply = replyTo ? (locale === "en" ? `Reply to this e-mail or write to <a href="mailto:${esc(replyTo)}" style="color:rgba(255,255,255,0.75);">${esc(replyTo)}</a>.` : `Odpowiedz na tę wiadomość albo napisz na <a href="mailto:${esc(replyTo)}" style="color:rgba(255,255,255,0.75);">${esc(replyTo)}</a>.`) : "";
  return `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#ececec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececec;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0d9488 100%);padding:24px 32px;text-align:center;">
        <div style="color:white;font-weight:800;font-size:20px;letter-spacing:-0.4px;">Fresh Market <span style="color:rgba(255,255,255,0.6);font-weight:600;font-size:12px;">PreConnect</span></div>
      </td></tr>
      <tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;">${body}</td></tr>
      <tr><td style="background:#0f172a;padding:18px 28px;text-align:center;">
        <div style="color:rgba(255,255,255,0.92);font-weight:700;font-size:13px;margin-bottom:4px;">Fresh Market PreConnect</div>
        <div style="color:rgba(255,255,255,0.45);font-size:11px;line-height:1.7;">${addr}<br><a href="${esc(appUrl)}" style="color:rgba(255,255,255,0.7);text-decoration:none;">b2b.freshmarket.eu</a></div>
        <div style="color:rgba(255,255,255,0.55);font-size:11px;line-height:1.7;margin-top:10px;">${reply}<br>${unsub}</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const p = (t) => `<p style="margin:0 0 14px;">${t}</p>`;
const cta = (label, url) => `<p style="margin:22px 0 10px;"><a href="${esc(url)}" style="display:inline-block;background:#0d9488;color:white;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;">${esc(label)}</a></p>`;

/**
 * @param {object} d
 * @param {string} d.templateKey  start_with_credits | return_active
 * @param {string} d.locale       pl | en
 * @param {string} d.companyName
 * @param {number} d.creditsRemaining  ważne kredyty w chwili odczytu
 * @param {string|null} d.creditsExpiry 'YYYY-MM-DD' najbliższy termin ważności (null = bez terminu)
 * @param {string} d.snapshotAt   ISO chwila odczytu danych
 * @param {Date}   [d.now]        do wyliczenia najbliższego mailingu (test)
 * @param {string} d.appUrl
 * @param {string} d.unsubscribeUrl
 * @param {string} [d.replyTo]
 */
export function renderMarketingTemplate(d) {
  const key = TEMPLATE_KEYS.includes(d?.templateKey) ? d.templateKey : null;
  if (!key) throw new Error("unknown_template:" + String(d?.templateKey));
  const locale = pickLocale(d.locale);
  const n = Math.max(0, Number(d.creditsRemaining) || 0);
  const mailing = nextBuyerMailingDate(d.now || new Date());
  const mailingLabel = formatLongDate(mailing, locale);
  const expiry = parseISODate(d.creditsExpiry);
  const expiryLabel = expiry ? formatLongDate(expiry, locale) : null;
  const snapshot = d.snapshotAt ? new Date(d.snapshotAt) : new Date();
  const snapshotLabel = formatLongDate(snapshot, locale);
  const company = String(d.companyName || "").trim();
  const appUrl = d.appUrl || "https://b2b.freshmarket.eu";
  if (!d.unsubscribeUrl) throw new Error("unsubscribe_url_required");

  let subject, paras, ctaLabel;
  if (locale === "en") {
    const credits = `${n} ${creditsWord(n, "en")}`;
    if (key === "start_with_credits") {
      subject = `You have ${credits} in PreConnect — next buyer mailing on ${mailingLabel}`;
      paras = [
        `Hello${company ? ", " + esc(company) : ""},`,
        `Your Fresh Market B2B account has <strong>${credits}</strong> available in PreConnect (as of ${snapshotLabel})${expiryLabel ? `, the nearest expiry date is <strong>${expiryLabel}</strong>` : ""}. One product proposal to one retail chain uses one credit. The credit is settled after a registered read: the buyer opening the e-mail or viewing the proposal on the list in their panel.`,
        `Prepare your proposal before the next buyer mailing on <strong>${mailingLabel}</strong>. Proposals qualify for the mailing according to their current status.`,
        `If you are not sure how to prepare a proposal or which chain to address, reply to this e-mail. We will help you start.`,
      ];
      ctaLabel = "Open the panel";
    } else {
      subject = `Buyer mailing on ${mailingLabel} — add a new proposal in PreConnect?`;
      paras = [
        `Hello${company ? ", " + esc(company) : ""},`,
        `If you have a new product or an up-to-date supply programme, you can prepare another proposal in PreConnect. Your account has <strong>${credits}</strong> available (as of ${snapshotLabel})${expiryLabel ? `, nearest expiry <strong>${expiryLabel}</strong>` : ""}. A credit is settled after a registered read: the buyer opening the e-mail or viewing the proposal on the list in their panel.`,
        `Prepare your proposal before the next buyer mailing on <strong>${mailingLabel}</strong>. Proposals qualify for the mailing according to their current status. In the panel you can check the state of your previous sendings.`,
        `If you would like help choosing a chain or describing your range, reply to this e-mail.`,
      ];
      ctaLabel = "Go to PreConnect";
    }
  } else {
    const credits = `${n} ${creditsWord(n, "pl")}`;
    if (key === "start_with_credits") {
      subject = `Masz ${credits} PreConnect — najbliższy mailing do kupców ${mailingLabel}`;
      paras = [
        `Dzień dobry${company ? ", " + esc(company) : ""},`,
        `W Twoim koncie Fresh Market B2B dostępne są <strong>${credits}</strong> PreConnect (stan na ${snapshotLabel})${expiryLabel ? `, najbliższy termin ważności: <strong>${expiryLabel}</strong>` : ""}. Jedna propozycja asortymentowa do jednej sieci = jeden kredyt. Kredyt rozliczamy po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca.`,
        `Przygotuj propozycję przed najbliższym mailingiem do kupców <strong>${mailingLabel}</strong>. Do wysyłki kwalifikujemy propozycje zgodnie z ich aktualnym statusem.`,
        `Jeżeli nie wiesz, jak przygotować propozycję lub do kogo ją skierować, odpowiedz na tę wiadomość. Pomożemy Ci zacząć.`,
      ];
      ctaLabel = "Przejdź do panelu";
    } else {
      subject = `Mailing do kupców ${mailingLabel} — dodasz nową propozycję w PreConnect?`;
      paras = [
        `Dzień dobry${company ? ", " + esc(company) : ""},`,
        `Jeżeli masz nowy produkt lub aktualny program dostaw, możesz przygotować kolejną propozycję w PreConnect. W Twoim koncie dostępne są <strong>${credits}</strong> (stan na ${snapshotLabel})${expiryLabel ? `, najbliższy termin ważności: <strong>${expiryLabel}</strong>` : ""}. Kredyt rozliczamy po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca.`,
        `Przygotuj propozycję przed najbliższym mailingiem do kupców <strong>${mailingLabel}</strong>. Do wysyłki kwalifikujemy propozycje zgodnie z ich aktualnym statusem. W panelu sprawdzisz stan dotychczasowych wysyłek.`,
        `Jeżeli chcesz pomocy w wyborze sieci albo opisaniu asortymentu, odpowiedz na tę wiadomość.`,
      ];
      ctaLabel = "Przejdź do PreConnect";
    }
  }

  const body = paras.map(p).join("") + cta(ctaLabel, appUrl);
  const html = shell({ title: subject, body, locale, unsubscribeUrl: d.unsubscribeUrl, replyTo: d.replyTo, appUrl });
  const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const text = [
    ...paras.map(strip), "", `${ctaLabel}: ${appUrl}`, "",
    d.replyTo ? (locale === "en" ? `Reply to this e-mail or write to ${d.replyTo}.` : `Odpowiedz na tę wiadomość albo napisz na ${d.replyTo}.`) : "",
    locale === "en" ? `Unsubscribe from PreConnect information: ${d.unsubscribeUrl}` : `Wypisz się z informacji o PreConnect: ${d.unsubscribeUrl}`,
  ].filter((l) => l !== null).join("\n");
  return { subject, html, text, meta: { locale, templateKey: key, mailingDate: mailingLabel, creditsRemaining: n, creditsExpiry: expiryLabel } };
}
