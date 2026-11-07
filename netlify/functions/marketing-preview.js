/**
 * Netlify Function: marketing-preview
 * POST /.netlify/functions/marketing-preview   (admin JWT)
 * Body: { campaign_id?: uuid, template_key?: string, company_id: uuid, locale?: 'pl'|'en', reply_to?: string, content?: {pl,en},
 *         photo_id?: uuid | null, layout_version?: 1|2 }
 *
 * [feat/marketing-activation] Podgląd finalnej wiadomości dla jednej firmy z AKTUALNYCH
 * danych (ten sam odczyt co kandydaci). `content` w body = NIEZAPISANA treść z edytora
 * (podgląd przed zapisem); bez niej używana jest treść zapisana w kampanii albo domyślna.
 * Link wypisu w podglądzie jest zastępczy (brak jeszcze wiersza wiadomości) — przy
 * zatwierdzeniu powstaje prawdziwy token. Nic nie zapisuje, nic nie wysyła.
 *
 * [feat/marketing-photos] Układ: kampanii (layout_version) albo body.layout_version bez kampanii (domyślnie 2).
 * Zdjęcie: po zatwierdzeniu ZAWSZE zamrożone (frozen_photo); w szkicu — wybrane w kampanii, a `photo_id` w body
 * (niezapisany wybór z okna „Wybierz zdjęcie”) ma pierwszeństwo; `photo_id: null` = podgląd bez zdjęcia.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { computeCandidates, loadCampaign } from "./_shared/marketing-data.js";
import { renderMarketingTemplate, validateContent, normalizeLayoutVersion, DEFAULT_LAYOUT_VERSION, TEMPLATE_KEYS } from "./_shared/marketing-templates.js";
import { loadPhoto, loadPhotoVersion, resolveCampaignPhoto, isPublished } from "./_shared/marketing-photo-data.js";
import { LOGO_GREEN_DATA_URI, LOGO_WHITE_DATA_URI } from "./_shared/marketing-logo-data.js";

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
    const result = await computeCandidates(auth.supaSvc, { campaign: campaign || { template_key: templateKey }, env: auth.env });
    const row = result.rows.find((r) => String(r.company_id) === String(body.company_id));
    if (!row) return json(404, { error: "company_not_found" });
    const key = templateKey || row.template_key;
    if (!key) return json(422, { error: "no_template_for_segment", segment: row.segment });
    let content = null;
    if (body.content) {
      const errors = validateContent(body.content);
      if (errors.length) return json(422, { error: "content_invalid", errors });
      content = body.content;
    } else if (campaign && campaign.status !== "draft" && campaign.frozen_content && Object.keys(campaign.frozen_content).length) content = campaign.frozen_content; // zamrożona, kompletna treść
    else if (campaign?.content && Object.keys(campaign.content).length) content = campaign.content;
    const locale = body.locale === "en" || body.locale === "pl" ? body.locale : row.locale;
    const layoutVersion = campaign ? normalizeLayoutVersion(campaign.layout_version) : normalizeLayoutVersion(body.layout_version ?? DEFAULT_LAYOUT_VERSION);
    const photo = layoutVersion === 2 ? await previewPhoto(auth.supaSvc, campaign, body) : null;
    const rendered = renderMarketingTemplate({
      templateKey: key, content, locale,
      companyName: row.company_name,
      creditsRemaining: row.snapshot.credits_remaining,
      creditsAvailable: row.snapshot.credits_available,
      creditsReserved: row.snapshot.reserved,
      expiringCredits: row.snapshot.expiring_credits,
      creditsExpiry: row.snapshot.nearest_expiry,
      snapshotAt: result.snapshot_at,
      appUrl: auth.env.b2bAppUrl,
      unsubscribeUrl: `${String(auth.env.b2bAppUrl || "").replace(/\/$/, "")}/.netlify/functions/marketing-unsubscribe?m=PODGLAD&t=PODGLAD`,
      replyTo: body.reply_to || campaign?.reply_to || null,
      layoutVersion, photo,
      // TYLKO PODGLĄD: logotypy osadzone jako data URI — ramka podglądu w panelu (iframe sandbox) nie może pobierać obrazków
      // z localhost/sieci prywatnej, więc na środowisku testowym logo nie wczytywało się. Prawdziwy mail (approve/test/batch)
      // nadal dostaje adres HTTPS z aplikacji.
      logoGreenUrl: LOGO_GREEN_DATA_URI, logoUrl: LOGO_WHITE_DATA_URI,
    });
    return json(200, { ok: true, preview: true, logo_inline: true, snapshot_at: result.snapshot_at, row, subject: rendered.subject, html: rendered.html, text: rendered.text, meta: rendered.meta, layout_version: layoutVersion, photo: photo ? { photo_id: photo.photo_id, version_id: photo.version_id, frozen: !!photo.frozen } : null });
  } catch (e) {
    console.error("[marketing-preview]", e?.message || e);
    return json(500, { error: "preview_failed", detail: String(e?.message || e) });
  }
};

/** Zdjęcie do podglądu: zamrożenie > niezapisany wybór z body > wybór w kampanii; `photo_id: null` w body = bez zdjęcia. */
async function previewPhoto(supaSvc, campaign, body) {
  if (campaign && campaign.frozen_photo && campaign.frozen_photo.url) return { ...campaign.frozen_photo, frozen: true };
  if (body.photo_id === null) return null;
  if (body.photo_id) {
    const photo = await loadPhoto(supaSvc, body.photo_id);
    const version = photo ? await loadPhotoVersion(supaSvc, photo.approved_version_id) : null; // tylko zatwierdzona, opublikowana wersja
    if (!photo || !isPublished(version)) throw new Error("photo_not_found");
    return { photo_id: photo.id, version_id: version.id, url: version.public_url, width: version.width, height: version.height, alt_pl: photo.alt_pl, alt_en: photo.alt_en, caption_pl: photo.caption_pl, caption_en: photo.caption_en, frozen: false };
  }
  return resolveCampaignPhoto(supaSvc, campaign);
}
