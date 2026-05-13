/**
 * Renderer HTML maila zbiorczego dla pojedynczej sieci handlowej.
 * [B2B Round pipeline-retailer-email-mvp]
 *
 * Wejście:
 *   {
 *     retailer:  { id, name, country, color, bg, logo_url },
 *     sends:     [{ legacy_id, pos, sendDate, data:{ supplierId, ... } }, ...],
 *     offers:    Map<offer_legacy_id, offerData>     // offerData = legacy_offers.data
 *     companies: Map<legacy_supplier_id|uuid, co>    // company row
 *     buyerCount: number
 *     month:     string (np. "Maj 2026")
 *     appUrl:    string (B2B_APP_URL)
 *   }
 *
 * Wyjście: { html, subject }
 *
 * Email jest tabelarycznie pisany — szablon zgodny z większością klientów
 * pocztowych (Outlook, Gmail, Mail.app). Brak <style>, brak flexboxa
 * w głównym układzie, krytyczne elementy w tabelach.
 */

const FLAG = {
  AT:"\u{1F1E6}\u{1F1F9}", BE:"\u{1F1E7}\u{1F1EA}", BG:"\u{1F1E7}\u{1F1EC}", BR:"\u{1F1E7}\u{1F1F7}",
  CL:"\u{1F1E8}\u{1F1F1}", CO:"\u{1F1E8}\u{1F1F4}", CR:"\u{1F1E8}\u{1F1F7}", HR:"\u{1F1ED}\u{1F1F7}",
  CY:"\u{1F1E8}\u{1F1FE}", CZ:"\u{1F1E8}\u{1F1FF}", DE:"\u{1F1E9}\u{1F1EA}", DK:"\u{1F1E9}\u{1F1F0}",
  EC:"\u{1F1EA}\u{1F1E8}", EG:"\u{1F1EA}\u{1F1EC}", EE:"\u{1F1EA}\u{1F1EA}", FI:"\u{1F1EB}\u{1F1EE}",
  FR:"\u{1F1EB}\u{1F1F7}", GR:"\u{1F1EC}\u{1F1F7}", ES:"\u{1F1EA}\u{1F1F8}", NL:"\u{1F1F3}\u{1F1F1}",
  IE:"\u{1F1EE}\u{1F1EA}", IT:"\u{1F1EE}\u{1F1F9}", KE:"\u{1F1F0}\u{1F1EA}", LV:"\u{1F1F1}\u{1F1FB}",
  LT:"\u{1F1F1}\u{1F1F9}", LU:"\u{1F1F1}\u{1F1FA}", MD:"\u{1F1F2}\u{1F1E9}", MT:"\u{1F1F2}\u{1F1F9}",
  MA:"\u{1F1F2}\u{1F1E6}", PE:"\u{1F1F5}\u{1F1EA}", PL:"\u{1F1F5}\u{1F1F1}", PT:"\u{1F1F5}\u{1F1F9}",
  RO:"\u{1F1F7}\u{1F1F4}", SK:"\u{1F1F8}\u{1F1F0}", SI:"\u{1F1F8}\u{1F1EE}", ZA:"\u{1F1FF}\u{1F1E6}",
  SE:"\u{1F1F8}\u{1F1EA}", TR:"\u{1F1F9}\u{1F1F7}", UA:"\u{1F1FA}\u{1F1E6}", HU:"\u{1F1ED}\u{1F1FA}",
};
const CNAME = {
  AT:"Austria", BE:"Belgia", BG:"Bułgaria", BR:"Brazylia", CL:"Chile", CO:"Kolumbia", CR:"Kostaryka",
  HR:"Chorwacja", CY:"Cypr", CZ:"Czechy", DE:"Niemcy", DK:"Dania", EC:"Ekwador", EG:"Egipt",
  EE:"Estonia", FI:"Finlandia", FR:"Francja", GR:"Grecja", ES:"Hiszpania", NL:"Holandia",
  IE:"Irlandia", IT:"Włochy", KE:"Kenia", LV:"Łotwa", LT:"Litwa", LU:"Luksemburg", MD:"Mołdawia",
  MT:"Malta", MA:"Maroko", PE:"Peru", PL:"Polska", PT:"Portugalia", RO:"Rumunia", SK:"Słowacja",
  SI:"Słowenia", ZA:"RPA", SE:"Szwecja", TR:"Turcja", UA:"Ukraina", HU:"Węgry",
};

export function buildSubject({ retailer, offerCount }) {
  const safeName = retailer?.name || "sieci";
  return `Fresh Market PreConnect – ${offerCount} ${pluralOferta(offerCount)} dla ${safeName}`;
}

function pluralOferta(n) {
  if (n === 1) return "oferta";
  if (n >= 2 && n <= 4) return "oferty";
  return "ofert";
}

function pluralKupiec(n) {
  if (n === 1) return "kupca";
  return "kupców";
}

export function renderRetailerEmail({ retailer, sends, offers, companies, buyerCount, month, appUrl }) {
  const sortedSends = [...sends].sort((a, b) => {
    const ap = (a.data && a.data.pos) || a.pos || 99;
    const bp = (b.data && b.data.pos) || b.pos || 99;
    return ap - bp;
  });

  const offerCount = sortedSends.length;
  const subject = buildSubject({ retailer, offerCount });

  const offerBlocks = sortedSends.map((s) => renderOfferBlock(s, offers, companies, appUrl)).join("");

  const introCount = `${offerCount} ${pluralOferta(offerCount)}`;
  const buyerLine = `Trafia do ${buyerCount} ${pluralKupiec(buyerCount)} z sieci ${esc(retailer?.name || "")}`;

  return {
    subject,
    html: `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ececec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececec;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.08);">
      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0d9488 100%);padding:28px 32px;text-align:center;">
        <div style="color:white;font-weight:800;font-size:22px;letter-spacing:-0.5px;margin-bottom:6px;">Fresh Market <span style="color:rgba(255,255,255,0.5);font-weight:600;font-size:13px;">PreConnect</span></div>
        <div style="color:rgba(255,255,255,0.95);font-size:20px;font-weight:700;margin-bottom:4px;">Propozycje ${esc(month)}</div>
        <div style="color:rgba(255,255,255,0.55);font-size:13px;">Mailing dla <strong style="color:rgba(255,255,255,0.9);">${esc(retailer?.name || "")}</strong></div>
      </td></tr>
      <!-- Intro -->
      <tr><td style="padding:22px 32px 8px;border-left:4px solid #0d9488;border-right:4px solid #0d9488;">
        <p style="margin:0 0 10px;color:#334155;line-height:1.6;font-size:14px;">Szanowni Państwo,</p>
        <p style="margin:0 0 10px;color:#334155;line-height:1.65;font-size:14px;">przesyłamy zestaw <strong>${introCount}</strong> wyselekcjonowanych dla <strong>${esc(retailer?.name || "")}</strong> przez zespół Fresh Market. Szczegóły każdej propozycji znajdziesz po wejściu na platformę.</p>
        <p style="margin:0;font-size:12px;color:#94a3b8;">${buyerLine}.</p>
      </td></tr>
      <!-- Offers -->
      ${offerBlocks}
      <!-- Footer -->
      <tr><td style="background:#0f172a;padding:22px 28px;text-align:center;">
        <div style="color:rgba(255,255,255,0.92);font-weight:700;font-size:14px;margin-bottom:6px;">Fresh Market PreConnect</div>
        <div style="color:rgba(255,255,255,0.45);font-size:11px;line-height:1.8;">
          KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Polska<br>
          <a href="${esc(appUrl)}" style="color:rgba(255,255,255,0.7);text-decoration:none;">freshmarket.eu</a> ·
          <a href="mailto:newsletter@freshmarket.eu" style="color:rgba(255,255,255,0.7);text-decoration:none;">newsletter@freshmarket.eu</a> ·
          +48 603 424 346
        </div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);font-size:10px;color:rgba(255,255,255,0.35);line-height:1.6;">
          Otrzymałeś tę wiadomość, ponieważ jesteś zarejestrowany w programie Fresh Market PreConnect jako kupiec sieci ${esc(retailer?.name || "")}.<br>
          © ${new Date().getFullYear()} KJOW Sp. z o.o. Wszelkie prawa zastrzeżone.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  };
}

function renderOfferBlock(send, offersMap, companiesMap, appUrl) {
  const data = send.data || {};
  const offerId = data.offerId || send.offer_legacy_id;
  const offer = offerId != null ? (offersMap.get(offerId) || offersMap.get(String(offerId))) : null;
  if (!offer) return "";

  const supplierKey = data.supplierId || offer.supplierId;
  const company = supplierKey ? companiesMap.get(supplierKey) : null;
  const isPrem = (offer.tier || "") === "premium";

  const photo = Array.isArray(offer.photos) && offer.photos[0]
    ? (typeof offer.photos[0] === "string" ? offer.photos[0] : offer.photos[0].url)
    : null;

  const certs = [...(offer.certs || []), offer.customCert].filter(Boolean);
  const packaging = [...(offer.packaging || []), offer.customPackaging].filter(Boolean);

  const originLabel = offer.origin
    ? `${FLAG[offer.origin] || "\u{1F310}"} ${esc(CNAME[offer.origin] || offer.origin)}`
    : "";

  const cta = offer.cta || "";
  const ctaLabel = cta.includes("samples") ? "Poproś o próbki"
                 : cta.includes("rfq")     ? "Zapytaj o cenę i wolumen"
                 : cta.includes("meet_fm") ? "Umów spotkanie"
                 : "Zobacz ofertę";
  // [B2B Round prod-rollout / email-open-tracking] Deep-link do panelu kupca,
  // z konkretnym send_id w query — PreconnectFM przy boot otwiera detal oferty.
  // Wcześniej link wskazywał /admin/oferty/{offerId} — kupiec nie ma roli admin
  // i lądował na "Konto bez roli" zamiast w aplikacji.
  const sendIdForLink = send.legacy_id || data.id || "";
  const ctaUrl = sendIdForLink
    ? `${appUrl}/kupiec?send=${esc(sendIdForLink)}`
    : `${appUrl}/kupiec`;

  const companyName = company?.name || "Dostawca Fresh Market";
  const companyLogo = company?.logo_url || company?.logo || null;
  const companyDescShort = (company?.description_short || "").trim();

  return `
<tr><td style="padding:0 0 0 0;border-left:4px solid ${isPrem ? "#fbbf24" : "#e2e8f0"};border-right:4px solid ${isPrem ? "#fbbf24" : "#e2e8f0"};border-bottom:1px solid #f1f5f9;background:white;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:white;">
    <tr><td style="padding:18px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td valign="top" style="width:56px;padding-right:14px;">
            ${companyLogo
              ? `<img src="${esc(companyLogo)}" alt="${esc(companyName)}" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;background:white;">`
              : `<div style="width:48px;height:48px;border-radius:8px;background:#f1f5f9;color:#64748b;text-align:center;line-height:48px;font-weight:700;font-size:16px;">${esc(initials(companyName))}</div>`
            }
          </td>
          <td valign="top">
            <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">${esc(companyName)}${isPrem ? `<span style="background:#d97706;color:white;font-size:10px;padding:2px 8px;border-radius:20px;margin-left:8px;text-transform:none;letter-spacing:0;">PREMIUM</span>` : ""}</div>
            <div style="font-weight:700;font-size:16px;color:#0f172a;line-height:1.3;margin-bottom:4px;">${esc(offer.title || offer.product || "")}</div>
            <div style="font-size:12px;color:#64748b;">${originLabel}${offer.volume ? ` · ${esc(offer.volume)} ${esc(offer.volumeUnit || "")}` : ""}${packaging[0] ? ` · ${esc(packaging[0])}` : ""}</div>
          </td>
        </tr>
      </table>
      ${photo ? `<div style="margin-top:12px;"><img src="${esc(photo)}" alt="" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px;border:1px solid #f1f5f9;"></div>` : ""}
      ${offer.description ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#475569;background:${isPrem ? "#fffbeb" : "#f8fafc"};padding:10px 14px;border-radius:7px;border-left:3px solid ${isPrem ? "#fbbf24" : "#e2e8f0"};">${esc(truncate(offer.description, 280))}</p>` : ""}
      ${(certs.length > 0 || companyDescShort) ? `
        <div style="margin-top:10px;font-size:11px;color:#64748b;">
          ${certs.length > 0 ? certs.slice(0, 5).map(c => `<span style="background:#d1fae5;color:#047857;font-weight:600;padding:2px 8px;border-radius:20px;border:1px solid #6ee7b7;margin-right:4px;">✓ ${esc(c)}</span>`).join("") : ""}
        </div>` : ""}
      <div style="margin-top:14px;text-align:right;">
        <a href="${esc(ctaUrl)}" style="display:inline-block;background:${isPrem ? "#d97706" : "#0d9488"};color:white;padding:9px 20px;border-radius:7px;font-weight:700;font-size:12px;text-decoration:none;">${esc(ctaLabel)}</a>
      </div>
    </td></tr>
  </table>
</td></tr>`;
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "•";
}

function truncate(s, max) {
  const text = String(s || "").trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
