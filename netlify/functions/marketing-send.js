/**
 * Netlify Function: marketing-send
 * POST /.netlify/functions/marketing-send   (admin JWT)
 * Body: { campaign_id, mode: 'batch' | 'test', test_to?: string, message_id?: uuid, limit?: number }
 *
 * [feat/marketing-activation] Wysyłka z rejestru — nigdy „z listy”:
 *  * batch: kampania approved/sending → RPC marketing_claim_messages (dzierżawa, FOR
 *    UPDATE SKIP LOCKED) → dla każdego zajętego wiersza TUŻ PRZED wysyłką ponowna
 *    kontrola dopuszczenia w bazie (`marketing_precheck_message`: stan claimed, zgoda,
 *    brak wypisu/odbicia — wypis w trakcie partii zatrzymuje ten mail) → wysyłka
 *    ZAMROŻONEJ treści pod stałym Idempotency-Key → marketing_record_result.
 *    Przerwana funkcja zostawia wiersze `claimed` z dzierżawą: następne wywołanie
 *    odzyskuje je po jej wygaśnięciu i wysyła tę samą treść pod tym samym kluczem —
 *    Resend nie tworzy drugiej wiadomości (24 h). Poza oknem → needs_review.
 *  * test: osobny wiersz is_test=true z WŁASNĄ treścią wyrenderowaną dla tego wiersza
 *    (własny link i nagłówek wypisu — kliknięcie przez pracownika nie dotyka
 *    prawdziwego adresata; wypis z wiersza testowego niczego nie zapisuje).
 *
 * Prawdziwa poczta WYŁĄCZNIE gdy MARKETING_SEND_ENABLED="true" (Netlify env). Bez
 * flagi: 403 `send_disabled` — także dla testu (Artur 4.11). W testach jednostkowych
 * transport jest atrapą (fetch).
 *
 * Marketing nie woła żadnego RPC rozliczeń i nie dotyka legacy_sends.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { loadCampaign } from "./_shared/marketing-data.js";
import { sendMarketingMail, unsubscribeUrl, payloadHash } from "./_shared/marketing-mailer.js";
import { renderMarketingTemplate } from "./_shared/marketing-templates.js";

const TIME_BUDGET_MS = 20_000;     // Netlify: 26 s limitu — zostaw zapas na odpowiedź
const DEFAULT_LIMIT = 50;
const LEASE_SECONDS = 900;
const WINDOW_SECONDS = 23 * 3600; // ochrona Resend 24 h minus godzina zapasu (jak supplier-read-notify)

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: MARKETING_CORS };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = await requireAdmin(event, "marketing-send", ["resendApiKey"]);
  if (!auth.ok) return auth.response;
  const body = parseBody(event);
  if (!body || !body.campaign_id) return json(400, { error: "campaign_id_required" });
  const { supaSvc, env, caller } = auth;

  if (env.marketingSendEnabled !== true) {
    return json(403, { error: "send_disabled", hint: "MARKETING_SEND_ENABLED nie jest ustawione na true — wysyłka (także testowa) wyłączona na tym środowisku" });
  }
  if (!env.marketingUnsubscribeSecret) return json(500, { error: "unsubscribe_secret_missing" });

  try {
    const campaign = await loadCampaign(supaSvc, body.campaign_id);
    if (!campaign) return json(404, { error: "campaign_not_found" });
    const mode = String(body.mode || "batch");

    if (mode === "test") return await sendTest({ supaSvc, env, caller, campaign, body });

    if (!["approved", "sending"].includes(campaign.status)) return json(409, { error: "campaign_not_approved", status: campaign.status });
    if (campaign.status === "approved") {
      const { error } = await supaSvc.from("marketing_campaigns").update({ status: "sending" }).eq("id", campaign.id).eq("status", "approved");
      if (error) throw new Error("campaign status: " + error.message);
    }
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), DEFAULT_LIMIT);
    const started = Date.now();
    const outcome = { claimed: 0, accepted: 0, rejected: 0, uncertain: 0, skipped: 0 };
    const details = [];

    const { data: claimed, error: claimErr } = await supaSvc.rpc("marketing_claim_messages", {
      p_campaign_id: campaign.id, p_limit: limit, p_lease_seconds: LEASE_SECONDS, p_window_seconds: WINDOW_SECONDS,
    });
    if (claimErr) throw new Error("claim: " + claimErr.message);
    const rows = Array.isArray(claimed) ? claimed : [];
    outcome.claimed = rows.length;

    for (const m of rows) {
      if (Date.now() - started > TIME_BUDGET_MS) { details.push({ id: m.id, result: "deferred", note: "time_budget" }); continue; } // zostaje claimed → odzyska następne wywołanie po dzierżawie
      // kontrola spójności: treść nie mogła się zmienić od zatwierdzenia
      if (payloadHash({ subject: m.subject, html: m.html, text: m.text_body }) !== m.payload_hash) {
        await supaSvc.rpc("marketing_record_result", { p_message_id: m.id, p_state: "rejected", p_resend_message_id: null, p_error: "payload_hash_mismatch" });
        outcome.rejected += 1; details.push({ id: m.id, result: "rejected", error: "payload_hash_mismatch" }); continue;
      }
      // [review Codexa #2] ponowna kontrola dopuszczenia w bazie TUŻ PRZED wysyłką
      // (wypis / odbicie / cofnięta zgoda w trakcie partii zatrzymują ten mail)
      const { data: pre, error: preErr } = await supaSvc.rpc("marketing_precheck_message", { p_message_id: m.id });
      if (preErr) { outcome.skipped += 1; details.push({ id: m.id, result: "skipped", error: "precheck_failed:" + preErr.message }); continue; } // zostaje claimed → odzyskanie
      if (!pre?.ok) { outcome.skipped += 1; details.push({ id: m.id, result: "skipped", reason: pre?.reason || "precheck_rejected" }); continue; }

      const unsub = unsubscribeUrl({ appUrl: env.b2bAppUrl, messageId: m.id, secret: env.marketingUnsubscribeSecret });
      const r = await sendMarketingMail({ env, message: m, unsubscribeUrl: unsub, replyTo: campaign.reply_to || null });
      const { data: rec, error: recErr } = await supaSvc.rpc("marketing_record_result", { p_message_id: m.id, p_state: r.status, p_resend_message_id: r.id || null, p_error: r.error || null });
      if (recErr) {
        // poczta mogła przyjąć, a zapis padł: wiersz zostaje claimed z dzierżawą → ponowienie pod tym samym kluczem = ta sama wiadomość
        outcome.uncertain += 1; details.push({ id: m.id, result: "uncertain", error: "record_failed:" + recErr.message, resend_message_id: r.id || null }); continue;
      }
      outcome[r.status] += 1;
      details.push({ id: m.id, result: r.status, resend_message_id: r.id || null, error: r.error || null, record: rec || null });
    }

    // [review Codexa #6] co zostało? Błąd odczytu NIE zamyka kampanii — zostaje `sending`.
    const { data: left, error: leftErr } = await supaSvc.from("marketing_messages").select("id, state").eq("campaign_id", campaign.id).eq("is_test", false).in("state", ["pending", "claimed"]);
    if (leftErr) return json(200, { ok: true, outcome, remaining: null, done: false, details, warning: "remaining_unknown:" + leftErr.message });
    const remaining = Array.isArray(left) ? left.length : null;
    if (remaining === 0) {
      const { error: doneErr } = await supaSvc.from("marketing_campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id).eq("status", "sending");
      if (doneErr) return json(200, { ok: true, outcome, remaining, done: false, details, warning: "campaign_close_failed:" + doneErr.message });
    }
    return json(200, { ok: true, outcome, remaining, done: remaining === 0, details });
  } catch (e) {
    console.error("[marketing-send]", e?.message || e);
    return json(500, { error: "send_failed", detail: String(e?.message || e) });
  }
};

/**
 * [review Codexa #1] Test na adres zespołu: WŁASNY wiersz z WŁASNĄ treścią (render dla id
 * wiersza testowego → własny link wypisu i nagłówek List-Unsubscribe). Nic w treści
 * ani nagłówkach nie wskazuje na wiersz prawdziwego adresata.
 */
async function sendTest({ supaSvc, env, caller, campaign, body }) {
  const to = String(body.test_to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json(400, { error: "test_to_invalid" });
  if (!body.message_id) return json(400, { error: "message_id_required" });
  const { data: src, error } = await supaSvc.from("marketing_messages").select("*").eq("id", body.message_id).eq("campaign_id", campaign.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!src) return json(404, { error: "message_not_found" });
  if (src.is_test) return json(409, { error: "message_is_test" });
  const snap = src.snapshot || {};
  // osobny wiersz testowy: klucz = wiadomość źródłowa + adres + minuta (dwuklik = ta sama wiadomość; kolejna próba po minucie = nowa)
  const minute = new Date().toISOString().slice(0, 16);
  const testId = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : (await import("node:crypto")).randomUUID());
  const key = `marketing-test:${src.id}:${to}:${minute}`;
  const unsub = unsubscribeUrl({ appUrl: env.b2bAppUrl, messageId: testId, secret: env.marketingUnsubscribeSecret });
  const rendered = renderMarketingTemplate({
    templateKey: campaign.template_key, locale: src.locale, companyName: snap.company_name || "",
    creditsRemaining: snap.credits_remaining, creditsExpiry: snap.nearest_expiry, snapshotAt: snap.snapshot_at || src.created_at,
    appUrl: env.b2bAppUrl, unsubscribeUrl: unsub, replyTo: campaign.reply_to || null,
  });
  const subject = `[TEST] ${rendered.subject}`;
  const now = new Date().toISOString();
  const { data: testRow, error: insErr } = await supaSvc.from("marketing_messages").insert({
    id: testId, campaign_id: campaign.id, company_id: src.company_id, profile_id: null, to_email: to, locale: src.locale, segment: src.segment,
    consent_source: `test:${caller.email || caller.id}`, snapshot: { ...snap, test_of: src.id },
    subject, html: rendered.html, text_body: rendered.text, payload_hash: payloadHash({ subject, html: rendered.html, text: rendered.text }),
    idempotency_key: key, is_test: true, state: "claimed", attempts: 1, first_claim_at: now, claimed_at: now,
  }).select("*").maybeSingle();
  if (insErr) {
    if (/duplicate|unique/i.test(insErr.message)) return json(200, { ok: true, duplicate: true, hint: "ten sam test w tej samej minucie — nie wysłano drugi raz" });
    throw new Error(insErr.message);
  }
  const r = await sendMarketingMail({ env, message: { ...testRow, campaign_id: campaign.id }, unsubscribeUrl: unsub, replyTo: campaign.reply_to || null });
  await supaSvc.rpc("marketing_record_result", { p_message_id: testRow.id, p_state: r.status, p_resend_message_id: r.id || null, p_error: r.error || null });
  return json(r.status === "accepted" ? 200 : 502, { ok: r.status === "accepted", test: true, test_message_id: testRow.id, result: r.status, resend_message_id: r.id || null, error: r.error || null });
}
