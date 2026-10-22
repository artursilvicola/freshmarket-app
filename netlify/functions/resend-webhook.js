/**
 * Netlify Function: resend-webhook
 * POST /.netlify/functions/resend-webhook
 *
 * Webhook od Resend (Svix) po każdym zdarzeniu maila: sent, delivered, opened,
 * clicked, bounced, complained, delivery_delayed.
 *
 * Headers:
 *   svix-id, svix-timestamp, svix-signature ("v1,<base64-hmac>" — HMAC-SHA256
 *   z `${svix-id}.${svix-timestamp}.${rawBody}` kluczem RESEND_WEBHOOK_SECRET
 *   po prefiksie `whsec_`).
 *
 * Body: { type, created_at, data: { email_id, from, to, subject, ... } }
 *
 * [feat/email-open-history] Kolejność: ZAPISZ zdarzenie → przetwórz → potwierdź.
 *   1. Podpis + anty-replay (10 min). Zła sygnatura / stary event → 200 „ignored"
 *      (ponowienie przez Svix niczego by nie naprawiło).
 *   2. `ingest_legacy_send_email_event` — deduplikacja po svix-id. Jeśli zapis
 *      do bazy padnie → 500, żeby Svix PONOWIŁ: zdarzenie nie może przepaść.
 *   3. Duplikat → 200 bez przetwarzania. Wiadomość jeszcze nie powiązana → 200
 *      „orphan": zdarzenie czeka, `record_legacy_send_message` wróci do niego.
 *   4. email.opened → rozliczenie WYŁĄCZNIE propozycji z tej wiadomości (legacy_ids
 *      z powiązania) przez `mark_legacy_send_seen`. Błąd przejściowy → zdarzenie
 *      w `error`, odpowiedź 500 → Svix ponawia; rozliczenie i powiadomienie
 *      dostawcy są idempotentne, więc ponowienie nie dubluje.
 *   5. Inne typy → historia (status processed), 200.
 *
 * Maile niezwiązane z propozycjami (logowanie, powiadomienia dostawców) nie mają
 * powiązania w legacy_send_messages → trafiają do rejestru jako orphan i nigdy
 * niczego nie rozliczają.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { ingestResendEvent, processKnownEvent, RetryableEventError } from "./_shared/email-events.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REPLAY_WINDOW_SECONDS = 10 * 60;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "resendWebhookSecret"]);
  if (missing.length) {
    // Konfiguracja, nie zdarzenie — ponowienie przez Svix nic nie da. Głośno w logu.
    console.error("[resend-webhook] missing env:", missing);
    return reply(200, { ignored: "missing_env", missing });
  }

  // ── 1. Podpis Svix + anty-replay ────────────────────────────────────────
  const h = lowerHeaders(event.headers || {});
  const svixId = h["svix-id"];
  const svixTs = h["svix-timestamp"];
  const svixSig = h["svix-signature"];
  if (!svixId || !svixTs || !svixSig) {
    console.warn("[resend-webhook] brak svix headers");
    return reply(200, { ignored: "missing_svix_headers" });
  }
  const tsNum = Number(svixTs);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > REPLAY_WINDOW_SECONDS) {
    console.warn("[resend-webhook] timestamp poza oknem");
    return reply(200, { ignored: "stale_timestamp" });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");

  const secret = String(env.resendWebhookSecret || "");
  const secretBytes = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expectedSig = crypto.createHmac("sha256", secretBytes).update(`${svixId}.${svixTs}.${rawBody}`).digest("base64");
  const candidates = String(svixSig).split(" ").map((part) => part.split(",")[1]).filter(Boolean);
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

  // ── 2. Ładunek ──────────────────────────────────────────────────────────
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return reply(200, { ignored: "invalid_json" }); }

  const type = String(payload?.type || "");
  const messageId = payload?.data?.email_id ? String(payload.data.email_id) : "";
  if (!messageId) return reply(200, { ignored: "no_message_id", type });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

  // ── 3. Zapis zdarzenia (deduplikacja po svix-id) ────────────────────────
  let ingested;
  try {
    ingested = await ingestResendEvent({
      supaSvc, eventId: svixId, messageId, type,
      occurredAt: payload?.created_at || null,
      payload: { type, created_at: payload?.created_at || null, data: scrubPayload(payload?.data) },
    });
  } catch (e) {
    // Nie zapisaliśmy — nie wolno potwierdzić. Svix ponowi.
    console.error("[resend-webhook] ingest failed:", e?.detail || e?.message);
    return reply(500, { error: "ingest_failed", retry: true });
  }

  if (ingested.duplicate) {
    // Ten sam svix-id już był. Jeśli poprzednia próba skończyła się błędem,
    // przetwarzamy ponownie (to właśnie jest ponowienie Svixa); inaczej nic.
    if (ingested.status !== "error" && ingested.status !== "pending") {
      return reply(200, { ok: true, duplicate: true, status: ingested.status });
    }
  }

  if (ingested.status === "ignored") return reply(200, { ok: true, status: "ignored", type });
  if (ingested.status === "orphan") {
    console.log("[resend-webhook] orphan:", type, "message:", messageId);
    return reply(200, { ok: true, status: "orphan", type });
  }

  // ── 4. Przetwarzanie (pending / error po ponowieniu) ────────────────────
  let legacyIds = Array.isArray(ingested.legacy_ids) ? ingested.legacy_ids : null;
  if (!legacyIds) {
    // duplikat w stanie pending/error: ingest nie oddaje legacy_ids — doczytaj powiązanie
    const { data: link, error: linkErr } = await supaSvc
      .from("legacy_send_messages")
      .select("legacy_ids")
      .eq("resend_message_id", messageId)
      .maybeSingle();
    if (linkErr) return reply(500, { error: "link_read_failed", retry: true });
    if (!link) return reply(200, { ok: true, status: "orphan", type });
    legacyIds = link.legacy_ids || [];
  }

  try {
    const result = await processKnownEvent({ supaSvc, env, eventId: svixId, type, legacyIds });
    return reply(200, { ok: true, message_id: messageId, type, ...result });
  } catch (e) {
    if (e instanceof RetryableEventError) {
      console.error("[resend-webhook] processing failed, retry:", e.message, e.detail);
      return reply(500, { error: e.message, detail: e.detail, retry: true });
    }
    console.error("[resend-webhook] unexpected:", e?.message || e);
    return reply(500, { error: "unexpected", retry: true });
  }
};

function lowerHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = v;
  return out;
}

// Do rejestru trafia to, co potrzebne do historii; bez treści i bez list adresów
// poza samym odbiorcą tej wiadomości (jest jeden — tak wysyłamy).
function scrubPayload(data) {
  if (!data || typeof data !== "object") return {};
  const { email_id, from, to, subject, created_at, click, bounce, tags } = data;
  return { email_id, from, to, subject, created_at, click, bounce, tags };
}

function reply(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
