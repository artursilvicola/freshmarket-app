// [fix/buyer-entry-seen] Walidacja żądania ręcznego potwierdzenia / cofnięcia odczytu
// (funkcja admin-confirm-send-read). Czysta logika — testowana bez bazy.

export const MANUAL_READ_TYPES = Object.freeze(["manual_phone", "manual_email", "manual_meeting"]);
const NOTE_MAX = 1000;

export function parseManualConfirmRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  const legacyId = Number(b.legacy_id);
  if (!Number.isInteger(legacyId) || legacyId <= 0) return { ok: false, error: "missing_legacy_id" };
  const action = b.action === "undo" ? "undo" : b.action === "confirm" ? "confirm" : null;
  if (!action) return { ok: false, error: "invalid_action" };
  if (action === "undo") return { ok: true, action, legacyId };
  if (!MANUAL_READ_TYPES.includes(b.read_type)) return { ok: false, error: "invalid_read_type" };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, NOTE_MAX) : "";
  return { ok: true, action, legacyId, readType: b.read_type, note };
}
