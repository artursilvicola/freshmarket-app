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
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const BUYER_CATEGORY_OPTIONS = new Set(["owoce", "warzywa", "kwiaty"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  // [P2-backend-mails C3] Locale resolution (Accept-Language → profile → body).
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: errLoc(locale, "method_not_allowed") };
  }

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "supabaseAnonKey"]);
  if (missing.length) return errJson(500, envErrorPayload("admin-update-user", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return errJson(401, errLoc(locale, "no_auth_header"));
  }
  const token = authHeader.slice(7);

  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return errJson(401, errLoc(locale, "invalid_token"));

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  // [P2-backend-mails C3] Pull admin `locale` for error messages.
  const { data: profile, error: pErr } = await supaSvc
    .from("profiles")
    .select("role, locale")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (pErr || profile?.role !== "admin") {
    return errJson(403, errLoc(locale, "only_admin_update_users"));
  }
  locale = resolveLocale({ profileLocale: profile.locale, acceptLanguage: acceptLang });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return errJson(400, errLoc(locale, "invalid_json"));
  }
  // [P2-backend-mails C3] body.locale overrides profile.locale jeśli klient przekazał.
  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: profile.locale, acceptLanguage: acceptLang });

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

  if (!user_id) return errJson(400, errLoc(locale, "missing_user_id"));
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeText(name);
  const normalizedPhone = normalizeText(phone);
  const normalizedPosition = normalizeText(position);
  const normalizedRetailerId = retailer_id ? Number(retailer_id) : null;
  const normalizedBuyerCategories = normalizeBuyerCategories(buyer_categories);

  if (role === "buyer") {
    if (!normalizedName) return errJson(400, errLoc(locale, "buyer_needs_name_full"));
    if (!normalizedEmail) return errJson(400, errLoc(locale, "buyer_needs_email"));
    if (!normalizedRetailerId) return errJson(400, errLoc(locale, "buyer_needs_one_retailer"));
    if (active !== false && normalizedBuyerCategories.length === 0) {
      return errJson(400, errLoc(locale, "buyer_needs_category"));
    }
  }

  const { data: targetProfile, error: targetErr } = await supaSvc
    .from("profiles")
    .select("id, role, email")
    .eq("id", user_id)
    .maybeSingle();
  if (targetErr || !targetProfile) {
    return errJson(404, errLoc(locale, "target_profile_not_found"));
  }
  if (targetProfile.role !== "buyer" || role !== "buyer") {
    return errJson(400, errLoc(locale, "buyer_only_path"));
  }

  const { data: retailer, error: rErr } = await supaSvc
    .from("retailers")
    .select("id")
    .eq("id", normalizedRetailerId)
    .maybeSingle();
  if (rErr || !retailer) return errJson(400, errLoc(locale, "retailer_not_found"));

  const { data: profiles, error: dupErr } = await supaSvc
    .from("profiles")
    .select("id, email")
    .eq("role", "buyer")
    .not("email", "is", null);
  if (dupErr) return errJson(500, errLoc(locale, "duplicate_check_failed"));
  const duplicate = (profiles || []).find((p) => p.id !== user_id && normalizeEmail(p.email) === normalizedEmail);
  if (duplicate) return errJson(409, errLoc(locale, "buyer_email_duplicate"));

  const authPatch = {
    user_metadata: { name: normalizedName, role, company_id, retailer_id: normalizedRetailerId },
  };
  if (normalizedEmail) authPatch.email = normalizedEmail;

  const { error: authErr } = await supaSvc.auth.admin.updateUserById(user_id, authPatch);
  if (authErr) {
    return errJson(
      authErr.message?.toLowerCase().includes("already been registered") ? 409 : 500,
      errLoc(locale, "auth_update_failed", { detail: authErr.message })
    );
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
    return errJson(500, errLoc(locale, "profile_after_auth_update_failed", { detail: saveErr.message }));
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
