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
    "═══ NAJWAŻNIEJSZE — JAK CZYTAĆ HISTORIĘ WIADOMOŚCI ═══",
    "- OSTATNIA wiadomość w historii to AKTUALNE pytanie, na które masz odpowiedzieć.",
    "- Wcześniejsze wiadomości to TYLKO KONTEKST — nie odnoś się do nich, chyba że ostatnia wiadomość bezpośrednio o nie pyta.",
    "- Jeśli ostatnia wiadomość to nowe pytanie, IGNORUJ tematy z wcześniejszych wiadomości.",
    "- Przykład: jeśli rozmówca napisał wcześniej o aktywacji konta, a w ostatniej wiadomości pyta o cenę udziału — odpowiadasz TYLKO na pytanie o cenę.",
    "",
    "ZASADY FORMATOWANIA:",
    "- Odpowiadasz w języku rozmówcy (PL lub EN — zależnie od ostatniej wiadomości).",
    "- Styl: życzliwy, rzeczowy, biznesowy. 2–5 zdań. Bez bulletów, bez nagłówków, bez cudzysłowów.",
    "- Bez podpisu na końcu (admin dodaje sam).",
    "- Krótko: max 80 słów.",
    "",
    "ZASADY MERYTORYCZNE (KRYTYCZNE — NIE HALUCYNUJ):",
    "- Korzystaj WYŁĄCZNIE z faktów z bazy wiedzy poniżej. NIE wymyślaj danych.",
    "- Zakaz wymyślania liczb, cen, terminów, zasad, mechanizmów. Jeśli czegoś nie ma w bazie wiedzy poniżej — NIE pisz tego.",
    "- Zakaz pisania o '14 dniach zwrotu kredytu' lub podobnych nieaktualnych zasadach billingu — model rozliczeń to NIE jest dziś relewantne dla pytań o cenę udziału w evencie.",
    "- Nigdy nie obiecuj rzeczy nieoczywistych: spotkania 1:1 zależą od akceptacji kupców, finalny harmonogram od algorytmu i admina.",
    "- Jeśli pytanie wykracza poza bazę wiedzy — odpowiedz uczciwie 'sprawdzę i wrócę z konkretną odpowiedzią' albo skieruj do Oksany (oksana@freshmarket.eu, +48 603 811 818).",
    "",
    "MAPOWANIE PYTAŃ NA CZĘŚCI BAZY:",
    "- 'Ile kosztuje udział?', 'Cena pakietu?', 'Ile za stoisko?' → Część B sekcje 8 (pakiety) + 9 (cennik) + 10 (stoiska).",
    "- 'Kiedy event?', 'Gdzie?', 'Agenda?' → Część B sekcje 0, 1, 7.",
    "- 'Jak działają spotkania B2B?', 'Co to networking?' → Część B sekcje 5, 6.",
    "- 'Jak zalogować się?', 'Jak dodać ofertę?', 'Jak działa PreConnect?' → Część A.",
    "- 'Kiedy mogę aktywować konto?', 'Kiedy plan spotkań?' → Część B sekcja 18 (ważne daty).",
  ];

  if (!kompendiumContent) {
    introRules.push(
      "",
      "MINIMALNA BAZA FAKTÓW (fallback — pełna baza wiedzy nie załadowała się):",
      "- Fresh Market 2026: 24 września 2026, Ożarów Mazowiecki, Ptak Warsaw Expo.",
      "- Plan spotkań publikowany 22 września po korektach admina.",
      "- Kontakt do organizatora: Oksana Kozłowska, oksana@freshmarket.eu, +48 603 811 818.",
      "- PreConnect (b2b.freshmarket.eu) = panel B2B z profilami firm, ofertami, matchmakingiem i harmonogramem spotkań."
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
  // Najnowsza wiadomość od rozmówcy (NIE od admina) — to jest pytanie do odpowiedzi.
  const lastFromParticipant = [...thread].reverse().find((msg) => msg.author !== "admin");
  const lastQuestion = lastFromParticipant?.text || "(brak)";

  const history = thread
    .map((msg, i) => {
      const isLast = i === thread.length - 1;
      const role = msg.author === "admin" ? "Admin" : participant.name;
      return `${isLast ? "→ " : "  "}${role}: ${msg.text}`;
    })
    .join("\n");

  return [
    `ROZMÓWCA: ${participant.name} (rola: ${participant.role}${participant.title ? `, ${participant.title}` : ""})`,
    "",
    "HISTORIA WIADOMOŚCI (od najstarszej, strzałka → wskazuje OSTATNIĄ):",
    history,
    "",
    "═══ AKTUALNE PYTANIE (na to MASZ odpowiedzieć) ═══",
    lastQuestion,
    "═══════════════════════════════════════════════════",
    "",
    "ZADANIE:",
    "1. Zidentyfikuj o co PYTA rozmówca w AKTUALNYM PYTANIU powyżej.",
    "2. Znajdź odpowiedź w bazie wiedzy (Część A albo B — patrz MAPOWANIE PYTAŃ w system prompt).",
    "3. Napisz JEDNĄ gotową odpowiedź administratora (2–5 zdań, max 80 słów, bez podpisu, bez cudzysłowów, w języku rozmówcy).",
    "4. Jeśli odpowiedź wymaga liczb/cen/dat — WYŁĄCZNIE z bazy wiedzy. Jeśli czegoś nie ma — napisz 'sprawdzę i wrócę z konkretami' albo skieruj do Oksany.",
    "5. NIE odpowiadaj na wcześniejsze tematy z historii — tylko na AKTUALNE PYTANIE.",
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
