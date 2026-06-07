/**
 * Szablon dokumentu PROFORMA (HTML) — PL + EN.
 * [feat/bank-transfer-proforma / Poprawki Lany #2]
 *
 * Zwraca { subject, html }. HTML jest samodzielnym dokumentem (działa jako treść
 * maila ORAZ jako plik do pobrania / wydruku do PDF przez przeglądarkę).
 * Pisany tabelarycznie — odporny na klienty pocztowe.
 *
 * NIE jest fakturą VAT ani dokumentem księgowym — to proforma (podstawa do
 * płatności przelewem). Pakiet aktywuje admin ręcznie po zaksięgowaniu wpłaty.
 *
 * Dane SPRZEDAWCY i RACHUNEK są konfigurowalne przez env (bo to dane prawne/
 * finansowe — nie zgadujemy ich w kodzie):
 *   PROFORMA_SELLER_NAME, PROFORMA_SELLER_ADDRESS, PROFORMA_SELLER_NIP,
 *   PROFORMA_BANK_BENEFICIARY, PROFORMA_BANK_IBAN, PROFORMA_BANK_NAME.
 * Domyślne wartości pochodzą ze stopki maili / danych w panelu; pola których
 * nie znamy na pewno (NIP sprzedawcy) mają widoczny placeholder do uzupełnienia
 * PRZED włączeniem flagi BANK_TRANSFER_PROFORMA.
 */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function seller() {
  return {
    name: process.env.PROFORMA_SELLER_NAME || "KJOW Sp. z o.o.",
    address: process.env.PROFORMA_SELLER_ADDRESS || "ul. Marii 17/25, 05-803 Pruszków, Polska",
    nip: process.env.PROFORMA_SELLER_NIP || "[NIP sprzedawcy — uzupełnij env PROFORMA_SELLER_NIP]",
  };
}

function bank() {
  return {
    beneficiary: process.env.PROFORMA_BANK_BENEFICIARY || "KJOW Sp. z o.o.",
    bankName: process.env.PROFORMA_BANK_NAME || "PKO BP",
    iban: process.env.PROFORMA_BANK_IBAN || "[IBAN — uzupełnij env PROFORMA_BANK_IBAN]",
  };
}

// Format liczby jako kwoty: 400.00 → "400,00" (PL) / "400.00" (EN).
function money(n, locale) {
  const v = Number(n || 0).toFixed(2);
  return locale === "en" ? v : v.replace(".", ",");
}

const T = {
  pl: {
    title: "Faktura proforma",
    docNo: "Numer",
    issued: "Data wystawienia",
    dueNote: "Dokument do zapłaty przelewem. Po zaksięgowaniu wpłaty pakiet kredytów zostanie aktywowany.",
    seller: "Sprzedawca",
    buyer: "Nabywca",
    nip: "NIP",
    item: "Pozycja",
    qty: "Ilość",
    net: "Netto",
    vat: "VAT",
    gross: "Brutto",
    creditsUnit: "kredytów PreConnect",
    pkg: "Pakiet PreConnect",
    sumNet: "Razem netto",
    sumVat: "VAT 23%",
    sumGross: "Razem do zapłaty",
    payTitle: "Dane do przelewu",
    beneficiary: "Odbiorca",
    bankName: "Bank",
    iban: "Numer rachunku (IBAN)",
    payTitleLabel: "Tytuł przelewu",
    disclaimer: "Faktura proforma nie jest fakturą VAT ani dokumentem księgowym. Po zaksięgowaniu wpłaty wystawimy właściwy dokument i aktywujemy pakiet.",
    emailIntro: "W załączeniu / poniżej proforma do opłacenia przelewem. Pakiet kredytów aktywujemy po zaksięgowaniu wpłaty.",
  },
  en: {
    title: "Proforma invoice",
    docNo: "Number",
    issued: "Issue date",
    dueNote: "Document to be paid by bank transfer. The credit package will be activated once the payment is posted.",
    seller: "Seller",
    buyer: "Buyer",
    nip: "Tax ID",
    item: "Item",
    qty: "Qty",
    net: "Net",
    vat: "VAT",
    gross: "Gross",
    creditsUnit: "PreConnect credits",
    pkg: "PreConnect package",
    sumNet: "Total net",
    sumVat: "VAT 23%",
    sumGross: "Total due",
    payTitle: "Bank transfer details",
    beneficiary: "Beneficiary",
    bankName: "Bank",
    iban: "Account number (IBAN)",
    payTitleLabel: "Transfer title",
    disclaimer: "A proforma invoice is not a VAT invoice or an accounting document. Once the payment is posted we will issue the proper document and activate the package.",
    emailIntro: "Below is your proforma to pay by bank transfer. The credit package will be activated once the payment is posted.",
  },
};

/**
 * @param {object} p
 * @param {string} p.number      PF/2026/000001
 * @param {string} p.issuedAt    ISO date
 * @param {string} p.planLabel   np. "Standard 10"
 * @param {number} p.qty         liczba kredytów
 * @param {string} p.currency    "EUR"
 * @param {number} p.net
 * @param {number} p.vatRate     23
 * @param {number} p.vat
 * @param {number} p.gross
 * @param {object} p.company     { name, nip, address }
 * @param {string} p.locale      "pl" | "en"
 * @returns {{ subject: string, html: string }}
 */
export function renderProforma(p) {
  const locale = p.locale === "en" ? "en" : "pl";
  const t = T[locale];
  const s = seller();
  const b = bank();
  const cur = esc(p.currency || "EUR");
  const issued = String(p.issuedAt || "").slice(0, 10);
  const transferTitle = p.number; // tytuł przelewu = numer proformy

  const subject = locale === "en"
    ? `Fresh Market – proforma ${p.number}`
    : `Fresh Market – proforma ${p.number}`;

  const itemName = `${esc(t.pkg)} — ${esc(p.planLabel)} (${esc(p.qty)} ${esc(t.creditsUnit)})`;

  const html = `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.title)} ${esc(p.number)}</title></head>
<body style="margin:0;padding:0;background:#ececec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececec;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.08);">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0d9488 100%);padding:22px 32px;">
        <div style="color:white;font-weight:800;font-size:20px;letter-spacing:-0.4px;">Fresh Market <span style="color:rgba(255,255,255,0.6);font-weight:600;font-size:12px;">PreConnect</span></div>
        <div style="color:rgba(255,255,255,0.85);font-weight:700;font-size:15px;margin-top:6px;">${esc(t.title)}</div>
      </td></tr>

      <tr><td style="padding:22px 32px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
          <tr>
            <td style="padding:2px 0;"><span style="color:#94a3b8;">${esc(t.docNo)}:</span> <strong>${esc(p.number)}</strong></td>
            <td style="padding:2px 0;text-align:right;"><span style="color:#94a3b8;">${esc(t.issued)}:</span> <strong>${esc(issued)}</strong></td>
          </tr>
        </table>
        <div style="margin-top:8px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;color:#1e3a5f;font-size:12px;">${esc(t.dueNote)}</div>
      </td></tr>

      <tr><td style="padding:14px 32px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
          <tr>
            <td valign="top" style="width:50%;padding-right:10px;">
              <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${esc(t.seller)}</div>
              <div style="font-weight:700;">${esc(s.name)}</div>
              <div>${esc(s.address)}</div>
              <div>${esc(t.nip)}: ${esc(s.nip)}</div>
            </td>
            <td valign="top" style="width:50%;padding-left:10px;">
              <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${esc(t.buyer)}</div>
              <div style="font-weight:700;">${esc(p.company?.name || "—")}</div>
              <div>${esc(p.company?.address || "")}</div>
              <div>${esc(t.nip)}: ${esc(p.company?.nip || "—")}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:14px 32px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;text-transform:uppercase;">${esc(t.item)}</th>
              <th align="center" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;text-transform:uppercase;">${esc(t.qty)}</th>
              <th align="right" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;text-transform:uppercase;">${esc(t.net)}</th>
              <th align="right" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;text-transform:uppercase;">${esc(t.gross)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:10px;border-bottom:1px solid #f1f5f9;">${itemName}</td>
              <td align="center" style="padding:10px;border-bottom:1px solid #f1f5f9;">${esc(p.qty)}</td>
              <td align="right" style="padding:10px;border-bottom:1px solid #f1f5f9;">${money(p.net, locale)} ${cur}</td>
              <td align="right" style="padding:10px;border-bottom:1px solid #f1f5f9;">${money(p.gross, locale)} ${cur}</td>
            </tr>
          </tbody>
        </table>
      </td></tr>

      <tr><td style="padding:6px 32px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
          <tr><td align="right" style="padding:2px 0;color:#64748b;">${esc(t.sumNet)}:</td><td align="right" style="width:140px;padding:2px 0;">${money(p.net, locale)} ${cur}</td></tr>
          <tr><td align="right" style="padding:2px 0;color:#64748b;">${esc(t.sumVat)}:</td><td align="right" style="padding:2px 0;">${money(p.vat, locale)} ${cur}</td></tr>
          <tr><td align="right" style="padding:8px 0 2px;font-weight:800;font-size:15px;">${esc(t.sumGross)}:</td><td align="right" style="padding:8px 0 2px;font-weight:800;font-size:15px;color:#0d9488;">${money(p.gross, locale)} ${cur}</td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:10px 32px 18px;">
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 14px;font-size:13px;color:#0369a1;">
          <div style="font-weight:700;margin-bottom:6px;">${esc(t.payTitle)}</div>
          <div>${esc(t.beneficiary)}: <strong>${esc(b.beneficiary)}</strong></div>
          <div>${esc(t.bankName)}: ${esc(b.bankName)}</div>
          <div>${esc(t.iban)}: <span style="font-family:monospace;">${esc(b.iban)}</span></div>
          <div>${esc(t.payTitleLabel)}: <strong>${esc(transferTitle)}</strong></div>
        </div>
        <div style="margin-top:12px;font-size:11px;color:#94a3b8;line-height:1.6;">${esc(t.disclaimer)}</div>
      </td></tr>

      <tr><td style="background:#0f172a;padding:16px 28px;text-align:center;">
        <div style="color:rgba(255,255,255,0.92);font-weight:700;font-size:13px;margin-bottom:4px;">Fresh Market PreConnect</div>
        <div style="color:rgba(255,255,255,0.45);font-size:11px;">${esc(s.name)} · ${esc(s.address)}</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, html, emailIntro: t.emailIntro };
}
