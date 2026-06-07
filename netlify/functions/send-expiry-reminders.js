/**
 * Netlify Function: send-expiry-reminders
 * POST /.netlify/functions/send-expiry-reminders
 *
 * Headers: Authorization: Bearer <user JWT>   (dowolny zalogowany user)
 *
 * [feat/credit-expiry-reminder / Poprawki Lany #6]
 *
 * Leniwy sweep (wołany przy wejściu do aplikacji, jak expire_legacy_sends_14d):
 *   1. RPC claim_due_expiry_reminders ATOMOWO oznacza pakiety 14 dni przed
 *      wygaśnięciem jako "przypomniane" i zwraca je (z e-mailem dostawcy).
 *   2. Dla każdego zwróconego pakietu wysyła e-mail przypomnienia (Resend).
 *
 * Idempotencja: marker packages.expiry_reminder_sent_at — każdy pakiet
 * przypominany RAZ niezależnie od liczby wywołań (mark-then-send, at-most-once).
 *
 * Bezpieczeństwo: wymaga zalogowanego usera (jak istniejący sweep). Nie ujawnia
 * danych — funkcja sama wysyła maile do firm; wołający niczego nie widzi.
 * NIE dotyka purchase_package / qty_used / PayU.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";
import { tplCreditExpiryReminder } from "./_shared/reminder-template.js";

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
  if (missing.length) return json(500, envErrorPayload("send-expiry-reminders", missing));

  // ── Auth (dowolny zalogowany user — sweep idempotentny) ─────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });

  // ── Zaklep due pakiety (atomowo) ────────────────────────────────────
  const { data: rows, error: rpcErr } = await supaSvc.rpc("claim_due_expiry_reminders", { p_limit: 200 });
  if (rpcErr) return json(500, { error: "claim_due_expiry_reminders failed", detail: rpcErr.message });

  const claimed = Array.isArray(rows) ? rows : [];
  let sent = 0;
  const failures = [];

  for (const r of claimed) {
    const email = r.supplier_email;
    if (!email) continue; // brak odbiorcy — pakiet już oznaczony, pomijamy wysyłkę
    try {
      const { subject, html } = tplCreditExpiryReminder({
        companyName: r.company_name,
        qtyRemaining: r.qty_remaining,
        expiresAt: r.expires_at,
        appUrl: env.b2bAppUrl,
        locale: r.supplier_locale || "pl",
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
      else failures.push({ package_id: r.package_id, status: res.status });
    } catch (e) {
      failures.push({ package_id: r.package_id, error: e?.message || String(e) });
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
