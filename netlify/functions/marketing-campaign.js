/**
 * Netlify Function: marketing-campaign
 * POST /.netlify/functions/marketing-campaign   (admin JWT)
 * Body: { action: 'list' | 'create' | 'get' | 'update_content' | 'approve' | 'close', ... }
 *
 * [feat/marketing-activation]
 *  list           → kampanie z licznikami stanów wiadomości
 *  create         → { name, template_key (= grupa odbiorców), reply_to } — treść = domyślna szablonu
 *  get            → { campaign_id } → kampania (+ domyślna treść szablonu do porównania) + wiadomości (bez html)
 *  update_content → { campaign_id, content: { pl: {subject, body, cta}, en: {...} } } — tylko w szkicu,
 *                   bez HTML (walidacja), pusty obiekt = powrót do domyślnej
 *  approve        → { campaign_id, recipients: [{ company_id, consent_source }] }
 *            ŚWIEŻY odczyt kandydatów → tylko kwalifikujący się DO GRUPY KAMPANII z listy → render
 *            PL/EN z treści kampanii → ZAMROŻONE wiersze marketing_messages (treść, hash, klucz
 *            idempotencji, snapshot salda, źródło zgody). Id wiersza losowane przed zapisem (link
 *            wypisu w treści), więc JEDEN insert zapisuje kompletną wiadomość (review Codexa #5).
 *            Wiersz bez consent_source nie powstaje (422 z listą). Powtórne approve nie dubluje
 *            (unikalność campaign+profile) — dopisuje tylko nowych adresatów.
 *  close          → { campaign_id } → status closed (bez wysyłki)
 *
 * Żadnej wysyłki tutaj. Marketing nie dotyka legacy_sends ani rozliczeń.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { computeCandidates, loadCampaign } from "./_shared/marketing-data.js";
import { renderMarketingTemplate, defaultContent, validateContent, AUDIENCE_TEMPLATE_KEYS, TEMPLATE_KEYS } from "./_shared/marketing-templates.js";
import { payloadHash, unsubscribeUrl } from "./_shared/marketing-mailer.js";
import { randomUUID } from "node:crypto";

const MAX_RECIPIENTS = 200;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: MARKETING_CORS };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = await requireAdmin(event, "marketing-campaign");
  if (!auth.ok) return auth.response;
  const body = parseBody(event);
  if (!body) return json(400, { error: "invalid_json" });
  const { supaSvc, env, caller } = auth;

  try {
    switch (String(body.action || "")) {
      case "list": {
        const { data: campaigns, error } = await supaSvc.from("marketing_campaigns").select("*").order("created_at", { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        const { data: msgs, error: mErr } = await supaSvc.from("marketing_messages").select("campaign_id, state, is_test");
        if (mErr) throw new Error(mErr.message);
        const counts = {};
        for (const m of msgs || []) {
          const c = counts[m.campaign_id] || (counts[m.campaign_id] = { total: 0, test: 0 });
          if (m.is_test) { c.test += 1; continue; }
          c.total += 1; c[m.state] = (c[m.state] || 0) + 1;
        }
        return json(200, { ok: true, campaigns: (campaigns || []).map((c) => ({ ...c, counts: counts[c.id] || { total: 0, test: 0 } })) });
      }
      case "create": {
        const name = String(body.name || "").trim();
        if (!name) return json(400, { error: "name_required" });
        // nowe kampanie tylko z grupą odbiorców; stare klucze zostają wyłącznie dla istniejących wierszy
        if (!AUDIENCE_TEMPLATE_KEYS.includes(body.template_key)) return json(400, { error: "template_key_invalid", allowed: AUDIENCE_TEMPLATE_KEYS });
        const row = { name, template_key: body.template_key, content: {}, reply_to: emailOrNull(body.reply_to), created_by: caller.id };
        const { data, error } = await supaSvc.from("marketing_campaigns").insert(row).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        return json(200, { ok: true, campaign: data, default_content: defaultContent(body.template_key) });
      }
      case "get": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        const { data: messages, error } = await supaSvc.from("marketing_messages")
          .select("id, company_id, profile_id, to_email, locale, segment, consent_source, snapshot, subject, state, attempts, first_claim_at, claimed_at, lease_until, resend_message_id, sent_at, last_error, is_test, created_at")
          .eq("campaign_id", campaign.id).order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const defaults = TEMPLATE_KEYS.includes(campaign.template_key) ? defaultContent(campaign.template_key) : null;
        return json(200, { ok: true, campaign, default_content: defaults, messages: messages || [] });
      }
      case "update_content": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        if (campaign.status !== "draft") return json(409, { error: "content_frozen", status: campaign.status, hint: "treść edytujesz tylko w szkicu; po zatwierdzeniu jest zamrożona w rejestrze — zmiana = nowa kampania" });
        const content = body.content && typeof body.content === "object" ? body.content : {};
        const reset = Object.keys(content).length === 0;
        if (!reset) {
          const errors = validateContent(content);
          if (errors.length) return json(422, { error: "content_invalid", errors });
        }
        const clean = reset ? {} : { pl: pickFields(content.pl), en: pickFields(content.en) };
        const { data, error } = await supaSvc.from("marketing_campaigns")
          .update({ content: clean, content_updated_at: new Date().toISOString(), content_updated_by: caller.id })
          .eq("id", campaign.id).eq("status", "draft").select("*").maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return json(409, { error: "content_frozen" });
        return json(200, { ok: true, campaign: data, reset });
      }
      case "approve": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        if (!["draft", "approved"].includes(campaign.status)) return json(409, { error: "campaign_not_editable", status: campaign.status });
        if (!env.marketingUnsubscribeSecret) return json(500, { error: "unsubscribe_secret_missing", hint: "ustaw MARKETING_UNSUBSCRIBE_SECRET — bez linku wypisu nie zatwierdzamy wiadomości" });
        const wanted = Array.isArray(body.recipients) ? body.recipients.slice(0, MAX_RECIPIENTS) : [];
        if (!wanted.length) return json(400, { error: "recipients_required" });
        const byCompany = new Map(wanted.map((r) => [String(r.company_id), str(r.consent_source)]));
        const content = campaign.content && Object.keys(campaign.content).length ? campaign.content : null;
        if (content) { const errors = validateContent(content); if (errors.length) return json(422, { error: "content_invalid", errors }); }

        const result = await computeCandidates(supaSvc, { campaign });
        const snapshotAt = result.snapshot_at;
        const problems = [];
        const toInsert = [];
        for (const [companyId, consent] of byCompany) {
          const row = result.rows.find((r) => String(r.company_id) === companyId);
          if (!row) { problems.push({ company_id: companyId, reason: "not_found" }); continue; }
          if (!row.eligible) { problems.push({ company_id: companyId, reason: row.base_ok === false ? "not_eligible" : "not_in_audience", exclusions: row.exclusions, audience_reason: row.audience_reason }); continue; }
          if (!consent) { problems.push({ company_id: companyId, reason: "consent_source_missing" }); continue; }
          toInsert.push({ row, consent, templateKey: campaign.template_key });
        }
        if (problems.length && body.strict !== false) return json(422, { error: "recipients_rejected", problems, approved: 0 });

        const inserted = [];
        const skipped = [];
        for (const { row, consent, templateKey } of toInsert) {
          const key = `marketing:${campaign.id}:${row.profile_id}`;
          const { data: existing, error: exErr } = await supaSvc.from("marketing_messages").select("id, state").eq("idempotency_key", key).maybeSingle();
          if (exErr) throw new Error("lookup message: " + exErr.message);
          if (existing) { skipped.push({ company_id: row.company_id, message_id: existing.id, state: existing.state }); continue; }
          // id losowane PRZED zapisem → link wypisu w treści → jeden INSERT z kompletną, zamrożoną treścią
          const messageId = randomUUID();
          const unsub = unsubscribeUrl({ appUrl: env.b2bAppUrl, messageId, secret: env.marketingUnsubscribeSecret });
          const rendered = renderMarketingTemplate({
            templateKey, content, locale: row.locale, companyName: row.company_name,
            creditsRemaining: row.snapshot.credits_remaining, creditsReserved: row.snapshot.reserved, expiringCredits: row.snapshot.expiring_credits,
            creditsExpiry: row.snapshot.nearest_expiry,
            snapshotAt, appUrl: env.b2bAppUrl, unsubscribeUrl: unsub, replyTo: campaign.reply_to || null,
          });
          const full = {
            id: messageId, campaign_id: campaign.id, company_id: row.company_id, profile_id: row.profile_id, to_email: row.email, locale: row.locale,
            segment: row.segment, consent_source: consent,
            snapshot: { ...row.snapshot, snapshot_at: snapshotAt, company_name: row.company_name, template_key: templateKey, audience_reason: row.audience_reason, warnings: row.warnings, custom_content: Boolean(content) },
            subject: rendered.subject, html: rendered.html, text_body: rendered.text,
            payload_hash: payloadHash({ subject: rendered.subject, html: rendered.html, text: rendered.text }),
            idempotency_key: key, is_test: false, state: "pending",
          };
          const { error: insErr } = await supaSvc.from("marketing_messages").insert(full);
          if (insErr) {
            if (/duplicate|unique/i.test(insErr.message)) { skipped.push({ company_id: row.company_id, reason: "duplicate" }); continue; }
            throw new Error("insert message: " + insErr.message);
          }
          inserted.push({ company_id: row.company_id, message_id: messageId, to_email: row.email, locale: row.locale });
        }
        const { error: cErr } = await supaSvc.from("marketing_campaigns")
          .update({ status: "approved", approved_by: caller.id, approved_at: new Date().toISOString(), snapshot_at: snapshotAt })
          .eq("id", campaign.id);
        if (cErr) throw new Error("campaign update: " + cErr.message);
        return json(200, { ok: true, approved: inserted.length, inserted, skipped, problems, snapshot_at: snapshotAt });
      }
      case "close": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        const { error } = await supaSvc.from("marketing_campaigns").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", campaign.id);
        if (error) throw new Error(error.message);
        return json(200, { ok: true });
      }
      default:
        return json(400, { error: "unknown_action" });
    }
  } catch (e) {
    console.error("[marketing-campaign]", e?.message || e);
    return json(500, { error: "campaign_failed", detail: String(e?.message || e) });
  }
};

function pickFields(c) { return { subject: String(c?.subject ?? ""), body: String(c?.body ?? ""), cta: String(c?.cta ?? "") }; }
function str(v) { const s = String(v ?? "").trim(); return s ? s.slice(0, 500) : null; }
function emailOrNull(v) { const s = str(v); return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null; }
