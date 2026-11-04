/**
 * Netlify Function: marketing-candidates
 * POST /.netlify/functions/marketing-candidates   (admin JWT)
 * Body: { campaign_id?: uuid, target_categories?: string[], target_keywords?: string[] }
 *
 * [feat/marketing-activation] Odczyt bieżącego stanu firm pod kampanię aktywizacyjną:
 * saldo (packages / company_capacity), rezerwacje (legacy_sends), terminy ważności,
 * segment, wykluczenia z powodami, dopasowanie do potrzeb kupców. Tylko odczyt —
 * nic nie zapisuje, nic nie wysyła, nie dotyka rozliczeń.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { computeCandidates, loadCampaign } from "./_shared/marketing-data.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: MARKETING_CORS };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = await requireAdmin(event, "marketing-candidates");
  if (!auth.ok) return auth.response;
  const body = parseBody(event);
  if (!body) return json(400, { error: "invalid_json" });

  try {
    let campaign = body.campaign_id ? await loadCampaign(auth.supaSvc, body.campaign_id) : null;
    if (body.campaign_id && !campaign) return json(404, { error: "campaign_not_found" });
    if (!campaign) campaign = { target_categories: body.target_categories || [], target_keywords: body.target_keywords || [] };
    const result = await computeCandidates(auth.supaSvc, { campaign });
    return json(200, { ok: true, snapshot_at: result.snapshot_at, today: result.today, summary: result.summary, rows: result.rows, campaign: body.campaign_id ? campaign : null });
  } catch (e) {
    console.error("[marketing-candidates]", e?.message || e);
    return json(500, { error: "candidates_failed", detail: String(e?.message || e) });
  }
};
