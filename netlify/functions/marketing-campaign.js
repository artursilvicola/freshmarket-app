/**
 * Netlify Function: marketing-campaign
 * POST /.netlify/functions/marketing-campaign   (admin JWT)
 * Body: { action: 'list' | 'create' | 'get' | 'update_content' | 'approve' | 'close', ... }
 *
 * [feat/marketing-activation]
 *  list           → kampanie z licznikami stanów wiadomości
 *  create         → { name, template_key (= grupa odbiorców), reply_to } — treść = domyślna szablonu
 *  get            → { campaign_id } → kampania (+ domyślna treść szablonu do porównania) + wiadomości (bez html)
 *  update_content → { campaign_id, content: { pl: {subject, body, cta}, en: {...} }, expected_version? } — tylko w szkicu,
 *                   bez HTML (walidacja), pusty obiekt = powrót do domyślnej; content_version += 1 warunkowo
 *                   (inna wersja w bazie = 409 content_version_conflict — edycja w drugim oknie)
 *  approve        → { campaign_id, content_version, recipients: [{ company_id, consent_source? }] }
 *            consent_source: decyzja Artura 05.11 — administrator NIE wpisuje źródła zgody; zgoda marketingowa wynika
 *            z regulaminu przy rejestracji konta, więc bez podanej wartości serwer zapisuje CONSENT_SOURCE_DEFAULT
 *            (rejestr nadal ma podstawę per adresat, blokada blocked_no_consent w bazie zostaje).
 *            content_version MUSI równać się wersji w bazie (tej, którą administrator widział w podglądzie) — inaczej 409.
 *            Najpierw JEDEN warunkowy UPDATE (status in draft/approved AND content_version = oczekiwana) zamraża treść
 *            w kampanii (frozen_content) i ustawia status approved; 0 wierszy = równoległa edycja/zamknięcie = 409, nic nie
 *            powstaje. Dopiero potem wiadomości — renderowane WYŁĄCZNIE z frozen_content, więc awaria w połowie i
 *            ponowienie dają te same teksty (review Codexa P1 #2).
 *            ŚWIEŻY odczyt kandydatów → tylko kwalifikujący się DO GRUPY KAMPANII z listy → render
 *            PL/EN z treści kampanii → ZAMROŻONE wiersze marketing_messages (treść, hash, klucz
 *            idempotencji, snapshot salda, źródło zgody). Id wiersza losowane przed zapisem (link
 *            wypisu w treści), więc JEDEN insert zapisuje kompletną wiadomość (review Codexa #5).
 *            Wiersz bez consent_source nie powstaje (domyślna podstawa z regulaminu). Powtórne approve nie dubluje
 *            (unikalność campaign+profile) — dopisuje tylko nowych adresatów.
 *  message        → { campaign_id, message_id } → ZAPISANA wiadomość z rejestru (temat, html, tekst) — wierna kopia tego,
 *                   co wyjdzie/wyszło; podgląd kampanii po zatwierdzeniu to tylko szablon z aktualnych danych
 *  close          → { campaign_id } → status closed (bez wysyłki)
 *
 * [feat/marketing-photos] Układ v2 + zdjęcie z biblioteki (jedno na kampanię, wspólne PL/EN):
 *  create         → layout_version = 2, zdjęcie przypisane AUTOMATYCZNIE z rotacji (nigdy niewysłane → najdawniej wysłane,
 *                   omija 4 ostatnie kampanie, które faktycznie wysyłały, i zdjęcia innych otwartych kampanii); brak gotowych
 *                   zdjęć = kampania bez zdjęcia + ostrzeżenie
 *  set_photo      → { campaign_id, photo_id | null, auto?, expected_version? } — tylko w szkicu; zdjęcie musi być `ready`
 *                   z aktualną wersją; zapisuje photo_id + photo_version_id (konkretny plik) i podbija content_version
 *                   (zdjęcie jest częścią tego, co administrator widział w podglądzie przed zatwierdzeniem)
 *  approve        → przy PIERWSZYM zamrożeniu zapisuje frozen_photo (id zdjęcia i wersji, adres HTTPS, alt/podpis PL/EN,
 *                   wymiary) razem z frozen_content; wiadomości renderowane z zamrożenia — wyłączenie zdjęcia albo nowa
 *                   wersja pliku nie zmienia ani tej kampanii, ani starych maili. Zdjęcie wyłączone w międzyczasie = 409.
 *
 * Żadnej wysyłki tutaj. Marketing nie dotyka legacy_sends ani rozliczeń.
 */
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { computeCandidates, loadCampaign } from "./_shared/marketing-data.js";
import { renderMarketingTemplate, defaultContent, effectiveContent, validateContent, normalizeLayoutVersion, AUDIENCE_TEMPLATE_KEYS, TEMPLATE_KEYS, DEFAULT_LAYOUT_VERSION } from "./_shared/marketing-templates.js";
import { freezePhoto, validateFrozenPhoto } from "./_shared/marketing-photos.js";
import { loadPhoto, loadPhotoVersion, resolveCampaignPhoto, suggestPhoto, isPublished } from "./_shared/marketing-photo-data.js";
import { payloadHash, unsubscribeUrl } from "./_shared/marketing-mailer.js";
import { randomUUID } from "node:crypto";

const MAX_RECIPIENTS = 200;
/** Podstawa zgody zapisywana w rejestrze, gdy panel jej nie podaje (regulamin przy rejestracji — decyzja Artura 05.11). */
export const CONSENT_SOURCE_DEFAULT = "Regulamin Fresh Market B2B — zgoda na informacje o PreConnect wyrażona przy rejestracji konta";

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
        if (body.template_key === "selected_companies" && !name) return json(400, { error: "name_required" });
        if (name.length > 160) return json(400, { error: "name_too_long" });
        // nowe kampanie tylko z grupą odbiorców; stare klucze zostają wyłącznie dla istniejących wierszy
        if (!AUDIENCE_TEMPLATE_KEYS.includes(body.template_key)) return json(400, { error: "template_key_invalid", allowed: AUDIENCE_TEMPLATE_KEYS });
        // The database assigns the immutable sequence number, date and standard name.
        // [feat/marketing-photos] nowe kampanie w układzie 2 ze zdjęciem z rotacji (brak gotowych zdjęć = bez zdjęcia + ostrzeżenie)
        const layoutVersion = DEFAULT_LAYOUT_VERSION;
        const pick = await suggestPhoto(supaSvc, {});
        const row = { name: body.template_key === "selected_companies" ? name : "", template_key: body.template_key, content: {}, reply_to: emailOrNull(body.reply_to), created_by: caller.id,
          layout_version: layoutVersion, photo_id: pick.photo?.id || null, photo_version_id: pick.version?.id || null };
        const { data, error } = await supaSvc.from("marketing_campaigns").insert(row).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        return json(200, { ok: true, campaign: data, default_content: defaultContent(body.template_key, layoutVersion), photo: await resolveCampaignPhoto(supaSvc, data), photo_pick: pickInfo(pick) });
      }
      case "get": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        const { data: messages, error } = await supaSvc.from("marketing_messages")
          .select("id, company_id, profile_id, to_email, locale, segment, consent_source, snapshot, subject, state, attempts, first_claim_at, claimed_at, lease_until, resend_message_id, sent_at, last_error, is_test, created_at")
          .eq("campaign_id", campaign.id).order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const defaults = TEMPLATE_KEYS.includes(campaign.template_key) ? defaultContent(campaign.template_key, campaign.layout_version) : null;
        return json(200, { ok: true, campaign, default_content: defaults, messages: messages || [], photo: await resolveCampaignPhoto(supaSvc, campaign) });
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
        const current = Number(campaign.content_version || 1);
        const expected = body.expected_version == null ? current : Number(body.expected_version);
        if (expected !== current) return json(409, { error: "content_version_conflict", current, expected });
        // warunkowo po wersji: dwa okna nie nadpiszą się nawzajem po cichu
        const { data, error } = await supaSvc.from("marketing_campaigns")
          .update({ content: clean, content_version: current + 1, content_updated_at: new Date().toISOString(), content_updated_by: caller.id })
          .eq("id", campaign.id).eq("status", "draft").eq("content_version", current).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return json(409, { error: "content_version_conflict", current });
        return json(200, { ok: true, campaign: data, reset });
      }
      case "set_photo": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        if (campaign.status !== "draft") return json(409, { error: "photo_frozen", status: campaign.status, hint: "zdjęcie zmieniasz tylko w szkicu; po zatwierdzeniu jest zamrożone" });
        if (normalizeLayoutVersion(campaign.layout_version) !== 2) return json(409, { error: "layout_without_photo", layout_version: campaign.layout_version });
        const current = Number(campaign.content_version || 1);
        const expected = body.expected_version == null ? current : Number(body.expected_version);
        if (expected !== current) return json(409, { error: "content_version_conflict", current, expected });
        let photoId = null, versionId = null, pick = null;
        if (body.auto === true) {
          pick = await suggestPhoto(supaSvc, { campaignId: campaign.id });
          if (!pick.photo || !pick.version) return json(409, { error: "no_ready_photos", warnings: pick.warnings });
          photoId = pick.photo.id; versionId = pick.version.id;
        } else if (body.photo_id) {
          const photo = await loadPhoto(supaSvc, body.photo_id);
          if (!photo) return json(404, { error: "photo_not_found" });
          // [review Codexa P2] do kampanii trafia WYŁĄCZNIE zatwierdzona, opublikowana wersja — nigdy „ostatnio wgrana”
          const approved = photo.status === "ready" ? await loadPhotoVersion(supaSvc, photo.approved_version_id) : null;
          if (!isPublished(approved)) return json(409, { error: "photo_not_ready", status: photo.status });
          photoId = photo.id; versionId = approved.id;
        } // photo_id: null = świadomie bez zdjęcia
        const { data, error } = await supaSvc.from("marketing_campaigns")
          .update({ photo_id: photoId, photo_version_id: versionId, content_version: current + 1, content_updated_at: new Date().toISOString(), content_updated_by: caller.id })
          .eq("id", campaign.id).eq("status", "draft").eq("content_version", current).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return json(409, { error: "content_version_conflict", current });
        return json(200, { ok: true, campaign: data, photo: await resolveCampaignPhoto(supaSvc, data), photo_pick: pick ? pickInfo(pick) : null });
      }
      case "approve": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        if (!["draft", "approved"].includes(campaign.status)) return json(409, { error: "campaign_not_editable", status: campaign.status });
        if (!env.marketingUnsubscribeSecret) return json(500, { error: "unsubscribe_secret_missing", hint: "ustaw MARKETING_UNSUBSCRIBE_SECRET — bez linku wypisu nie zatwierdzamy wiadomości" });
        const wanted = Array.isArray(body.recipients) ? body.recipients.slice(0, MAX_RECIPIENTS) : [];
        if (!wanted.length) return json(400, { error: "recipients_required" });
        const byCompany = new Map(wanted.map((r) => [String(r.company_id), str(r.consent_source) || CONSENT_SOURCE_DEFAULT]));
        // [P1 #1] wersja treści, którą administrator widział w podglądzie, musi być wersją w bazie
        const currentVersion = Number(campaign.content_version || 1);
        if (!Number.isInteger(Number(body.content_version))) return json(400, { error: "content_version_required" });
        if (Number(body.content_version) !== currentVersion) return json(409, { error: "content_version_mismatch", current: currentVersion, sent: Number(body.content_version) });
        const liveContent = campaign.content && Object.keys(campaign.content).length ? campaign.content : null;
        if (liveContent) { const errors = validateContent(liveContent); if (errors.length) return json(422, { error: "content_invalid", errors }); }

        const result = await computeCandidates(supaSvc, { campaign });
        const snapshotAt = result.snapshot_at;
        const problems = [];
        const toInsert = [];
        for (const [companyId, consent] of byCompany) {
          const row = result.rows.find((r) => String(r.company_id) === companyId);
          if (!row) { problems.push({ company_id: companyId, reason: "not_found" }); continue; }
          if (!row.eligible) { problems.push({ company_id: companyId, reason: row.base_ok === false ? "not_eligible" : "not_in_audience", exclusions: row.exclusions, audience_reason: row.audience_reason }); continue; }
          toInsert.push({ row, consent, templateKey: campaign.template_key });
        }
        if (problems.length && body.strict !== false) return json(422, { error: "recipients_rejected", problems, approved: 0 });

        // [P1 #2] ATOMOWE zamrożenie: jeden warunkowy UPDATE (status draft/approved + ta sama wersja treści) ustawia
        // status approved i zapisuje frozen_content; 0 wierszy = ktoś w międzyczasie edytował treść albo zamknął kampanię.
        const nowIso = new Date().toISOString();
        // [review Codexa P1 #3] zamrażamy PEŁNĄ efektywną treść PL/EN — także gdy administrator został przy domyślnym
        // szablonie ({}); inaczej zmiana szablonu w kodzie w kolejnej wersji aplikacji zmieniłaby treść tej samej kampanii
        // przy ponowieniu, podglądzie i teście. Stare zamrożenie {} (sprzed tej poprawki) traktujemy jak brak zamrożenia.
        const firstFreeze = !campaign.frozen_content || Object.keys(campaign.frozen_content).length === 0;
        const layoutVersion = normalizeLayoutVersion(campaign.layout_version);
        // [feat/marketing-photos] zamrożenie zdjęcia razem z treścią: konkretna wersja pliku (adres HTTPS) + alt/podpis PL/EN.
        // Zdjęcie wyłączone albo bez pliku w chwili zatwierdzenia = STOP (administrator wybiera inne), nie „bez zdjęcia po cichu”.
        let frozenPhoto = null;
        if (firstFreeze && layoutVersion === 2 && campaign.photo_id) {
          const photo = await loadPhoto(supaSvc, campaign.photo_id);
          const version = photo ? await loadPhotoVersion(supaSvc, campaign.photo_version_id || photo.approved_version_id) : null;
          if (!photo || !version) return json(409, { error: "photo_missing", hint: "zdjęcie kampanii nie istnieje albo nie ma pliku — wybierz inne zdjęcie w szkicu" });
          if (photo.status !== "ready") return json(409, { error: "photo_not_ready", status: photo.status, hint: "zdjęcie zostało wyłączone — wybierz inne" });
          // [P1] zamrażamy tylko OPUBLIKOWANĄ (zatwierdzoną) wersję — wersja z prywatnego bucketa nie ma adresu dla klienta poczty
          if (!isPublished(version) || String(version.id) !== String(photo.approved_version_id)) return json(409, { error: "photo_version_not_approved", hint: "wybrana wersja pliku nie jest zatwierdzona — wybierz zdjęcie ponownie" });
          frozenPhoto = freezePhoto(photo, version);
        }
        const freezePatch = firstFreeze
          ? { status: "approved", approved_by: caller.id, approved_at: nowIso, snapshot_at: snapshotAt, frozen_content: effectiveContent(campaign.template_key, liveContent, layoutVersion), frozen_content_version: currentVersion, content_frozen_at: nowIso, frozen_photo: frozenPhoto }
          : { status: "approved", snapshot_at: snapshotAt };
        const { data: frozenCampaign, error: fzErr } = await supaSvc.from("marketing_campaigns").update(freezePatch)
          .eq("id", campaign.id).eq("content_version", currentVersion).in("status", ["draft", "approved"]).select("*").maybeSingle();
        if (fzErr) throw new Error("freeze: " + fzErr.message);
        if (!frozenCampaign) return json(409, { error: "campaign_changed", hint: "treść zmieniona albo kampania zamknięta w innym oknie — odśwież i sprawdź podgląd" });
        const content = frozenCampaign.frozen_content; // zawsze kompletna treść PL/EN zapisana w bazie
        if (!content || validateContent(content).length) return json(500, { error: "frozen_content_invalid", errors: content ? validateContent(content) : ["missing"] });
        const photoFrozen = frozenCampaign.frozen_photo || null; // zamrożone zdjęcie (null = kampania bez zdjęcia / układ 1)
        if (photoFrozen && validateFrozenPhoto(photoFrozen).length) return json(500, { error: "frozen_photo_invalid", errors: validateFrozenPhoto(photoFrozen) });
        const frozenLayout = normalizeLayoutVersion(frozenCampaign.layout_version);
        const customContent = Boolean(liveContent);

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
            creditsRemaining: row.snapshot.credits_remaining, creditsAvailable: row.snapshot.credits_available, creditsReserved: row.snapshot.reserved, expiringCredits: row.snapshot.expiring_credits,
            creditsExpiry: row.snapshot.nearest_expiry,
            snapshotAt, appUrl: env.b2bAppUrl, unsubscribeUrl: unsub, replyTo: campaign.reply_to || null,
            layoutVersion: frozenLayout, photo: photoFrozen,
          });
          const full = {
            id: messageId, campaign_id: campaign.id, company_id: row.company_id, profile_id: row.profile_id, to_email: row.email, locale: row.locale,
            segment: row.segment, consent_source: consent,
            snapshot: { ...row.snapshot, snapshot_at: snapshotAt, company_name: row.company_name, template_key: templateKey, audience_reason: row.audience_reason, warnings: row.warnings, custom_content: customContent, content_version: frozenCampaign.frozen_content_version || currentVersion, layout_version: frozenLayout, photo_id: photoFrozen?.photo_id || null, photo_version_id: photoFrozen?.version_id || null },
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
        return json(200, { ok: true, approved: inserted.length, inserted, skipped, problems, snapshot_at: snapshotAt, content_version: frozenCampaign.frozen_content_version || currentVersion, layout_version: frozenLayout, photo: photoFrozen ? { photo_id: photoFrozen.photo_id, version_id: photoFrozen.version_id, url: photoFrozen.url } : null });
      }
      case "message": {
        if (!body.campaign_id || !body.message_id) return json(400, { error: "message_id_required" });
        const { data: msg, error } = await supaSvc.from("marketing_messages")
          .select("id, campaign_id, to_email, locale, state, subject, html, text_body, payload_hash, snapshot, consent_source, is_test, sent_at, created_at")
          .eq("id", body.message_id).eq("campaign_id", body.campaign_id).maybeSingle();
        if (error) throw new Error(error.message);
        if (!msg) return json(404, { error: "message_not_found" });
        return json(200, { ok: true, saved: true, message: msg });
      }
      case "close": {
        const campaign = await loadCampaign(supaSvc, body.campaign_id);
        if (!campaign) return json(404, { error: "campaign_not_found" });
        const { error } = await supaSvc.from("marketing_campaigns").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", campaign.id).neq("status", "closed");
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

function pickInfo(pick) { return { reason: pick.reason, warnings: pick.warnings, pool: pick.pool, photo_id: pick.photo?.id || null }; }
function pickFields(c) { return { subject: String(c?.subject ?? ""), body: String(c?.body ?? ""), cta: String(c?.cta ?? "") }; }
function str(v) { const s = String(v ?? "").trim(); return s ? s.slice(0, 500) : null; }
function emailOrNull(v) { const s = str(v); return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null; }
