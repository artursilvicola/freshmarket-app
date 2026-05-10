import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { openAiChat } from "./_shared/openai.js";

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
  if (missing.length) return json(500, envErrorPayload("ai-admin-chat-suggestion", missing));

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
    .select("id, role, name, email")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerErr || caller?.role !== "admin") {
    return json(403, { error: "Ta funkcja jest dostepna tylko dla administratora." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Niepoprawny JSON" });
  }

  const participant = {
    name: text(body.participant?.name) || "Uczestnik",
    role: text(body.participant?.role) || "supplier",
    title: text(body.participant?.title) || null,
  };
  const thread = Array.isArray(body.thread)
    ? body.thread
        .map((msg) => ({
          author: text(msg.author) || "user",
          text: text(msg.text) || "",
          timestamp: text(msg.timestamp) || null,
        }))
        .filter((msg) => msg.text)
        .slice(-12)
    : [];

  if (!thread.length) return json(400, { error: "Brak wiadomosci do analizy." });

  const suggestion = await openAiChat({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    system:
      "Pomagasz administratorowi Fresh Market odpisywac uczestnikom. Piszesz po polsku, krotko, konkretnie i uprzejmie. Nie obiecujesz rzeczy, ktorych nie ma w danych. Jesli pytanie dotyczy terminow lub supportu, mozesz oprzec sie tylko na podanych faktach.",
    user: buildSuggestionPrompt(participant, thread),
    temperature: 0.5,
  });

  return json(200, {
    ok: true,
    suggestion: cleanSuggestion(suggestion),
  });
};

function buildSuggestionPrompt(participant, thread) {
  const history = thread
    .map((msg) => `- ${msg.author === "admin" ? "Admin" : participant.name}: ${msg.text}`)
    .join("\n");

  return [
    "Przygotuj jedna gotowa odpowiedz administratora do wyslania w czacie.",
    "Styl: zyczliwy, rzeczowy, 2-5 zdan, bez bulletow.",
    "Jesli czegos nie da sie potwierdzic, napisz to uczciwie i zaproponuj bezpieczny kolejny krok.",
    "Nie dodawaj podpisu, nie używaj cudzyslowow.",
    "",
    "FAKTY, KTORYCH MOZESZ UZYC:",
    "- Fresh Market 2026 odbedzie sie 24 wrzesnia 2026 w Ozarowie Mazowieckim.",
    "- Plan spotkan z numerami zostanie opublikowany 22 wrzesnia po korektach administratora.",
    "- W pilnych sprawach mozna kontaktowac sie z administratorem: Oksana Kozlowska, oksana@freshmarket.eu, +48 603 811 818.",
    "",
    `ROZMOWCA: ${participant.name} (${participant.role}${participant.title ? `, ${participant.title}` : ""})`,
    "HISTORIA WIADOMOSCI:",
    history,
  ].join("\n");
}

function cleanSuggestion(value) {
  return String(value || "").replace(/\s+\n/g, "\n").trim();
}

function text(value) {
  if (value == null) return null;
  const next = String(value).trim();
  return next || null;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
