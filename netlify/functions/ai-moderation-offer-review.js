import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { openAiChat } from "./_shared/openai.js";
import { loadKompendium } from "./_shared/load-kompendium.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "openAiApiKey"]);
  if (missing.length) return json(500, envErrorPayload("ai-moderation-offer-review", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: errLoc(locale, "no_auth_header") });
  const token = authHeader.slice(7);

  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await supaUser.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: caller, error: callerErr } = await supaSvc
    .from("profiles")
    .select("id, role, name, email, locale")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerErr || caller?.role !== "admin") {
    return json(403, { error: errLoc(locale, "only_admin_ai_chat") });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: errLoc(locale, "invalid_json") });
  }

  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: caller.locale, acceptLanguage: acceptLang });
  const offer = body.offer || null;
  if (!offer?.id) return json(400, { error: errLoc(locale, "missing_offer_id") });

  const km = loadKompendium();
  if (!km.ok) console.warn("[ai-moderation-offer-review] kompendium fallback:", km.reason);

  try {
    const raw = await openAiChat({
      apiKey: env.openAiApiKey,
      model: env.openAiModel,
      system: buildSystemPrompt(locale, km.content),
      user: buildReviewPrompt({
        offer,
        supplier: body.supplier || null,
        retailer: body.retailer || null,
        send: body.send || null,
      }),
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    });

    return json(200, {
      ok: true,
      analysis: normalizeAnalysis(safeJsonParse(raw)),
      kompendium_loaded: km.ok,
      kompendium_files: km.loaded,
    });
  } catch (e) {
    console.warn("[ai-moderation-offer-review]", e?.message || e);
    return json(500, { error: errLoc(locale, "ai_moderation_review_failed") });
  }
};

function buildSystemPrompt(locale, kompendiumContent) {
  const language = locale === "en" ? "English" : "Polish";
  const base = [
    "You are an assistant for a Fresh Market PreConnect administrator.",
    "Your job is to review a supplier product proposal before moderation.",
    "Use Fresh Market / PreConnect business knowledge and practical buyer expectations.",
    "Do not invent facts. If data is missing, name the missing data clearly.",
    `Write every value in ${language}.`,
    "Return JSON only with this shape:",
    "{\"score\":1-5,\"missing\":[...],\"suggestions\":[...],\"strengths\":[...],\"messageDraft\":\"...\",\"checklist\":[...]}",
    "score means completeness for buyer-facing moderation.",
    "messageDraft must be a short, polite admin message to the supplier, max 120 words.",
  ];
  if (kompendiumContent) {
    base.push("", "Fresh Market / PreConnect knowledge base:", truncate(kompendiumContent, 8000));
  }
  return base.join("\n");
}

function buildReviewPrompt({ offer, supplier, retailer, send }) {
  return [
    "Review this proposal for moderation.",
    "",
    `Supplier: ${text(supplier?.name) || text(supplier?.companyName) || text(supplier?.id) || "unknown"}`,
    `Retailer: ${text(retailer?.name) || text(retailer?.id) || "not assigned"}`,
    `Send status: ${text(send?.status) || "not sent"}`,
    "",
    "Offer data:",
    JSON.stringify({
      id: offer?.id,
      title: offer?.title,
      internalTitle: offer?.internalTitle,
      product: offer?.product,
      variety: offer?.variety,
      category: offer?.category,
      subcategory: offer?.subcategory,
      origin: offer?.origin,
      region: offer?.region,
      tier: offer?.tier,
      status: offer?.status,
      volume: offer?.volume,
      volumeUnit: offer?.volumeUnit,
      volumeMin: offer?.volumeMin,
      volumeMax: offer?.volumeMax,
      moq: offer?.moq || offer?.minOrder,
      from: offer?.from,
      to: offer?.to,
      packaging: offer?.packaging,
      customPackaging: offer?.customPackaging,
      packagingDesc: offer?.packagingDesc,
      qualitySpec: offer?.qualitySpec,
      benefit1: offer?.benefit1,
      benefit2: offer?.benefit2,
      benefit3: offer?.benefit3,
      shopBenefit: offer?.shopBenefit,
      riskMitigation: offer?.riskMitigation,
      deliveryModel: offer?.deliveryModel,
      loadingPoint: offer?.loadingPoint,
      deliveryRegions: offer?.deliveryRegions,
      certs: offer?.certs,
      description: truncate(offer?.description, 1200),
      photosCount: Array.isArray(offer?.photos) ? offer.photos.length : 0,
    }, null, 2),
    "",
    "Look for missing buyer-critical elements: clear product name, variety/quality, volume, season, origin, packaging, minimum order, logistics, certifications, buyer benefit, risk reduction, and whether the title is understandable.",
  ].join("\n");
}

function normalizeAnalysis(input = {}) {
  return {
    score: Math.max(1, Math.min(5, Number(input?.score) || 3)),
    missing: arr(input?.missing),
    suggestions: arr(input?.suggestions),
    strengths: arr(input?.strengths),
    checklist: arr(input?.checklist),
    messageDraft: truncate(text(input?.messageDraft) || "", 800),
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function arr(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean).slice(0, 8);
}

function truncate(value, limit = 700) {
  const next = text(value);
  return next.length > limit ? `${next.slice(0, limit)}...` : next;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
