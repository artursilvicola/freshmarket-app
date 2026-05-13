/**
 * Netlify Function: resend-webhook
 * POST /.netlify/functions/resend-webhook
 *
 * Webhook od Resend — wywoływany po każdym evencie maila (sent, delivered,
 * opened, bounced, complained).
 * [B2B Round prod-rollout / email-open-tracking]
 *
 * Headers (Resend używa Svix):
 *   svix-id: unique id tej notyfikacji (dla idempotencji po stronie odbiorcy)
 *   svix-timestamp: unix epoch (sekundy)
 *   svix-signature: "v1,<base64-hmac>" (HMAC-SHA256 z `${svix-id}.${svix-timestamp}.${rawBody}`
 *                                       z kluczem RESEND_WEBHOOK_SECRET po `whsec_` prefiksie)
 *
 * Body: {
 *   type: "email.opened" | "email.delivered" | "email.bounced" | "email.complained" | "email.sent",
 *   created_at: ISO timestamp,
 *   data: {
 *     email_id: "abc...",     // Resend message_id (mapujemy do legacy_sends.resend_message_id)
 *     from, to, subject, ...
 *   }
 * }
 *
 * Co robimy:
 *   - type=email.opened → znajdź legacy_sends po resend_message_id,
 *     jeśli status='sent' bump do 'opened' (kolor #7c3aed w STATUS_MAP),
 *     set email_opened_at = teraz (idempotent: nie nadpisuje istniejącej daty).
 *   - inne eventy: na razie tylko logujemy. W przyszłości można dodać
 *     bounce-handling (oznaczyć kupca jako niedostępnego).
 *
 * Bezpieczeństwo:
 *   - Walidacja signature constant-time (timingSafeEqual)
 *   - Bad signature → 200 OK z {ignored:'bad_signature'}, żeby Svix nie
 *     retryował na innym końcu (PayU-style).
 *   - Replay protection: odrzucamy eventy starsze niż 10 minut (anti-replay).
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { markLegacySendsSeen } from "./_shared/legacy-send-seen.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "resendWebhookSecret"]);
  if (missing.length) {
    // 200 nawet przy missing env — Resend by retryował niepotrzebnie.
    console.error("[resend-webhook] missing env:", missing);
    return reply(200, { ignored: "missing_env", missing });
  }

  // ── 1. Verify Svix signature ────────────────────────────────────────
  const rawBody = event.body || "";
  const svixId = event.headers["svix-id"] || event.headers["Svix-Id"];
  const svixTs = event.headers["svix-timestamp"] || event.headers["Svix-Timestamp"];
  const svixSig = event.headers["svix-signature"] || event.headers["Svix-Signature"];

  if (!svixId || !svixTs || !svixSig) {
    console.warn("[resend-webhook] brak svix headers");
    return reply(200, { ignored: "missing_svix_headers" });
  }

  // Anti-replay: ignoruj eventy starsze niż 10 minut
  const tsMs = Number(svixTs) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 10 * 60 * 1000) {
    console.warn("[resend-webhook] timestamp out of window");
    return reply(200, { ignored: "stale_timestamp" });
  }

  // Resend webhook secret ma format: whsec_<base64>
  const secret = env.resendWebhookSecret.startsWith("whsec_")
    ? env.resendWebhookSecret.slice(6)
    : env.resendWebhookSecret;

  const secretBytes = Buffer.from(secret, "base64");
  const signedContent = `${svixId}.${svixTs}.${rawBody}`;
  const expectedSig = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  // svix-signature ma format "v1,<sig1> v1,<sig2> ..." — kilka możliwych podpisów (key rotation)
  const candidates = svixSig.split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean);

  const expectedBuf = Buffer.from(expectedSig, "base64");
  const sigOk = candidates.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, "base64");
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch { return false; }
  });

  if (!sigOk) {
    console.warn("[resend-webhook] zła sygnatura");
    return reply(200, { ignored: "bad_signature" });
  }

  // ── 2. Parse body ───────────────────────────────────────────────────
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return reply(200, { ignored: "invalid_json" }); }

  const type = String(payload?.type || "");
  const messageId = payload?.data?.email_id;

  // ── 3. Obsługa per event-type ───────────────────────────────────────
  // Najważniejsze: email.opened. Reszta loguje się tylko (na razie).
  if (type !== "email.opened") {
    console.log("[resend-webhook] event:", type, "message_id:", messageId);
    return reply(200, { ok: true, ignored: `event_${type}` });
  }

  if (!messageId) {
    return reply(200, { ignored: "no_message_id" });
  }

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

  // Find ALL legacy_sends z tym message_id (jeden batch = wiele sends ten sam
  // mail). Aktualizujemy każdy: jeśli status='sent' → 'opened', plus
  // email_opened_at (idempotent — `coalesce` z istniejącą wartością).
  let { data: rows, error: selErr } = await supaSvc
    .from("legacy_sends")
    .select("id, legacy_id, status, email_opened_at, data")
    .eq("resend_message_id", messageId);

  if (selErr) {
    console.error("[resend-webhook] select error", selErr);
    return reply(200, { error: "db_select_failed", message: selErr.message });
  }

  // Nowe batche wysyłają osobny email do każdego kupca tej samej sieci, więc
  // legacy_sends przechowuje też listę message_id w JSONB data.resendMessageIds.
  if (!rows || rows.length === 0) {
    const alt = await supaSvc
      .from("legacy_sends")
      .select("id, legacy_id, status, email_opened_at, data")
      .contains("data", { resendMessageIds: [messageId] });
    if (alt.error) {
      console.error("[resend-webhook] jsonb select error", alt.error);
      return reply(200, { error: "db_select_failed", message: alt.error.message });
    }
    rows = alt.data || [];
  }

  if (!rows || rows.length === 0) {
    console.warn("[resend-webhook] no sends with message_id:", messageId);
    return reply(200, { ignored: "unknown_message_id", messageId });
  }

  const result = await markLegacySendsSeen({
    supaSvc,
    env,
    legacyIds: rows.map((row) => row.legacy_id),
    channel: "email",
    notifySupplier: true,
  });

  return reply(200, { ok: true, message_id: messageId, ...result });
};

function reply(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
