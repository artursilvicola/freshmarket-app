/**
 * Netlify Function: marketing-unsubscribe
 * GET  /.netlify/functions/marketing-unsubscribe?m=<message_id>&t=<token>   → strona potwierdzenia
 * POST /.netlify/functions/marketing-unsubscribe?m=...&t=...                → wypis
 *      (także one-click: body `List-Unsubscribe=One-Click`, RFC 8058)
 *
 * [feat/marketing-activation] Bez logowania, bez ujawniania adresu (strona nie
 * pokazuje e-maila — tylko potwierdzenie). Token = HMAC(secret, message_id);
 * adres bierzemy z wiersza wiadomości, nie z parametru. Nie jest tokenem logowania.
 * Wypis trafia do marketing_suppressions (trwały) i wyklucza niewysłane wiadomości
 * do tego adresu. Nie wyłącza maili usługowych (decyzja Artura).
 *
 * Działa także po cofnięciu frontendu: nie zależy od UI ani flagi wysyłki.
 */
import { createClient } from "@supabase/supabase-js";
import { resolveEnvConfig, missingEnvNames } from "./_shared/function-env.js";
import { verifyUnsubscribeToken } from "./_shared/marketing-mailer.js";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(statusCode, title, text, { form = null, lang = "pl" } = {}) {
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<div style="max-width:520px;margin:48px auto;background:white;border-radius:12px;padding:32px;box-shadow:0 4px 18px rgba(15,23,42,.08);">
<div style="font-weight:800;font-size:18px;margin-bottom:12px;">Fresh Market PreConnect</div>
<h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${text}</p>
${form || ""}
</div></body></html>`;
  return { statusCode, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, body: html };
}

export const handler = async (event) => {
  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "marketingUnsubscribeSecret"]);
  if (missing.length) return page(500, "Błąd konfiguracji / Configuration error", "Wypis jest chwilowo niedostępny. / Unsubscribe is temporarily unavailable.");

  const q = event.queryStringParameters || {};
  const messageId = String(q.m || "").trim();
  const token = String(q.t || "").trim();
  if (!UUID_RX.test(messageId) || !verifyUnsubscribeToken(env.marketingUnsubscribeSecret, messageId, token)) {
    return page(400, "Nieprawidłowy link / Invalid link", "Ten link wypisu jest nieprawidłowy lub niekompletny. / This unsubscribe link is invalid or incomplete.");
  }

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: msg, error } = await supaSvc.from("marketing_messages").select("id, to_email, locale, campaign_id, profile_id, is_test").eq("id", messageId).maybeSingle();
  if (error || !msg) return page(404, "Nie znaleziono / Not found", "Nie znaleziono wiadomości, której dotyczy ten link. / The message for this link was not found.");
  const lang = msg.locale === "en" ? "en" : "pl";

  if (event.httpMethod === "GET") {
    const form = `<form method="post" action="/.netlify/functions/marketing-unsubscribe?m=${encodeURIComponent(messageId)}&t=${encodeURIComponent(token)}">
      <button type="submit" style="background:#0d9488;color:white;border:none;border-radius:8px;padding:12px 22px;font-weight:700;font-size:15px;cursor:pointer;">${lang === "en" ? "Unsubscribe" : "Wypisz mnie"}</button></form>`;
    return page(200, lang === "en" ? "Unsubscribe from PreConnect information" : "Wypis z informacji o PreConnect",
      lang === "en"
        ? "Confirm that you no longer want to receive information e-mails about PreConnect. Service messages about your account (status, credits, buyer reads) are not affected."
        : "Potwierdź, że nie chcesz otrzymywać wiadomości informacyjnych o PreConnect. Wiadomości usługowe o koncie (status, kredyty, odczyty kupców) pozostają bez zmian.",
      { form, lang });
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: { Allow: "GET, POST" }, body: "" };

  const oneClick = /List-Unsubscribe=One-Click/i.test(String(event.body || ""));
  // [review Codexa #1] wiadomość testowa (kopia dla zespołu) — wypis nie zapisuje niczego:
  // ani adresu zespołu, ani (tym bardziej) prawdziwego adresata
  if (msg.is_test) {
    if (oneClick) return { statusCode: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "test message - nothing recorded" };
    return page(200, lang === "en" ? "Test message" : "Wiadomość testowa", lang === "en" ? "This was a test copy for the team. Nothing has been recorded." : "To była kopia testowa dla zespołu. Nic nie zostało zapisane.", { lang });
  }
  const { data, error: supErr } = await supaSvc.rpc("marketing_suppress_email", {
    p_email: msg.to_email, p_reason: "unsubscribe", p_source: oneClick ? "one-click" : "page", p_campaign_id: msg.campaign_id, p_profile_id: msg.profile_id,
  });
  if (supErr || !data?.ok) return page(500, "Błąd / Error", "Nie udało się zapisać wypisu. Spróbuj ponownie. / Could not save your request. Please try again.");
  if (oneClick) return { statusCode: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "unsubscribed" };
  return page(200, lang === "en" ? "You have been unsubscribed" : "Wypisano",
    lang === "en" ? "You will not receive further PreConnect information e-mails." : "Nie będziesz otrzymywać kolejnych wiadomości informacyjnych o PreConnect.", { lang });
};
