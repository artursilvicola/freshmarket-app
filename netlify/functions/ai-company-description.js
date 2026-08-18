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

  // [feat/company-desc-i18n] Tryb TŁUMACZENIA: wierny przekład istniejących
  // opisów (np. napisanych ręcznie po polsku) na EN. Bez generowania nowej
  // treści. Używany przy admin-approve, gdy brakuje wersji EN.
  const tr = body.translate;
  if (tr && (text(tr.description) || text(tr.description_short))) {
    const rawTr = await openAiChat({
      apiKey: env.openAiApiKey,
      model: env.openAiModel,
      system: [
        "You translate B2B company descriptions (fruit/vegetable/flower market) from Polish into English faithfully.",
        "No additions, no removals, no marketing embellishment — a precise professional translation.",
        "If a source text is already in English, return it unchanged.",
        "Return JSON: {\"description_en\": string, \"description_short_en\": string}. Empty input -> empty string.",
      ].join("\n"),
      user: JSON.stringify({
        description: text(tr.description) || "",
        description_short: text(tr.description_short) || "",
      }),
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    });
    let parsedTr;
    try { parsedTr = JSON.parse(rawTr); } catch { parsedTr = {}; }
    return json(200, {
      ok: true,
      description_en: cleanDescription(parsedTr.description_en || ""),
      description_short_en: cleanDescription(parsedTr.description_short_en || ""),
    });
  }

  // [feat/offer-i18n etap 2] Generyczny tryb tłumaczenia pól tekstowych
  // (tytuł/opis/benefity propozycji itd.): body.translate_texts = {klucz: tekst}
  // → { translations: {klucz: EN} }. Wierny przekład, EN źródło bez zmian.
  const tt = body.translate_texts;
  if (tt && typeof tt === "object" && !Array.isArray(tt)) {
    const fields = {};
    for (const [k, v] of Object.entries(tt)) {
      const val = text(v);
      if (val && String(k).length <= 40) fields[k] = val.slice(0, 2000);
    }
    if (!Object.keys(fields).length) return json(400, { error: errLoc(locale, "invalid_json") });
    const rawTt = await openAiChat({
      apiKey: env.openAiApiKey,
      model: env.openAiModel,
      system: [
        "You translate B2B fresh-produce trade texts (product names, varieties, offer descriptions, benefits) from Polish into English faithfully.",
        "No additions, no removals, no marketing embellishment. Keep any **bold** markers and line breaks as-is.",
        "If a source text is already in English, return it unchanged.",
        "Input is a JSON object {key: polishText}. Return JSON: {\"translations\": {key: englishText}} with EXACTLY the same keys.",
      ].join("\n"),
      user: JSON.stringify(fields),
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    });
    let parsedTt;
    try { parsedTt = JSON.parse(rawTt); } catch { parsedTt = {}; }
    const translations = {};
    const src = parsedTt.translations && typeof parsedTt.translations === "object" ? parsedTt.translations : parsedTt;
    for (const k of Object.keys(fields)) {
      const val = typeof src[k] === "string" ? src[k].trim() : "";
      if (val) translations[k] = val;
    }
    return json(200, { ok: true, translations });
  }

  const company = normalizeCompany(body.company || {});
  if (!company.name) return json(400, { error: errLoc(locale, "missing_data_company") });
  if (caller.role === "supplier" && caller.company_id && body.company_id && caller.company_id !== body.company_id) {
    return json(403, { error: errLoc(locale, "own_company_only_ai_desc") });
  }

  const site = await fetchWebsiteSnippet(company.website);
  const prompt = buildCompanyPrompt(company, site, locale);
  const richness = estimateDataRichness(company, site);

  // JSON-mode prompt: AI zwraca {description_short, description} w jednym call.
  // [P2-final-qa C3] System prompt locale-aware — supplier z locale='en'
  // dostaje wygenerowany opis po angielsku (zgodność z UI lang). Fallback PL.
  const raw = await openAiChat({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    system: systemPrompt(locale),
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
    parsed = { description: cleanDescription(raw), description_short: "", description_en: "", description_short_en: "" };
  }

  return json(200, {
    ok: true,
    description: cleanDescription(parsed.description || ""),
    description_short: cleanDescription(parsed.description_short || ""),
    // [feat/company-desc-i18n] Wersje EN generowane w tym samym wywołaniu.
    description_en: cleanDescription(parsed.description_en || ""),
    description_short_en: cleanDescription(parsed.description_short_en || ""),
    richness,
    source: {
      website_used: Boolean(site.text),
      website_url: site.finalUrl || company.website || null,
    },
  });
};

// [P2-final-qa C3] Locale-aware system prompt — PL/EN dispatcher.
// Fallback PL gdy locale nie 'en'. JSON output structure identyczna.
function systemPrompt(locale) {
  const lng = (locale === "en") ? "en" : "pl";
  if (lng === "en") return systemPromptEN();
  return systemPromptPL();
}

function systemPromptPL() {
  return [
    "Tworzysz wiarygodne opisy firm B2B dla platformy Fresh Market (rynek owoce-warzywa-kwiaty).",
    "Piszesz po polsku, językiem handlowym i konkretnym. Adresat: kupiec sieci handlowej.",
    "ZASADY:",
    "1. Nie zmyślasz faktów. Jeśli czegoś nie ma w danych, pomijasz. Nigdy nie wymyślasz krajów eksportu, certyfikatów, liczb pracowników ani volumenów.",
    "2. Nie używasz pustego marketingu (np. 'lider', 'najlepszy', 'wieloletnie tradycje', jeśli to nie wynika z danych).",
    "3. Skalujesz długość do ilości danych: mało danych → krótko; dużo danych → szerzej, ale nadal konkretnie.",
    "4. Bez nagłówków, list punktowanych, emoji.",
    "5. Akcent: typ firmy + co sprzedaje + dla kogo + na jakich rynkach + zaplecze/certyfikaty (tylko jeśli podane).",
    "Zwracasz JSON z CZTEREMA polami: {\"description_short\": string, \"description\": string, \"description_short_en\": string, \"description_en\": string}.",
    "description_short (PO POLSKU): 2-3 zdania, ~200-300 znaków, do podglądu kart i dashboardu kupca.",
    "description (PO POLSKU): 4-6 zdań, ~450-700 znaków, główny opis profilu. Jeśli danych mało (sama nazwa, kraj, jeden typ) — wystarczy 2-3 zdania (~250-400 znaków).",
    "description_short_en i description_en: WIERNE angielskie odpowiedniki wersji polskich (ta sama treść i długość, nie nowa treść).",
  ].join("\n");
}

function systemPromptEN() {
  return [
    "You write trustworthy B2B company descriptions for the Fresh Market platform (fruit-vegetable-flower market).",
    "Write in English, in concrete commercial language. Audience: a retailer's category buyer.",
    "RULES:",
    "1. Do not invent facts. If something is missing from the data, skip it. Never invent export countries, certificates, employee counts or volumes.",
    "2. Do not use empty marketing language (e.g. 'leader', 'best', 'long tradition') if it doesn't follow from the data.",
    "3. Scale length to the amount of data: little data → short; more data → broader, but still specific.",
    "4. No headings, no bullet lists, no emoji.",
    "5. Emphasis: company type + what they sell + for whom + on which markets + capacity/certificates (only if provided).",
    "Return JSON with FOUR fields: {\"description_short\": string, \"description\": string, \"description_short_en\": string, \"description_en\": string}.",
    "description_short and description must be written IN POLISH (shown to Polish buyers).",
    "description_short_en and description_en: faithful ENGLISH equivalents of the Polish versions (same content and length, not new text).",
    "Lengths: short 2-3 sentences ~200-300 chars; full 4-6 sentences ~450-700 chars. If data is limited — 2-3 sentences are enough.",
  ].join("\n");
}

// [P2-final-qa C3] Locale-aware field labels — AI sees the prompt in caller's
// language. Strukturalne dane (countries, products, certs) NIE są tłumaczone
// (to surowe wejście z formularza supplier'a — może być PL albo EN zależnie
// jak supplier wpisał). Tylko etykiety/intro/footer prompta są w locale.
function buildCompanyPrompt(company, site, locale) {
  const lng = (locale === "en") ? "en" : "pl";
  const labels = lng === "en" ? {
    intro: "Generate a company profile description. Return JSON with two fields: description_short and description.",
    sectionTitle: "COMPANY DATA:",
    name: "Name",
    country: "Country",
    city: "City",
    website: "Website",
    companyType: "Company type",
    productCategories: "Product categories",
    products: "Products (free text)",
    markets: "Sales markets (free text)",
    seasonality: "Seasonality",
    foundedYear: "Founded year",
    employees: "Employees count",
    yearRound: "Year-round products",
    seasonal: "Seasonal products",
    privateLabel: "Private label",
    yes: "yes",
    no: "no",
    customerTypes: "Customer types served",
    exportCountries: "Export countries",
    mainMarkets: "Main markets",
    partnership: "Partnership types",
    volumes: "Typical volumes",
    capabilities: "Operational capabilities",
    materials: "Number of supplied materials (PDF/photos)",
    pitchTitle: "EMPHASIS FROM THE COMPANY (commercial priority to include, but without copying verbatim):",
    contacts: "Contacts",
    certs: "Certificates",
    website_snippet: "Website snippet",
  } : {
    intro: "Wygeneruj opis profilu firmy. Zwróć JSON z dwoma polami: description_short i description.",
    sectionTitle: "DANE FIRMY:",
    name: "Nazwa",
    country: "Kraj",
    city: "Miasto",
    website: "WWW",
    companyType: "Typ firmy",
    productCategories: "Kategorie produktowe",
    products: "Produkty (wolny tekst)",
    markets: "Rynki sprzedaży (wolny tekst)",
    seasonality: "Sezonowość",
    foundedYear: "Rok założenia",
    employees: "Liczba pracowników",
    yearRound: "Produkty całoroczne",
    seasonal: "Produkty sezonowe",
    privateLabel: "Marka własna / private label",
    yes: "tak",
    no: "nie",
    customerTypes: "Typ obsługiwanych klientów",
    exportCountries: "Kraje eksportu",
    mainMarkets: "Główne rynki",
    partnership: "Typ współpracy",
    volumes: "Typowe wolumeny",
    capabilities: "Zaplecze operacyjne",
    materials: "Liczba dostarczonych materiałów (PDF/zdjęcia)",
    pitchTitle: "PODKREŚLENIE OD FIRMY (priorytet handlowy do uwzględnienia, ale bez kopiowania dosłownie):",
    contacts: "Kontakty",
    certs: "Certyfikaty",
    website_snippet: "Fragment strony WWW",
  };

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
    labels.intro,
    "",
    labels.sectionTitle,
    `${labels.name}: ${company.name || "-"}`,
    `${labels.country}: ${company.country || "-"}`,
    `${labels.city}: ${company.city || "-"}`,
    `${labels.website}: ${company.website || "-"}`,
    `${labels.companyType}: ${(company.types || []).join(", ") || "-"}`,
    `${labels.productCategories}: ${(company.categories || []).join(", ") || "-"}`,
    `${labels.products}: ${company.products || "-"}`,
    `${labels.markets}: ${company.markets || "-"}`,
    `${labels.seasonality}: ${company.seasonality || "-"}`,
  ];

  if (basics.founded_year) lines.push(`${labels.foundedYear}: ${basics.founded_year}`);
  if (basics.employees) lines.push(`${labels.employees}: ${basics.employees}`);

  if (offer.products_year_round) lines.push(`${labels.yearRound}: ${offer.products_year_round}`);
  if (offer.products_seasonal) lines.push(`${labels.seasonal}: ${offer.products_seasonal}`);
  if (typeof offer.private_label === "boolean") lines.push(`${labels.privateLabel}: ${offer.private_label ? labels.yes : labels.no}`);
  if (Array.isArray(offer.customer_types) && offer.customer_types.length) {
    lines.push(`${labels.customerTypes}: ${offer.customer_types.join(", ")}`);
  }

  if (Array.isArray(trade.export_countries) && trade.export_countries.length) {
    lines.push(`${labels.exportCountries}: ${trade.export_countries.join(", ")}`);
  }
  if (trade.main_markets) lines.push(`${labels.mainMarkets}: ${trade.main_markets}`);
  if (Array.isArray(trade.partnership_types) && trade.partnership_types.length) {
    lines.push(`${labels.partnership}: ${trade.partnership_types.join(", ")}`);
  }
  if (trade.typical_volumes) lines.push(`${labels.volumes}: ${trade.typical_volumes}`);

  if (Array.isArray(ops.capabilities) && ops.capabilities.length) {
    lines.push(`${labels.capabilities}: ${ops.capabilities.join(", ")}`);
  }

  if (materials.length) {
    lines.push(`${labels.materials}: ${materials.length}`);
  }

  if (supplierPitch) {
    lines.push("");
    lines.push(labels.pitchTitle);
    lines.push(supplierPitch);
  }

  lines.push("");
  lines.push(contacts ? `${labels.contacts}:\n${contacts}` : `${labels.contacts}: -`);
  lines.push(certs ? `${labels.certs}:\n${certs}` : `${labels.certs}: -`);
  lines.push(site.text ? `${labels.website_snippet}:\n${site.text}` : `${labels.website_snippet}: -`);

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
