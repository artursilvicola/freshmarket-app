/**
 * [feat/fm-queue] Wspólne helpery logowania obsługi eventu (rola `staff`).
 *
 * Konto obsługi = zwykły użytkownik Supabase Auth z syntetycznym e-mailem
 * `<kod>@obsluga.freshmarket.eu` (nic tam nie wysyłamy) i rolą `staff`.
 * PIN (6 cyfr) NIE jest hasłem wprost: hasło w Supabase = HMAC(pepper, kod:PIN).
 * Dzięki temu:
 *   • klient nigdy nie woła GoTrue z PIN-em (brute force bez peppera niemożliwy),
 *   • lockout i blokada admina egzekwowane po stronie funkcji (fm_staff),
 *   • PIN nie trafia do logów ani nie jest nigdzie przechowywany jawnie.
 *
 * Wymaga sekretu STAFF_PIN_PEPPER (Netlify env, ≥ 32 znaki losowe).
 */
import { createHmac } from "node:crypto";

export const STAFF_EMAIL_DOMAIN = "obsluga.freshmarket.eu";
export const STAFF_MAX_FAILED = 5;          // po tylu błędach → blokada czasowa
export const STAFF_LOCK_MINUTES = 15;

export function normalizeStaffCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

export function staffEmailFor(code) {
  return `${normalizeStaffCode(code).toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

export function isValidPin(pin) {
  return /^\d{6}$/.test(String(pin || ""));
}

export function generatePin() {
  // 6 cyfr, bez trywialnych ciągów (000000, 123456, 111111...)
  for (let i = 0; i < 50; i++) {
    const n = Math.floor(Math.random() * 1_000_000);
    const s = String(n).padStart(6, "0");
    if (/^(\d)\1{5}$/.test(s)) continue;
    if ("0123456789".includes(s) || "9876543210".includes(s)) continue;
    return s;
  }
  return "482913";
}

export function staffPassword(pepper, code, pin) {
  return createHmac("sha256", pepper).update(`${normalizeStaffCode(code)}:${pin}`).digest("base64url");
}

export function pepperFromEnv() {
  const p = process.env.STAFF_PIN_PEPPER || "";
  return p.length >= 32 ? p : null;
}
