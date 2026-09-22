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
 *   plan_updated_at — wersja zatwierdzonego planu (fm_plan_private.updated_at) albo null
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
import { loadFmPlanRaw } from "./_shared/fm-plan-raw.js";

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
    // [feat/fm-plan-send-server-card] rola admin + aktywne konto (dezaktywacja profilu zamyka eksport)
    const { data: profile } = await supaCheck
      .from("profiles").select("role, active").eq("id", userData.user.id).maybeSingle();
    if (profile?.role !== "admin" || profile.active === false) return json(403, { error: "admin_only" });
    authorized = true;
  }
  if (!authorized) return json(403, { error: "forbidden" });

  // ── dane ───────────────────────────────────────────────────────────────
  // [feat/fm-plan-send-server-card] wspólny loader z fm-plan-send — ten sam
  // obraz danych w eksporcie i w wysyłce; plan_updated_at = wersja planu.
  const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const raw = await loadFmPlanRaw(db);
  if (raw.error) return json(500, { error: raw.error });
  return json(200, raw);
}
