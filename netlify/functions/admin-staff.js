/**
 * Netlify Function (format 2.0): admin-staff
 * POST /.netlify/functions/admin-staff   (JWT SUPER admina: profiles.role='admin' AND admin_level='super')
 *
 * Body: { action: "create" | "reset_pin" | "block" | "unblock" | "delete", ... }
 *   create:    { code, display_name?, event_date }
 *              → użytkownik Auth (app_metadata.role='staff' — jedyna droga nadania roli
 *                uprzywilejowanej) + wiersz fm_staff; PIN zwracany JEDEN RAZ
 *   reset_pin: { id }  → nowe hasło GoTrue, potem fm_staff_revoke_sessions (rotacja: stare
 *                        tokeny odrzucane przez is_staff(), tablet odpięty). Częściowy błąd → 500
 *                        z jasnym komunikatem (PIN nie jest zwracany; powtórz reset).
 *   block:     { id }  → FAIL-CLOSED: najpierw fm_staff_set_blocked(true) w bazie (blocked +
 *                        unieważnienie sesji, jedna transakcja) i sprawdzenie wyniku, potem ban w Auth.
 *                        Gdy ban zawiedzie — konto ZOSTAJE zablokowane w bazie, endpoint zwraca błąd.
 *   unblock:   { id }  → najpierw zdjęcie banu w Auth, potem fm_staff_set_blocked(false);
 *                        przy błędzie konto pozostaje zablokowane.
 *   delete:    { id }  → usuwa użytkownika Auth (kaskada: profiles → fm_staff)
 *
 * PIN nie jest nigdzie zapisywany ani logowany — hasło GoTrue to HMAC(pepper, kod:PIN).
 * [feat/fm-queue]
 */
import { createClient } from "@supabase/supabase-js";
import { CORS, bearer, envConfig, json, missingOf, readJson } from "./_shared/netlify-modern.js";
import { generatePin, normalizeStaffCode, staffEmailFor, staffPassword } from "./_shared/staff-auth.js";

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const cfg = envConfig();
  const missing = missingOf(cfg, ["supabaseUrl", "supabaseServiceRoleKey", "supabaseAnonKey"]);
  if (missing.length) return json(500, { error: `Brak konfiguracji: ${missing.join(", ")}` });
  if (!cfg.staffPinPepper || cfg.staffPinPepper.length < 32) return json(500, { error: "Brak konfiguracji STAFF_PIN_PEPPER (Netlify env, min. 32 znaki)." });

  // 1. Autoryzacja: SUPER admin
  const token = bearer(request);
  if (!token) return json(401, { error: "Brak nagłówka Authorization" });
  const supaUser = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return json(401, { error: "Nieprawidłowy token" });
  const svc = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, { auth: { persistSession: false } });
  const { data: caller } = await svc.from("profiles").select("role, admin_level").eq("id", userData.user.id).maybeSingle();
  if (caller?.role !== "admin" || caller?.admin_level !== "super") return json(403, { error: "Kontami obsługi zarządza tylko super administrator." });

  const body = await readJson(request);
  if (!body) return json(400, { error: "Niepoprawny JSON" });
  const action = String(body.action || "");

  if (action === "create") {
    const code = normalizeStaffCode(body.code);
    const eventDate = String(body.event_date || "").slice(0, 10);
    const displayName = String(body.display_name || "").trim().slice(0, 80) || null;
    if (!code || code.length < 3) return json(400, { error: "Kod operatora: min. 3 znaki (litery, cyfry, myślnik)." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return json(400, { error: "Podaj datę eventu (YYYY-MM-DD)." });
    const { data: exists } = await svc.from("fm_staff").select("id").eq("code", code).maybeSingle();
    if (exists) return json(409, { error: `Kod ${code} już istnieje.` });

    const pin = generatePin();
    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email: staffEmailFor(code),
      password: staffPassword(cfg.staffPinPepper, code, pin),
      email_confirm: true,
      app_metadata: { role: "staff", staff_code: code },   // rola uprzywilejowana TYLKO tędy
      user_metadata: { staff_code: code },
    });
    if (cErr || !created?.user) return json(500, { error: `Nie udało się utworzyć konta: ${cErr?.message || "?"}` });
    const uid = created.user.id;
    const { error: pErr } = await svc.from("profiles").upsert({ id: uid, email: staffEmailFor(code), role: "staff", name: displayName || code }, { onConflict: "id" });
    const { error: sErr } = pErr ? { error: pErr } : await svc.from("fm_staff").insert({
      id: uid, code, display_name: displayName, event_date: eventDate, pin_rotated_at: new Date().toISOString(),
    });
    if (sErr) {
      await svc.auth.admin.deleteUser(uid).catch(() => {});
      return json(500, { error: `Nie udało się zapisać obsługi: ${sErr.message}` });
    }
    return json(200, { id: uid, code, pin }); // PIN tylko tu, jeden raz
  }

  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Brak id konta obsługi." });
  const { data: staff } = await svc.from("fm_staff").select("id, code, blocked").eq("id", id).maybeSingle();
  if (!staff) return json(404, { error: "Nie znaleziono konta obsługi." });

  if (action === "reset_pin") {
    const pin = generatePin();
    const { error } = await svc.auth.admin.updateUserById(id, { password: staffPassword(cfg.staffPinPepper, staff.code, pin) });
    if (error) return json(500, { error: `Reset PIN nieudany: ${error.message}` });
    const { data: rev, error: rErr } = await svc.rpc("fm_staff_revoke_sessions", { p_user: id, p_rotate_pin: true });
    if (rErr) return json(500, { error: `Hasło zmienione, ale nie udało się unieważnić sesji (${rErr.message}). Powtórz „nowy PIN”.` });
    return json(200, { id, code: staff.code, pin, sessions_revoked: rev?.sessions_revoked ?? null });
  }

  if (action === "block") {
    // fail-closed: najpierw baza (blocked + sesje w jednej transakcji), dopiero potem Auth
    const { data: blk, error: bErr } = await svc.rpc("fm_staff_set_blocked", { p_user: id, p_blocked: true });
    if (bErr || !blk?.blocked) return json(500, { error: `Nie udało się zablokować konta w bazie: ${bErr?.message || "brak potwierdzenia"}.` });
    const { error: banErr } = await svc.auth.admin.updateUserById(id, { ban_duration: "87600h" });
    if (banErr) return json(500, { error: `Konto ZABLOKOWANE w bazie (sesje unieważnione: ${blk.sessions_revoked}), ale ban w Auth nie powiódł się: ${banErr.message}. Powtórz „zablokuj”.`, blocked: true });
    return json(200, { id, code: staff.code, blocked: true, sessions_revoked: blk.sessions_revoked });
  }

  if (action === "unblock") {
    // odblokowanie: najpierw Auth, potem baza; przy błędzie konto pozostaje zablokowane
    const { error: banErr } = await svc.auth.admin.updateUserById(id, { ban_duration: "none" });
    if (banErr) return json(500, { error: `Nie udało się zdjąć banu w Auth: ${banErr.message}. Konto pozostaje zablokowane.`, blocked: true });
    const { data: blk, error: bErr } = await svc.rpc("fm_staff_set_blocked", { p_user: id, p_blocked: false });
    if (bErr || blk?.blocked !== false) return json(500, { error: `Ban zdjęty w Auth, ale baza nadal blokuje konto: ${bErr?.message || "brak potwierdzenia"}. Powtórz „odblokuj”.`, blocked: true });
    return json(200, { id, code: staff.code, blocked: false });
  }

  if (action === "delete") {
    const { error } = await svc.auth.admin.deleteUser(id);
    if (error) return json(500, { error: `Usunięcie nieudane: ${error.message}` });
    return json(200, { id, deleted: true });
  }
  return json(400, { error: "Nieznana akcja." });
};
