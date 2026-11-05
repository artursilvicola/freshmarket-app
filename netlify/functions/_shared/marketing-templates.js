/**
 * [feat/marketing-activation] Szablony kampanii aktywizacyjnej PreConnect (PL/EN) — po grupie odbiorców.
 *
 * Główna wartość komunikatu (Artur 5.11): daj się poznać sieciom handlowym, przedstaw kupcom
 * swoje produkty i możliwości firmy — PreConnect pomaga zrobić pierwszy krok do współpracy.
 * Kredyty wspierają ten przekaz, nie zastępują go. Treść nie obiecuje odczytu, odpowiedzi ani
 * umowy, nie twierdzi, że „kupcy właśnie szukają”, ani że sieć jest „nowa dla tej firmy”.
 *
 * Każda grupa ma DOMYŚLNĄ treść PL i EN (temat, treść, etykieta przycisku). Administrator może
 * ją edytować w panelu BEZ HTML: zwykły tekst, akapity rozdzielone pustą linią, `**pogrubienie**`,
 * symbole {{company}}, {{credits}} (WOLNE = ważne − rezerwacje), {{credits_n}}, {{valid_credits}} (wszystkie ważne),
 * {{expiry}}, {{expiring_credits}}, {{reserved_n}}, {{mailing_date}}, {{snapshot_date}}. Wszystko jest ESCAPOWANE — `<`/`>` są odrzucane przy walidacji.
 * Stałe elementy (nagłówek, stopka, adres, link wypisu, reply-to) są poza edycją.
 *
 * Każdy render zwraca { subject, html, text, meta } — wersja tekstowa jest pełna.
 * Liczby i daty pochodzą z danych odczytanych tuż przed zatwierdzeniem (snapshot) — nigdy na sztywno.
 */
import { formatLongDate, nextBuyerMailingDate, parseISODate } from "./marketing-dates.js";

export const AUDIENCE_TEMPLATE_KEYS = Object.freeze(["credits_no_proposal", "credits_proposal_ready", "used_before_free_credits", "credits_expiring", "no_valid_credits", "selected_companies"]);
/** Stare klucze zostają, żeby dało się renderować/pokazać wcześniejsze kampanie testowe. */
export const LEGACY_TEMPLATE_KEYS = Object.freeze(["start_with_credits", "return_active"]);
export const TEMPLATE_KEYS = Object.freeze([...AUDIENCE_TEMPLATE_KEYS, ...LEGACY_TEMPLATE_KEYS]);
export const PLACEHOLDERS = Object.freeze(["company", "credits", "credits_n", "valid_credits", "expiry", "expiring_credits", "reserved_n", "mailing_date", "snapshot_date"]);
export const LIMITS = Object.freeze({ subject: 200, body: 4000, cta: 60 });

export function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pickLocale(input) {
  const raw = String(input || "").trim().toLowerCase().split(/[-_]/)[0];
  return raw === "en" ? "en" : "pl";
}

export function creditsWord(n, locale) {
  if (locale === "en") return n === 1 ? "credit" : "credits";
  const t = n % 10, h = n % 100;
  if (n === 1) return "kredyt";
  if (t >= 2 && t <= 4 && !(h >= 12 && h <= 14)) return "kredyty";
  return "kredytów";
}

const CORE_PL = "PreConnect pomaga zrobić pierwszy krok do współpracy z sieciami handlowymi: przedstawiasz kupcom swoje produkty i możliwości firmy, a my dostarczamy propozycję do wybranych sieci w najbliższym mailingu. Nawiązanie współpracy zwykle wymaga kilku prezentacji, rozmów i próbek — PreConnect pomaga się zaprezentować, nie zastępuje tych etapów.";
const RULES_PL = "Jedna propozycja do jednej sieci to jeden kredyt. Kredyt rozliczamy dopiero po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca. Kredyty przypisane do propozycji, które czekają na odczyt, pozostają zarezerwowane do rozliczenia.";
const MAILING_PL = "Najbliższy mailing do kupców: **{{mailing_date}}**. Propozycje kwalifikujemy do wysyłki zgodnie z ich aktualnym statusem.";
const HELP_PL = "Jeżeli chcesz pomocy w opisaniu asortymentu albo wyborze sieci, odpowiedz na tę wiadomość.";
const CORE_EN = "PreConnect helps you take the first step towards working with retail chains: you present your products and your company's capabilities to buyers, and we deliver the proposal to the selected chains in the next mailing. Starting a cooperation usually takes several presentations, conversations and samples — PreConnect helps you introduce yourself, it does not replace those steps.";
const RULES_EN = "One proposal to one retail chain uses one credit. A credit is settled only after a registered read: the buyer opening the e-mail or viewing the proposal on the list in their panel. Credits assigned to proposals that are still waiting to be read stay reserved until settlement.";
const MAILING_EN = "Next buyer mailing: **{{mailing_date}}**. Proposals qualify for the mailing according to their current status.";
const HELP_EN = "If you would like help describing your range or choosing chains, reply to this e-mail.";

export const DEFAULT_CONTENT = Object.freeze({
  selected_companies: {
    pl: { subject: "PreConnect: przedstaw swoją firmę sieciom handlowym", cta: "Przejdź do PreConnect",
      body: `Dzień dobry, {{company}},\n\n${CORE_PL}\n\nSprawdź swoje konto, przygotuj propozycję i wybierz sieci, którym chcesz się zaprezentować.\n\nPrzed zgłoszeniem propozycji sprawdź dostępne kredyty w panelu. Jeśli nie masz wolnych, ważnych kredytów, możesz wybrać odpowiedni pakiet. ${RULES_PL}\n\n${MAILING_PL}\n\n${HELP_PL}` },
    en: { subject: "PreConnect: introduce your company to retail chains", cta: "Go to PreConnect",
      body: `Hello, {{company}},\n\n${CORE_EN}\n\nCheck your account, prepare a proposal and choose the chains you want to introduce yourself to.\n\nBefore submitting a proposal, check your available credits in the panel. If you have no free, valid credits, you can choose a suitable package. ${RULES_EN}\n\n${MAILING_EN}\n\n${HELP_EN}` },
  },
  credits_no_proposal: {
    pl: { subject: "Daj się poznać sieciom handlowym — masz {{credits}} w PreConnect", cta: "Przygotuj propozycję",
      body: `Dzień dobry, {{company}},\n\n${CORE_PL}\n\nW Twoim koncie Fresh Market B2B dostępne są **{{credits}}** (stan na {{snapshot_date}}). ${RULES_PL}\n\n${MAILING_PL}\n\nJeżeli nie wiesz, jak przygotować pierwszą propozycję lub do kogo ją skierować, odpowiedz na tę wiadomość. Pomożemy Ci zacząć.` },
    en: { subject: "Introduce your company to retail chains — you have {{credits}} in PreConnect", cta: "Prepare a proposal",
      body: `Hello, {{company}},\n\n${CORE_EN}\n\nYour Fresh Market B2B account has **{{credits}}** available (as of {{snapshot_date}}). ${RULES_EN}\n\n${MAILING_EN}\n\nIf you are not sure how to prepare your first proposal or which chains to address, reply to this e-mail. We will help you start.` },
  },
  credits_proposal_ready: {
    pl: { subject: "Twoja propozycja czeka na sieci — wybierz odbiorców w PreConnect", cta: "Wybierz sieci",
      body: `Dzień dobry, {{company}},\n\nMasz w PreConnect przygotowaną propozycję asortymentową, która nie została jeszcze skierowana do żadnej sieci. ${CORE_PL}\n\nWybierz sieci, do których chcesz ją skierować. W Twoim koncie dostępne są **{{credits}}** (stan na {{snapshot_date}}). ${RULES_PL}\n\n${MAILING_PL}\n\n${HELP_PL}` },
    en: { subject: "Your proposal is waiting for retail chains — choose recipients in PreConnect", cta: "Choose chains",
      body: `Hello, {{company}},\n\nYou have a product proposal prepared in PreConnect that has not been addressed to any retail chain yet. ${CORE_EN}\n\nChoose the chains you want to address. Your account has **{{credits}}** available (as of {{snapshot_date}}). ${RULES_EN}\n\n${MAILING_EN}\n\n${HELP_EN}` },
  },
  used_before_free_credits: {
    pl: { subject: "Kolejna propozycja w PreConnect — masz jeszcze {{credits}}", cta: "Przygotuj propozycję",
      body: `Dzień dobry, {{company}},\n\nKorzystałeś już z PreConnect. Jeżeli masz nowy produkt, aktualny program dostaw albo chcesz przedstawić się innym sieciom, przygotuj kolejną propozycję. ${CORE_PL}\n\nW Twoim koncie dostępne są **{{credits}}** (stan na {{snapshot_date}}). ${RULES_PL} W panelu sprawdzisz stan dotychczasowych wysyłek.\n\n${MAILING_PL}\n\n${HELP_PL}` },
    en: { subject: "Another proposal in PreConnect — you still have {{credits}}", cta: "Prepare a proposal",
      body: `Hello, {{company}},\n\nYou have used PreConnect before. If you have a new product, an up-to-date supply programme or want to introduce yourself to other chains, prepare another proposal. ${CORE_EN}\n\nYour account has **{{credits}}** available (as of {{snapshot_date}}). ${RULES_EN} In the panel you can check the state of your previous sendings.\n\n${MAILING_EN}\n\n${HELP_EN}` },
  },
  credits_expiring: {
    pl: { subject: "Twoje kredyty PreConnect wygasają {{expiry}}", cta: "Przygotuj propozycję",
      body: `Dzień dobry, {{company}},\n\nW Twoim koncie Fresh Market B2B **{{expiring_credits}}** PreConnect ma termin ważności do **{{expiry}}** (łącznie dostępne: {{credits}}, stan na {{snapshot_date}}). Po tym terminie niewykorzystane kredyty z tej puli przepadają.\n\n${CORE_PL}\n\n${RULES_PL}\n\n${MAILING_PL} Przygotuj propozycję wcześniej, żeby zdążyć przed terminem ważności.\n\n${HELP_PL}` },
    en: { subject: "Your PreConnect credits expire on {{expiry}}", cta: "Prepare a proposal",
      body: `Hello, {{company}},\n\nIn your Fresh Market B2B account **{{expiring_credits}}** in PreConnect are valid until **{{expiry}}** (available in total: {{credits}}, as of {{snapshot_date}}). After that date the unused credits from this pool are lost.\n\n${CORE_EN}\n\n${RULES_EN}\n\n${MAILING_EN} Prepare your proposal earlier to make it before the expiry date.\n\n${HELP_EN}` },
  },
  no_valid_credits: {
    pl: { subject: "PreConnect: pakiet kredytów na propozycje do sieci handlowych", cta: "Sprawdź pakiety",
      body: `Dzień dobry, {{company}},\n\nObecnie w Twoim koncie Fresh Market B2B nie ma ważnych kredytów PreConnect (stan na {{snapshot_date}}). ${CORE_PL}\n\nJeżeli chcesz przedstawić swoje produkty kupcom sieci handlowych, możesz kupić pakiet kredytów w panelu. ${RULES_PL}\n\n${MAILING_PL}\n\n${HELP_PL}` },
    en: { subject: "PreConnect: a credit package for proposals to retail chains", cta: "See packages",
      body: `Hello, {{company}},\n\nYour Fresh Market B2B account currently has no valid PreConnect credits (as of {{snapshot_date}}). ${CORE_EN}\n\nIf you want to present your products to retail chain buyers, you can buy a credit package in the panel. ${RULES_EN}\n\n${MAILING_EN}\n\n${HELP_EN}` },
  },
  // stare szablony (kampanie sprzed 5.11) — treść jak dotąd, w nowej strukturze
  start_with_credits: {
    pl: { subject: "Masz {{credits}} PreConnect — najbliższy mailing do kupców {{mailing_date}}", cta: "Przejdź do panelu",
      body: `Dzień dobry, {{company}},\n\nW Twoim koncie Fresh Market B2B dostępne są **{{credits}}** PreConnect (stan na {{snapshot_date}}), najbliższy termin ważności: **{{expiry}}**. Jedna propozycja asortymentowa do jednej sieci = jeden kredyt. Kredyt rozliczamy po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca.\n\nPrzygotuj propozycję przed najbliższym mailingiem do kupców **{{mailing_date}}**. Do wysyłki kwalifikujemy propozycje zgodnie z ich aktualnym statusem.\n\nJeżeli nie wiesz, jak przygotować propozycję lub do kogo ją skierować, odpowiedz na tę wiadomość. Pomożemy Ci zacząć.` },
    en: { subject: "You have {{credits}} in PreConnect — next buyer mailing on {{mailing_date}}", cta: "Open the panel",
      body: `Hello, {{company}},\n\nYour Fresh Market B2B account has **{{credits}}** available in PreConnect (as of {{snapshot_date}}), the nearest expiry date is **{{expiry}}**. One product proposal to one retail chain uses one credit. The credit is settled after a registered read: the buyer opening the e-mail or viewing the proposal on the list in their panel.\n\nPrepare your proposal before the next buyer mailing on **{{mailing_date}}**. Proposals qualify for the mailing according to their current status.\n\nIf you are not sure how to prepare a proposal or which chain to address, reply to this e-mail. We will help you start.` },
  },
  return_active: {
    pl: { subject: "Mailing do kupców {{mailing_date}} — dodasz nową propozycję w PreConnect?", cta: "Przejdź do PreConnect",
      body: `Dzień dobry, {{company}},\n\nJeżeli masz nowy produkt lub aktualny program dostaw, możesz przygotować kolejną propozycję w PreConnect. W Twoim koncie dostępne są **{{credits}}** (stan na {{snapshot_date}}), najbliższy termin ważności: **{{expiry}}**. Kredyt rozliczamy po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca.\n\nPrzygotuj propozycję przed najbliższym mailingiem do kupców **{{mailing_date}}**. Do wysyłki kwalifikujemy propozycje zgodnie z ich aktualnym statusem. W panelu sprawdzisz stan dotychczasowych wysyłek.\n\nJeżeli chcesz pomocy w wyborze sieci albo opisaniu asortymentu, odpowiedz na tę wiadomość.` },
    en: { subject: "Buyer mailing on {{mailing_date}} — add a new proposal in PreConnect?", cta: "Go to PreConnect",
      body: `Hello, {{company}},\n\nIf you have a new product or an up-to-date supply programme, you can prepare another proposal in PreConnect. Your account has **{{credits}}** available (as of {{snapshot_date}}), nearest expiry **{{expiry}}**. A credit is settled after a registered read: the buyer opening the e-mail or viewing the proposal on the list in their panel.\n\nPrepare your proposal before the next buyer mailing on **{{mailing_date}}**. Proposals qualify for the mailing according to their current status. In the panel you can check the state of your previous sendings.\n\nIf you would like help choosing a chain or describing your range, reply to this e-mail.` },
  },
});

/** Domyślna treść PL+EN dla szablonu (kopia). */
export function defaultContent(templateKey) {
  const d = DEFAULT_CONTENT[templateKey];
  if (!d) throw new Error("unknown_template:" + String(templateKey));
  return { pl: { ...d.pl }, en: { ...d.en } };
}

/**
 * Walidacja treści z panelu: { pl: {subject, body, cta}, en: {...} }. Zwraca listę błędów (pusta = OK).
 * Bez HTML (`<`/`>` odrzucane), limity długości, tylko znane symbole {{...}}.
 */
export function validateContent(content) {
  const errors = [];
  if (!content || typeof content !== "object") return ["content_required"];
  for (const locale of ["pl", "en"]) {
    const c = content[locale];
    if (!c || typeof c !== "object") { errors.push(`${locale}.missing`); continue; }
    for (const field of ["subject", "body", "cta"]) {
      const v = String(c[field] ?? "");
      if (!v.trim()) errors.push(`${locale}.${field}.empty`);
      if (v.length > LIMITS[field]) errors.push(`${locale}.${field}.too_long`);
      if (/[<>]/.test(v)) errors.push(`${locale}.${field}.html_not_allowed`);
      if (field !== "body" && /\n/.test(v)) errors.push(`${locale}.${field}.multiline`);
      for (const m of v.matchAll(/\{\{\s*([a-z_]*)\s*\}\}/g)) if (!PLACEHOLDERS.includes(m[1])) errors.push(`${locale}.${field}.unknown_placeholder:${m[1] || "?"}`);
      if (/\{\{(?![^{}]*\}\})/.test(v.replace(/\{\{\s*[a-z_]+\s*\}\}/g, ""))) errors.push(`${locale}.${field}.unclosed_placeholder`);
    }
  }
  return errors;
}

/** Treść do renderu: zapisana w kampanii (jeśli poprawna) albo domyślna dla szablonu. */
export function effectiveContent(templateKey, saved) {
  const base = defaultContent(templateKey);
  if (saved && typeof saved === "object" && validateContent(saved).length === 0) return { pl: { ...base.pl, ...saved.pl }, en: { ...base.en, ...saved.en } };
  return base;
}

function fill(template, vars) {
  return String(template || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ""));
}
/** Escapuje tekst i zamienia **x** na <strong>, pojedyncze nowe linie na <br>. */
function inlineHtml(s) {
  return esc(s).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}
const stripBold = (s) => String(s).replace(/\*\*([^*\n]+)\*\*/g, "$1");

export const EMAIL_LOGO_PATH = "/brand/fm-email-logo-white.png"; // biały logotyp (public/brand), serwowany z aplikacji
export const TAGLINE = Object.freeze({
  pl: "Łączymy dostawców owoców, warzyw i kwiatów z kupcami sieci handlowych.",
  en: "We connect fruit, vegetable and flower suppliers with retail chain buyers.",
});
/** Adres logo do maila: statyczny biały PNG z aplikacji (po deployu b2b.freshmarket.eu/brand/…). */
export function emailLogoUrl(appUrl) {
  return String(appUrl || "https://b2b.freshmarket.eu").replace(/\/$/, "") + EMAIL_LOGO_PATH;
}

/**
 * Czapka (Artur 05.11): dyskretne białe logo na ciemnym tle, bez białego pola; obok „PreConnect” i hasło,
 * żeby adresat od razu wiedział, od kogo i o czym jest mail. Tabele zamiast flex — zgodność z klientami poczty.
 */
function header({ logoUrl, locale }) {
  const tagline = TAGLINE[locale] || TAGLINE.pl;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="width:150px;padding-right:18px;"><img src="${esc(logoUrl)}" alt="Fresh Market" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;"></td>
          <td valign="middle" style="border-left:1px solid rgba(255,255,255,0.28);padding-left:18px;">
            <div style="color:#ffffff;font-weight:800;font-size:17px;letter-spacing:0.3px;line-height:1.2;">PreConnect</div>
            <div style="color:rgba(255,255,255,0.80);font-size:12.5px;line-height:1.45;margin-top:4px;">${esc(tagline)}</div>
          </td>
        </tr></table>`;
}
function footerBrand({ logoUrl }) {
  return `<img src="${esc(logoUrl)}" alt="Fresh Market" width="104" style="display:inline-block;width:104px;max-width:104px;height:auto;border:0;outline:none;text-decoration:none;opacity:0.9;margin-bottom:6px;">`;
}

function shell({ title, body, locale, unsubscribeUrl, replyTo, appUrl, logoUrl }) {
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
      <tr><td style="background:#0f172a;background-image:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0d9488 100%);padding:22px 32px;">
        ${header({ logoUrl, locale })}
      </td></tr>
      <tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;">${body}</td></tr>
      <tr><td style="background:#0f172a;padding:18px 28px;text-align:center;">
        ${footerBrand({ logoUrl })}
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
 * @param {string} d.templateKey   grupa/szablon (TEMPLATE_KEYS)
 * @param {object} [d.content]     treść z kampanii { pl: {subject, body, cta}, en: {...} } (domyślna, gdy brak/niepoprawna)
 * @param {string} d.locale        pl | en
 * @param {string} d.companyName
 * @param {number} d.creditsRemaining  wszystkie ważne kredyty w chwili odczytu ({{valid_credits}})
 * @param {number} [d.creditsAvailable] WOLNE kredyty = ważne − rezerwacje ({{credits}}, {{credits_n}}); domyślnie = creditsRemaining
 * @param {number} [d.creditsReserved] rezerwacje ({{reserved_n}})
 * @param {number} [d.expiringCredits] kredyty z najbliższym terminem ({{expiring_credits}}; domyślnie = creditsRemaining)
 * @param {string|null} d.creditsExpiry 'YYYY-MM-DD' najbliższy termin ważności (null = „—”)
 * @param {string} d.snapshotAt    ISO chwila odczytu danych
 * @param {Date}   [d.now]         do wyliczenia najbliższego mailingu (test)
 * @param {string} d.appUrl
 * @param {string} d.unsubscribeUrl
 * @param {string} [d.replyTo]
 * @param {string} [d.logoUrl]  adres białego logo (domyślnie emailLogoUrl(appUrl) → /brand/fm-email-logo-white.png)
 */
export function renderMarketingTemplate(d) {
  const key = TEMPLATE_KEYS.includes(d?.templateKey) ? d.templateKey : null;
  if (!key) throw new Error("unknown_template:" + String(d?.templateKey));
  const locale = pickLocale(d.locale);
  if (!d.unsubscribeUrl) throw new Error("unsubscribe_url_required");
  const n = Math.max(0, Number(d.creditsRemaining) || 0);
  const reserved = Math.max(0, Number(d.creditsReserved) || 0);
  const avail = d.creditsAvailable == null ? n : Math.max(0, Number(d.creditsAvailable) || 0);
  const expiringN = d.expiringCredits == null ? n : Math.max(0, Number(d.expiringCredits) || 0);
  const mailing = nextBuyerMailingDate(d.now || new Date());
  const mailingLabel = formatLongDate(mailing, locale);
  const expiry = parseISODate(d.creditsExpiry);
  const expiryLabel = expiry ? formatLongDate(expiry, locale) : "—";
  const snapshot = d.snapshotAt ? new Date(d.snapshotAt) : new Date();
  const snapshotLabel = formatLongDate(snapshot, locale);
  const company = String(d.companyName || "").trim();
  const appUrl = d.appUrl || "https://b2b.freshmarket.eu";
  const content = effectiveContent(key, d.content)[locale];
  const vars = {
    company, credits: `${avail} ${creditsWord(avail, locale)}`, credits_n: String(avail), valid_credits: `${n} ${creditsWord(n, locale)}`,
    expiry: expiryLabel, expiring_credits: `${expiringN} ${creditsWord(expiringN, locale)}`, reserved_n: String(reserved),
    mailing_date: mailingLabel, snapshot_date: snapshotLabel,
  };
  const subject = stripBold(fill(content.subject, vars)).replace(/\s+/g, " ").trim();
  const ctaLabel = stripBold(fill(content.cta, vars)).trim();
  const paras = fill(content.body, vars).split(/\n[ \t]*\n/).map((s) => s.trim()).filter(Boolean);
  const body = paras.map((t) => p(inlineHtml(t))).join("") + cta(ctaLabel, appUrl);
  const html = shell({ title: subject, body, locale, unsubscribeUrl: d.unsubscribeUrl, replyTo: d.replyTo, appUrl, logoUrl: d.logoUrl || emailLogoUrl(appUrl) });
  const text = [
    ...paras.map(stripBold), "", `${ctaLabel}: ${appUrl}`, "",
    d.replyTo ? (locale === "en" ? `Reply to this e-mail or write to ${d.replyTo}.` : `Odpowiedz na tę wiadomość albo napisz na ${d.replyTo}.`) : "",
    locale === "en" ? `Unsubscribe from PreConnect information: ${d.unsubscribeUrl}` : `Wypisz się z informacji o PreConnect: ${d.unsubscribeUrl}`,
  ].filter((l) => l !== null).join("\n");
  return { subject, html, text, meta: { locale, templateKey: key, mailingDate: mailingLabel, creditsRemaining: n, creditsAvailable: avail, creditsExpiry: expiry ? expiryLabel : null, customContent: Boolean(d.content && validateContent(d.content).length === 0) } };
}
