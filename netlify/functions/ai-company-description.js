import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { fetchWebsiteSnippet, openAiChat } from "./_shared/openai.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "openAiApiKey"]);
  if (missing.length) return json(500, envErrorPayload("ai-company-description", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Brak naglowka Authorization" });
  const token = authHeader.slice(7);

  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await supaUser.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: "Nieprawidlowy token" });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: caller, error: callerErr } = await supaSvc
    .from("profiles")
    .select("id, role, company_id, name, email")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerErr || !caller) return json(403, { error: "Nie znaleziono profilu uzytkownika" });
  if (!["admin", "supplier"].includes(caller.role)) {
    return json(403, { error: "Ta funkcja jest dostepna tylko dla admina lub dostawcy." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Niepoprawny JSON" });
  }

  const company = normalizeCompany(body.company || {});
  if (!company.name) return json(400, { error: "Brak danych firmy do opisu." });
  if (caller.role === "supplier" && caller.company_id && body.company_id && caller.company_id !== body.company_id) {
    return json(403, { error: "Dostawca moze generowac opis tylko dla swojej firmy." });
  }

  const site = await fetchWebsiteSnippet(company.website);
  const prompt = buildCompanyPrompt(company, site);
  const description = await openAiChat({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    system:
      "Tworzysz krotkie, wiarygodne opisy firm B2B dla platformy Fresh Market. Piszesz po polsku. Nie zmyslasz faktow. Jesli czegos nie ma w danych, pomijasz to. Unikasz marketingowego nadmuchania i nie dodajesz certyfikatow, liczb ani krajow, ktorych nie ma w materiale.",
    user: prompt,
    temperature: 0.5,
  });

  return json(200, {
    ok: true,
    description: cleanDescription(description),
    source: {
      website_used: Boolean(site.text),
      website_url: site.finalUrl || company.website || null,
    },
  });
};

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
  };
}

function buildCompanyPrompt(company, site) {
  const contacts = company.contacts
    .map((ct) => [ct?.role, ct?.name, ct?.position, ct?.email, ct?.phone].filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");
  const certs = company.certs
    .map((ct) => [ct?.type, ct?.number, ct?.valid].filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");

  return [
    "Napisz gotowy do wklejenia opis firmy do profilu dostawcy.",
    "Forma: 3-5 zdan, 450-700 znakow, naturalny jezyk, konkret biznesowy.",
    "Cel: kupiec ma szybko zrozumiec czym firma sie zajmuje, co sprzedaje, na jakich rynkach dziala i jakiego typu wspolprace obsluguje.",
    "Nie uzywaj naglowkow, punktow ani emoji.",
    "",
    "DANE FIRMY:",
    `Nazwa: ${company.name || "-"}`,
    `Kraj: ${company.country || "-"}`,
    `Miasto: ${company.city || "-"}`,
    `WWW: ${company.website || "-"}`,
    `Telefon: ${company.phone || "-"}`,
    `Typ firmy: ${(company.types || []).join(", ") || "-"}`,
    `Kategorie: ${(company.categories || []).join(", ") || "-"}`,
    `Produkty: ${company.products || "-"}`,
    `Sezonowosc: ${company.seasonality || "-"}`,
    `Rynki: ${company.markets || "-"}`,
    contacts ? `Kontakty:\n${contacts}` : "Kontakty: -",
    certs ? `Certyfikaty:\n${certs}` : "Certyfikaty: -",
    site.text ? `Fragment strony WWW:\n${site.text}` : "Fragment strony WWW: -",
  ].join("\n");
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
