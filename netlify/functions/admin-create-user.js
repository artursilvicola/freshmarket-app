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
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";

const BUYER_CATEGORY_OPTIONS = new Set(["owoce", "warzywa", "kwiaty"]);

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

  const env = resolveEnvConfig();
  const missingCore = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missingCore.length) {
    return errJson(500, envErrorPayload("admin-create-user", missingCore));
  }

  // 1. Autoryzacja: musi byc zalogowany admin
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return errJson(401, "Brak naglowka Authorization");
  }
  const token = authHeader.slice(7);

  // Klient z anon do weryfikacji JWT
  const missingAuth = missingEnvNames(env, ["supabaseAnonKey"]);
  if (missingAuth.length) return errJson(500, envErrorPayload("admin-create-user", missingAuth));
  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return errJson(401, "Nieprawidlowy token");

  // Sprawdz role w profiles
  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
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
    phone = null,
    position = null,
    active = true,
    fm26_active = false,
    buyer_categories = [],
    send_magic_link = true,
  } = body;
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeText(name);
  if (!normalizedEmail) return errJson(400, "Brak email");
  if (!["admin", "supplier", "buyer"].includes(role)) {
    return errJson(400, "Niepoprawna role (admin/supplier/buyer)");
  }
  if (role === "supplier" && !company_id) {
    return errJson(400, "supplier wymaga company_id");
  }
  if (role === "buyer" && !retailer_id) {
    return errJson(400, "buyer wymaga retailer_id");
  }
  if (role === "buyer" && !normalizedName) {
    return errJson(400, "buyer wymaga imienia i nazwiska");
  }

  if (role === "buyer") {
    const { data: retailer, error: rErr } = await supaSvc
      .from("retailers")
      .select("id")
      .eq("id", Number(retailer_id))
      .maybeSingle();
    if (rErr || !retailer) return errJson(400, "Wybrana sieć handlowa nie istnieje.");

    const { data: profiles, error: dupErr } = await supaSvc
      .from("profiles")
      .select("id, email")
      .eq("role", "buyer")
      .not("email", "is", null);
    if (dupErr) return errJson(500, "Nie udało się sprawdzić duplikatów kupców.");
    const duplicate = (profiles || []).find((p) => normalizeEmail(p.email) === normalizedEmail);
    if (duplicate) return errJson(409, "Kupiec z tym adresem e-mail już istnieje.");
  }

  // 3. Stworz auth.users
  const { data: created, error: cErr } = await supaSvc.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true, // omijamy email confirmation - admin tworzy konta
    user_metadata: { name: normalizedName, role, company_id, retailer_id: retailer_id ? Number(retailer_id) : null },
  });
  if (cErr || !created?.user) {
    return errJson(cErr?.message?.toLowerCase().includes("already been registered") ? 409 : 500, "Nie udalo sie utworzyc usera: " + (cErr?.message || ""));
  }

  // 4. Upsert profile (na pewniaka, nawet jesli trigger handle_new_user istnieje)
  const profileRow = {
    id: created.user.id,
    email: normalizedEmail,
    role,
    name: normalizedName,
    company_id,
    retailer_id: retailer_id ? Number(retailer_id) : null,
    phone: normalizeText(phone),
    position: normalizeText(position),
    active: active !== false,
    fm26_active: !!fm26_active,
    buyer_categories: normalizeBuyerCategories(buyer_categories),
    updated_at: new Date().toISOString(),
  };
  const { data: savedProfile, error: upErr } = await supaSvc
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" })
    .select()
    .single();
  if (upErr) {
    // Konto powstalo, profile nie - zwrocmy bledy z context'em
    return errJson(500, "Konto utworzone, ale update profile nie powiodl sie: " + upErr.message);
  }

  // 5. Magic link (jesli zazadane)
  let magic_link = null;
  if (send_magic_link) {
    const { data: linkData, error: linkErr } = await supaSvc.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: {
        redirectTo: env.b2bAppUrl,
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
    email: normalizedEmail,
    role,
    company_id,
    retailer_id: retailer_id ? Number(retailer_id) : null,
    magic_link,
    profile: savedProfile,
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
    body: JSON.stringify(typeof msg === "string" ? { error: msg } : msg),
  };
}

function normalizeText(value) {
  if (value == null) return null;
  const next = String(value).trim();
  return next || null;
}

function normalizeEmail(value) {
  const next = normalizeText(value);
  return next ? next.toLowerCase() : null;
}

function normalizeBuyerCategories(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter((v) => BUYER_CATEGORY_OPTIONS.has(v)))];
}
