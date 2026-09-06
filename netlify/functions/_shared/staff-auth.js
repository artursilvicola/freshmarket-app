/**
 * [feat/fm-queue] Wspólne helpery logowania obsługi eventu (rola `staff`).
 *
 * Konto obsługi = użytkownik Supabase Auth z syntetycznym e-mailem
 * `<kod>@obsluga.freshmarket.eu` (nic tam nie wysyłamy), rola `staff` nadana
 * przez app_metadata (tylko service_role może je ustawić — handle_new_user
 * ignoruje role uprzywilejowane z user_metadata).
 * PIN (6 cyfr) NIE jest hasłem wprost: hasło GoTrue = HMAC(pepper, kod:PIN).
 *   • klient nigdy nie woła GoTrue z PIN-em (brute force bez peppera niemożliwy),
 *   • lockout, limit per IP, data eventu i urządzenie egzekwowane w bazie
 *     (fm_staff_login_gate / fm_staff_login_result, atomowe UPDATE),
 *   • PIN nie trafia do logów ani nie jest nigdzie przechowywany.
 *
 * Wymaga sekretu STAFF_PIN_PEPPER (Netlify env, ≥ 32 znaki losowe).
 */
import { createHmac, randomInt } from "node:crypto";

export const STAFF_EMAIL_DOMAIN = "obsluga.freshmarket.eu";

export function normalizeStaffCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

export function staffEmailFor(code) {
  return `${normalizeStaffCode(code).toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

export function isValidPin(pin) {
  return /^\d{6}$/.test(String(pin || ""));
}

// Kryptograficznie losowy PIN bez trywialnych ciągów (000000, 123456, 111111, 654321…).
export function generatePin() {
  for (;;) {
    const s = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (/^(\d)\1{5}$/.test(s)) continue;
    if ("0123456789".includes(s) || "9876543210".includes(s)) continue;
    if (/^(\d\d)\1\1$/.test(s)) continue; // 121212
    return s;
  }
}

export function staffPassword(pepper, code, pin) {
  return createHmac("sha256", pepper).update(`${normalizeStaffCode(code)}:${pin}`).digest("base64url");
}

export function pepperFromEnv() {
  const p = process.env.STAFF_PIN_PEPPER || "";
  return p.length >= 32 ? p : null;
}

export function clientIp(event) {
  const h = event.headers || {};
  const raw = h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || h["client-ip"] || "";
  return String(raw).split(",")[0].trim().slice(0, 64) || null;
}
