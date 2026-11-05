/**
 * [feat/marketing-activation] Kandydaci do kampanii aktywizacyjnej PreConnect.
 *
 * CZYSTA funkcja: dostaje wiersze z bazy (firmy, profile, pakiety, wysyłki, propozycje,
 * suppresje, ostatnie wysyłki marketingowe), oddaje listę firm z saldem, rezerwacjami,
 * terminami ważności, GRUPAMI ODBIORCÓW (z powodem zakwalifikowania / niezakwalifikowania)
 * i powodami wykluczenia. Żadnych zapisów, żadnych przeliczeń salda „po swojemu”:
 *   - saldo = wiersze `packages` dokładnie jak company_capacity / summarizeCreditPools
 *     (src/lib/db.js): tylko niewygasłe, remaining = qty_total − qty_used, pule po `source`;
 *   - rezerwacje = `legacy_sends` tak jak describeCreditUsage (src/lib/preconnect-credit-usage.js):
 *     statusy poza rejected/refunded/queued/unread_expired, bez pobrania, bez odczytu;
 *   - propozycje = `legacy_offers` firmy (istnienie przygotowanej propozycji).
 *
 * Założenia Artura (5.11): PreConnect pomaga dostawcy zaprezentować się sieciom i zacząć
 * relację z kupcem — nie sprzedajemy wysyłki e-maila ani nie obiecujemy zamówienia. Nie znamy
 * bieżących potrzeb kupców, więc NIE ma dopasowania do potrzeb; dostawca przedstawia to, co ma.
 * Grupy odbiorców (jedna kampania = jedna grupa; firma może kwalifikować się do kilku):
 *   credits_no_proposal      — ma wolne ważne kredyty, nigdy nie przygotował propozycji ani nic nie wysłał
 *   credits_proposal_ready   — ma wolne ważne kredyty i przygotowaną propozycję, której nie skierował jeszcze do żadnej sieci
 *   used_before_free_credits — korzystał wcześniej (wysyłał) i ma wolne ważne kredyty
 *   credits_expiring         — ma wolne ważne kredyty, których najbliższy termin ważności mija w ciągu EXPIRING_DAYS
 *   no_valid_credits         — nie ma żadnych ważnych kredytów I nie ma rezerwacji przy oczekujących propozycjach
 * „Wolne” = ważne kredyty minus rezerwacje. Firma z kredytami zarezerwowanymi przy oczekujących
 * propozycjach nigdy nie trafia do „brak kredytów” (powód: b_reserved_pending / b_all_reserved).
 * Ostateczny wybór zatwierdza człowiek.
 */
import { usesPreconnectCredit, hasCreditCharge } from "../../../src/lib/preconnect-credit-usage.js";

export const AUDIENCES = Object.freeze({
  CREDITS_NO_PROPOSAL: "credits_no_proposal",
  CREDITS_PROPOSAL_READY: "credits_proposal_ready",
  USED_BEFORE_FREE_CREDITS: "used_before_free_credits",
  CREDITS_EXPIRING: "credits_expiring",
  NO_VALID_CREDITS: "no_valid_credits",
});
export const AUDIENCE_KEYS = Object.freeze(Object.values(AUDIENCES));
export const EXPIRING_DAYS = 30;

/** Opisowy segment (informacyjnie, do kolumny `segment` w rejestrze) — nie decyduje o kwalifikacji. */
export const SEGMENTS = Object.freeze({
  START_WITH_CREDITS: "start_with_credits",   // wolne kredyty, nigdy nic nie wysłał
  RETURN_ACTIVE: "return_active",             // wolne kredyty, wysyłał wcześniej
  IN_PROCESS_ONLY: "in_process_only",         // wszystko zarezerwowane — tylko czekać
  NO_CREDITS: "no_credits",                   // brak ważnych kredytów
});

/** Wykluczenia BAZOWE (niezależne od grupy). */
export const EXCLUSION_REASONS = Object.freeze([
  "account_not_active", "preconnect_disabled", "test_account", "no_operator", "multiple_operators",
  "email_invalid", "email_shared", "suppressed", "recent_campaign",
]);

/** Powody kwalifikacji (q_*) i niekwalifikacji (b_*) do grupy — do pokazania administratorowi. */
export const AUDIENCE_REASONS = Object.freeze([
  "q_credits_available_no_history", "q_credits_available_offer_not_sent", "q_used_before_credits_available", "q_credits_expiring", "q_no_valid_credits",
  "b_no_valid_credits", "b_all_reserved", "b_has_sends", "b_has_offers", "b_no_offers", "b_no_sends", "b_no_expiry", "b_expiry_far", "b_has_valid_credits", "b_reserved_pending",
]);

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_NAME_RX = /^zzz test/i;

function norm(s) { return String(s || "").trim().toLowerCase(); }
function dateOnly(s) { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || "")); return m ? m[1] : null; }

/** Klucze, po których wysyłki/propozycje dopasowują się do firmy (jak legacyKeyMatchesCompany w UI). */
export function companyKeys(co) {
  const keys = new Set();
  if (co?.id) keys.add(String(co.id));
  if (co?.legacy_supplier_id) keys.add(String(co.legacy_supplier_id));
  if (co?.legacy_fm_id) { keys.add(String(co.legacy_fm_id)); keys.add("sup-" + co.legacy_fm_id); }
  return keys;
}

/** Pule kredytów 1:1 z summarizeCreditPools (tylko niewygasłe; today = 'YYYY-MM-DD'). */
export function summarizePools(packages, todayISO) {
  const pools = { free: 0, paid: 0, legacy: 0, remaining: 0, nearest_expiry: null, expiring: [] };
  for (const p of packages || []) {
    const exp = dateOnly(p?.expires_at);
    if (exp && exp < todayISO) continue;
    const total = Number(p?.qty_total || 0), used = Math.min(total, Number(p?.qty_used || 0));
    const remaining = Math.max(0, total - used);
    const src = String(p?.source || "purchase");
    const pool = src === "grant" ? "free" : src === "legacy" ? "legacy" : "paid";
    pools[pool] += remaining;
    pools.remaining += remaining;
    if (remaining > 0 && exp) {
      pools.expiring.push({ expiry: exp, remaining, pool });
      if (!pools.nearest_expiry || exp < pools.nearest_expiry) pools.nearest_expiry = exp;
    }
  }
  pools.expiring.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return pools;
}

/**
 * Kwalifikacja do jednej grupy na podstawie faktów firmy.
 * @param {string} key grupa
 * @param {object} f { remaining, reserved, available, sends_total, offers_total, nearest_expiry, expiring_soon }
 * @returns {{ ok: boolean, reason: string }}
 */
export function qualifyAudience(key, f) {
  const noCredits = () => (f.remaining <= 0 ? "b_no_valid_credits" : "b_all_reserved");
  switch (key) {
    case AUDIENCES.CREDITS_NO_PROPOSAL:
      if (f.available <= 0) return { ok: false, reason: noCredits() };
      if (f.sends_total > 0) return { ok: false, reason: "b_has_sends" };
      if (f.offers_total > 0) return { ok: false, reason: "b_has_offers" };
      return { ok: true, reason: "q_credits_available_no_history" };
    case AUDIENCES.CREDITS_PROPOSAL_READY:
      if (f.available <= 0) return { ok: false, reason: noCredits() };
      if (f.sends_total > 0) return { ok: false, reason: "b_has_sends" };
      if (f.offers_total <= 0) return { ok: false, reason: "b_no_offers" };
      return { ok: true, reason: "q_credits_available_offer_not_sent" };
    case AUDIENCES.USED_BEFORE_FREE_CREDITS:
      if (f.available <= 0) return { ok: false, reason: noCredits() };
      if (f.sends_total <= 0) return { ok: false, reason: "b_no_sends" };
      return { ok: true, reason: "q_used_before_credits_available" };
    case AUDIENCES.CREDITS_EXPIRING:
      if (f.available <= 0) return { ok: false, reason: noCredits() };
      if (!f.nearest_expiry) return { ok: false, reason: "b_no_expiry" };
      if (!f.expiring_soon) return { ok: false, reason: "b_expiry_far" };
      return { ok: true, reason: "q_credits_expiring" };
    case AUDIENCES.NO_VALID_CREDITS:
      if (f.remaining > 0) return { ok: false, reason: "b_has_valid_credits" };
      if (f.reserved > 0) return { ok: false, reason: "b_reserved_pending" }; // kredyty przy oczekujących propozycjach — NIE „kup pakiet”
      return { ok: true, reason: "q_no_valid_credits" };
    default:
      return { ok: false, reason: "b_unknown_audience" };
  }
}

/**
 * @param {object} input
 * @param {Array} input.companies   id, name, country, categories, products, description, account_status, preconnect_enabled, legacy_supplier_id, legacy_fm_id
 * @param {Array} input.profiles    id, email, role, company_id, locale, active, name
 * @param {Array} input.packages    company_id, source, qty_total, qty_used, expires_at
 * @param {Array} input.sends       supplier_legacy_id, status, data, created_at, updated_at
 * @param {Array} input.offers      supplier_legacy_id, status, created_at, updated_at
 * @param {Array} input.suppressions email
 * @param {Array} input.recentMessages profile_id, company_id, sent_at, state  (wysłane w ostatnich 30 dniach)
 * @param {object} input.campaign   template_key = grupa odbiorców (AUDIENCE_KEYS) — decyduje o `in_audience`/`eligible`
 * @param {string} input.todayISO   'YYYY-MM-DD' (dzień biznesowy)
 */
export function buildCandidates(input) {
  const { companies = [], profiles = [], packages = [], sends = [], offers = [], suppressions = [], recentMessages = [], campaign = null, todayISO } = input;
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const audience = AUDIENCE_KEYS.includes(campaign?.template_key) ? campaign.template_key : null;
  const suppressed = new Set(suppressions.map((s) => norm(s.email)).filter(Boolean));

  // operatorzy: aktywne profile dostawców per firma; adresy współdzielone między firmami
  const profilesByCompany = new Map();
  const companiesByEmail = new Map();
  for (const p of profiles) {
    if (p?.role !== "supplier" || p?.active === false || !p?.company_id) continue;
    const list = profilesByCompany.get(String(p.company_id)) || [];
    list.push(p); profilesByCompany.set(String(p.company_id), list);
    const e = norm(p.email);
    if (e) { const set = companiesByEmail.get(e) || new Set(); set.add(String(p.company_id)); companiesByEmail.set(e, set); }
  }
  const packagesByCompany = new Map();
  for (const pk of packages) { const k = String(pk?.company_id || ""); if (!k) continue; (packagesByCompany.get(k) || packagesByCompany.set(k, []).get(k)).push(pk); }
  const recentByCompany = new Map();
  for (const m of recentMessages) { if (m?.company_id) recentByCompany.set(String(m.company_id), m); }
  const expiringLimit = shiftDays(today, EXPIRING_DAYS);

  const rows = [];
  for (const co of companies) {
    const keys = companyKeys(co);
    const ownSends = sends.filter((s) => keys.has(String(s?.supplier_legacy_id)));
    const ownOffers = offers.filter((o) => keys.has(String(o?.supplier_legacy_id)));
    const pools = summarizePools(packagesByCompany.get(String(co.id)) || [], today);
    const reserved = ownSends.filter((s) => usesPreconnectCredit(s) && !hasCreditCharge(s) && !["opened", "read", "read_manual"].includes(s.status)).length;
    const reads = ownSends.filter((s) => ["opened", "read", "read_manual"].includes(s.status) || hasCreditCharge(s)).length;
    const available = Math.max(0, pools.remaining - reserved);
    const expiringSoon = Boolean(pools.nearest_expiry && pools.nearest_expiry <= expiringLimit);
    const expiringCredits = pools.expiring.filter((e) => e.expiry === pools.nearest_expiry).reduce((a, e) => a + e.remaining, 0);
    const lastSendAt = ownSends.map((s) => s.created_at).filter(Boolean).sort().pop() || null;
    const lastOfferAt = ownOffers.map((o) => o.updated_at || o.created_at).filter(Boolean).sort().pop() || null;
    const lastRejected = ownSends.filter((s) => s.status === "rejected").map((s) => s.updated_at || s.created_at).filter(Boolean).sort().pop() || null;
    const ops = profilesByCompany.get(String(co.id)) || [];
    const operator = ops.length === 1 ? ops[0] : null;
    const email = norm(operator?.email);

    const exclusions = [];
    const warnings = [];
    if (co.account_status !== "active") exclusions.push("account_not_active");
    if (!co.preconnect_enabled) exclusions.push("preconnect_disabled");
    if (TEST_NAME_RX.test(String(co.name || ""))) exclusions.push("test_account");
    if (ops.length === 0) exclusions.push("no_operator");
    if (ops.length > 1) exclusions.push("multiple_operators");
    if (operator && !EMAIL_RX.test(email)) exclusions.push("email_invalid");
    if (email && (companiesByEmail.get(email)?.size || 0) > 1) exclusions.push("email_shared");
    if (email && suppressed.has(email)) exclusions.push("suppressed");
    if (recentByCompany.has(String(co.id))) exclusions.push("recent_campaign");

    // opisowy segment (informacja, nie kwalifikacja)
    let segment;
    if (pools.remaining <= 0) segment = SEGMENTS.NO_CREDITS;
    else if (available <= 0) segment = SEGMENTS.IN_PROCESS_ONLY;
    else if (ownSends.length === 0) segment = SEGMENTS.START_WITH_CREDITS;
    else segment = SEGMENTS.RETURN_ACTIVE;

    const facts = { remaining: pools.remaining, reserved, available, sends_total: ownSends.length, offers_total: ownOffers.length, nearest_expiry: pools.nearest_expiry, expiring_soon: expiringSoon };
    const audiences = [];
    const audienceReasons = {};
    for (const key of AUDIENCE_KEYS) {
      const q = qualifyAudience(key, facts);
      audienceReasons[key] = q.reason;
      if (q.ok) audiences.push(key);
    }
    // kampania bez grupy (stare szablony) → wolne kredyty wystarczą
    const inAudience = audience ? audiences.includes(audience) : available > 0;
    const audienceReason = audience ? audienceReasons[audience] : (available > 0 ? "q_credits_available" : (pools.remaining <= 0 ? "b_no_valid_credits" : "b_all_reserved"));

    if (segment === SEGMENTS.RETURN_ACTIVE && reads === 0) warnings.push("sent_no_reads");
    if (lastRejected && lastRejected.slice(0, 10) >= shiftDays(today, -30)) warnings.push("recent_rejection");
    if (reserved > 0 && available > 0) warnings.push("has_reservations");
    if (operator && norm(co.country) && norm(co.country) !== "pl" && norm(operator.locale || "pl") === "pl") warnings.push("locale_pl_foreign_country");
    if (expiringSoon && available > 0 && audience !== AUDIENCES.CREDITS_EXPIRING) warnings.push("credits_expire_soon");

    const baseOk = exclusions.length === 0;
    rows.push({
      company_id: co.id,
      company_name: co.name,
      country: co.country || null,
      categories: co.categories || [],
      profile_id: operator?.id || null,
      operator_name: operator?.name || null,
      email: email || null,
      locale: norm(operator?.locale).split(/[-_]/)[0] === "en" ? "en" : "pl",
      segment,
      template_key: audience || (segment === SEGMENTS.START_WITH_CREDITS ? "start_with_credits" : segment === SEGMENTS.RETURN_ACTIVE ? "return_active" : null),
      audiences,
      audience_reasons: audienceReasons,
      in_audience: inAudience,
      audience_reason: audienceReason,
      base_ok: baseOk,
      eligible: baseOk && inAudience,
      exclusions,
      warnings,
      snapshot: {
        credits_free: pools.free, credits_paid: pools.paid, credits_legacy: pools.legacy, credits_remaining: pools.remaining,
        credits_available: available, expiring_credits: expiringCredits,
        nearest_expiry: pools.nearest_expiry, expiring: pools.expiring,
        reserved, sends_total: ownSends.length, reads_total: reads, offers_total: ownOffers.length,
        last_send_at: lastSendAt, last_offer_at: lastOfferAt, last_rejected_at: lastRejected,
        operators: ops.length,
      },
    });
  }
  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.base_ok) - Number(a.base_ok) || String(a.company_name).localeCompare(String(b.company_name)));
  const byAudience = {};
  for (const key of AUDIENCE_KEYS) byAudience[key] = rows.filter((r) => r.base_ok && r.audiences.includes(key)).length;
  const summary = {
    companies: rows.length,
    base_ok: rows.filter((r) => r.base_ok).length,
    eligible: rows.filter((r) => r.eligible).length,
    audience,
    by_audience: byAudience,          // firmy bez wykluczeń bazowych per grupa (nakładają się)
    by_segment: countBy(rows, (r) => r.segment),
    by_exclusion: countBy(rows.flatMap((r) => r.exclusions), (x) => x),
    counts_overlap: true, // powody wykluczeń i grupy nakładają się — nie sumować
  };
  return { rows, summary, today };
}

function shiftDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function countBy(list, fn) {
  const out = {};
  for (const x of list) { const k = fn(x); if (k == null) continue; out[k] = (out[k] || 0) + 1; }
  return out;
}
