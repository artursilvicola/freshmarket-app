/**
 * Netlify Function: fm-plan-send
 * POST /.netlify/functions/fm-plan-send
 *
 * [feat/fm-plan-export] Wysyła JEDNĄ kartę spotkań (PDF wygenerowany w panelu
 * admina) na adresy firmy/sieci przez Resend. Panel woła tę funkcję w pętli
 * (karta po karcie) i pokazuje postęp — dzięki temu nie ma ciężkich zależności
 * (pdfmake/sharp) po stronie serwera, a renderer jest jeden (przeglądarka admina).
 *
 * Body (JSON):
 *   kind: "supplier" | "chain", id: uuid|int, name, lang: "pl"|"en",
 *   to: [emails], filename: "….pdf", pdfBase64, test?: boolean (nie oznacza wysyłki)
 * Auth: Bearer JWT admina (profiles.role = 'admin').
 * Po sukcesie (gdy !test): companies/retailers.fm_plan_sent_at = now() (migracja 051;
 * brak kolumny jest ignorowany).
 */
import { createClient } from "@supabase/supabase-js";
import { resolveEnvConfig, missingEnvNames, envErrorPayload } from "./_shared/function-env.js";

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
const MAX_PDF_BYTES = 4 * 1024 * 1024;

const MAIL = {
  pl: {
    subject: (k) => (k === "supplier" ? "Fresh Market 2026 — Twój plan spotkań B2B (24 września)" : "Fresh Market 2026 — kolejka spotkań B2B dla Państwa sieci (24 września)"),
    body: (k, name) => `
      <p>Dzień dobry,</p>
      <p>w załączniku przesyłamy ${k === "supplier" ? "<b>plan spotkań B2B</b> firmy <b>" + name + "</b>" : "<b>kolejkę spotkań B2B</b> dla sieci <b>" + name + "</b>"} na Fresh Market 2026 — <b>24 września 2026</b>, MCC Mazurkas, Ożarów Mazowiecki (rejestracja 8:00–9:00).</p>
      <p>${k === "supplier"
        ? "Na karcie znajdą Państwo numery spotkań, sieci handlowe i wejście (GATE 1 / GATE 2), przy którym stoi logo danej sieci. Obowiązuje kolejność numerów, nie godziny — aktualnie obsługiwane numery widać w aplikacji <b>b2b.freshmarket.eu</b> i na dużym ekranie w sali spotkań. Kartę warto wydrukować lub mieć w telefonie."
        : "Na karcie znajdą Państwo kolejność dostawców (z logo, krajem, krótkim opisem i kontaktem), informacje o dniu spotkań oraz kontakty do naszego zespołu. Spotkania zaczynają się o 10:00 (na życzenie od 9:00), lunch 13:00–14:00, koniec rozmów B2B o 17:00, po czym zapraszamy na uroczystą kolację (sala Bolero)."}</p>
      <p>Pytania w dniu wydarzenia: Oksana Kozłowska (PL) · oksana@freshmarket.eu · tel. +48 509 086 949; Jagoda Knadel (EN) · jagoda.knadel@freshmarket.eu · tel./WhatsApp +48 603 811 818.</p>
      <p>Do zobaczenia na Fresh Market!<br>Zespół Fresh Market · support@freshmarket.eu</p>`,
  },
  en: {
    subject: (k) => (k === "supplier" ? "Fresh Market 2026 — your B2B meeting schedule (24 September)" : "Fresh Market 2026 — B2B meeting queue for your chain (24 September)"),
    body: (k, name) => `
      <p>Dear Partner,</p>
      <p>please find attached ${k === "supplier" ? "the <b>B2B meeting schedule</b> for <b>" + name + "</b>" : "the <b>B2B meeting queue</b> for <b>" + name + "</b>"} at Fresh Market 2026 — <b>24 September 2026</b>, MCC Mazurkas, Ożarów Mazowiecki near Warsaw (registration 8:00–9:00).</p>
      <p>${k === "supplier"
        ? "The card lists your meeting numbers, the retail chains and the entrance (GATE 1 / GATE 2) where each chain’s logo is displayed. The order of numbers applies, not fixed times — the numbers currently being served are shown in the <b>b2b.freshmarket.eu</b> app and on the big screen in the meeting hall. Please print the card or keep it on your phone."
        : "The card lists the suppliers in meeting order (with logo, country, short description and contact), information about the meeting day and our team’s contacts. Meetings start at 10:00 (from 9:00 on request), lunch 13:00–14:00, B2B meetings end at 17:00, followed by the gala dinner (Bolero hall)."}</p>
      <p>Questions on the day: Jagoda Knadel (EN) · jagoda.knadel@freshmarket.eu · tel./WhatsApp +48 603 811 818; Oksana Kozłowska (PL) · oksana@freshmarket.eu · tel. +48 509 086 949.</p>
      <p>See you at Fresh Market!<br>Fresh Market Team · support@freshmarket.eu</p>`,
  },
};

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "resendApiKey"]);
  if (missing.length) return json(500, envErrorPayload("fm-plan-send", missing));

  // ── auth: admin ────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "no_auth_header" });
  const token = authHeader.slice(7);
  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return json(401, { error: "invalid_token" });
  const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: profile } = await db.from("profiles").select("role, email").eq("id", userData.user.id).maybeSingle();
  if (profile?.role !== "admin") return json(403, { error: "admin_only" });

  // ── body ───────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "invalid_json" }); }
  const kind = body.kind === "chain" ? "chain" : "supplier";
  const lang = body.lang === "pl" ? "pl" : "en";
  const name = String(body.name || "").slice(0, 200);
  const to = Array.isArray(body.to) ? body.to.map((e) => String(e).trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) : [];
  const pdfBase64 = String(body.pdfBase64 || "");
  const filename = String(body.filename || "karta.pdf").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  if (!to.length) return json(400, { error: "no_recipients" });
  if (!pdfBase64 || pdfBase64.length * 0.75 > MAX_PDF_BYTES) return json(400, { error: "pdf_missing_or_too_large" });

  // ── Resend ─────────────────────────────────────────────────────────────
  const m = MAIL[lang];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.resendApiKey}` },
    body: JSON.stringify({
      from: "Fresh Market <newsletter@freshmarket.eu>",
      reply_to: "support@freshmarket.eu",
      to,
      subject: (body.test ? "[TEST] " : "") + m.subject(kind),
      html: m.body(kind, name),
      attachments: [{ filename, content: pdfBase64 }],
      tags: [{ name: "fm2026", value: body.test ? "plan-card-test" : `plan-card-${kind}` }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return json(502, { error: "resend_error", status: res.status, detail: detail.slice(0, 400) });
  }
  const sent = await res.json().catch(() => ({}));

  // ── znacznik wysyłki (kolumna z migracji 051; brak kolumny = ignoruj) ──
  let marked = false;
  if (!body.test && body.id != null) {
    const table = kind === "chain" ? "retailers" : "companies";
    const { error } = await db.from(table).update({ fm_plan_sent_at: new Date().toISOString() }).eq("id", body.id);
    marked = !error;
  }
  return json(200, { ok: true, id: sent.id || null, to, marked });
}
