/**
 * Netlify Function: fm-plan-send
 * POST /.netlify/functions/fm-plan-send
 *
 * [feat/fm-plan-send-server-card] Wysyła JEDNĄ kartę spotkań B2B na adresy
 * firmy/sieci przez Resend. Karta jest GENEROWANA NA SERWERZE z zatwierdzonego
 * planu (fm_plan_private) tym samym rendererem co panel/CLI (layout.js).
 * Przeglądarka administratora nie dostarcza ŻADNYCH bajtów karty — ani PDF,
 * ani obrazów: logotypy pochodzą wyłącznie z adresów zapisanych w bazie na
 * naszym Supabase Storage (_shared/fm-plan-logos.js). PDF zawiera więc
 * dokładnie kartę wskazanego odbiorcy, także gdy ma kilka stron.
 *
 * Body (JSON):
 *   kind: "supplier" | "chain", id: uuid|int,
 *   planUpdatedAt: ISO — wersja planu z panelu (= fm_plan_private.updated_at,
 *                  inaczej 409 plan_changed),
 *   test?: boolean — WYŁĄCZNIE na adres zalogowanego administratora, bez
 *          rejestru; przy braku planu karta symulacyjna ze znakiem wodnym,
 *   force?: boolean — ponowienie niepewnego doręczenia starszego niż okno
 *          idempotencji dostawcy (24 h); świadoma zgoda na możliwy duplikat.
 * Auth: Bearer JWT admina (profiles.role = 'admin' i active ≠ false).
 *
 * Gwarancje doręczeń (rejestr fm_plan_deliveries + bucket fm-plan-cards):
 *   • karta dla (kind, id, wersja planu) jest renderowana RAZ i zapisywana w
 *     prywatnym buckecie; każde ponowienie używa tych samych bajtów,
 *   • każdy adresat dostaje osobną wiadomość z trwałym Idempotency-Key
 *     (kind, id, adresat, wersja planu) — Resend odtwarza wynik zamiast
 *     wysyłać drugi raz, o ile żądanie jest identyczne (jest: te same bajty),
 *   • wiersz 'sending' powstaje PRZED wysyłką (UNIQUE blokuje równoległy
 *     duplikat) i NIGDY nie jest usuwany po niepewnym wyniku (5xx, timeout,
 *     nieudany zapis potwierdzenia) — ponowienie odtwarza to samo żądanie;
 *     usuwany tylko po jednoznacznej odmowie dostawcy (4xx) dla świeżej próby,
 *   • mail przyjęty, ale zapis potwierdzenia nieudany = 'unconfirmed', nie
 *     sukces; znacznik fm_plan_sent_at dopiero, gdy KAŻDY adresat ma 'sent'.
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import PdfPrinter from "pdfmake";
import { resolveEnvConfig, missingEnvNames, envErrorPayload } from "./_shared/function-env.js";
import { loadFmPlanRaw } from "./_shared/fm-plan-raw.js";
import { attachCanonicalLogos, webpToPngDataUri } from "./_shared/fm-plan-logos.js";
// re-eksport do smoke-testu spakowanej funkcji (dekoder WASM w bundlu); bez wpływu na handler
export { webpToPngDataUri };
import { buildPlanModel } from "../../src/lib/fm-plan/model.js";
import { supplierDoc, chainDoc } from "../../src/lib/fm-plan/layout.js";
import { FM_PLAN_FONTS_VFS, FM_PLAN_FONT_FAMILIES } from "../../src/lib/fm-plan/fonts.js";

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLISHED_PHASES = new Set(["published", "final_published", "event_day"]);
const BUCKET = "fm-plan-cards";
const LEDGER = "fm_plan_deliveries";
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // Resend przechowuje klucze 24 h

const uniqueEmails = (rows) => [...new Set((rows || []).map((row) => String(row.email || "").trim().toLowerCase()).filter((email) => EMAIL_RE.test(email)))];
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&amp;/g, "and").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const planTag = (ts) => String(ts).replace(/[^0-9]/g, "").slice(0, 20);
export const artefactPath = (kind, targetId, planAt) => `${planTag(planAt)}/${kind}-${String(targetId).replace(/[^0-9A-Za-z-]/g, "")}.pdf`;
export const idempotencyKey = (kind, targetId, planAt, email, suffix = "") =>
  `fm2026-${kind}-${String(targetId).replace(/[^0-9A-Za-z]/g, "")}-${sha256(String(email).toLowerCase()).slice(0, 24)}-${planTag(planAt)}${suffix}`;

// ── karta odbiorcy z modelu ──────────────────────────────────────────────
export function findCard(model, kind, id) {
  if (kind === "supplier") return model.suppliers.find((s) => String(s.id) === String(id)) || null;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return null;
  return model.chains.find((c) => Number(c.id) === rid) || null;
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

// Artefakt: jeden PDF per (kind, id, wersja planu). Pierwszy zapis wygrywa (upsert: false);
// przy wyścigu pobieramy zapisaną wersję, żeby wszystkie ponowienia miały te same bajty.
async function getOrCreateArtefact(db, card, mode, path) {
  const bucket = db.storage.from(BUCKET);
  const first = await bucket.download(path);
  if (!first.error && first.data) return { pdf: Buffer.from(await first.data.arrayBuffer()), reused: true };
  const pdf = await renderCardPdf(card, mode);
  const up = await bucket.upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (!up.error) return { pdf, reused: false };
  const again = await bucket.download(path);
  if (!again.error && again.data) return { pdf: Buffer.from(await again.data.arrayBuffer()), reused: true };
  throw new Error("artefact_store_failed: " + String(up.error.message || up.error));
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

async function sendViaResend(env, { to, subject, html, filename, pdf, tag, idempotencyKey: key }) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${env.resendApiKey}` };
  if (key) headers["Idempotency-Key"] = key;
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers,
      body: JSON.stringify({
        from: "Fresh Market <newsletter@freshmarket.eu>", reply_to: "support@freshmarket.eu",
        to: [to], subject, html,
        attachments: [{ filename, content: pdf.toString("base64") }],
        tags: [{ name: "fm2026", value: tag }],
      }),
    });
  } catch (e) { return { error: "resend_network: " + String(e?.message || e).slice(0, 120), status: 0, uncertain: true }; }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const conflict = res.status === 409 || /idempoten/i.test(detail);
    return { error: `resend_${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`, status: res.status, conflict, uncertain: res.status >= 500 };
  }
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
  const force = body.force === true;
  // Żadne bajty karty z klienta: ani PDF, ani obrazy.
  if (body.pdfBase64 != null || body.logos != null) return json(400, { error: "client_payload_not_accepted" });

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

  // ── adresaci (zawsze z bazy) ───────────────────────────────────────────
  const rec = await resolveRecipients(db, kind, card);
  if (rec.error) return json(400, { error: rec.error });
  const recipients = test ? uniqueEmails([{ email: profile.email }]) : rec.recipients;
  if (!recipients.length) return json(400, { error: test ? "admin_email_missing" : "no_canonical_recipients" });
  const name = String(rec.name || card.name || "").slice(0, 200);
  const filename = `${card.card}-${slug(name)}-${card.lang}.pdf`;
  const m = MAIL[card.lang === "pl" ? "pl" : "en"];
  const subject = (test ? "[TEST] " : "") + m.subject(kind);
  const html = m.body(kind, name);
  const targetId = String(card.id);

  // ── karta: kanoniczne logotypy + artefakt ──────────────────────────────
  let logos;
  try { logos = await attachCanonicalLogos(card, env.supabaseUrl); } catch { logos = { attached: 0, requested: 0 }; }

  if (test) {
    let pdf;
    try { pdf = await renderCardPdf(card, model.mode); } catch (e) { return json(500, { error: "render_failed", detail: String(e?.message || e).slice(0, 200) }); }
    const r = await sendViaResend(env, { to: recipients[0], subject, html, filename, pdf, tag: "plan-card-test" });
    if (r.error) return json(502, { ok: false, test: true, mode: model.mode, filename, failed: [{ email: recipients[0], error: r.error }], logos });
    return json(200, { ok: true, test: true, mode: model.mode, filename, sent: [recipients[0]], logos });
  }

  const path = artefactPath(kind, targetId, raw.plan_updated_at);
  let artefact;
  try { artefact = await getOrCreateArtefact(db, card, model.mode, path); } catch (e) { return json(500, { error: "artefact_failed", detail: String(e?.message || e).slice(0, 200) }); }
  const pdf = artefact.pdf, pdfSha = sha256(pdf);

  // ── wysyłka per adresat + rejestr doręczeń ─────────────────────────────
  const result = { sent: [], already_sent: [], in_progress: [], unconfirmed: [], stale_unconfirmed: [], failed: [] };
  const { data: existing, error: ledgerError } = await db.from(LEDGER).select("id, email, status, created_at, attempts, idempotency_key")
    .eq("kind", kind).eq("target_id", targetId).eq("plan_updated_at", raw.plan_updated_at);
  if (ledgerError) return json(500, { error: "deliveries_lookup_failed" });
  const byEmail = new Map((existing || []).map((r) => [String(r.email).toLowerCase(), r]));
  const now = () => new Date().toISOString();

  for (const to of recipients) {
    const prior = byEmail.get(to);
    if (prior?.status === "sent") { result.already_sent.push(to); continue; }
    let rowId, key, fresh = false;
    if (prior) {
      // Niepewna próba (5xx/timeout/nieudany zapis) — odtwarzamy TO SAMO żądanie: ten sam klucz, te same bajty.
      const age = Date.now() - Date.parse(prior.created_at || 0);
      const stale = !(age <= IDEMPOTENCY_WINDOW_MS);
      if (stale && !force) { result.stale_unconfirmed.push(to); continue; }
      rowId = prior.id;
      key = stale ? idempotencyKey(kind, targetId, raw.plan_updated_at, to, `-f${Date.now()}`) : (prior.idempotency_key || idempotencyKey(kind, targetId, raw.plan_updated_at, to));
      const { error: bumpErr } = await db.from(LEDGER).update({ attempts: (Number(prior.attempts) || 0) + 1, idempotency_key: key, pdf_path: path, pdf_sha256: pdfSha }).eq("id", rowId);
      if (bumpErr) { result.failed.push({ email: to, error: "delivery_update_failed" }); continue; }
    } else {
      key = idempotencyKey(kind, targetId, raw.plan_updated_at, to);
      const { data: claim, error: claimErr } = await db.from(LEDGER)
        .insert({ kind, target_id: targetId, plan_updated_at: raw.plan_updated_at, email: to, status: "sending", sent_by: userData.user.id, idempotency_key: key, pdf_path: path, pdf_sha256: pdfSha, attempts: 1 })
        .select("id").single();
      if (claimErr || !claim) { if (claimErr?.code === "23505") result.in_progress.push(to); else result.failed.push({ email: to, error: "delivery_claim_failed" }); continue; }
      rowId = claim.id; fresh = true;
    }
    const r = await sendViaResend(env, { to, subject, html, filename, pdf, tag: `plan-card-${kind}`, idempotencyKey: key });
    if (r.error) {
      if (r.conflict) { await db.from(LEDGER).update({ last_error: r.error }).eq("id", rowId); result.failed.push({ email: to, error: "idempotency_conflict", detail: r.error }); continue; }
      if (!r.uncertain && fresh) {
        // jednoznaczna odmowa dostawcy dla świeżej próby (4xx): nic nie wyszło, zwalniamy rezerwację
        await db.from(LEDGER).delete().eq("id", rowId).eq("status", "sending");
        result.failed.push({ email: to, error: r.error }); continue;
      }
      // 5xx / sieć / timeout albo wcześniejsza niepewna próba: wiersz zostaje 'sending' — ponowienie odtworzy żądanie
      await db.from(LEDGER).update({ last_error: r.error }).eq("id", rowId);
      result.failed.push({ email: to, error: r.error, uncertain: true }); continue;
    }
    const { error: doneErr } = await db.from(LEDGER).update({ status: "sent", resend_id: r.id, sent_at: now(), last_error: null }).eq("id", rowId);
    if (doneErr) { result.unconfirmed.push(to); continue; } // przyjęte przez pocztę, zapis niepotwierdzony — NIE sukces; ponowienie = replay tym samym kluczem
    result.sent.push(to);
  }

  // znacznik na rekordzie firmy/sieci dopiero, gdy KAŻDY adresat tej wersji planu ma potwierdzone doręczenie
  let marked = false;
  if (result.sent.length + result.already_sent.length === recipients.length) {
    const table = kind === "chain" ? "retailers" : "companies";
    const { error } = await db.from(table).update({ fm_plan_sent_at: now() }).eq("id", card.id);
    marked = !error;
  }
  const ok = ["failed", "in_progress", "unconfirmed", "stale_unconfirmed"].every((k) => result[k].length === 0);
  return json(200, { ok, mode: model.mode, filename, recipient_count: recipients.length, marked, plan_updated_at: raw.plan_updated_at,
    artefact: { path, sha256: pdfSha, reused: artefact.reused }, logos, ...result });
}
