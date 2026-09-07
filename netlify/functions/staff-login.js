/**
 * Netlify Function (format 2.0): staff-login
 * POST /.netlify/functions/staff-login
 * Body: { code: "OBSLUGA-3", pin: "482913", device_id: "<uuid z tabletu>" }
 *
 * Logowanie obsługi eventu (rola `staff`) kodem operatora + 6-cyfrowym PIN-em.
 * Bez JWT (to jest logowanie). Zwraca sesję Supabase (access/refresh token),
 * którą klient ustawia przez supabase.auth.setSession().
 *
 * Kolejność:
 *   1. fm_staff_login_gate (service_role): zaufane IP z context.ip; limity ip+kod+urządzenie
 *      (10/15 min) i globalny IP (300/15 min); kod, blokada, lockout, dzień eventu,
 *      urządzenie; REZERWACJA próby → attempt_id (wygasa po 60 s bez rozliczenia).
 *      Równolegle dopuszczane tylko tyle prób, ile zostało do lockoutu (FM_BUSY).
 *   2. GoTrue signInWithPassword(hasło = HMAC(pepper, kod:PIN)).
 *   3. fm_staff_login_result(attempt_id, outcome): rozliczenie DOKŁADNIE tej próby:
 *        success             → licznik 0 + przypięcie tabletu w jednym UPDATE (drugi tablet → mismatch),
 *        invalid_credentials → licznik +1, 5. błędny PIN = lockout 15 min,
 *        system_error        → nic (awaria GoTrue/sieci NIE blokuje operatora).
 *      Gdy rozliczenie zawiedzie albo wykryje inne urządzenie — świeża sesja jest
 *      unieważniana i tokeny NIE są zwracane.
 *   PIN nigdy nie jest logowany ani zwracany. Komunikaty PL/EN wg Accept-Language.
 * [feat/fm-queue]
 */
import { createClient } from "@supabase/supabase-js";
import { CORS, envConfig, json, langOf, missingOf, readJson, trustedIp } from "./_shared/netlify-modern.js";
import { isValidPin, normalizeStaffCode, staffEmailFor, staffPassword } from "./_shared/staff-auth.js";

const MSG = {
  pl: {
    FM_BAD_INPUT: "Podaj kod operatora i 6-cyfrowy PIN.",
    FM_DEVICE_REQUIRED: "Brak identyfikatora urządzenia — odśwież stronę i spróbuj ponownie.",
    FM_BAD_CREDENTIALS: "Nieprawidłowy kod lub PIN.",
    FM_BLOCKED: "Konto obsługi jest zablokowane. Zgłoś się do organizatora.",
    FM_LOCKED: (s) => `Za dużo błędnych prób. Spróbuj ponownie za ${Math.ceil((s || 900) / 60)} min.`,
    FM_BUSY: "Trwa inna próba logowania na to konto. Odczekaj chwilę i spróbuj ponownie.",
    FM_RATE_LIMIT: "Za dużo prób z tego urządzenia. Odczekaj 15 minut.",
    FM_WRONG_DAY: (d) => `To konto działa tylko w dniu wydarzenia (${d}).`,
    FM_DEVICE_MISMATCH: "To konto jest przypisane do innego urządzenia. Poproś organizatora o reset PIN-u.",
    FM_SYSTEM_ERROR: "Chwilowy problem z logowaniem (serwer). Spróbuj ponownie za chwilę — próba nie została policzona.",
    FM_DB: "Błąd bazy przy logowaniu.",
    FM_NO_PEPPER: "Brak konfiguracji STAFF_PIN_PEPPER (Netlify env).",
  },
  en: {
    FM_BAD_INPUT: "Enter the operator code and the 6-digit PIN.",
    FM_DEVICE_REQUIRED: "Missing device identifier — reload the page and try again.",
    FM_BAD_CREDENTIALS: "Invalid code or PIN.",
    FM_BLOCKED: "This staff account is blocked. Contact the organiser.",
    FM_LOCKED: (s) => `Too many wrong attempts. Try again in ${Math.ceil((s || 900) / 60)} min.`,
    FM_BUSY: "Another login attempt for this account is in progress. Wait a moment and try again.",
    FM_RATE_LIMIT: "Too many attempts from this device. Wait 15 minutes.",
    FM_WRONG_DAY: (d) => `This account only works on the event day (${d}).`,
    FM_DEVICE_MISMATCH: "This account is bound to another device. Ask the organiser for a PIN reset.",
    FM_SYSTEM_ERROR: "Temporary login problem (server). Try again in a moment — the attempt was not counted.",
    FM_DB: "Database error during login.",
    FM_NO_PEPPER: "STAFF_PIN_PEPPER is not configured (Netlify env).",
  },
};
const msg = (lang, code, arg) => { const m = MSG[lang][code] || MSG[lang].FM_BAD_CREDENTIALS; return typeof m === "function" ? m(arg) : m; };
const STATUS = { FM_LOCKED: 423, FM_RATE_LIMIT: 423, FM_BUSY: 423, FM_BAD_CREDENTIALS: 401, FM_SYSTEM_ERROR: 503, FM_DB: 500 };

// GoTrue: 400 "Invalid login credentials" = zły PIN; wszystko inne (5xx, sieć, timeout) = awaria
function classifyAuthError(err) {
  if (!err) return "success";
  const status = Number(err.status || 0);
  const m = String(err.message || "");
  if (status === 400 || /invalid login credentials|invalid_credentials|invalid_grant/i.test(m)) return "invalid_credentials";
  return "system_error";
}

export default async (request, context) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const lang = langOf(request);

  const cfg = envConfig();
  const missing = missingOf(cfg, ["supabaseUrl", "supabaseServiceRoleKey", "supabaseAnonKey"]);
  if (missing.length) return json(500, { error: `Brak konfiguracji: ${missing.join(", ")}`, code: "FM_ENV" });
  if (!cfg.staffPinPepper || cfg.staffPinPepper.length < 32) return json(500, { error: msg(lang, "FM_NO_PEPPER"), code: "FM_NO_PEPPER" });

  const body = await readJson(request);
  if (!body) return json(400, { error: msg(lang, "FM_BAD_INPUT"), code: "FM_BAD_INPUT" });
  const code = normalizeStaffCode(body.code);
  const pin = String(body.pin || "");
  const deviceId = String(body.device_id || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  if (!code || !isValidPin(pin)) return json(400, { error: msg(lang, "FM_BAD_INPUT"), code: "FM_BAD_INPUT" });
  if (deviceId.length < 8) return json(400, { error: msg(lang, "FM_DEVICE_REQUIRED"), code: "FM_DEVICE_REQUIRED" });
  const ip = trustedIp(context);

  const svc = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, { auth: { persistSession: false } });

  // 1. bramka + rezerwacja próby
  const { data: gate, error: gErr } = await svc.rpc("fm_staff_login_gate", { p_code: code, p_ip: ip, p_device: deviceId });
  if (gErr || !gate) return json(503, { error: msg(lang, "FM_SYSTEM_ERROR"), code: "FM_SYSTEM_ERROR" });
  if (!gate.allowed) {
    const reason = gate.reason || "FM_BAD_CREDENTIALS";
    return json(STATUS[reason] || 403, { error: msg(lang, reason, gate.retry_after_s ?? gate.event_date), code: reason, retry_after_s: gate.retry_after_s ?? undefined });
  }
  const attemptId = gate.attempt_id;

  // 2. GoTrue — hasło pochodne, PIN nie opuszcza tej funkcji
  let auth = null, outcome;
  try {
    const anon = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await anon.auth.signInWithPassword({ email: staffEmailFor(code), password: staffPassword(cfg.staffPinPepper, code, pin) });
    auth = r.data;
    outcome = r.error ? classifyAuthError(r.error) : (r.data?.session ? "success" : "system_error");
  } catch {
    outcome = "system_error";
  }

  // 3. rozliczenie DOKŁADNIE tej próby
  const { data: res, error: rErr } = await svc.rpc("fm_staff_login_result", { p_attempt_id: attemptId, p_outcome: outcome, p_device: deviceId });
  const revoke = async () => { if (auth?.session?.access_token) await svc.auth.admin.signOut(auth.session.access_token, "local").catch(() => {}); };

  if (rErr) {
    // nie wiemy, czy próba została policzona — sesji nie oddajemy; rezerwacja wygaśnie po 60 s bez lockoutu
    await revoke();
    return json(503, { error: msg(lang, "FM_SYSTEM_ERROR"), code: "FM_SYSTEM_ERROR" });
  }
  if (outcome === "system_error") return json(503, { error: msg(lang, "FM_SYSTEM_ERROR"), code: "FM_SYSTEM_ERROR" });
  if (outcome === "invalid_credentials") {
    if (res?.locked) return json(423, { error: msg(lang, "FM_LOCKED", res.retry_after_s), code: "FM_LOCKED", retry_after_s: res.retry_after_s || 900 });
    return json(401, { error: msg(lang, "FM_BAD_CREDENTIALS"), code: "FM_BAD_CREDENTIALS", attempts_left: res?.attempts_left ?? undefined });
  }
  if (!res?.ok || res.device_id !== deviceId) {
    await revoke();
    const reason = res?.reason === "FM_DEVICE_MISMATCH" || (res?.ok && res.device_id !== deviceId) ? "FM_DEVICE_MISMATCH" : "FM_SYSTEM_ERROR";
    return json(reason === "FM_DEVICE_MISMATCH" ? 403 : 503, { error: msg(lang, reason), code: reason });
  }

  return json(200, {
    access_token: auth.session.access_token,
    refresh_token: auth.session.refresh_token,
    expires_at: auth.session.expires_at,
    staff: { id: gate.id, code: gate.code, display_name: gate.display_name },
  });
};
