/**
 * Netlify Function: notify-supplier-read
 * POST /.netlify/functions/notify-supplier-read
 *
 * Body: { legacy_id: number }
 * Headers: Authorization: Bearer <user JWT>
 *
 * [B2B Round prod-rollout / email-open-tracking]
 *
 * Wywoływane z frontendu zaraz po `markSendOpened` (kupiec otworzył ofertę
 * w aplikacji). Sprawdza JWT (musi być zalogowany), znajduje suppliera
 * powiązanego z send.offer_id i wysyła mu mail "Twoja oferta została
 * zobaczona".
 *
 * Idempotency: helper supplier-read-notify sam sprawdza data.supplierNotifiedAt
 * w legacy_sends — wielokrotne wywołanie (np. buyer F5'uje detal) = no-op.
 *
 * Bezpieczeństwo: wymaga JWT. Auth-check: każdy zalogowany może wywołać
 * (idempotent, bez side effects po pierwszym razie). Mogłbym zawęzić do
 * roli buyer/admin, ale to dodatkowy hop bez realnej wartości — i tak helper
 * nie wyśle drugiego maila.
 *
 * Fire-and-forget: jeśli wysyłka się nie powiedzie, NIE wracamy z błędem
 * na frontend. Logujemy w Netlify, zwracamy 200 z deails — frontend i tak
 * status w bazie ustawił niezależnie od maila.
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
  // [P2-backend-mails C3] Caller is buyer/admin → use Accept-Language → profile.locale.
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missing.length) return json(500, envErrorPayload("notify-supplier-read", missing));

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: errLoc(locale, "invalid_token") });
  }

  // [P2-backend-mails C3] Pull `locale` for caller-facing error messages.
  const { data: profile, error: profileErr } = await supaSvc
    .from("profiles")
    .select("id, role, retailer_id, active, locale")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileErr) return json(500, { error: profileErr.message });
  if (!profile?.active) return json(403, { error: errLoc(locale, "account_inactive") });
  if (!["buyer", "admin"].includes(profile?.role)) {
    return json(403, { error: errLoc(locale, "only_buyer_or_admin_mark_seen") });
  }
  locale = resolveLocale({ profileLocale: profile.locale, acceptLanguage: acceptLang });

  // ── Body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: errLoc(locale, "invalid_json") }); }
  // [P2-backend-mails C3] body.locale wygrywa, jeśli klient przekazał.
  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: profile.locale, acceptLanguage: acceptLang });
  const legacyId = Number(body.legacy_id);
  if (!Number.isFinite(legacyId) || legacyId <= 0) {
    return json(400, { error: errLoc(locale, "missing_legacy_id") });
  }

  const result = await markLegacySendsSeen({
    supaSvc,
    env,
    legacyIds: [legacyId],
    channel: "app_detail",
    allowedRetailerId: profile.role === "buyer" ? profile.retailer_id : null,
    notifySupplier: true,
  });

  // 200 zawsze (fire-and-forget z frontu) — frontend nie powinien się
  // zaciąć jeśli mail padnie. Status w details.
  return json(200, result);
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
