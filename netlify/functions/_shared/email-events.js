/**
 * Rejestr zdarzeń Resend + powiązanie wiadomość ↔ odbiorca.
 * Migracja 20261022120000_email_open_history.sql.
 *
 * Zasady:
 *  - zdarzenie najpierw ZAPISUJEMY (deduplikacja po svix-id), dopiero potem
 *    przetwarzamy; powtórka webhooka nie dubluje historii ani rozliczenia;
 *  - zdarzenie o wiadomości, której jeszcze nie powiązaliśmy, czeka jako `orphan`
 *    i wraca do kolejki, gdy `record_legacy_send_message` zapisze powiązanie;
 *  - `email.opened` rozlicza WYŁĄCZNIE propozycje zawarte w tej wiadomości
 *    (legacy_ids z powiązania), przez istniejące `mark_legacy_send_seen` —
 *    jedna propozycja do jednej sieci = najwyżej jedno pobranie kredytu.
 */

import { markLegacySendsSeen } from "./legacy-send-seen.js";

export const RESEND_EVENT_TYPES = new Set([
  "email.sent", "email.delivered", "email.opened", "email.clicked",
  "email.bounced", "email.complained", "email.delivery_delayed",
]);

// Błąd, po którym webhook ma odpowiedzieć 5xx, żeby Svix ponowił dostawę.
export class RetryableEventError extends Error {
  constructor(message, detail) { super(message); this.name = "RetryableEventError"; this.detail = detail; }
}

export async function ingestResendEvent({ supaSvc, eventId, messageId, type, occurredAt, payload }) {
  const { data, error } = await supaSvc.rpc("ingest_legacy_send_email_event", {
    p_event_id: eventId,
    p_resend_message_id: messageId,
    p_event_type: type,
    p_occurred_at: occurredAt || null,
    p_payload: payload || {},
  });
  if (error) throw new RetryableEventError("ingest_failed", error.message);
  return data || {};
}

async function finishEvent(supaSvc, eventId, status, result, errorText) {
  const { error } = await supaSvc.rpc("finish_legacy_send_email_event", {
    p_event_id: eventId, p_status: status, p_result: result ?? null, p_error: errorText ?? null,
  });
  return error ? error.message : null;
}

/**
 * Przetwarza JEDNO zapisane zdarzenie o znanej wiadomości.
 * Zwraca { status, ... }. Rzuca RetryableEventError, gdy rozliczenie padło
 * przejściowo — wtedy wołający odpowiada 5xx i Svix ponowi (ingest zobaczy
 * duplikat, a mark_legacy_send_seen jest idempotentne).
 */
export async function processKnownEvent({ supaSvc, env, eventId, type, legacyIds }) {
  if (type !== "email.opened") {
    // dostarczenie, odbicie, skarga, kliknięcie — tylko historia
    const finishErr = await finishEvent(supaSvc, eventId, "processed", { history_only: true });
    if (finishErr) throw new RetryableEventError("finish_failed", finishErr);
    return { status: "processed", history_only: true };
  }

  const ids = (legacyIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) {
    const finishErr = await finishEvent(supaSvc, eventId, "processed", { no_legacy_ids: true });
    if (finishErr) throw new RetryableEventError("finish_failed", finishErr);
    return { status: "processed", no_legacy_ids: true };
  }

  let result;
  try {
    result = await markLegacySendsSeen({ supaSvc, env, legacyIds: ids, channel: "email", notifySupplier: true });
  } catch (e) {
    const msg = e?.message || String(e);
    await finishEvent(supaSvc, eventId, "error", null, msg);
    throw new RetryableEventError("seen_failed", msg);
  }

  const rows = result?.results || [];
  const errors = rows.filter((r) => r.status === "error");
  const summary = {
    legacy_ids: ids,
    results: rows.map((r) => ({
      legacy_id: r.legacy_id, status: r.status, reason: r.reason,
      billing: r.billing ? { charged: r.billing.charged, alreadyCharged: !!r.billing.alreadyCharged, status: r.billing.billingStatus } : undefined,
    })),
    notification: result?.notificationSummary ? { status: result.notificationSummary.status } : null,
  };
  if (errors.length) {
    // Część wierszy nie rozliczyła się przejściowo (np. 40001 z pakietu). Zostawiamy
    // zdarzenie do ponowienia; wiersze już rozliczone są chronione znacznikiem.
    const msg = errors.map((r) => `${r.legacy_id}: ${r.reason}`).join("; ");
    await finishEvent(supaSvc, eventId, "error", summary, msg);
    throw new RetryableEventError("partial_failure", msg);
  }
  const finishErr = await finishEvent(supaSvc, eventId, "processed", summary);
  if (finishErr) throw new RetryableEventError("finish_failed", finishErr);
  return { status: "processed", ...summary };
}

/**
 * Po zapisaniu powiązania wiadomości: przetwarza zdarzenia, które przyszły
 * wcześniej (sieroty wrócone do `pending`). Błędy NIE wywracają wysyłki —
 * raportujemy je, a zdarzenie zostaje w `error` do ponowienia przez webhook/sweep.
 */
export async function processPendingEvents({ supaSvc, env, legacyIds, pendingEvents }) {
  const out = [];
  for (const ev of pendingEvents || []) {
    try {
      const r = await processKnownEvent({ supaSvc, env, eventId: ev.event_id, type: ev.event_type, legacyIds });
      out.push({ event_id: ev.event_id, event_type: ev.event_type, ...r });
    } catch (e) {
      out.push({ event_id: ev.event_id, event_type: ev.event_type, status: "error", error: e?.detail || e?.message || String(e) });
    }
  }
  return out;
}

/** Zapis powiązania po akceptacji przez Resend. Nigdy nie wysyła ponownie. */
export async function recordSendMessage({ supaSvc, messageId, retailerId, buyerProfileId, toEmail, legacyIds, sentAt, sendKey, locale }) {
  const { data, error } = await supaSvc.rpc("record_legacy_send_message", {
    p_resend_message_id: messageId,
    p_retailer_id: retailerId,
    p_buyer_profile_id: buyerProfileId || null,
    p_to_email: toEmail,
    p_legacy_ids: legacyIds,
    p_sent_at: sentAt || new Date().toISOString(),
    p_send_key: sendKey || null,
    p_locale: locale || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data || {}) };
}
