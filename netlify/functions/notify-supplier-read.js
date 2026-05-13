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
import { notifySupplierOfferRead } from "./_shared/supplier-read-notify.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "resendApiKey"]);
  if (missing.length) return json(500, envErrorPayload("notify-supplier-read", missing));

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: "Brak tokenu autoryzacji" });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: "Nieprawidłowy token" });
  }

  // ── Body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Niepoprawny JSON" }); }
  const legacyId = Number(body.legacy_id);
  if (!Number.isFinite(legacyId) || legacyId <= 0) {
    return json(400, { error: "Brak / nieprawidłowy legacy_id" });
  }

  const result = await notifySupplierOfferRead({
    supaSvc,
    env,
    legacyId,
    openedVia: "app",
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
