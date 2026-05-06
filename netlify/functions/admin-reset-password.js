/**
 * Netlify Function: admin-reset-password
 * POST /.netlify/functions/admin-reset-password
 *
 * Body: {
 *   email: string,           // user do resetu
 *   new_password?: string,   // jesli podane: ustaw nowe haslo
 *   send_magic_link?: boolean // jesli true: wyslij magic link zamiast hasla
 * }
 *
 * Wymaga:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - SUPABASE_ANON_KEY (do weryfikacji JWT)
 *
 * Sprawdza JWT (admin) → znajduje user-a po email → admin.updateUserById z
 * nowym haslem (lub generuje magic link). Nie wymaga UI Supabase Dashboard.
 *
 * [B2B Round 2.4]
 */
import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY    = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return errJson(500, "Brak konfiguracji Supabase (URL + SERVICE_ROLE_KEY + ANON_KEY)");
  }

  // 1. Autoryzacja: caller musi byc admin
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return errJson(401, "Brak naglowka Authorization");
  const token = authHeader.slice(7);

  const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return errJson(401, "Nieprawidlowy token");

  const supaSvc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: caller, error: cErr } = await supaSvc
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (cErr || caller?.role !== "admin") return errJson(403, "Tylko admin moze resetowac hasla");

  // 2. Walidacja body
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return errJson(400, "Niepoprawny JSON"); }
  const { email, new_password, send_magic_link = false } = body;
  if (!email) return errJson(400, "Brak email");
  if (!new_password && !send_magic_link) {
    return errJson(400, "Podaj new_password ALBO send_magic_link=true");
  }

  // 3. Znajdz user-a po email (w auth.users — wymaga service role)
  // Supabase Auth Admin API: listUsers + filter, lub bezposrednio przez profiles.
  const { data: profile } = await supaSvc
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();
  if (!profile?.id) return errJson(404, "User nie znaleziony");

  // 4. Reset hasla LUB magic link
  if (new_password) {
    const { error: updErr } = await supaSvc.auth.admin.updateUserById(
      profile.id,
      { password: new_password }
    );
    if (updErr) return errJson(500, "Nie udalo sie zaktualizowac hasla: " + updErr.message);
    return okJson({ user_id: profile.id, email, password_reset: true });
  }

  // Magic link
  const { data: linkData, error: linkErr } = await supaSvc.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: process.env.B2B_APP_URL || "https://app.freshmarket.eu",
    },
  });
  if (linkErr) return errJson(500, "Magic link nie wygenerowany: " + linkErr.message);
  return okJson({
    user_id: profile.id,
    email,
    magic_link: linkData?.properties?.action_link || null,
  });
};

function okJson(p) { return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(p) }; }
function errJson(c, m) { return { statusCode: c, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: m }) }; }
