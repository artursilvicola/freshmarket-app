import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { fetchWebsiteSnippet, openAiChat } from "./_shared/openai.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// [B2B Round adaptive-company-profile-ai]
// Funkcja generuje DWA opisy w jednym wywołaniu:
//   - description_short  (2-3 zdania) — szybki podgląd dla kupca, dashboardu
//   - description        (4-6 zdań)  — główny opis na karcie firmy
// Długość opisu jest dopasowywana do ilości danych — jeśli supplier podał
// tylko nazwę i kraj, opis krótki ma 1 zdanie, a description ~2-3 zdania.
// Jeśli supplier podał strukturę (zaplecze, rynki, certyfikaty), AI pisze
// szerzej. NIGDY nie zmyśla brakujących faktów.
export const handler = async (event) => {
  // [P2-backend-mails C3] Caller is admin/supplier — locale-aware error msgs.
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "openAiApiKey"]);
  if (missing.length) return json(500, envErrorPayload("ai-company-description", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: errLoc(locale, "no_auth_header") });
  const token = authHeader.slice(7);

  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await supaUser.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  // [P2-backend-mails C3] Pull caller `locale`.
  const { data: caller, error: callerErr } = await supaSvc
    .from("profiles")
    .select("id, role, company_id, name, email, locale")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerErr || !caller) return json(403, { error: errLoc(locale, "profile_not_found") });
  if (!["admin", "supplier"].includes(caller.role)) {
    return json(403, { error: errLoc(locale, "only_admin_or_supplier_ai_desc") });
  }
  locale = resolveLocale({ profileLocale: caller.locale, acceptLanguage: acceptLang });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: errLoc(locale, "invalid_json") });
  }
  // [P2-backend-mails C3] body.locale overrides.
  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: caller.locale, acceptLanguage: acceptLang });

  const company = normalizeCompany(body.company || {});
  if (!company.name) return json(400, { error: errLoc(locale, "missing_data_company") });
  if (caller.role === "supplier" && caller.company_id && body.company_id && caller.company_id !== body.company_id) {
    return json(403, { error: errLoc(locale, "own_company_only_ai_desc") });
  }

  const site = await fetchWebsiteSnippet(company.website);
  const prompt = buildCompanyPrompt(company, site);
  const richness = estimateDataRichness(company, site);

  // JSON-mode prompt: AI zwraca {description_short, description} w jednym call
  const raw = await openAiChat({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    system: systemPrompt(),
    user: prompt,
    temperature: 0.4,
    responseFormat: { type: "json_object" },
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: AI nie zwrócił JSON-a. Traktuj cały tekst jako description,
    // a description_short zostaw puste — frontend wybierze description jako
    // główny opis i nie pokaże short na karcie.
    parsed = { description: cleanDescription(raw), description_short: "" };
  }

  return json(200, {
    ok: true,
    description: cleanDescription(parsed.description || ""),
    description_short: cleanDescription(parsed.description_short || ""),
    richness,
    source: {
      website_used: Boolean(site.text),
      website_url: site.finalUrl || company.website || null,
    },
  });
};

function systemPrompt() {
  return [
    "Tworzysz wiarygodne opisy firm B2B dla platformy Fresh Market (rynek owoce-warzywa-kwiaty).",
    "Piszesz po polsku, językiem handlowym i konkretnym. Adresat: kupiec sieci handlowej.",
    "ZASADY:",
    "1. Nie zmyślasz faktów. Jeśli czegoś nie ma w danych, pomijasz. Nigdy nie wymyślasz krajów eksportu, certyfikatów, liczb pracowników ani volumenów.",
    "2. Nie używasz pustego marketingu (np. 'lider', 'najlepszy', 'wieloletnie tradycje', jeśli to nie wynika z danych).",
    "3. Skalujesz długość do ilości danych: mało danych → krótko; dużo danych → szerzej, ale nadal konkretnie.",
    "4. Bez nagłówków, list punktowanych, emoji.",
    "5. Akcent: typ firmy + co sprzedaje + dla kogo + na jakich rynkach + zaplecze/certyfikaty (tylko jeśli podane).",
    "Zwracasz JSON: {\"description_short\": string, \"description\": string}.",
    "description_short: 2-3 zdania, ~200-300 znaków, do podglądu kart i dashboardu kupca.",
    "description: 4-6 zdań, ~450-700 znaków, główny opis profilu. Jeśli danych mało (sama nazwa, kraj, jeden typ) — wystarczy 2-3 zdania (~250-400 znaków).",
  ].join("\n");
}

function buildCompanyPrompt(company, site) {
  const contacts = (company.contacts || [])
    .map((ct) => [ct?.role, ct?.name, ct?.position, ct?.email, ct?.phone].filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");
  const certs = (company.certs || [])
    .map((ct) => [ct?.type, ct?.number, ct?.valid].filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");

  // Strukturalne dane z profile_data (round adaptive-company-profile-ai)
  const pd = company.profile_data || {};
  const basics = pd.basics || {};
  const offer = pd.offer || {};
  const trade = pd.trade || {};
  const ops = pd.operations || {};
  const materials = Array.isArray(pd.materials) ? pd.materials : [];
  const supplierPitch = typeof pd.supplier_pitch === "string" ? pd.supplier_pitch.trim() : "";

  const lines = [
    "Wygeneruj opis profilu firmy. Zwróć JSON z dwoma polami: description_short i description.",
    "",
    "DANE FIRMY:",
    `Nazwa: ${company.name || "-"}`,
    `Kraj: ${company.country || "-"}`,
    `Miasto: ${company.city || "-"}`,
    `WWW: ${company.website || "-"}`,
    `Typ firmy: ${(company.types || []).join(", ") || "-"}`,
    `Kategorie produktowe: ${(company.categories || []).join(", ") || "-"}`,
    `Produkty (wolny tekst): ${company.products || "-"}`,
    `Rynki sprzedaży (wolny tekst): ${company.markets || "-"}`,
    `Sezonowość: ${company.seasonality || "-"}`,
  ];

  if (basics.founded_year) lines.push(`Rok założenia: ${basics.founded_year}`);
  if (basics.employees) lines.push(`Liczba pracowników: ${basics.employees}`);

  if (offer.products_year_round) lines.push(`Produkty całoroczne: ${offer.products_year_round}`);
  if (offer.products_seasonal) lines.push(`Produkty sezonowe: ${offer.products_seasonal}`);
  if (typeof offer.private_label === "boolean") lines.push(`Marka własna / private label: ${offer.private_label ? "tak" : "nie"}`);
  if (Array.isArray(offer.customer_types) && offer.customer_types.length) {
    lines.push(`Typ obsługiwanych klientów: ${offer.customer_types.join(", ")}`);
  }

  if (Array.isArray(trade.export_countries) && trade.export_countries.length) {
    lines.push(`Kraje eksportu: ${trade.export_countries.join(", ")}`);
  }
  if (trade.main_markets) lines.push(`Główne rynki: ${trade.main_markets}`);
  if (Array.isArray(trade.partnership_types) && trade.partnership_types.length) {
    lines.push(`Typ współpracy: ${trade.partnership_types.join(", ")}`);
  }
  if (trade.typical_volumes) lines.push(`Typowe wolumeny: ${trade.typical_volumes}`);

  if (Array.isArray(ops.capabilities) && ops.capabilities.length) {
    lines.push(`Zaplecze operacyjne: ${ops.capabilities.join(", ")}`);
  }

  if (materials.length) {
    lines.push(`Liczba dostarczonych materiałów (PDF/zdjęcia): ${materials.length}`);
  }

  if (supplierPitch) {
    lines.push("");
    lines.push("PODKREŚLENIE OD FIRMY (priorytet handlowy do uwzględnienia, ale bez kopiowania dosłownie):");
    lines.push(supplierPitch);
  }

  lines.push("");
  lines.push(contacts ? `Kontakty:\n${contacts}` : "Kontakty: -");
  lines.push(certs ? `Certyfikaty:\n${certs}` : "Certyfikaty: -");
  lines.push(site.text ? `Fragment strony WWW:\n${site.text}` : "Fragment strony WWW: -");

  return lines.join("\n");
}

// Heurystyka: ile danych firma realnie podała. Używana w odpowiedzi do
// frontendu (richness=tier) — ale głównie do diagnostyki, AI i tak skaluje
// się przez prompt.
function estimateDataRichness(company, site) {
  let score = 0;
  if (company.name) score += 1;
  if (company.country) score += 1;
  if (company.city) score += 1;
  if (company.website) score += 1;
  if ((company.types || []).length) score += 1;
  if ((company.categories || []).length) score += 1;
  if (company.products) score += 1;
  if (company.markets) score += 1;
  if ((company.contacts || []).length) score += 1;
  if ((company.certs || []).length) score += 2;
  if (site.text) score += 2;

  const pd = company.profile_data || {};
  if (pd.basics?.founded_year) score += 1;
  if (pd.basics?.employees) score += 1;
  if (pd.offer?.products_year_round) score += 1;
  if (pd.offer?.products_seasonal) score += 1;
  if (Array.isArray(pd.offer?.customer_types) && pd.offer.customer_types.length) score += 1;
  if (Array.isArray(pd.trade?.export_countries) && pd.trade.export_countries.length) score += 2;
  if (pd.trade?.typical_volumes) score += 1;
  if (Array.isArray(pd.trade?.partnership_types) && pd.trade.partnership_types.length) score += 1;
  if (Array.isArray(pd.operations?.capabilities) && pd.operations.capabilities.length) score += 2;
  if (Array.isArray(pd.materials) && pd.materials.length) score += 2;
  if (typeof pd.supplier_pitch === "string" && pd.supplier_pitch.trim()) score += 1;

  if (score < 5) return "minimal";
  if (score < 12) return "standard";
  return "rich";
}

function normalizeCompany(company) {
  return {
    name: text(company.name),
    country: text(company.country),
    city: text(company.city),
    website: text(company.website),
    phone: text(company.phone),
    description: text(company.description),
    types: array(company.types),
    categories: array(company.categories),
    products: text(company.products),
    seasonality: text(company.seasonality),
    markets: text(company.markets),
    contacts: Array.isArray(company.contacts) ? company.contacts : [],
    certs: Array.isArray(company.certs) ? company.certs : [],
    profile_data: company.profile_data && typeof company.profile_data === "object"
      ? company.profile_data
      : {},
  };
}

function cleanDescription(textValue) {
  return String(textValue || "").replace(/\s+/g, " ").trim();
}

function text(value) {
  if (value == null) return null;
  const next = String(value).trim();
  return next || null;
}

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
