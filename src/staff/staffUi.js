// [feat/fm-queue] Wspólne drobiazgi UI panelu obsługi i tablicy (bez zależności od PreconnectFM).
import { STAFF_DICT, fmErrorText, pickLang } from "./staffI18n";

export const C = {
  teal: "#0d9488", tealDark: "#0f766e", ink: "#0f172a", slate: "#475569", muted: "#94a3b8",
  line: "#e2e8f0", bg: "#f1f5f9", white: "#ffffff",
  green: "#059669", greenBg: "#ecfdf5", amber: "#d97706", amberBg: "#fffbeb", red: "#dc2626", redBg: "#fef2f2",
  blue: "#2563eb", blueBg: "#eff6ff",
};

// Etykiety trybów: zawsze obie wersje (tablica pokazuje PL / EN równocześnie)
export const MODE_LABEL = {
  closed: { pl: STAFF_DICT.pl.mode.closed, en: STAFF_DICT.en.mode.closed, color: C.muted, bg: "#e2e8f0" },
  open: { pl: STAFF_DICT.pl.mode.open, en: STAFF_DICT.en.mode.open, color: C.green, bg: C.greenBg },
  paused: { pl: STAFF_DICT.pl.mode.paused, en: STAFF_DICT.en.mode.paused, color: C.amber, bg: C.amberBg },
  free_entry: { pl: STAFF_DICT.pl.mode.free_entry, en: STAFF_DICT.en.mode.free_entry, color: C.blue, bg: C.blueBg },
};

export const statusLabel = (lang, s) => STAFF_DICT[pickLang(lang)].status[s] || s;

// Identyfikator urządzenia (tablet) — wymagany przy logowaniu obsługi, przypinany do konta.
export function deviceId() {
  try {
    let id = localStorage.getItem("fm_device_id");
    if (!id || id.length < 8) {
      id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
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

export function humanFmError(e, lang = "pl") { return fmErrorText(lang, e); }
