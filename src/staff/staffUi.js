// [feat/fm-queue] Wspólne drobiazgi UI panelu obsługi i tablicy (bez zależności od PreconnectFM).

export const C = {
  teal: "#0d9488", tealDark: "#0f766e", ink: "#0f172a", slate: "#475569", muted: "#94a3b8",
  line: "#e2e8f0", bg: "#f1f5f9", white: "#ffffff",
  green: "#059669", greenBg: "#ecfdf5", amber: "#d97706", amberBg: "#fffbeb", red: "#dc2626", redBg: "#fef2f2",
  blue: "#2563eb", blueBg: "#eff6ff",
};

export const MODE_LABEL = {
  closed: { pl: "ZAMKNIĘTE", en: "CLOSED", color: C.muted, bg: "#e2e8f0" },
  open: { pl: "OTWARTE", en: "OPEN", color: C.green, bg: C.greenBg },
  paused: { pl: "PRZERWA", en: "BREAK", color: C.amber, bg: C.amberBg },
  free_entry: { pl: "WOLNE WEJŚCIE", en: "WALK-IN", color: C.blue, bg: C.blueBg },
};

export const STATUS_LABEL = {
  planned: "zaplanowane", called: "wywołane", in_progress: "w trakcie", done: "zakończone",
  no_show: "nieobecny", skipped: "pominięte", cancelled: "anulowane",
  returned_waiting: "powrócił — czeka", returned_in_progress: "powrócił — w trakcie",
};

export function deviceId() {
  try {
    let id = localStorage.getItem("fm_device_id");
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
      localStorage.setItem("fm_device_id", id);
    }
    return id;
  } catch { return null; }
}

export function fmtElapsed(from) {
  if (!from) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// Podział pozycji tablicy na strony po równo (19 przy 10/stronę → 10/9, 28 → 10/9/9).
export function splitPages(items, perPage) {
  const n = items.length;
  if (n === 0) return [[]];
  const pages = Math.max(1, Math.ceil(n / perPage));
  const base = Math.floor(n / pages), extra = n % pages;
  const out = []; let i = 0;
  for (let p = 0; p < pages; p++) { const size = base + (p < extra ? 1 : 0); out.push(items.slice(i, i + size)); i += size; }
  return out;
}

export function humanFmError(e) {
  const code = e?.fmCode || e?.code || "";
  const map = {
    FM_CONFLICT: "Stan stanowiska zmienił się w międzyczasie — odświeżono.",
    FM_STATION_NOT_OPEN: "Stanowisko nie jest otwarte.",
    FM_STATION_BUSY: "Na stanowisku trwa spotkanie — najpierw je zakończ.",
    FM_STATION_BUSY_RETURNEE: "Trwa obsługa powracającego — najpierw ją zakończ.",
    FM_QUEUE_EMPTY: "Kolejka pusta — brak kolejnych zaplanowanych spotkań.",
    FM_NO_CALLED_MEETING: "Brak wywołanego spotkania.",
    FM_NO_ACTIVE_MEETING: "Brak aktywnego spotkania.",
    FM_NO_RETURNEE: "Brak obsługiwanego powracającego.",
    FM_RETURNEE_BARRIER: "Powracający może wejść dopiero po zakończeniu spotkania z bariery.",
    FM_BAD_STATUS: "Ta operacja nie pasuje do stanu spotkania.",
    FM_UNDO_EXPIRED: "Cofnięcie możliwe tylko do 30 s po operacji.",
    FM_UNDO_NOT_LAST: "Po tej operacji zaszło już coś innego — nie można cofnąć.",
    FM_NOT_ASSIGNED: "Nie masz przypisania do tej sieci.",
    FM_FORBIDDEN: "Brak uprawnień.",
    FM_AUTH_REQUIRED: "Sesja wygasła — zaloguj się ponownie.",
    FM_STATION_INACTIVE: "Stanowisko jest nieaktywne.",
    FM_NAME_REQUIRED: "Podaj nazwę firmy.",
    FM_NO_SCHEDULE: "Brak zatwierdzonego planu spotkań (fm_settings.schedule).",
  };
  return map[code] || e?.message || "Nieznany błąd.";
}
