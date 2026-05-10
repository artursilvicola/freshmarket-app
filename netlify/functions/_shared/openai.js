export async function openAiChat({
  apiKey,
  model = "gpt-4.1-mini",
  system,
  user,
  temperature = 0.4,
  responseFormat = null,
}) {
  const payload = {
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(json?.error?.message || text || "OpenAI request failed");
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return typeof content === "string" ? content.trim() : String(content).trim();
}

export function stripHtmlToText(html = "", limit = 4000) {
  const withoutScripts = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return withoutScripts
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export async function fetchWebsiteSnippet(url) {
  if (!url) return { finalUrl: null, text: "" };
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return { finalUrl: null, text: "" };
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "FreshMarketB2B-AI/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return { finalUrl: parsed.toString(), text: "" };
    const html = await res.text();
    return {
      finalUrl: res.url || parsed.toString(),
      text: stripHtmlToText(html),
    };
  } catch {
    return { finalUrl: null, text: "" };
  }
}
