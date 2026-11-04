/**
 * Netlify Function: marketing-campaign
 * POST /.netlify/functions/marketing-campaign   (admin JWT)
 * Body: { action: 'list' | 'create' | 'get' | 'approve' | 'close', ... }
 *
 * [feat/marketing-activation]
 *  list    → kampanie z licznikami stanów wiadomości
 *  create  → { name, template_key, target_categories[], target_keywords[], needs_note, reply_to }
 *  get     → { campaign_id } → kampania + wiadomości (bez html, z metadanymi)
 *  approve → { campaign_id, recipients: [{ company_id, consent_source }] }
 *            ŚWIEŻY odczyt kandydatów → tylko kwalifikujący się z listy → render
 *            PL/EN → ZAMROŻONE wiersze marketing_messages (treść, hash, klucz
 *            idempotencji, snapshot salda, źródło zgody). Wiersz bez consent_source
 *            nie powstaje (422 z listą). Powtórne approve nie dubluje (unikalność
 *            campaign+profile) — dopisuje tylko nowych adresatów.
 *  close   → { campaign_id } → status closed (bez wysyłki)
 *
 * Żadnej wysyłki tutaj. Marketing nie dotyka legacy_sends ani rozliczeń.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { computeCandidates, loadCampaign } from "./_shared/marketing-data.js";
import { renderMarketingTemplate, TEMPLATE_KEYS } from "./_shared/marketing-templates.js";
import { payloadHash, unsubscribeUrl } from "./_shared/marketing-mailer.js";

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
        if (!TEMPLATE_KEYS.includes(body.template_key)) return json(400, { error: "template_key_invalid" });
        const row = {
          name, template_key: body.template_key,
          target_categories: cleanList(body.target_categories), target_keywords: cleanList(body.target_keywords),
          needs_note: str(body.needs_note), reply_to: emailOrNull(body.reply_to), created_by: caller.id,
        };
        const { data, error } = await supaSvc.from("marketing_campaigns").insert(row).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        return json(200, { ok: true, campaign: data });
      }
      case "get": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        const { data: messages, error } = await supaSvc.from("marketing_messages")
          .select("id, company_id, profile_id, to_email, locale, segment, consent_source, snapshot, subject, state, attempts, first_claim_at, claimed_at, lease_until, resend_message_id, sent_at, last_error, is_test, created_at")
          .eq("campaign_id", campaign.id).order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return json(200, { ok: true, campaign, messages: messages || [] });
      }
      case "approve": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        if (!["draft", "approved"].includes(campaign.status)) return json(409, { error: "campaign_not_editable", status: campaign.status });
        if (!env.marketingUnsubscribeSecret) return json(500, { error: "unsubscribe_secret_missing", hint: "ustaw MARKETING_UNSUBSCRIBE_SECRET — bez linku wypisu nie zatwierdzamy wiadomości" });
        const wanted = Array.isArray(body.recipients) ? body.recipients.slice(0, MAX_RECIPIENTS) : [];
        if (!wanted.length) return json(400, { error: "recipients_required" });
        const byCompany = new Map(wanted.map((r) => [String(r.company_id), str(r.consent_source)]));

        const result = await computeCandidates(supaSvc, { campaign });
        const snapshotAt = result.snapshot_at;
        const problems = [];
        const toInsert = [];
        for (const [companyId, consent] of byCompany) {
          const row = result.rows.find((r) => String(r.company_id) === companyId);
          if (!row) { problems.push({ company_id: companyId, reason: "not_found" }); continue; }
          if (!row.eligible) { problems.push({ company_id: companyId, reason: "not_eligible", exclusions: row.exclusions }); continue; }
          if (!consent) { problems.push({ company_id: companyId, reason: "consent_source_missing" }); continue; }
          const templateKey = campaign.template_key;
          toInsert.push({ row, consent, templateKey });
        }
        if (problems.length && body.strict !== false) return json(422, { error: "recipients_rejected", problems, approved: 0 });

        const inserted = [];
        const skipped = [];
        for (const { row, consent, templateKey } of toInsert) {
          // 1) wiersz bez treści, żeby mieć id do tokenu wypisu; unikalność (campaign, profile) chroni przed dublem
          const key = `marketing:${campaign.id}:${row.profile_id}`;
          const { data: existing } = await supaSvc.from("marketing_messages").select("id, state").eq("idempotency_key", key).maybeSingle();
          if (existing) { skipped.push({ company_id: row.company_id, message_id: existing.id, state: existing.state }); continue; }
          const base = {
            campaign_id: campaign.id, company_id: row.company_id, profile_id: row.profile_id, to_email: row.email, locale: row.locale,
            segment: row.segment, consent_source: consent, snapshot: { ...row.snapshot, snapshot_at: snapshotAt, match: row.match, warnings: row.warnings },
            subject: "(rendering)", html: "(rendering)", text_body: "(rendering)", payload_hash: "pending", idempotency_key: key, is_test: false, state: "pending",
          };
          const { data: created, error: insErr } = await supaSvc.from("marketing_messages").insert(base).select("id").maybeSingle();
          if (insErr) {
            if (/duplicate|unique/i.test(insErr.message)) { skipped.push({ company_id: row.company_id, reason: "duplicate" }); continue; }
            throw new Error("insert message: " + insErr.message);
          }
          // 2) zamrożona treść z prawdziwym linkiem wypisu (token po id wiersza)
          const unsub = unsubscribeUrl({ appUrl: env.b2bAppUrl, messageId: created.id, secret: env.marketingUnsubscribeSecret });
          const rendered = renderMarketingTemplate({
            templateKey, locale: row.locale, companyName: row.company_name,
            creditsRemaining: row.snapshot.credits_remaining, creditsExpiry: row.snapshot.nearest_expiry,
            snapshotAt, appUrl: env.b2bAppUrl, unsubscribeUrl: unsub, replyTo: campaign.reply_to || null,
          });
          const hash = payloadHash({ subject: rendered.subject, html: rendered.html, text: rendered.text });
          const { error: updErr } = await supaSvc.from("marketing_messages")
            .update({ subject: rendered.subject, html: rendered.html, text_body: rendered.text, payload_hash: hash })
            .eq("id", created.id).eq("payload_hash", "pending");
          if (updErr) throw new Error("freeze message: " + updErr.message);
          inserted.push({ company_id: row.company_id, message_id: created.id, to_email: row.email, locale: row.locale });
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

function cleanList(v) {
  return [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map((s) => String(s || "").trim()).filter(Boolean))].slice(0, 50);
}
function str(v) { const s = String(v ?? "").trim(); return s ? s.slice(0, 500) : null; }
function emailOrNull(v) { const s = str(v); return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null; }
