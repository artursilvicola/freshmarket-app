/**
 * Netlify Function: marketing-preview
 * POST /.netlify/functions/marketing-preview   (admin JWT)
 * Body: { campaign_id?: uuid, template_key?: string, company_id: uuid, locale?: 'pl'|'en', reply_to?: string }
 *
 * [feat/marketing-activation] Podgląd finalnej wiadomości dla jednej firmy z AKTUALNYCH
 * danych (ten sam odczyt co kandydaci). Link wypisu w podglądzie jest zastępczy
 * (brak jeszcze wiersza wiadomości) — przy zatwierdzeniu powstaje prawdziwy token.
 * Nic nie zapisuje, nic nie wysyła.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { computeCandidates, loadCampaign } from "./_shared/marketing-data.js";
import { renderMarketingTemplate, TEMPLATE_KEYS } from "./_shared/marketing-templates.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: MARKETING_CORS };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = await requireAdmin(event, "marketing-preview");
  if (!auth.ok) return auth.response;
  const body = parseBody(event);
  if (!body || !body.company_id) return json(400, { error: "company_id_required" });

  try {
    const campaign = body.campaign_id ? await loadCampaign(auth.supaSvc, body.campaign_id) : null;
    const result = await computeCandidates(auth.supaSvc, { campaign: campaign || { target_categories: [], target_keywords: [] } });
    const row = result.rows.find((r) => String(r.company_id) === String(body.company_id));
    if (!row) return json(404, { error: "company_not_found" });
    const templateKey = TEMPLATE_KEYS.includes(body.template_key) ? body.template_key : (campaign?.template_key || row.template_key);
    if (!templateKey) return json(422, { error: "no_template_for_segment", segment: row.segment });
    const locale = body.locale === "en" || body.locale === "pl" ? body.locale : row.locale;
    const rendered = renderMarketingTemplate({
      templateKey, locale,
      companyName: row.company_name,
      creditsRemaining: row.snapshot.credits_remaining,
      creditsExpiry: row.snapshot.nearest_expiry,
      snapshotAt: result.snapshot_at,
      appUrl: auth.env.b2bAppUrl,
      unsubscribeUrl: `${String(auth.env.b2bAppUrl || "").replace(/\/$/, "")}/.netlify/functions/marketing-unsubscribe?m=PODGLAD&t=PODGLAD`,
      replyTo: body.reply_to || campaign?.reply_to || null,
    });
    return json(200, { ok: true, preview: true, snapshot_at: result.snapshot_at, row, subject: rendered.subject, html: rendered.html, text: rendered.text, meta: rendered.meta });
  } catch (e) {
    console.error("[marketing-preview]", e?.message || e);
    return json(500, { error: "preview_failed", detail: String(e?.message || e) });
  }
};
