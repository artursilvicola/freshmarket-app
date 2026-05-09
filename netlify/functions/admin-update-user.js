/**
 * Netlify Function: admin-update-user
 * POST /.netlify/functions/admin-update-user
 *
 * Body:
 * {
 *   user_id: string,
 *   email?: string,
 *   name?: string,
 *   phone?: string,
 *   position?: string,
 *   role?: 'buyer' | 'supplier' | 'admin',
 *   company_id?: uuid | null,
 *   retailer_id?: integer | null,
 *   active?: boolean,
 *   fm26_active?: boolean,
 *   buyer_categories?: string[]
 * }
 */

import { createClient } from "@supabase/supabase-js";

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

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return errJson(500, "Brak konfiguracji Supabase");
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return errJson(401, "Brak naglowka Authorization");
  }
  const token = authHeader.slice(7);

  const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return errJson(401, "Nieprawidlowy token");

  const supaSvc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: profile, error: pErr } = await supaSvc
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (pErr || profile?.role !== "admin") {
    return errJson(403, "Tylko admin moze aktualizowac konta B2B");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return errJson(400, "Niepoprawny JSON");
  }

  const {
    user_id,
    email = null,
    name = null,
    phone = null,
    position = null,
    role = "buyer",
    company_id = null,
    retailer_id = null,
    active = true,
    fm26_active = false,
    buyer_categories = [],
  } = body;

  if (!user_id) return errJson(400, "Brak user_id");
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeText(name);
  const normalizedPhone = normalizeText(phone);
  const normalizedPosition = normalizeText(position);
  const normalizedRetailerId = retailer_id ? Number(retailer_id) : null;
  const normalizedBuyerCategories = normalizeBuyerCategories(buyer_categories);

  if (role === "buyer") {
    if (!normalizedName) return errJson(400, "Kupiec musi mieć imię i nazwisko.");
    if (!normalizedEmail) return errJson(400, "Kupiec musi mieć adres e-mail.");
    if (!normalizedRetailerId) return errJson(400, "Kupiec musi być przypisany do jednej sieci handlowej.");
    if (active !== false && normalizedBuyerCategories.length === 0) {
      return errJson(400, "Aktywny kupiec musi mieć przynajmniej jedną kategorię.");
    }
  }

  const { data: targetProfile, error: targetErr } = await supaSvc
    .from("profiles")
    .select("id, role, email")
    .eq("id", user_id)
    .maybeSingle();
  if (targetErr || !targetProfile) {
    return errJson(404, "Nie znaleziono profilu kupca do aktualizacji.");
  }
  if (targetProfile.role !== "buyer" || role !== "buyer") {
    return errJson(400, "Ta ścieżka służy tylko do zarządzania kupcami.");
  }

  const { data: retailer, error: rErr } = await supaSvc
    .from("retailers")
    .select("id")
    .eq("id", normalizedRetailerId)
    .maybeSingle();
  if (rErr || !retailer) return errJson(400, "Wybrana sieć handlowa nie istnieje.");

  const { data: profiles, error: dupErr } = await supaSvc
    .from("profiles")
    .select("id, email")
    .eq("role", "buyer")
    .not("email", "is", null);
  if (dupErr) return errJson(500, "Nie udało się sprawdzić duplikatów kupców.");
  const duplicate = (profiles || []).find((p) => p.id !== user_id && normalizeEmail(p.email) === normalizedEmail);
  if (duplicate) return errJson(409, "Kupiec z tym adresem e-mail już istnieje.");

  const authPatch = {
    user_metadata: { name: normalizedName, role, company_id, retailer_id: normalizedRetailerId },
  };
  if (normalizedEmail) authPatch.email = normalizedEmail;

  const { error: authErr } = await supaSvc.auth.admin.updateUserById(user_id, authPatch);
  if (authErr) {
    return errJson(authErr.message?.toLowerCase().includes("already been registered") ? 409 : 500, "Nie udalo sie zaktualizowac auth.users: " + authErr.message);
  }

  const profilePatch = {
    id: user_id,
    email: normalizedEmail,
    role,
    name: normalizedName,
    phone: normalizedPhone,
    position: normalizedPosition,
    company_id,
    retailer_id: normalizedRetailerId,
    active,
    fm26_active,
    buyer_categories: normalizedBuyerCategories,
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error: saveErr } = await supaSvc
    .from("profiles")
    .upsert(profilePatch, { onConflict: "id" })
    .select()
    .single();
  if (saveErr) {
    return errJson(500, "Auth zaktualizowany, ale profil nie: " + saveErr.message);
  }

  return okJson(saved);
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
