/**
 * Netlify Function: admin-create-user
 * POST /.netlify/functions/admin-create-user
 *
 * Body: {
 *   email: string,
 *   role: 'admin' | 'supplier' | 'buyer',
 *   name?: string,
 *   company_id?: uuid,        // wymagane dla supplier
 *   retailer_id?: integer,    // wymagane dla buyer
 *   send_magic_link?: boolean // domyslnie true
 * }
 *
 * Wymaga ENV:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Funkcja:
 *   1. Sprawdza JWT zalogowanego usera (Authorization: Bearer <token>) i
 *      potwierdza ze ma role='admin'.
 *   2. Tworzy auth.users przez admin.createUser (service role - omija RLS).
 *   3. Trigger handle_new_user automatycznie tworzy profile (z user_metadata).
 *   4. Aktualizuje profile.role/company_id/retailer_id/name (na pewniaka).
 *   5. Generuje magic link (admin.generateLink type='magiclink') i zwraca w body.
 *      (Wysylke maila zostawiamy stronie wywolujacej lub Resend - tu zwracamy
 *       link, klient pokaze go adminowi.)
 *
 * Kluczowe: NIE uzywamy supabase.auth.signUp z anon key - to przelaczyloby
 * sesje admina na nowo utworzonego usera. admin.createUser tworzy konto
 * bez logowania.
 */

import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return errJson(500, "Brak konfiguracji Supabase (URL + SERVICE_ROLE_KEY)");
  }

  // 1. Autoryzacja: musi byc zalogowany admin
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return errJson(401, "Brak naglowka Authorization");
  }
  const token = authHeader.slice(7);

  // Klient z anon do weryfikacji JWT
  const ANON_KEY =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!ANON_KEY) return errJson(500, "Brak SUPABASE_ANON_KEY w env");
  const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return errJson(401, "Nieprawidlowy token");

  // Sprawdz role w profiles
  const supaSvc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: profile, error: pErr } = await supaSvc
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (pErr || profile?.role !== "admin") {
    return errJson(403, "Tylko admin moze tworzyc konta B2B");
  }

  // 2. Walidacja body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return errJson(400, "Niepoprawny JSON");
  }
  const {
    email,
    role,
    name = null,
    company_id = null,
    retailer_id = null,
    send_magic_link = true,
  } = body;
  if (!email) return errJson(400, "Brak email");
  if (!["admin", "supplier", "buyer"].includes(role)) {
    return errJson(400, "Niepoprawna role (admin/supplier/buyer)");
  }
  if (role === "supplier" && !company_id) {
    return errJson(400, "supplier wymaga company_id");
  }
  if (role === "buyer" && !retailer_id) {
    return errJson(400, "buyer wymaga retailer_id");
  }

  // 3. Stworz auth.users
  const { data: created, error: cErr } = await supaSvc.auth.admin.createUser({
    email,
    email_confirm: true, // omijamy email confirmation - admin tworzy konta
    user_metadata: { name, role, company_id, retailer_id },
  });
  if (cErr || !created?.user) {
    return errJson(500, "Nie udalo sie utworzyc usera: " + (cErr?.message || ""));
  }

  // 4. Upsert profile (na pewniaka, nawet jesli trigger handle_new_user istnieje)
  const profileRow = {
    id: created.user.id,
    email,
    role,
    name,
    company_id,
    retailer_id,
  };
  const { error: upErr } = await supaSvc
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" });
  if (upErr) {
    // Konto powstalo, profile nie - zwrocmy bledy z context'em
    return errJson(500, "Konto utworzone, ale update profile nie powiodl sie: " + upErr.message);
  }

  // 5. Magic link (jesli zazadane)
  let magic_link = null;
  if (send_magic_link) {
    const { data: linkData, error: linkErr } = await supaSvc.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: process.env.B2B_APP_URL || "https://app.freshmarket.eu",
      },
    });
    if (linkErr) {
      // Konto powstalo, ale link nie - admin zobaczy info
      return okJson({
        user_id: created.user.id,
        email,
        magic_link: null,
        warning: "Konto utworzone, magic link nie wygenerowany: " + linkErr.message,
      });
    }
    magic_link = linkData?.properties?.action_link || null;
  }

  return okJson({
    user_id: created.user.id,
    email,
    role,
    company_id,
    retailer_id,
    magic_link,
  });
};

function okJson(payload) {
  return {
    statusCode: 200,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function errJson(code, msg) {
  return {
    statusCode: code,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify({ error: msg }),
  };
}
