/**
 * POST /.netlify/functions/mark-buyer-preconnect-seen
 *
 * Buyer opens the PreConnect list. Every visible sent/opened offer for that
 * buyer's retailer counts as delivered: status -> read, one package credit is
 * consumed once, supplier gets one idempotent notification.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { markLegacySendsSeen } from "./_shared/legacy-send-seen.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  // [P2-backend-mails C3] Caller is buyer/admin.
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missing.length) return json(500, envErrorPayload("mark-buyer-preconnect-seen", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });

  // [P2-backend-mails C3] Pull `locale` for caller-facing error messages.
  const { data: profile, error: profileErr } = await supaSvc
    .from("profiles")
    .select("id, role, retailer_id, active, locale")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileErr) return json(500, { error: profileErr.message });
  if (!profile?.active) return json(403, { error: errLoc(locale, "account_inactive_buyer") });
  if (!["buyer", "admin"].includes(profile?.role)) return json(403, { error: errLoc(locale, "only_buyer_or_admin_mark_seen_list") });
  locale = resolveLocale({ profileLocale: profile.locale, acceptLanguage: acceptLang });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: errLoc(locale, "invalid_json") }); }
  // [P2-backend-mails C3] body.locale overrides.
  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: profile.locale, acceptLanguage: acceptLang });

  const legacyIds = Array.isArray(body.legacy_ids) ? body.legacy_ids : [];
  const channel = body.channel === "app_detail" ? "app_detail" : "app_list";
  if (!legacyIds.length) return json(200, { ok: true, results: [] });

  const result = await markLegacySendsSeen({
    supaSvc,
    env,
    legacyIds,
    channel,
    allowedRetailerId: profile.role === "buyer" ? profile.retailer_id : null,
    notifySupplier: true,
  });

  // [TEMP DEBUG] dispatchnij pełen result + notificationSummary do Netlify log
  // żebyśmy mogli zobaczyć dlaczego mail H nie wysyłany. Usunąć po diagnozie.
  try { console.log("[mark-buyer-preconnect-seen RESULT]", JSON.stringify(result, null, 2)); } catch (e) {}

  return json(200, result);
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: statusCode === 204 ? "" : JSON.stringify(payload),
  };
}
