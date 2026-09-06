/**
 * Netlify Function: admin-staff
 * POST /.netlify/functions/admin-staff   (JWT SUPER admina: profiles.role='admin' AND admin_level='super')
 *
 * Body: { action: "create" | "reset_pin" | "block" | "unblock" | "delete", ... }
 *   create:    { code, display_name?, event_date }
 *              → użytkownik Auth (app_metadata.role='staff' — jedyna droga nadania roli
 *                uprzywilejowanej, patrz handle_new_user) + wiersz fm_staff; PIN zwracany JEDEN RAZ
 *   reset_pin: { id }  → nowy PIN (raz), unieważnienie wszystkich sesji, odpięcie urządzenia,
 *                        pin_rotated_at (stare tokeny odrzucane przez is_staff()), kasuje lockout
 *   block:     { id }  → fm_staff.blocked=true + ban w Auth + unieważnienie sesji
 *   unblock:   { id }
 *   delete:    { id }  → usuwa użytkownika Auth (kaskada: profiles → fm_staff)
 *
 * PIN nie jest nigdzie zapisywany ani logowany — hasło GoTrue to HMAC(pepper, kod:PIN).
 * [feat/fm-queue]
 */
import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { generatePin, normalizeStaffCode, pepperFromEnv, staffEmailFor, staffPassword } from "./_shared/staff-auth.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return errJson(405, "Method not allowed");

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "supabaseAnonKey"]);
  if (missing.length) return errJson(500, envErrorPayload("admin-staff", missing));
  const pepper = pepperFromEnv();
  if (!pepper) return errJson(500, { error: "Brak konfiguracji STAFF_PIN_PEPPER (Netlify env, min. 32 znaki)." });

  // 1. Autoryzacja: SUPER admin
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return errJson(401, "Brak nagłówka Authorization");
  const token = authHeader.slice(7);
  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return errJson(401, "Nieprawidłowy token");
  const svc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
  const { data: caller } = await svc.from("profiles").select("role, admin_level").eq("id", userData.user.id).maybeSingle();
  if (caller?.role !== "admin" || caller?.admin_level !== "super") return errJson(403, "Kontami obsługi zarządza tylko super administrator.");

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return errJson(400, "Niepoprawny JSON"); }
  const action = String(body.action || "");

  if (action === "create") {
    const code = normalizeStaffCode(body.code);
    const eventDate = String(body.event_date || "").slice(0, 10);
    const displayName = String(body.display_name || "").trim().slice(0, 80) || null;
    if (!code || code.length < 3) return errJson(400, "Kod operatora: min. 3 znaki (litery, cyfry, myślnik).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return errJson(400, "Podaj datę eventu (YYYY-MM-DD).");
    const { data: exists } = await svc.from("fm_staff").select("id").eq("code", code).maybeSingle();
    if (exists) return errJson(409, `Kod ${code} już istnieje.`);

    const pin = generatePin();
    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email: staffEmailFor(code),
      password: staffPassword(pepper, code, pin),
      email_confirm: true,
      app_metadata: { role: "staff", staff_code: code },   // rola uprzywilejowana TYLKO tędy
      user_metadata: { staff_code: code },
    });
    if (cErr || !created?.user) return errJson(500, `Nie udało się utworzyć konta: ${cErr?.message || "?"}`);
    const uid = created.user.id;

    // profil zakłada trigger handle_new_user (z app_metadata); dopinamy defensywnie
    await svc.from("profiles").upsert({ id: uid, email: staffEmailFor(code), role: "staff", name: displayName || code }, { onConflict: "id" });
    const { error: sErr } = await svc.from("fm_staff").insert({
      id: uid, code, display_name: displayName, event_date: eventDate, pin_rotated_at: new Date().toISOString(),
    });
    if (sErr) {
      await svc.auth.admin.deleteUser(uid).catch(() => {});
      return errJson(500, `Nie udało się zapisać obsługi: ${sErr.message}`);
    }
    return okJson({ id: uid, code, pin }); // PIN tylko tu, jeden raz
  }

  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errJson(400, "Brak id konta obsługi.");
  const { data: staff } = await svc.from("fm_staff").select("id, code").eq("id", id).maybeSingle();
  if (!staff) return errJson(404, "Nie znaleziono konta obsługi.");

  if (action === "reset_pin") {
    const pin = generatePin();
    const { error } = await svc.auth.admin.updateUserById(id, { password: staffPassword(pepper, staff.code, pin) });
    if (error) return errJson(500, `Reset PIN nieudany: ${error.message}`);
    const { data: rev, error: rErr } = await svc.rpc("fm_staff_revoke_sessions", { p_user: id, p_rotate_pin: true });
    if (rErr) return errJson(500, `PIN zmieniony, ale nie udało się unieważnić sesji: ${rErr.message}`);
    return okJson({ id, code: staff.code, pin, sessions_revoked: rev?.sessions_revoked ?? null });
  }
  if (action === "block" || action === "unblock") {
    const blocked = action === "block";
    const { error } = await svc.auth.admin.updateUserById(id, { ban_duration: blocked ? "87600h" : "none" });
    if (error) return errJson(500, `Zmiana blokady nieudana: ${error.message}`);
    await svc.from("fm_staff").update({ blocked }).eq("id", id);
    if (blocked) await svc.rpc("fm_staff_revoke_sessions", { p_user: id, p_rotate_pin: false });
    return okJson({ id, code: staff.code, blocked });
  }
  if (action === "delete") {
    const { error } = await svc.auth.admin.deleteUser(id);
    if (error) return errJson(500, `Usunięcie nieudane: ${error.message}`);
    return okJson({ id, deleted: true });
  }
  return errJson(400, "Nieznana akcja.");
};

function okJson(p) { return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(p) }; }
function errJson(c, m) { return { statusCode: c, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(typeof m === "string" ? { error: m } : m) }; }
