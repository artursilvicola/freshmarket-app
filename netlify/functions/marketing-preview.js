/**
 * Netlify Function: marketing-preview
 * POST /.netlify/functions/marketing-preview   (admin JWT)
 * Body: { campaign_id?: uuid, template_key?: string, company_id: uuid, locale?: 'pl'|'en', reply_to?: string, content?: {pl,en} }
 *
 * [feat/marketing-activation] Podgląd finalnej wiadomości dla jednej firmy z AKTUALNYCH
 * danych (ten sam odczyt co kandydaci). `content` w body = NIEZAPISANA treść z edytora
 * (podgląd przed zapisem); bez niej używana jest treść zapisana w kampanii albo domyślna.
 * Link wypisu w podglądzie jest zastępczy (brak jeszcze wiersza wiadomości) — przy
 * zatwierdzeniu powstaje prawdziwy token. Nic nie zapisuje, nic nie wysyła.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { computeCandidates, loadCampaign } from "./_shared/marketing-data.js";
import { renderMarketingTemplate, validateContent, TEMPLATE_KEYS } from "./_shared/marketing-templates.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: MARKETING_CORS };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = await requireAdmin(event, "marketing-preview");
  if (!auth.ok) return auth.response;
  const body = parseBody(event);
  if (!body || !body.company_id) return json(400, { error: "company_id_required" });

  try {
    const campaign = body.campaign_id ? await loadCampaign(auth.supaSvc, body.campaign_id) : null;
    const templateKey = TEMPLATE_KEYS.includes(body.template_key) ? body.template_key : (campaign?.template_key || null);
    const result = await computeCandidates(auth.supaSvc, { campaign: campaign || { template_key: templateKey } });
    const row = result.rows.find((r) => String(r.company_id) === String(body.company_id));
    if (!row) return json(404, { error: "company_not_found" });
    const key = templateKey || row.template_key;
    if (!key) return json(422, { error: "no_template_for_segment", segment: row.segment });
    let content = null;
    if (body.content) {
      const errors = validateContent(body.content);
      if (errors.length) return json(422, { error: "content_invalid", errors });
      content = body.content;
    } else if (campaign?.content && Object.keys(campaign.content).length) content = campaign.content;
    const locale = body.locale === "en" || body.locale === "pl" ? body.locale : row.locale;
    const rendered = renderMarketingTemplate({
      templateKey: key, content, locale,
      companyName: row.company_name,
      creditsRemaining: row.snapshot.credits_remaining,
      creditsReserved: row.snapshot.reserved,
      expiringCredits: row.snapshot.expiring_credits,
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
