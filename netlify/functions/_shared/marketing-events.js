/**
 * [feat/marketing-activation] Router zdarzeń Resend dla wiadomości marketingowych.
 *
 * Resend rozsyła KAŻDE zdarzenie domeny do każdego zarejestrowanego endpointu,
 * więc osobny endpoint nic nie izoluje. Izolacja jest tutaj: zdarzenie z tagiem
 * `kind=marketing` idzie do marketing_email_events i NIGDY nie trafia do
 * `ingest_legacy_send_email_event` ani do rozliczeń. Zdarzenie bez tagu (albo z innym
 * tagiem) przechodzi dotychczasową ścieżką bez żadnej zmiany.
 *
 * Cofnięcie modułu (brak RPC w bazie) nie może zepsuć webhooka: brak funkcji →
 * odpowiedź 200 „ignored”. Błąd PRZEJŚCIOWY (awaria bazy, timeout) → 5xx, żeby Svix
 * ponowił — odbicie/skarga nie mogą przepaść (review Codexa #3). Nadal nic nie idzie
 * do rozliczeń legacy.
 */
export function isMarketingEvent(payload) {
  const tags = payload?.data?.tags;
  if (!tags) return false;
  if (Array.isArray(tags)) return tags.some((t) => t && String(t.name) === "kind" && String(t.value) === "marketing");
  if (typeof tags === "object") return String(tags.kind) === "marketing";
  return false;
}

export async function ingestMarketingEvent({ supaSvc, eventId, messageId, type, occurredAt, payload }) {
  const { data, error } = await supaSvc.rpc("marketing_ingest_email_event", {
    p_event_id: eventId,
    p_resend_message_id: messageId,
    p_event_type: type,
    p_occurred_at: occurredAt || null,
    p_payload: payload || {},
  });
  if (error) {
    // [review Codexa #3] brak funkcji w bazie (moduł cofnięty) = trwałe → ignorujemy;
    // wszystko inne (sieć, timeout, awaria bazy) = przejściowe → webhook odpowie 5xx i Svix ponowi
    const missing = error.code === "PGRST202" || /could not find the function|does not exist|schema cache/i.test(String(error.message || ""));
    return { ok: false, missing, error: error.message };
  }
  return { ok: true, ...(data || {}) };
}
