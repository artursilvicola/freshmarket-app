/**
 * Netlify Function: staff-login
 * POST /.netlify/functions/staff-login
 * Body: { code: "OBSLUGA-3", pin: "482913", device_id?: string }
 *
 * Logowanie obsługi eventu (rola `staff`) kodem operatora + 6-cyfrowym PIN-em.
 * Bez JWT (to jest logowanie). Zwraca sesję Supabase (access/refresh token),
 * którą klient ustawia przez supabase.auth.setSession().
 *
 * Bezpieczeństwo:
 *   • hasło GoTrue = HMAC(STAFF_PIN_PEPPER, kod:PIN) — patrz _shared/staff-auth.js,
 *   • lockout: 5 nieudanych prób → 15 min (fm_staff.failed_logins / locked_until),
 *   • blokada admina (fm_staff.blocked) i konto nieaktywne → 403,
 *   • PIN nigdy nie jest logowany ani zwracany.
 *
 * [feat/fm-queue]
 */
import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import {
  STAFF_LOCK_MINUTES, STAFF_MAX_FAILED, isValidPin, normalizeStaffCode, pepperFromEnv, staffEmailFor, staffPassword,
} from "./_shared/staff-auth.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return errJson(405, "Method not allowed");

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "supabaseAnonKey"]);
  if (missing.length) return errJson(500, envErrorPayload("staff-login", missing));
  const pepper = pepperFromEnv();
  if (!pepper) return errJson(500, { error: "Brak konfiguracji STAFF_PIN_PEPPER (Netlify env)." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return errJson(400, "Niepoprawny JSON"); }
  const code = normalizeStaffCode(body.code);
  const pin = String(body.pin || "");
  const deviceId = String(body.device_id || "").slice(0, 64) || null;
  if (!code || !isValidPin(pin)) return errJson(400, { error: "Podaj kod operatora i 6-cyfrowy PIN.", code: "FM_BAD_INPUT" });

  const svc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: staff, error: sErr } = await svc.from("fm_staff")
    .select("id, code, display_name, kind, active, blocked, failed_logins, locked_until, device_id")
    .eq("code", code).maybeSingle();
  if (sErr) return errJson(500, { error: "Błąd bazy przy logowaniu.", code: "FM_DB" });

  // Nie zdradzamy, czy kod istnieje — ten sam komunikat co zły PIN.
  if (!staff) return errJson(401, { error: "Nieprawidłowy kod lub PIN.", code: "FM_BAD_CREDENTIALS" });
  if (staff.blocked || !staff.active) return errJson(403, { error: "Konto obsługi jest zablokowane. Zgłoś się do organizatora.", code: "FM_BLOCKED" });
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    const secs = Math.max(1, Math.round((new Date(staff.locked_until) - Date.now()) / 1000));
    return errJson(423, { error: `Za dużo prób. Spróbuj ponownie za ${Math.ceil(secs / 60)} min.`, code: "FM_LOCKED", retry_after_s: secs });
  }
  if (staff.device_id && deviceId && staff.device_id !== deviceId) {
    return errJson(403, { error: "To konto jest przypisane do innego urządzenia.", code: "FM_DEVICE_MISMATCH" });
  }

  const anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: aErr } = await anon.auth.signInWithPassword({
    email: staffEmailFor(code),
    password: staffPassword(pepper, code, pin),
  });

  if (aErr || !auth?.session) {
    const failed = Number(staff.failed_logins || 0) + 1;
    const patch = { failed_logins: failed };
    if (failed >= STAFF_MAX_FAILED) {
      patch.locked_until = new Date(Date.now() + STAFF_LOCK_MINUTES * 60_000).toISOString();
      patch.failed_logins = 0;
    }
    await svc.from("fm_staff").update(patch).eq("id", staff.id);
    if (patch.locked_until) {
      return errJson(423, { error: `Za dużo prób. Spróbuj ponownie za ${STAFF_LOCK_MINUTES} min.`, code: "FM_LOCKED", retry_after_s: STAFF_LOCK_MINUTES * 60 });
    }
    return errJson(401, { error: "Nieprawidłowy kod lub PIN.", code: "FM_BAD_CREDENTIALS", attempts_left: STAFF_MAX_FAILED - failed });
  }

  await svc.from("fm_staff").update({
    failed_logins: 0, locked_until: null, last_login_at: new Date().toISOString(),
    ...(deviceId && !staff.device_id ? { device_id: deviceId } : {}),
  }).eq("id", staff.id);

  return okJson({
    access_token: auth.session.access_token,
    refresh_token: auth.session.refresh_token,
    expires_at: auth.session.expires_at,
    staff: { id: staff.id, code: staff.code, display_name: staff.display_name, kind: staff.kind },
  });
};

function okJson(p) { return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(p) }; }
function errJson(c, m) { return { statusCode: c, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(typeof m === "string" ? { error: m } : m) }; }
