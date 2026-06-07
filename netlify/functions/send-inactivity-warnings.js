/**
 * Netlify Function: send-inactivity-warnings
 * POST /.netlify/functions/send-inactivity-warnings
 *
 * Headers: Authorization: Bearer <user JWT>   (dowolny zalogowany user)
 *
 * [feat/account-inactivity-foundation / Poprawki Lany #8]
 *
 * Leniwy sweep ostrzeżeń o nieaktywności konta (30 i 7 dni przed progiem 24 mc):
 *   1. RPC claim_due_inactivity_warnings ATOMOWO oznacza konta (markery 30/7)
 *      i zwraca je z e-mailem + datą po której konto może zostać usunięte.
 *   2. Dla każdego zwróconego konta wysyła ostrzeżenie (Resend).
 *
 * Idempotencja: markery inactivity_warn30_sent_at / inactivity_warn7_sent_at —
 * każdy etap wysyłany RAZ na konto (mark-then-send, at-most-once).
 *
 * To CZĘŚĆ BEZPIECZNA #8 — tylko ostrzeżenia. Archiwizacja/anonimizacja/usuwanie
 * to osobny etap za flagą (sandbox). Funkcja NIE usuwa ani nie modyfikuje danych
 * poza markerami ostrzeżeń.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";
import { tplInactivityWarning } from "./_shared/inactivity-template.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  const locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "resendApiKey"]);
  if (missing.length) return json(500, envErrorPayload("send-inactivity-warnings", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });

  const { data: rows, error: rpcErr } = await supaSvc.rpc("claim_due_inactivity_warnings", { p_limit: 200 });
  if (rpcErr) return json(500, { error: "claim_due_inactivity_warnings failed", detail: rpcErr.message });

  const claimed = Array.isArray(rows) ? rows : [];
  let sent = 0;
  const failures = [];

  for (const r of claimed) {
    const email = r.email;
    if (!email) continue;
    try {
      const { subject, html } = tplInactivityWarning({
        name: r.name,
        stage: r.stage,
        deleteAfter: r.delete_after,
        appUrl: env.b2bAppUrl,
        locale: r.locale || "pl",
      });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Fresh Market <newsletter@freshmarket.eu>",
          to: [email],
          subject,
          html,
        }),
      });
      if (res.ok) sent += 1;
      else failures.push({ profile_id: r.profile_id, stage: r.stage, status: res.status });
    } catch (e) {
      failures.push({ profile_id: r.profile_id, error: e?.message || String(e) });
    }
  }

  return json(200, { claimed: claimed.length, sent, failures: failures.length });
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
