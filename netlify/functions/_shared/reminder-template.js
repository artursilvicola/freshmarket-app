/**
 * Szablon e-maila: przypomnienie o wygaśnięciu kredytów (14 dni przed).
 * [feat/credit-expiry-reminder / Poprawki Lany #6]
 *
 * Standalone (własny shell) — świadomie NIE dotyka chronionego
 * supplier-email-templates.js. Zwraca { subject, html }, PL + EN.
 *
 * Treść zgodna z wymaganiem Lany:
 *   "Za 14 dni upływa termin ważności Twoich kredytów.
 *    Niewykorzystane kredyty przepadną po terminie ważności."
 */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// YYYY-MM-DD → DD.MM.YYYY
function fmtDMY(d) {
  const s = String(d || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function pickLocale(input) {
  const raw = String(input || "pl").trim().toLowerCase().split(/[-_]/)[0];
  return raw === "en" ? "en" : "pl";
}

function shell({ title, body, appUrl, locale }) {
  const footerAddr = locale === "en"
    ? "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Poland"
    : "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Polska";
  return `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#ececec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececec;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.08);">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#d97706 100%);padding:24px 32px;text-align:center;">
        <div style="color:white;font-weight:800;font-size:20px;letter-spacing:-0.4px;">Fresh Market <span style="color:rgba(255,255,255,0.6);font-weight:600;font-size:12px;">PreConnect</span></div>
      </td></tr>
      ${body}
      <tr><td style="background:#0f172a;padding:18px 28px;text-align:center;">
        <div style="color:rgba(255,255,255,0.92);font-weight:700;font-size:13px;margin-bottom:4px;">Fresh Market PreConnect</div>
        <div style="color:rgba(255,255,255,0.45);font-size:11px;line-height:1.7;">
          ${footerAddr}<br>
          <a href="${esc(appUrl)}" style="color:rgba(255,255,255,0.7);text-decoration:none;">freshmarket.eu</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function pBlock(text) {
  return `<p style="margin:0 0 10px;color:#334155;line-height:1.65;font-size:14px;">${text}</p>`;
}

function ctaButton(label, url) {
  return `<div style="margin:18px 0 8px;text-align:center;">
    <a href="${esc(url)}" style="display:inline-block;background:#0d9488;color:white;padding:11px 24px;border-radius:7px;font-weight:700;font-size:13px;text-decoration:none;">${esc(label)}</a>
  </div>`;
}

/**
 * @param {object} p
 * @param {string} p.companyName
 * @param {number} p.qtyRemaining   liczba niewykorzystanych kredytów
 * @param {string} p.expiresAt      data ważności (YYYY-MM-DD)
 * @param {string} p.appUrl
 * @param {string} p.locale         "pl" | "en"
 * @returns {{ subject: string, html: string }}
 */
export function tplCreditExpiryReminder({ companyName, qtyRemaining, expiresAt, appUrl, locale }) {
  const lng = pickLocale(locale);
  const date = fmtDMY(expiresAt);
  const url = `${appUrl || "https://b2b.freshmarket.eu"}/dostawca`;

  if (lng === "en") {
    const subject = "Fresh Market – your credits expire in 14 days";
    const greet = companyName ? `Hello ${esc(companyName)},` : "Hello,";
    const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock("In 14 days your PreConnect credits expire. Unused credits will be forfeited after the expiry date.")}
  <div style="margin:6px 0 4px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#78350f;font-size:14px;">
    <strong>Valid until: ${esc(date)}</strong>${qtyRemaining != null ? ` · ${esc(qtyRemaining)} unused credit(s)` : ""}
  </div>
  ${pBlock("Use your credits before the deadline by sending submissions to retailers, or purchase a new package to keep going.")}
  ${ctaButton("Open supplier panel", url)}
</td></tr>`;
    return { subject, html: shell({ title: subject, body, appUrl, locale: "en" }) };
  }

  const subject = "Fresh Market – Twoje kredyty wygasają za 14 dni";
  const greet = companyName ? `Dzień dobry ${esc(companyName)},` : "Dzień dobry,";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock("Za 14 dni upływa termin ważności Twoich kredytów. Niewykorzystane kredyty przepadną po terminie ważności.")}
  <div style="margin:6px 0 4px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#78350f;font-size:14px;">
    <strong>Ważne do: ${esc(date)}</strong>${qtyRemaining != null ? ` · ${esc(qtyRemaining)} niewykorzystanych kredytów` : ""}
  </div>
  ${pBlock("Wykorzystaj kredyty przed terminem, wysyłając propozycje do sieci, albo kup nowy pakiet, aby działać dalej.")}
  ${ctaButton("Otwórz panel dostawcy", url)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl, locale: "pl" }) };
}
