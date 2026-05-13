import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { openAiChat } from "./_shared/openai.js";
import { loadKompendium } from "./_shared/load-kompendium.js";

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

  // [B2B Round prod-rollout / AI knowledge base] Wczytaj kompendium PreConnect.
  // Plik dołączony do bundle przez included_files w netlify.toml. Failure mode:
  // jeśli plik niedostępny → fallback do minimalnych faktów hardcoded niżej.
  const km = loadKompendium();
  if (!km.ok) console.warn("[ai-admin-chat-suggestion] kompendium fallback:", km.reason);

  const systemPrompt = buildSystemPrompt(km.content);
  const userPrompt = buildSuggestionPrompt(participant, thread);

  const suggestion = await openAiChat({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    system: systemPrompt,
    user: userPrompt,
    temperature: 0.4,
  });

  return json(200, {
    ok: true,
    suggestion: cleanSuggestion(suggestion),
    kompendium_loaded: km.ok,
    kompendium_files: km.loaded,
  });
};

// [B2B Round prod-rollout / AI knowledge base]
// System prompt zawiera pełną bazę wiedzy o PreConnect (FM 2026, role, pakiety,
// FAQ dostawców/kupców, słownik, ważne daty). Asystent generuje odpowiedzi
// ZGODNIE z faktami w bazie, bez wymyślania. Jeśli plik niedostępny — używamy
// minimalnego fallback'u, ale logujemy ostrzeżenie w Netlify.
function buildSystemPrompt(kompendiumContent) {
  const introRules = [
    "Jesteś asystentem administratora Fresh Market. Pomagasz adminowi formułować odpowiedzi na pytania dostawców (suppliers) i kupców (buyers) w panelu PreConnect.",
    "",
    "ZASADY FORMATOWANIA:",
    "- Odpowiadasz w języku rozmówcy (PL lub EN — zależnie od historii wiadomości).",
    "- Styl: życzliwy, rzeczowy, biznesowy. 2–5 zdań. Bez bulletów, bez nagłówków, bez cudzysłowów.",
    "- Bez podpisu na końcu (admin dodaje sam).",
    "- Krótko: max 80 słów.",
    "",
    "ZASADY MERYTORYCZNE:",
    "- Korzystaj WYŁĄCZNIE z faktów z bazy wiedzy poniżej.",
    "- Nigdy nie obiecuj rzeczy nieoczywistych: spotkania 1:1 zależą od akceptacji kupców, finalny harmonogram od algorytmu i admina.",
    "- Jeśli pytanie wykracza poza bazę wiedzy — odpowiedz uczciwie 'sprawdzę i wrócę' albo skieruj do organizatora (Oksana Kozłowska, oksana@freshmarket.eu).",
    "- Nie wymyślaj cen, dat ani liczb — używaj tylko tych z bazy.",
  ];

  if (!kompendiumContent) {
    introRules.push(
      "",
      "MINIMALNA BAZA FAKTÓW (fallback — pełna baza wiedzy nie załadowała się):",
      "- Fresh Market 2026: 24 września 2026, Ożarów Mazowiecki, Ptak Warsaw Expo.",
      "- Plan spotkań publikowany 22 września po korektach admina.",
      "- Kontakt do organizatora: Oksana Kozłowska, oksana@freshmarket.eu, +48 603 811 818.",
      "- PreConnect (app.freshmarket.eu / freshmarketb2b.netlify.app) = panel B2B z profilami firm, ofertami, matchmakingiem i harmonogramem spotkań."
    );
    return introRules.join("\n");
  }

  introRules.push(
    "",
    "BAZA WIEDZY składa się z DWÓCH CZĘŚCI — czytaj OBYDWIE przed każdą odpowiedzią:",
    "  • CZĘŚĆ A — Kompendium PreConnect (panel B2B): role, workflow, pakiety wysyłek, FAQ techniczne.",
    "  • CZĘŚĆ B — Kompendium Fresh Market 2026 (event): cennik uczestnictwa, pakiety Standard/Business/Premium, stoiska, agenda, FAQ klienta.",
    "",
    "Pytania o panel B2B / oferty / wysyłki → CZĘŚĆ A.",
    "Pytania o cenę udziału / pakiety / stoiska / agendę / fakturę → CZĘŚĆ B.",
    "Jeśli pytanie mieszane — łącz obie części.",
    "",
    kompendiumContent.trim()
  );
  return introRules.join("\n");
}

function buildSuggestionPrompt(participant, thread) {
  const history = thread
    .map((msg) => `- ${msg.author === "admin" ? "Admin" : participant.name}: ${msg.text}`)
    .join("\n");

  return [
    `ROZMÓWCA: ${participant.name} (rola: ${participant.role}${participant.title ? `, ${participant.title}` : ""})`,
    "",
    "HISTORIA WIADOMOŚCI (od najstarszej):",
    history,
    "",
    "ZADANIE:",
    "Przygotuj JEDNĄ gotową odpowiedź administratora do wysłania w czacie. Odnieś się do OSTATNIEJ wiadomości od rozmówcy. Stosuj zasady ze system prompt (styl, długość, fakty z bazy wiedzy).",
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
