/**
 * [feat/marketing-activation] Transport poczty dla wiadomości marketingowych +
 * token wypisu.
 *
 * Zasady:
 *  * ładunek jest ZAMROŻONY w marketing_messages (subject/html/text) — tutaj go
 *    tylko wysyłamy; `Idempotency-Key` = marketing_messages.idempotency_key.
 *    Resend wiąże klucz z ładunkiem na 24 h: ponowienie tej samej treści pod tym
 *    samym kluczem oddaje TĘ SAMĄ wiadomość (nie drugą). Inny ładunek pod tym
 *    samym kluczem = 409 → nie zgadujemy, oddajemy `uncertain` (ręczna kontrola).
 *  * tag `kind=marketing` + `campaign` — po nim webhook kieruje zdarzenia do
 *    marketing_email_events, NIGDY do rejestru rozliczeń.
 *  * nagłówki List-Unsubscribe + List-Unsubscribe-Post (one-click).
 *  * wynik: accepted (id Resend) | rejected (ładunek odrzucony: 400/401/403/404/422)
 *    | uncertain (timeout / 5xx / 429 / 409 / błąd sieci — dzierżawa pozwoli odzyskać).
 *  * transport jest wstrzykiwalny (`fetchImpl`) — testy używają atrapy; prawdziwa
 *    wysyłka tylko gdy MARKETING_SEND_ENABLED="true" (sprawdzane w funkcji, nie tu).
 *  * MARKETING_SEND_ALLOWLIST (próba 06.11): gdy lista niepusta, adres spoza listy NIE idzie
 *    do Resend — funkcja pomija go wcześniej (`skipped`), a tu jest druga zapora:
 *    `uncertain` + `allowlist_blocked` bez żadnego żądania (wiersz zostaje do odzyskania).
 */
import crypto from "node:crypto";

export const MARKETING_FROM = "Fresh Market <newsletter@freshmarket.eu>";
const REJECTED_STATUSES = new Set([400, 401, 403, 404, 422]);
const TIMEOUT_MS = 15_000;

export function unsubscribeToken(secret, messageId) {
  if (!secret || !messageId) throw new Error("unsubscribe_token_inputs");
  return crypto.createHmac("sha256", String(secret)).update(String(messageId)).digest("base64url");
}

export function verifyUnsubscribeToken(secret, messageId, token) {
  if (!secret || !messageId || !token) return false;
  const expected = unsubscribeToken(secret, messageId);
  const a = Buffer.from(String(token)), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubscribeUrl({ appUrl, messageId, secret }) {
  const base = String(appUrl || "https://b2b.freshmarket.eu").replace(/\/$/, "");
  return `${base}/.netlify/functions/marketing-unsubscribe?m=${encodeURIComponent(messageId)}&t=${encodeURIComponent(unsubscribeToken(secret, messageId))}`;
}

/** Czy lista dozwolonych adresów (MARKETING_SEND_ALLOWLIST) jest ustawiona (poprawna albo błędna). */
export function sendAllowlistActive(env) {
  return env?.marketingSendAllowlistInvalid === true || (Array.isArray(env?.marketingSendAllowlist) && env.marketingSendAllowlist.length > 0);
}

/** [review Codexa P1] lista ustawiona, ale błędna (wpis bez `@`) — blokuje wszystko. */
export function sendAllowlistInvalid(env) {
  return env?.marketingSendAllowlistInvalid === true;
}

/** true = adres może dostać pocztę (lista nieustawiona albo adres na POPRAWNEJ liście; porównanie trim + małe litery). */
export function allowedBySendAllowlist(env, email) {
  if (sendAllowlistInvalid(env)) return false;
  if (!sendAllowlistActive(env)) return true;
  const v = String(email || "").trim().toLowerCase();
  return !!v && env.marketingSendAllowlist.includes(v);
}

/** Lista dla RPC claim: null = bez ograniczenia; tablica = tylko te adresy (SQL nie dotyka reszty). */
export function claimAllowlistParam(env) {
  if (sendAllowlistInvalid(env)) return [];
  return sendAllowlistActive(env) ? env.marketingSendAllowlist.slice() : null;
}

export function payloadHash({ subject, html, text }) {
  return crypto.createHash("sha256").update(`${subject}\n${html}\n${text}`).digest("hex");
}

/**
 * @param {object} a
 * @param {object} a.env            resendApiKey
 * @param {object} a.message        { id, to_email, subject, html, text_body, idempotency_key, campaign_id, locale }
 * @param {string} a.unsubscribeUrl
 * @param {string} [a.replyTo]
 * @param {Function} [a.fetchImpl]  domyślnie globalThis.fetch
 * @returns {Promise<{status:'accepted'|'rejected'|'uncertain', id?:string, error?:string, httpStatus?:number}>}
 */
export async function sendMarketingMail({ env, message, unsubscribeUrl: unsub, replyTo, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!env?.resendApiKey) return { status: "uncertain", error: "no_resend_key" };
  if (!unsub) return { status: "rejected", error: "unsubscribe_url_missing" };
  if (sendAllowlistInvalid(env)) return { status: "uncertain", error: "allowlist_invalid" };
  if (!allowedBySendAllowlist(env, message?.to_email)) return { status: "uncertain", error: "allowlist_blocked" };
  const body = {
    from: MARKETING_FROM,
    to: [message.to_email],
    subject: message.subject,
    html: message.html,
    text: message.text_body,
    reply_to: replyTo || undefined,
    tags: [{ name: "kind", value: "marketing" }, { name: "campaign", value: String(message.campaign_id || "") }],
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  let res;
  try {
    res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotency_key },
      body: JSON.stringify(body),
      signal: ctrl?.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { status: "uncertain", error: `network:${e?.name || "error"}` };
  }
  if (timer) clearTimeout(timer);
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (res.ok) {
    const id = data?.id ? String(data.id) : null;
    return id ? { status: "accepted", id, httpStatus: res.status } : { status: "uncertain", error: "accepted_without_id", httpStatus: res.status };
  }
  if (REJECTED_STATUSES.has(res.status)) return { status: "rejected", error: `resend_${res.status}:${String(data?.message || data?.name || "").slice(0, 200)}`, httpStatus: res.status };
  // 409 (ten sam klucz, inny ładunek — nie powinno się zdarzyć przy zamrożonej treści), 429, 5xx
  return { status: "uncertain", error: `resend_${res.status}:${String(data?.message || data?.name || "").slice(0, 200)}`, httpStatus: res.status };
}
