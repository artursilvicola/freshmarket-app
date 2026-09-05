/**
 * Netlify Function: fm-plan-data
 * GET /.netlify/functions/fm-plan-data
 *
 * [feat/fm-plan-export] Komplet danych do generowania kart spotkań B2B
 * (Excel + PDF per dostawca/sieć + wysyłka). Czyta przez service role
 * (omija RLS), więc dostęp wyłącznie dla admina:
 *   - produkcja: Bearer JWT zalogowanego usera z profiles.role = 'admin'
 *     (ten sam wzorzec co admin-create-user),
 *   - lokalnie (`netlify dev` / `netlify functions:serve`, NETLIFY_DEV=true):
 *     nagłówek `x-fm-local: 1` zamiast JWT — generator CLI uruchamiany na
 *     komputerze organizatora. W produkcji NETLIFY_DEV nie istnieje, więc
 *     ta furtka nigdy się tam nie otwiera.
 *
 * Zwraca (JSON):
 *   settings   — ostatni wiersz fm_settings (algo_phase, schedule, ui_content, …)
 *   companies  — firmy dopuszczone do FM B2B (fm_b2b_enabled, active) + kontakty
 *   supplier_profiles — konta dostawców (e-mail do wysyłki karty)
 *   retailers  — sieci FM 2026 (fm26_active) + kupcy (profiles) — dane wrażliwe,
 *                na kartę DOSTAWCY nigdy nie trafiają (reguła: dostawca nie
 *                widzi nazwisk ani kontaktów kupców)
 *   prefs      — company_target_retailers (wybory dostawców)
 *   resps      — fm_resps (odpowiedzi sieci)
 */
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveEnvConfig, missingEnvNames, envErrorPayload } from "./_shared/function-env.js";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

export async function handler(event) {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missing.length) return json(500, envErrorPayload("fm-plan-data", missing));

  // ── autoryzacja ────────────────────────────────────────────────────────
  //  a) lokalnie (netlify dev): x-fm-local: 1
  //  b) token serwisowy: x-fm-token == FM_EXPORT_TOKEN (env, sekret) — dla
  //     generatora CLI / cron bez sesji przeglądarki; usunięcie zmiennej
  //     w Netlify zamyka tę ścieżkę. Porównanie w stałym czasie.
  //  c) Bearer JWT admina (panel).
  const isLocal = process.env.NETLIFY_DEV === "true" || process.env.NETLIFY_LOCAL === "true";
  const localFlag = event.headers["x-fm-local"] || event.headers["X-FM-Local"];
  const svcToken = event.headers["x-fm-token"] || event.headers["X-FM-Token"];
  const expected = process.env.FM_EXPORT_TOKEN || "";
  let authorized = false;
  if (isLocal && localFlag === "1") {
    authorized = true;
  } else if (svcToken && expected && expected.length >= 32) {
    const a = Buffer.from(String(svcToken)), b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) authorized = true;
    else return json(401, { error: "invalid_token" });
  } else {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "no_auth_header" });
    const token = authHeader.slice(7);
    const missingAuth = missingEnvNames(env, ["supabaseAnonKey"]);
    if (missingAuth.length) return json(500, envErrorPayload("fm-plan-data", missingAuth));
    const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
    if (uErr || !userData?.user) return json(401, { error: "invalid_token" });
    const supaCheck = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
    const { data: profile } = await supaCheck
      .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (profile?.role !== "admin") return json(403, { error: "admin_only" });
    authorized = true;
  }
  if (!authorized) return json(403, { error: "forbidden" });

  // ── dane ───────────────────────────────────────────────────────────────
  const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const fail = (scope, error) => json(500, { error: `${scope}: ${error.message || error}` });

  const settingsQ = await db.from("fm_settings").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (settingsQ.error) return fail("fm_settings", settingsQ.error);

  const companiesQ = await db
    .from("companies")
    .select("*, company_contacts(name, position, phone, email, role, sort_order)")
    .eq("fm_b2b_enabled", true)
    .neq("account_status", "suspended")
    .neq("account_status", "rejected")
    .order("name");
  if (companiesQ.error) return fail("companies", companiesQ.error);
  const companyIds = (companiesQ.data || []).map((c) => c.id);

  let supplierProfiles = [];
  if (companyIds.length) {
    const profQ = await db
      .from("profiles")
      .select("id, company_id, email, name, phone, position, role, locale, active")
      .in("company_id", companyIds);
    if (profQ.error) return fail("profiles", profQ.error);
    supplierProfiles = profQ.data || [];
  }

  const retailersQ = await db
    .from("retailers")
    .select(`*, buyers:profiles!fk_profiles_retailer(id, role, name, email, phone, position, active, fm26_active, buyer_categories, locale)`)
    .eq("fm26_active", true)
    .order("name");
  if (retailersQ.error) return fail("retailers", retailersQ.error);

  const prefsQ = await db.from("company_target_retailers").select("*");
  if (prefsQ.error) return fail("company_target_retailers", prefsQ.error);
  const respsQ = await db.from("fm_resps").select("*");
  if (respsQ.error) return fail("fm_resps", respsQ.error);

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    settings: settingsQ.data || null,
    companies: companiesQ.data || [],
    supplier_profiles: supplierProfiles,
    retailers: retailersQ.data || [],
    prefs: prefsQ.data || [],
    resps: respsQ.data || [],
  });
}
