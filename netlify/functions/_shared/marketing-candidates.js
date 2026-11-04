/**
 * [feat/marketing-activation] Kandydaci do kampanii aktywizacyjnej PreConnect.
 *
 * CZYSTA funkcja: dostaje wiersze z bazy (firmy, profile, pakiety, wysyłki, szkice,
 * suppresje, ostatnie wysyłki marketingowe), oddaje listę firm z segmentem, saldem,
 * rezerwacjami, terminami ważności, dopasowaniem do potrzeb kupców i powodami
 * wykluczenia. Żadnych zapisów, żadnych przeliczeń salda „po swojemu”:
 *   - saldo = wiersze `packages` dokładnie jak company_capacity / summarizeCreditPools
 *     (src/lib/db.js): tylko niewygasłe, remaining = qty_total − qty_used, pule po `source`;
 *   - rezerwacje = `legacy_sends` tak jak describeCreditUsage (src/lib/preconnect-credit-usage.js):
 *     statusy poza rejected/refunded/queued/unread_expired, bez pobrania, bez odczytu.
 *
 * Kryteria Artura (4.11): dostępne WAŻNE kredyty, poprawny adres operatora, brak
 * wypisu, brak trwającego procesu wymagającego tylko oczekiwania, dopasowanie
 * asortymentu do potrzeb kupców (Oksana). Ostateczny wybór zatwierdza człowiek.
 */
import { usesPreconnectCredit, hasCreditCharge } from "../../../src/lib/preconnect-credit-usage.js";

export const SEGMENTS = Object.freeze({
  START_WITH_CREDITS: "start_with_credits",   // kredyty są, nigdy nic nie wysłał
  RETURN_ACTIVE: "return_active",             // kredyty są, wysyłał wcześniej
  IN_PROCESS_ONLY: "in_process_only",         // wszystko zarezerwowane — tylko czekać → wykluczony
  NO_CREDITS: "no_credits",                   // brak ważnych kredytów → poza fazą 1
});

export const EXCLUSION_REASONS = Object.freeze([
  "account_not_active", "preconnect_disabled", "test_account", "no_operator", "multiple_operators",
  "email_invalid", "email_shared", "suppressed", "recent_campaign", "in_process_only", "no_credits",
]);

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_NAME_RX = /^zzz test/i;

function norm(s) { return String(s || "").trim().toLowerCase(); }
function dateOnly(s) { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || "")); return m ? m[1] : null; }

/** Klucze, po których wysyłki/szkice dopasowują się do firmy (jak legacyKeyMatchesCompany w UI). */
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

/** Dopasowanie asortymentu do potrzeb kupców: kategorie (dokładnie) + słowa kluczowe (w produktach/nazwie/opisie). */
export function matchNeeds(co, campaign) {
  const cats = (campaign?.target_categories || []).map(norm).filter(Boolean);
  const kws = (campaign?.target_keywords || []).map(norm).filter(Boolean);
  if (!cats.length && !kws.length) return { status: "n/a", score: 0, categories: [], keywords: [] };
  const own = (co?.categories || []).map(norm);
  const hitCats = cats.filter((c) => own.includes(c));
  const hay = norm([co?.products, co?.name, co?.description, co?.description_short].filter(Boolean).join(" "));
  const hitKws = kws.filter((k) => hay.includes(k));
  const score = hitCats.length + hitKws.length;
  return { status: score > 0 ? "yes" : "no", score, categories: hitCats, keywords: hitKws };
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
 * @param {object} input.campaign   target_categories, target_keywords
 * @param {string} input.todayISO   'YYYY-MM-DD' (dzień biznesowy)
 */
export function buildCandidates(input) {
  const { companies = [], profiles = [], packages = [], sends = [], offers = [], suppressions = [], recentMessages = [], campaign = null, todayISO } = input;
  const today = todayISO || new Date().toISOString().slice(0, 10);
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

  const rows = [];
  for (const co of companies) {
    const keys = companyKeys(co);
    const ownSends = sends.filter((s) => keys.has(String(s?.supplier_legacy_id)));
    const ownOffers = offers.filter((o) => keys.has(String(o?.supplier_legacy_id)));
    const pools = summarizePools(packagesByCompany.get(String(co.id)) || [], today);
    const reserved = ownSends.filter((s) => usesPreconnectCredit(s) && !hasCreditCharge(s) && !["opened", "read", "read_manual"].includes(s.status)).length;
    const reads = ownSends.filter((s) => ["opened", "read", "read_manual"].includes(s.status) || hasCreditCharge(s)).length;
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

    let segment;
    if (pools.remaining <= 0) { segment = SEGMENTS.NO_CREDITS; exclusions.push("no_credits"); }
    else if (reserved > 0 && pools.remaining <= reserved) { segment = SEGMENTS.IN_PROCESS_ONLY; exclusions.push("in_process_only"); }
    else if (ownSends.length === 0) segment = SEGMENTS.START_WITH_CREDITS;
    else segment = SEGMENTS.RETURN_ACTIVE;

    if (segment === SEGMENTS.RETURN_ACTIVE && reads === 0) warnings.push("sent_no_reads");
    if (lastRejected && lastRejected.slice(0, 10) >= shiftDays(today, -30)) warnings.push("recent_rejection");
    if (reserved > 0 && !exclusions.includes("in_process_only")) warnings.push("has_reservations");
    if (operator && norm(co.country) && norm(co.country) !== "pl" && norm(operator.locale || "pl") === "pl") warnings.push("locale_pl_foreign_country");
    if (pools.nearest_expiry && pools.nearest_expiry <= shiftDays(today, 30)) warnings.push("credits_expire_soon");

    const match = matchNeeds(co, campaign);
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
      template_key: segment === SEGMENTS.START_WITH_CREDITS ? "start_with_credits" : segment === SEGMENTS.RETURN_ACTIVE ? "return_active" : null,
      eligible: exclusions.length === 0,
      exclusions,
      warnings,
      match,
      snapshot: {
        credits_free: pools.free, credits_paid: pools.paid, credits_legacy: pools.legacy, credits_remaining: pools.remaining,
        nearest_expiry: pools.nearest_expiry, expiring: pools.expiring,
        reserved, sends_total: ownSends.length, reads_total: reads,
        last_send_at: lastSendAt, last_offer_at: lastOfferAt, last_rejected_at: lastRejected,
        operators: ops.length,
      },
    });
  }
  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.match.score - a.match.score || String(a.company_name).localeCompare(String(b.company_name)));
  const summary = {
    companies: rows.length,
    eligible: rows.filter((r) => r.eligible).length,
    by_segment: countBy(rows, (r) => r.segment),
    by_exclusion: countBy(rows.flatMap((r) => r.exclusions), (x) => x),
    matched: rows.filter((r) => r.eligible && r.match.status === "yes").length,
    counts_overlap: true, // powody wykluczeń nakładają się — nie sumować
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
