/**
 * Netlify Function: fm-plan-send
 * POST /.netlify/functions/fm-plan-send
 *
 * [feat/fm-plan-send-server-card] Wysyła JEDNĄ kartę spotkań B2B na adresy
 * firmy/sieci przez Resend. Karta jest GENEROWANA NA SERWERZE z zatwierdzonego
 * planu (fm_plan_private) tym samym rendererem co panel/CLI (layout.js).
 * Przeglądarka administratora nie przesyła już PDF-a — jedyne, co dostarcza,
 * to logotypy (PNG/JPEG data URI zdekodowane w przeglądarce, bo Supabase
 * trzyma je jako WebP). Obraz nie może wnieść cudzych spotkań, nazwisk ani
 * numerów: dane karty pochodzą wyłącznie z bazy, więc PDF zawiera dokładnie
 * kartę wskazanego odbiorcy, także gdy ma kilka stron.
 *
 * Body (JSON):
 *   kind: "supplier" | "chain", id: uuid|int,
 *   planUpdatedAt: ISO — wersja planu, którą admin oglądał w panelu (musi być
 *                  równa fm_plan_private.updated_at; inaczej 409 plan_changed),
 *   logos?: { self?: dataUri, [cid|supplierId]: dataUri } — opcjonalne obrazy,
 *   test?: boolean — wysyłka WYŁĄCZNIE na adres zalogowanego administratora
 *          (bez rejestru doręczeń, bez znacznika; przy braku planu karta
 *          symulacyjna ze znakiem wodnym — nigdy w wysyłce właściwej).
 * Auth: Bearer JWT admina (profiles.role = 'admin' i active ≠ false).
 *
 * Wysyłka właściwa wymaga: fazy published/final_published/event_day,
 * istniejącego planu, zgodnej wersji planu i co najmniej jednego spotkania
 * odbiorcy. Adresaci zawsze z bazy (profile firmy/sieci), nigdy z żądania.
 * Każdy adresat dostaje OSOBNĄ wiadomość; rejestr fm_plan_deliveries
 * (UNIQUE kind+target+email+wersja planu, rezerwacja 'sending' przed wysyłką)
 * sprawia, że ponowienie po częściowym błędzie nie wysyła drugi raz do już
 * obsłużonych adresatów, a dwa równoległe wywołania nie dublują maili.
 */
import { createClient } from "@supabase/supabase-js";
import PdfPrinter from "pdfmake";
import { resolveEnvConfig, missingEnvNames, envErrorPayload } from "./_shared/function-env.js";
import { loadFmPlanRaw } from "./_shared/fm-plan-raw.js";
import { buildPlanModel } from "../../src/lib/fm-plan/model.js";
import { supplierDoc, chainDoc } from "../../src/lib/fm-plan/layout.js";
import { FM_PLAN_FONTS_VFS, FM_PLAN_FONT_FAMILIES } from "../../src/lib/fm-plan/fonts.js";

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLISHED_PHASES = new Set(["published", "final_published", "event_day"]);
const LOGO_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_LOGO_BYTES = 200 * 1024;      // jeden logotyp
const MAX_LOGOS_BYTES = 4 * 1024 * 1024; // wszystkie logotypy w żądaniu
const STALE_CLAIM_MS = 15 * 60 * 1000;   // porzucona rezerwacja 'sending' (np. timeout funkcji)

const uniqueEmails = (rows) => [...new Set((rows || []).map((row) => String(row.email || "").trim().toLowerCase()).filter((email) => EMAIL_RE.test(email)))];
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&amp;/g, "and").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

// ── karta odbiorcy z modelu (czysta logika, testowana osobno) ────────────
export function findCard(model, kind, id) {
  if (kind === "supplier") return model.suppliers.find((s) => String(s.id) === String(id)) || null;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return null;
  return model.chains.find((c) => Number(c.id) === rid) || null;
}

// Logotypy z przeglądarki: tylko PNG/JPEG data URI, tylko klucze należące do
// tej karty ("self" = odbiorca; cid sieci na karcie dostawcy; id firmy na
// karcie sieci). Cokolwiek innego jest ignorowane i raportowane.
export function attachLogos(card, logos) {
  const ignored = [];
  const input = logos && typeof logos === "object" && !Array.isArray(logos) ? logos : {};
  let total = 0;
  const valid = (key) => {
    const v = input[key];
    if (v == null) return null;
    const m = typeof v === "string" && v.length <= MAX_LOGO_BYTES * 1.4 ? LOGO_RE.exec(v) : null;
    const bytes = m ? Math.floor(m[2].length * 0.75) : 0;
    if (!m || bytes > MAX_LOGO_BYTES) { ignored.push(key); return null; }
    total += bytes;
    if (total > MAX_LOGOS_BYTES) { ignored.push(key); return null; }
    return v;
  };
  const allowed = new Set(["self"]);
  card.logo = valid("self");
  for (const m of card.meetings) {
    const key = card.kind === "supplier" ? String(m.chain.cid) : String(m.supplier.id);
    allowed.add(key);
    const target = card.kind === "supplier" ? m.chain : m.supplier;
    target.logo = valid(key);
  }
  for (const key of Object.keys(input)) if (!allowed.has(key)) ignored.push(key);
  return { ignored: [...new Set(ignored)] };
}

let printer = null;
function getPrinter() {
  if (!printer) {
    const fonts = Object.fromEntries(Object.entries(FM_PLAN_FONT_FAMILIES).map(([fam, v]) => [fam, Object.fromEntries(Object.entries(v).map(([k, f]) => [k, Buffer.from(FM_PLAN_FONTS_VFS[f], "base64")]))]));
    printer = new PdfPrinter(fonts);
  }
  return printer;
}
export function renderCardPdf(card, mode) {
  const def = card.kind === "supplier" ? supplierDoc(card, { mode }) : chainDoc(card, { mode });
  return new Promise((resolve, reject) => {
    const doc = getPrinter().createPdfKitDocument(def);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.end();
  });
}

async function resolveRecipients(db, kind, card) {
  if (kind === "supplier") {
    const { data: company, error } = await db.from("companies").select("id, name, fm_b2b_enabled, account_status, fm_plan_sent_at").eq("id", card.id).maybeSingle();
    if (error) return { error: "company_lookup_failed" };
    if (!company || company.fm_b2b_enabled !== true || ["suspended", "rejected"].includes(company.account_status)) return { error: "supplier_not_eligible" };
    const { data: profiles, error: profilesError } = await db.from("profiles").select("email, role, active").eq("company_id", company.id).eq("role", "supplier");
    if (profilesError) return { error: "supplier_recipients_lookup_failed" };
    return { name: company.name, recipients: uniqueEmails((profiles || []).filter((p) => p.active !== false)) };
  }
  const { data: retailer, error } = await db.from("retailers").select("id, name, fm26_active, fm_plan_sent_at").eq("id", card.id).maybeSingle();
  if (error) return { error: "retailer_lookup_failed" };
  if (!retailer || retailer.fm26_active !== true) return { error: "retailer_not_eligible" };
  const { data: profiles, error: profilesError } = await db.from("profiles").select("email, role, active, fm26_active").eq("retailer_id", retailer.id).eq("role", "buyer");
  if (profilesError) return { error: "buyer_recipients_lookup_failed" };
  return { name: retailer.name, recipients: uniqueEmails((profiles || []).filter((p) => p.active !== false && p.fm26_active !== false)) };
}

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

async function sendViaResend(env, { to, subject, html, filename, pdf, tag }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.resendApiKey}` },
    body: JSON.stringify({
      from: "Fresh Market <newsletter@freshmarket.eu>", reply_to: "support@freshmarket.eu",
      to: [to], subject, html,
      attachments: [{ filename, content: pdf.toString("base64") }],
      tags: [{ name: "fm2026", value: tag }],
    }),
  });
  if (!res.ok) { const detail = await res.text().catch(() => ""); return { error: `resend_${res.status}${detail ? ": " + detail.slice(0, 200) : ""}` }; }
  const sent = await res.json().catch(() => ({}));
  return { id: sent.id || null };
}

const sameInstant = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && x === y; };

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "resendApiKey"]);
  if (missing.length) return json(500, envErrorPayload("fm-plan-send", missing));

  // ── auth: aktywny admin ────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "no_auth_header" });
  const token = authHeader.slice(7);
  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: uErr } = await supaUser.auth.getUser(token);
  if (uErr || !userData?.user) return json(401, { error: "invalid_token" });
  const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: profile } = await db.from("profiles").select("role, email, active").eq("id", userData.user.id).maybeSingle();
  if (profile?.role !== "admin" || profile.active === false) return json(403, { error: "admin_only" });

  // ── body ───────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "invalid_json" }); }
  if (body.kind !== "supplier" && body.kind !== "chain") return json(400, { error: "invalid_kind" });
  const kind = body.kind;
  const test = body.test === true;
  if (body.pdfBase64 != null) return json(400, { error: "pdf_not_accepted" }); // karta powstaje na serwerze

  // ── plan: faza, istnienie, wersja ──────────────────────────────────────
  const raw = await loadFmPlanRaw(db);
  if (raw.error) return json(500, { error: raw.error });
  const phase = String(raw.settings?.algo_phase || "").trim().toLowerCase();
  const hasPlan = !!(raw.settings?.schedule && raw.plan_updated_at);
  if (!test) {
    if (!PUBLISHED_PHASES.has(phase)) return json(409, { error: "plan_not_published" });
    if (!hasPlan) return json(409, { error: "plan_missing" });
    if (!body.planUpdatedAt || !sameInstant(body.planUpdatedAt, raw.plan_updated_at)) return json(409, { error: "plan_changed", plan_updated_at: raw.plan_updated_at });
  }
  const model = buildPlanModel(raw, { simulate: test && !hasPlan });
  if (!test && model.mode !== "final") return json(409, { error: "plan_not_final" });
  const card = findCard(model, kind, body.id);
  if (!card) return json(400, { error: "card_not_found" });
  if (!card.meetings.length) return json(409, { error: "no_meetings" });
  const { ignored: logosIgnored } = attachLogos(card, body.logos);

  // ── adresaci (zawsze z bazy) ───────────────────────────────────────────
  const rec = await resolveRecipients(db, kind, card);
  if (rec.error) return json(400, { error: rec.error });
  const recipients = test ? uniqueEmails([{ email: profile.email }]) : rec.recipients;
  if (!recipients.length) return json(400, { error: test ? "admin_email_missing" : "no_canonical_recipients" });
  const name = String(rec.name || card.name || "").slice(0, 200);

  // ── render na serwerze ─────────────────────────────────────────────────
  let pdf;
  try { pdf = await renderCardPdf(card, model.mode); } catch (e) { return json(500, { error: "render_failed", detail: String(e?.message || e).slice(0, 200) }); }
  const filename = `${card.card}-${slug(name)}-${card.lang}.pdf`;
  const m = MAIL[card.lang === "pl" ? "pl" : "en"];
  const subject = (test ? "[TEST] " : "") + m.subject(kind);
  const html = m.body(kind, name);
  const targetId = String(card.id);

  // ── wysyłka per adresat + rejestr doręczeń ─────────────────────────────
  const result = { sent: [], already_sent: [], in_progress: [], failed: [] };
  if (test) {
    const r = await sendViaResend(env, { to: recipients[0], subject, html, filename, pdf, tag: "plan-card-test" });
    if (r.error) result.failed.push({ email: recipients[0], error: r.error }); else result.sent.push(recipients[0]);
    return json(result.failed.length ? 502 : 200, { ok: !result.failed.length, test: true, mode: model.mode, filename, ...result, logos_ignored: logosIgnored });
  }

  const ledgerKey = { kind, target_id: targetId, plan_updated_at: raw.plan_updated_at };
  const { data: existing, error: ledgerError } = await db.from("fm_plan_deliveries").select("id, email, status, created_at")
    .eq("kind", kind).eq("target_id", targetId).eq("plan_updated_at", raw.plan_updated_at);
  if (ledgerError) return json(500, { error: "deliveries_lookup_failed" });
  const byEmail = new Map((existing || []).map((r) => [String(r.email).toLowerCase(), r]));

  for (const to of recipients) {
    const prior = byEmail.get(to);
    if (prior?.status === "sent") { result.already_sent.push(to); continue; }
    if (prior?.status === "sending") {
      const age = Date.now() - Date.parse(prior.created_at || 0);
      if (!(age > STALE_CLAIM_MS)) { result.in_progress.push(to); continue; }
      // porzucona rezerwacja (np. timeout) — zwalniamy i próbujemy ponownie
      const { error: delErr } = await db.from("fm_plan_deliveries").delete().eq("id", prior.id).eq("status", "sending");
      if (delErr) { result.failed.push({ email: to, error: "stale_claim_release_failed" }); continue; }
    }
    // rezerwacja PRZED wysyłką: UNIQUE odrzuca równoległy duplikat
    const { data: claim, error: claimErr } = await db.from("fm_plan_deliveries")
      .insert({ ...ledgerKey, email: to, status: "sending", sent_by: userData.user.id }).select("id").single();
    if (claimErr || !claim) { if (claimErr?.code === "23505") result.in_progress.push(to); else result.failed.push({ email: to, error: "delivery_claim_failed" }); continue; }
    const r = await sendViaResend(env, { to, subject, html, filename, pdf, tag: `plan-card-${kind}` });
    if (r.error) {
      await db.from("fm_plan_deliveries").delete().eq("id", claim.id);
      result.failed.push({ email: to, error: r.error });
      continue;
    }
    const { error: doneErr } = await db.from("fm_plan_deliveries").update({ status: "sent", resend_id: r.id, sent_at: new Date().toISOString() }).eq("id", claim.id);
    result.sent.push(to);
    if (doneErr) result.ledger_warning = "delivery_mark_failed";
  }

  // znacznik na rekordzie firmy/sieci dopiero, gdy KAŻDY adresat tej wersji planu ma kartę
  let marked = false;
  if (result.sent.length + result.already_sent.length === recipients.length) {
    const table = kind === "chain" ? "retailers" : "companies";
    const { error } = await db.from(table).update({ fm_plan_sent_at: new Date().toISOString() }).eq("id", card.id);
    marked = !error;
  }
  const ok = !result.failed.length && !result.in_progress.length;
  return json(200, { ok, mode: model.mode, filename, recipient_count: recipients.length, marked, plan_updated_at: raw.plan_updated_at, ...result, logos_ignored: logosIgnored });
}
