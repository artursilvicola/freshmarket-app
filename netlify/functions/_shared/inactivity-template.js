/**
 * Szablon e-maila: ostrzeżenie o nieaktywności konta (30 / 7 dni przed usunięciem).
 * [feat/account-inactivity-foundation / Poprawki Lany #8]
 *
 * Standalone (własny shell) — NIE dotyka chronionego supplier-email-templates.js.
 * Zwraca { subject, html }, PL + EN, dwa etapy: stage '30d' i '7d'.
 *
 * Konto nieaktywne 24 miesiące podlega archiwizacji/anonimizacji (RODO).
 * Ostrzeżenie informuje JAK zachować konto (zaloguj się).
 */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#b91c1c 100%);padding:24px 32px;text-align:center;">
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
 * @param {string} p.name         nazwa/osoba (opcjonalnie)
 * @param {string} p.stage        '30d' | '7d'
 * @param {string} p.deleteAfter  data (YYYY-MM-DD), po której konto może zostać usunięte
 * @param {string} p.appUrl
 * @param {string} p.locale       "pl" | "en"
 * @returns {{ subject: string, html: string }}
 */
export function tplInactivityWarning({ name, stage, deleteAfter, appUrl, locale }) {
  const lng = pickLocale(locale);
  const days = stage === "7d" ? 7 : 30;
  const date = fmtDMY(deleteAfter);
  const url = `${appUrl || "https://b2b.freshmarket.eu"}/login`;

  if (lng === "en") {
    const subject = `Fresh Market – your account will be removed in ${days} days due to inactivity`;
    const greet = name ? `Hello ${esc(name)},` : "Hello,";
    const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`your Fresh Market account has been inactive for nearly 24 months. In <strong>${days} days</strong> it may be removed or anonymised in line with our data-retention rules (GDPR).`)}
  <div style="margin:6px 0 4px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:14px;">
    <strong>Account may be removed after: ${esc(date)}</strong>
  </div>
  ${pBlock("To keep your account, simply <strong>sign in</strong> — that resets the inactivity timer. No other action is required.")}
  ${ctaButton("Sign in to keep my account", url)}
</td></tr>`;
    return { subject, html: shell({ title: subject, body, appUrl, locale: "en" }) };
  }

  const subject = `Fresh Market – konto zostanie usunięte za ${days} dni z powodu nieaktywności`;
  const greet = name ? `Dzień dobry ${esc(name)},` : "Dzień dobry,";
  const body = `
<tr><td style="padding:24px 32px 8px;">
  ${pBlock(greet)}
  ${pBlock(`Twoje konto Fresh Market jest nieaktywne od blisko 24 miesięcy. Za <strong>${days} dni</strong> może zostać usunięte lub zanonimizowane zgodnie z zasadami retencji danych (RODO).`)}
  <div style="margin:6px 0 4px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:14px;">
    <strong>Konto może zostać usunięte po: ${esc(date)}</strong>
  </div>
  ${pBlock("Aby zachować konto, wystarczy się <strong>zalogować</strong> — to zeruje licznik nieaktywności. Nie trzeba robić nic więcej.")}
  ${ctaButton("Zaloguj się, aby zachować konto", url)}
</td></tr>`;
  return { subject, html: shell({ title: subject, body, appUrl, locale: "pl" }) };
}
