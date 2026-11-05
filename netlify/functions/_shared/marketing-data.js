/**
 * [feat/marketing-activation] Odczyt danych do kandydatów (service_role) — jedno
 * miejsce, z którego korzystają marketing-candidates, marketing-preview i
 * marketing-campaign (approve). Zapytania proste (select/eq/in/gte), żeby dało się
 * je uruchomić także na cienkim shimie PostgREST w teście zintegrowanym.
 */
import { buildCandidates } from "./marketing-candidates.js";

async function must(q, what) {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
}

export async function loadCandidateInputs(supaSvc, { campaign = null, todayISO = null } = {}) {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [companies, profiles, packages, sends, offers, suppressions, recent] = await Promise.all([
    must(supaSvc.from("companies").select("id, name, country, categories, products, description, description_short, account_status, preconnect_enabled, legacy_supplier_id, legacy_fm_id"), "companies"),
    must(supaSvc.from("profiles").select("id, email, role, company_id, locale, active, name").eq("role", "supplier"), "profiles"),
    must(supaSvc.from("packages").select("company_id, source, qty_total, qty_used, expires_at"), "packages"),
    must(supaSvc.from("legacy_sends").select("legacy_id, supplier_legacy_id, status, data, created_at, updated_at"), "legacy_sends"),
    must(supaSvc.from("legacy_offers").select("supplier_legacy_id, status, created_at, updated_at"), "legacy_offers"),
    must(supaSvc.from("marketing_suppressions").select("email"), "marketing_suppressions"),
    must(supaSvc.from("marketing_messages").select("profile_id, company_id, sent_at, state, is_test").eq("is_test", false).eq("state", "accepted").gte("sent_at", since), "marketing_messages"),
  ]);
  return { companies, profiles, packages, sends, offers, suppressions, recentMessages: recent, campaign, todayISO: today };
}

export async function computeCandidates(supaSvc, opts) {
  const inputs = await loadCandidateInputs(supaSvc, opts);
  const result = buildCandidates(inputs);
  return { ...result, snapshot_at: new Date().toISOString() };
}

export async function loadCampaign(supaSvc, campaignId) {
  if (!campaignId) return null;
  const { data, error } = await supaSvc.from("marketing_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error) throw new Error("marketing_campaigns: " + error.message);
  return data || null;
}
