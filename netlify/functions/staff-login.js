/**
 * Netlify Function: staff-login
 * POST /.netlify/functions/staff-login
 * Body: { code: "OBSLUGA-3", pin: "482913", device_id: "<uuid z tabletu>" }
 *
 * Logowanie obsługi eventu (rola `staff`) kodem operatora + 6-cyfrowym PIN-em.
 * Bez JWT (to jest logowanie). Zwraca sesję Supabase (access/refresh token),
 * którą klient ustawia przez supabase.auth.setSession().
 *
 * Kolejność:
 *   1. fm_staff_login_gate (service_role): limit per IP, kod istnieje, blokada,
 *      lockout, konto ważne TYLKO w dniu eventu (Europe/Warsaw), urządzenie
 *      wymagane i zgodne z przypiętym.
 *   2. GoTrue signInWithPassword(hasło = HMAC(pepper, kod:PIN)).
 *   3. fm_staff_login_result (service_role): atomowy licznik/lockout,
 *      przypięcie urządzenia przy pierwszym logowaniu.
 *   PIN nigdy nie jest logowany ani zwracany. Komunikaty PL/EN wg Accept-Language.
 * [feat/fm-queue]
 */
import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { clientIp, isValidPin, normalizeStaffCode, pepperFromEnv, staffEmailFor, staffPassword } from "./_shared/staff-auth.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Accept-Language",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MSG = {
  pl: {
    FM_BAD_INPUT: "Podaj kod operatora i 6-cyfrowy PIN.",
    FM_DEVICE_REQUIRED: "Brak identyfikatora urządzenia — odśwież stronę i spróbuj ponownie.",
    FM_BAD_CREDENTIALS: "Nieprawidłowy kod lub PIN.",
    FM_BLOCKED: "Konto obsługi jest zablokowane. Zgłoś się do organizatora.",
    FM_LOCKED: (s) => `Za dużo prób. Spróbuj ponownie za ${Math.ceil(s / 60)} min.`,
    FM_RATE_LIMIT: "Za dużo prób z tego urządzenia/sieci. Odczekaj 15 minut.",
    FM_WRONG_DAY: (d) => `To konto działa tylko w dniu wydarzenia (${d}).`,
    FM_DEVICE_MISMATCH: "To konto jest przypisane do innego urządzenia. Poproś organizatora o reset PIN-u.",
    FM_DB: "Błąd bazy przy logowaniu.",
    FM_NO_PEPPER: "Brak konfiguracji STAFF_PIN_PEPPER (Netlify env).",
  },
  en: {
    FM_BAD_INPUT: "Enter the operator code and the 6-digit PIN.",
    FM_DEVICE_REQUIRED: "Missing device identifier — reload the page and try again.",
    FM_BAD_CREDENTIALS: "Invalid code or PIN.",
    FM_BLOCKED: "This staff account is blocked. Contact the organiser.",
    FM_LOCKED: (s) => `Too many attempts. Try again in ${Math.ceil(s / 60)} min.`,
    FM_RATE_LIMIT: "Too many attempts from this device/network. Wait 15 minutes.",
    FM_WRONG_DAY: (d) => `This account only works on the event day (${d}).`,
    FM_DEVICE_MISMATCH: "This account is bound to another device. Ask the organiser for a PIN reset.",
    FM_DB: "Database error during login.",
    FM_NO_PEPPER: "STAFF_PIN_PEPPER is not configured (Netlify env).",
  },
};
const msg = (lang, code, arg) => { const m = MSG[lang][code] || MSG[lang].FM_BAD_CREDENTIALS; return typeof m === "function" ? m(arg) : m; };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return errJson(405, { error: "Method not allowed" });
  const lang = /^en/i.test(String(event.headers["accept-language"] || event.headers["Accept-Language"] || "")) ? "en" : "pl";

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "supabaseAnonKey"]);
  if (missing.length) return errJson(500, envErrorPayload("staff-login", missing));
  const pepper = pepperFromEnv();
  if (!pepper) return errJson(500, { error: msg(lang, "FM_NO_PEPPER"), code: "FM_NO_PEPPER" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return errJson(400, { error: msg(lang, "FM_BAD_INPUT"), code: "FM_BAD_INPUT" }); }
  const code = normalizeStaffCode(body.code);
  const pin = String(body.pin || "");
  const deviceId = String(body.device_id || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  if (!code || !isValidPin(pin)) return errJson(400, { error: msg(lang, "FM_BAD_INPUT"), code: "FM_BAD_INPUT" });
  if (deviceId.length < 8) return errJson(400, { error: msg(lang, "FM_DEVICE_REQUIRED"), code: "FM_DEVICE_REQUIRED" });
  const ip = clientIp(event);

  const svc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });

  // 1. bramka w bazie (limit IP, blokada, lockout, dzień eventu, urządzenie)
  const { data: gate, error: gErr } = await svc.rpc("fm_staff_login_gate", { p_code: code, p_ip: ip, p_device: deviceId });
  if (gErr || !gate) return errJson(500, { error: msg(lang, "FM_DB"), code: "FM_DB" });
  if (!gate.allowed) {
    const status = gate.reason === "FM_LOCKED" || gate.reason === "FM_RATE_LIMIT" ? 423 : gate.reason === "FM_BAD_CREDENTIALS" ? 401 : 403;
    return errJson(status, { error: msg(lang, gate.reason, gate.retry_after_s ?? gate.event_date), code: gate.reason, retry_after_s: gate.retry_after_s ?? undefined });
  }

  // 2. GoTrue — hasło pochodne, PIN nie opuszcza tej funkcji
  const anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: aErr } = await anon.auth.signInWithPassword({ email: staffEmailFor(code), password: staffPassword(pepper, code, pin) });
  const success = Boolean(!aErr && auth?.session);

  // 3. atomowy wynik (licznik/lockout/urządzenie)
  const { data: res } = await svc.rpc("fm_staff_login_result", { p_code: code, p_ip: ip, p_success: success, p_device: deviceId });
  if (!success) {
    if (res?.locked) return errJson(423, { error: msg(lang, "FM_LOCKED", res.retry_after_s || 900), code: "FM_LOCKED", retry_after_s: res.retry_after_s || 900 });
    return errJson(401, { error: msg(lang, "FM_BAD_CREDENTIALS"), code: "FM_BAD_CREDENTIALS", attempts_left: res?.attempts_left ?? undefined });
  }

  return okJson({
    access_token: auth.session.access_token,
    refresh_token: auth.session.refresh_token,
    expires_at: auth.session.expires_at,
    staff: { id: gate.id, code: gate.code, display_name: gate.display_name },
  });
};

function okJson(p) { return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(p) }; }
function errJson(c, m) { return { statusCode: c, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(m) }; }
