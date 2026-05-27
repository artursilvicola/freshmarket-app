/**
 * Netlify Function: upsert-legacy-offer
 * POST /.netlify/functions/upsert-legacy-offer
 *
 * Supplier-safe write path for legacy_offers. Some newer supplier companies
 * were created without legacy_supplier_id, while RLS uses that value. This
 * function verifies the JWT, backfills the supplier key when missing, and
 * writes the offer with the verified company key.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  // [P2-backend-mails C3] Pre-body locale = Accept-Language fallback. Po
  // parse body locale jest revised z body.locale (preferred) + profile.locale.
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missing.length) return json(500, envErrorPayload("upsert-legacy-offer", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: errLoc(locale, "invalid_json") });
  }
  // [P2-backend-mails C3] body.locale wins jeśli klient przekazał.
  locale = resolveLocale({ bodyLocale: body.locale, acceptLanguage: acceptLang });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });

  // [P2-backend-mails C3] Pull profile.locale jako backup-source dla locale,
  // gdy klient nie przekazał body.locale.
  const { data: profile, error: profileErr } = await supaSvc
    .from("profiles")
    .select("id, role, company_id, locale, company:companies!company_id(id, legacy_supplier_id)")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileErr || !profile) return json(403, { error: errLoc(locale, "profile_no_role") });
  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: profile.locale, acceptLanguage: acceptLang });

  const input = body.offer || {};
  if (!input.id) return json(400, { error: errLoc(locale, "missing_offer_id") });

  let offer = { ...input };
  if (profile.role === "supplier") {
    if (!profile.company_id) return json(403, { error: errLoc(locale, "no_company_assigned") });
    const supplierKey = profile.company?.legacy_supplier_id || profile.company_id;
    if (!profile.company?.legacy_supplier_id) {
      const { error: backfillErr } = await supaSvc
        .from("companies")
        .update({ legacy_supplier_id: supplierKey })
        .eq("id", profile.company_id);
      if (backfillErr) return json(500, { error: errLoc(locale, "legacy_supplier_id_backfill_failed", { detail: backfillErr.message }) });
    }
    offer.supplierId = supplierKey;
  } else if (profile.role !== "admin") {
    return json(403, { error: errLoc(locale, "no_offer_write_perm") });
  } else if (!offer.supplierId) {
    return json(400, { error: errLoc(locale, "missing_supplier_id") });
  }

  const row = {
    legacy_id: offer.id,
    supplier_legacy_id: offer.supplierId,
    status: offer.status || null,
    category: offer.category || null,
    origin: offer.origin || null,
    data: offer,
  };
  const { error } = await supaSvc
    .from("legacy_offers")
    .upsert(row, { onConflict: "legacy_id" });
  // [P2-backend-mails C3] Raw Supabase error passthrough — nie tłumaczymy
  // surowych DB errorów (admin może sięgnąć do logów Netlify), ale komunikat
  // sam zwraca .message.
  if (error) return json(500, { error: error.message });

  return json(200, { offer });
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
