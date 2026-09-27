// [feat/free-credit-grants v3] Maszyna stanów formularza „Przyznaj bezpłatne kredyty” (admin).
// Czyste funkcje — bez Reacta — żeby dało się przetestować dokładnie scenariusz z review Codexa:
// żądanie w toku → próba edycji → utrata odpowiedzi → ponowienie z IDENTYCZNYM payloadem i kluczem.
//
// Zasady:
//  * klucz idempotencji powstaje przy otwarciu formularza i nigdy nie zmienia się w jego życiu;
//  * od chwili wysłania (busy) do rozstrzygnięcia pola są zablokowane — edycja jest ignorowana;
//  * przy wysyłce robimy snapshot payloadu (`sent`); po błędzie stan = locked i „Ponów”
//    wysyła DOKŁADNIE ten snapshot (nie bieżące pola), więc ten sam klucz nie może wyjść
//    z inną treścią;
//  * zamknięcie w stanie locked wymaga ostrzeżenia (wynik nieznany — sprawdź partie),
//    nowe otwarcie = nowy klucz, czyli nowa próba, nie „retry”.
import { addCalendarMonthsISO, businessTodayISO } from "./db.js";

export const GRANT_REASONS = ["promotion", "compensation", "gift", "registration", "other"];

export function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `grant-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function openGrantForm({ companyId = null, today = businessTodayISO(), key = newIdempotencyKey() } = {}) {
  return {
    key,
    companyIds: companyId ? [String(companyId)] : [],
    qty: 1,
    reason: "compensation",
    message: "",
    note: "",
    expiresAt: addCalendarMonthsISO(today, 3),
    expiresTouched: false,
    busy: false,
    locked: false,
    sent: null,      // snapshot payloadu ostatniej wysyłki
    error: null,     // 'mismatch' | 'failed' | null
  };
}

export function isEditable(state) {
  return !!state && !state.busy && !state.locked;
}

// Edycja pól; ignorowana, gdy formularz jest w toku lub zablokowany.
export function editGrantForm(state, patch) {
  if (!isEditable(state)) return state;
  const next = { ...state, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "expiresAt")) next.expiresTouched = true;
  return next;
}

export function addCompany(state, companyId) {
  if (!isEditable(state)) return state;
  const id = String(companyId || "").trim();
  if (!id || state.companyIds.includes(id)) return state;
  return { ...state, companyIds: [...state.companyIds, id] };
}

export function removeCompany(state, companyId) {
  if (!isEditable(state)) return state;
  return { ...state, companyIds: state.companyIds.filter((x) => x !== String(companyId)) };
}

export function parseQty(qty) {
  const n = Number.parseInt(String(qty), 10);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}

export function canSubmit(state) {
  return !!state && !state.busy && state.companyIds.length > 0 && parseQty(state.qty) !== null
    && GRANT_REASONS.includes(state.reason) && !!state.expiresAt;
}

// Payload do RPC. Domyślna data NIE jest wysyłana (null) — liczy ją baza w dniu przyznania.
export function buildPayload(state) {
  return {
    companyIds: [...state.companyIds],
    qty: parseQty(state.qty),
    reason: state.reason,
    message: state.message,
    note: state.note,
    expiresAt: state.expiresTouched ? state.expiresAt : null,
    idempotencyKey: state.key,
  };
}

// Start wysyłki: pierwsza próba robi snapshot; ponowienie (locked) używa snapshotu bez zmian.
export function submitStart(state) {
  if (!state || state.busy) return { state, payload: null };
  if (!state.locked && !canSubmit(state)) return { state, payload: null };
  const payload = state.sent || buildPayload(state);
  return { state: { ...state, busy: true, sent: payload, error: null }, payload };
}

export function submitFailed(state, { mismatch = false } = {}) {
  return { ...state, busy: false, locked: true, error: mismatch ? "mismatch" : "failed" };
}

export function submitSucceeded(state) {
  return { ...state, busy: false, locked: false, error: null };
}

// Czy zamknięcie formularza wymaga ostrzeżenia (wynik ostatniej wysyłki nieznany)?
export function closeNeedsWarning(state) {
  return !!state && (state.busy || (state.locked && state.error === "failed"));
}
