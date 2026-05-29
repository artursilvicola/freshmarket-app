/**
 * Netlify Function: send-retailer-batch
 * POST /.netlify/functions/send-retailer-batch
 * Body: { retailer_id: number, send_ids: number[], dry_run?: boolean }
 *
 * [B2B Round pipeline-retailer-email-mvp]
 *
 * Wysyła ZBIORCZY mail do jednej sieci handlowej z listą zatwierdzonych
 * ofert. Endpoint:
 *   1. Auth: tylko admin (sprawdzane przez profile.role).
 *   2. Wczytuje legacy_sends WHERE retailer_id = X AND legacy_id IN (...)
 *      I status = 'approved'. Każdy inny status (sent / rejected / queued
 *      bez moderacji / pending_moderation) jest odrzucany — to bramka
 *      anti-duplicate.
 *   3. Wczytuje legacy_offers po offer_legacy_id i companies po
 *      legacy_supplier_id (bo to jest klucz w jsonb data.supplierId).
 *   4. Wczytuje retailer + buyers (active + email + role='buyer').
 *   5. Renderuje HTML mail (shared/render-retailer-email.js).
 *   6. Wysyła ten sam mail do każdego aktywnego kupca przez Resend
 *      (każdy buyer = osobne wywołanie Resend, ale ta sama treść).
 *   7. Po sukcesie aktualizuje legacy_sends.status='sent' oraz
 *      data.status='sent' + data.sentAt. Robi to atomowo per send_id —
 *      jeśli choć jeden Resend się powiódł, marker idzie. Jeśli żaden,
 *      status zostaje 'approved' i admin może spróbować ponownie.
 *   8. Zwraca {ok, sent_count, buyer_count, send_ids_marked, errors[]}.
 *
 * dry_run=true zwraca tylko podgląd (ile sendsów, ilu kupców, subject,
 * pierwsze ~3KB HTMLa) bez wysyłki — przydatne do preview po stronie UI
 * jeśli kiedyś chcemy mieć render server-side. MVP używa client-side
 * preview, ale endpoint jest ready.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { renderRetailerEmail, buildSubject } from "./_shared/render-retailer-email.js";
import { tplOffersSentToRetailer } from "./_shared/supplier-email-templates.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hasRetailerEmailMarker(row) {
  const data = row?.data || {};
  const messageIds = data.resendMessageIds || [];
  const buyerEmails = data.resendBuyerEmails || [];
  return Boolean(
    row?.resend_message_id ||
    data.resendMessageId ||
    data.resend_message_id ||
    data.emailSentAt ||
    data.email_sent_at ||
    (Array.isArray(messageIds) && messageIds.length) ||
    (Array.isArray(buyerEmails) && buyerEmails.length)
  );
}

async function getBrandLogoUrl(supaSvc) {
  try {
    const { data } = await supaSvc
      .from("fm_settings")
      .select("brand_logo_url")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.brand_logo_url || null;
  } catch {
    return null;
  }
}

async function buildMagicLinksByLegacyId({ supaSvc, buyer, sends, appUrl }) {
  const links = new Map();
  const email = String(buyer?.email || "").trim();
  if (!email || !email.includes("@")) return links;

  for (const s of sends || []) {
    const legacyId = s?.legacy_id || s?.data?.id;
    if (!legacyId) continue;
    const redirectTo = `${appUrl}/kupiec?send=${encodeURIComponent(String(legacyId))}`;
    try {
      const { data, error } = await supaSvc.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (!error && data?.properties?.action_link) {
        links.set(String(legacyId), data.properties.action_link);
      }
    } catch (e) {
      console.warn("[retailer_batch_magic_link]", email, legacyId, e?.message || e);
    }
  }
  return links;
}

export const handler = async (event) => {
  // [P2-backend-mails C3] adminFacing locale (caller = admin).
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let adminLocale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(adminLocale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const required = ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "resendApiKey"];
  const missing = missingEnvNames(env, required);
  if (missing.length) return json(500, envErrorPayload("send-retailer-batch", missing));

  // ── Auth: admin only ─────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: errLoc(adminLocale, "no_auth_header") });
  const token = authHeader.slice(7);

  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await supaUser.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(adminLocale, "invalid_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  // [P2-backend-mails C3] Pull admin `locale` for error messages.
  const { data: caller, error: callerErr } = await supaSvc
    .from("profiles")
    .select("id, role, name, email, locale")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerErr || !caller) return json(403, { error: errLoc(adminLocale, "profile_not_found") });
  if (caller.role !== "admin") {
    return json(403, { error: errLoc(adminLocale, "only_admin_send_batch") });
  }
  adminLocale = resolveLocale({ profileLocale: caller.locale, acceptLanguage: acceptLang });

  // ── Body ─────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: errLoc(adminLocale, "invalid_json") });
  }
  // [P2-backend-mails C3] body.locale (admin UI) overrides profile.locale dla errorów.
  adminLocale = resolveLocale({ bodyLocale: body.locale, profileLocale: caller.locale, acceptLanguage: acceptLang });

  const retailerId = Number(body.retailer_id);
  const sendIds = Array.isArray(body.send_ids) ? body.send_ids.map(Number).filter(Number.isFinite) : [];
  const dryRun = !!body.dry_run;

  if (!retailerId) return json(400, { error: errLoc(adminLocale, "missing_retailer_id") });
  if (!sendIds.length) return json(400, { error: errLoc(adminLocale, "missing_send_ids") });

  // ── Retailer + active buyers ─────────────────────────────────────────
  // [P2-backend-mails C2] Buyer rows include `locale` so each buyer can get
  // the mailing rendered in their preferred language. Mixed locale batches
  // result in two render passes (PL + EN) — niżej grupujemy.
  const { data: retailer, error: retErr } = await supaSvc
    .from("retailers")
    .select(`id, name, country, color, bg, logo_url,
             buyers:profiles!fk_profiles_retailer(id, role, name, email, active, fm26_active, locale)`)
    .eq("id", retailerId)
    .maybeSingle();
  if (retErr || !retailer) return json(404, { error: errLoc(adminLocale, "retailer_not_found_short") });

  const activeBuyers = (retailer.buyers || []).filter(
    (b) => b && (b.role == null || b.role === "buyer") && b.active !== false && b.email && b.email.includes("@")
  );
  if (!activeBuyers.length) {
    return json(400, {
      error: errLoc(adminLocale, "no_active_buyers", { retailerName: retailer.name }),
    });
  }

  // ── Sends: tylko approved + należące do tej sieci ────────────────────
  const { data: sendsRaw, error: sendsErr } = await supaSvc
    .from("legacy_sends")
    .select("legacy_id, retailer_id, status, resend_message_id, data")
    .in("legacy_id", sendIds);
  if (sendsErr) return json(500, { error: errLoc(adminLocale, "sends_read_failed", { detail: sendsErr.message }) });

  const eligible = (sendsRaw || []).filter(
    (s) => Number(s.retailer_id) === retailerId && ["approved", "sent"].includes(s.status) && !hasRetailerEmailMarker(s)
  );
  const skipped = (sendsRaw || []).filter((s) => !eligible.includes(s));

  if (!eligible.length) {
    return json(400, {
      error: errLoc(adminLocale, "no_approved_sends"),
      skipped_statuses: skipped.map((s) => ({ legacy_id: s.legacy_id, status: hasRetailerEmailMarker(s) ? "email_sent" : s.status })),
    });
  }

  // ── Offers (legacy_offers.data jsonb) ────────────────────────────────
  const offerIds = [...new Set(eligible.map((s) => (s.data || {}).offerId).filter((x) => x != null))];
  const offersMap = new Map();
  if (offerIds.length) {
    const { data: offerRows } = await supaSvc
      .from("legacy_offers")
      .select("legacy_id, data")
      .in("legacy_id", offerIds);
    for (const row of offerRows || []) {
      offersMap.set(row.legacy_id, row.data || {});
    }
  }

  // ── Companies (po legacy_supplier_id, fallback po fmId / id UUID) ────
  // sends.data.supplierId może być stringiem typu "sup-s1" (legacy_supplier_id)
  // albo UUID-em (companies.id) zależnie od tego, jak supplier dodał ofertę.
  const supplierKeys = [...new Set(eligible.map((s) => (s.data || {}).supplierId).filter(Boolean))];
  const companiesMap = new Map();
  if (supplierKeys.length) {
    // próba 1: legacy_supplier_id
    const { data: byLegacy } = await supaSvc
      .from("companies")
      .select("id, legacy_supplier_id, legacy_fm_id, name, country, logo_url, description_short, description")
      .in("legacy_supplier_id", supplierKeys);
    for (const co of byLegacy || []) {
      if (co.legacy_supplier_id) companiesMap.set(co.legacy_supplier_id, co);
      if (co.id) companiesMap.set(co.id, co);
    }
    // próba 2: id UUID dla kluczy które nie zostały złapane przez legacy_supplier_id
    const unresolvedKeys = supplierKeys.filter((k) => !companiesMap.has(k));
    const uuidKeys = unresolvedKeys.filter((k) => typeof k === "string" && k.length === 36);
    if (uuidKeys.length) {
      const { data: byUuid } = await supaSvc
        .from("companies")
        .select("id, legacy_supplier_id, legacy_fm_id, name, country, logo_url, description_short, description")
        .in("id", uuidKeys);
      for (const co of byUuid || []) {
        companiesMap.set(co.id, co);
        if (co.legacy_supplier_id) companiesMap.set(co.legacy_supplier_id, co);
      }
    }
  }

  // ── Render HTML — per-locale ─────────────────────────────────────────
  // [P2-backend-mails C2] Mailing renderujemy raz na język. Buyerzy z `locale='en'`
  // dostają EN render, reszta PL. monthLabel() jest zależny od locale (np. "May 2026"
  // vs "Maj 2026"). dry_run pokazuje preview pierwszego renderu (PL preferowany
  // jeśli wszyscy PL, inaczej EN).
  const brandLogoUrl = await getBrandLogoUrl(supaSvc);
  const renderedByLocale = new Map(); // locale -> { html, subject, month }
  const pickRender = (lng) => {
    if (renderedByLocale.has(lng)) return renderedByLocale.get(lng);
    const month = monthLabel(lng);
    const r = renderRetailerEmail({
      retailer,
      sends: eligible,
      offers: offersMap,
      companies: companiesMap,
      buyerCount: activeBuyers.length,
      month,
      appUrl: env.b2bAppUrl,
      locale: lng,
      brandLogoUrl,
    });
    renderedByLocale.set(lng, { ...r, month });
    return renderedByLocale.get(lng);
  };

  if (dryRun) {
    // [P2-backend-mails C2] dry_run zwraca preview w języku admina (jeśli możliwe)
    // lub PL jako domyślne. UI admin może później rozszerzyć żeby pokazać oba.
    const previewLocale = activeBuyers.some(b => (b.locale || "pl").toLowerCase().startsWith("en")) ? "en" : "pl";
    const { html, subject } = pickRender(previewLocale);
    return json(200, {
      ok: true,
      dry_run: true,
      subject,
      preview_locale: previewLocale,
      offer_count: eligible.length,
      buyer_count: activeBuyers.length,
      buyers: activeBuyers.map((b) => ({ name: b.name, email: b.email, locale: b.locale || "pl" })),
      html_preview: html.slice(0, 3000),
    });
  }

  // ── Wysyłka przez Resend (po jednej wiadomości na buyera, w jego locale) ─
  const resendResults = [];
  for (const buyer of activeBuyers) {
    const buyerLocale = (buyer.locale || "pl").toLowerCase().startsWith("en") ? "en" : "pl";
    const month = monthLabel(buyerLocale);
    const magicLinksByLegacyId = await buildMagicLinksByLegacyId({
      supaSvc,
      buyer,
      sends: eligible,
      appUrl: env.b2bAppUrl,
    });
    const { html, subject } = renderRetailerEmail({
      retailer,
      sends: eligible,
      offers: offersMap,
      companies: companiesMap,
      buyerCount: activeBuyers.length,
      month,
      appUrl: env.b2bAppUrl,
      locale: buyerLocale,
      brandLogoUrl,
      magicLinksByLegacyId,
    });
    if (!renderedByLocale.has(buyerLocale)) {
      renderedByLocale.set(buyerLocale, { html, subject, month });
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Fresh Market <newsletter@freshmarket.eu>",
          to: [buyer.email],
          subject,
          html,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        resendResults.push({ buyer: buyer.email, locale: buyerLocale, ok: false, status: res.status, detail });
      } else {
        const r = await res.json().catch(() => ({}));
        resendResults.push({ buyer: buyer.email, locale: buyerLocale, ok: true, message_id: r.id || null });
      }
    } catch (e) {
      resendResults.push({ buyer: buyer.email, locale: buyerLocale, ok: false, status: 0, detail: e?.message || String(e) });
    }
  }

  const anySent = resendResults.some((r) => r.ok);
  let markedSendIds = [];

  // [B2B Round prod-rollout / email-open-tracking] Zapisujemy resend_message_id
  // z pierwszego pomyślnego maila do tego retailera. Wszystkie legacy_sends
  // tego batcha dostają ten sam message_id — bo mail jest ZBIORCZY (zawiera
  // wszystkie oferty do tego retailera). Jak buyer otworzy ten mail, webhook
  // wykryje otwarcie po message_id i marki wszystkie powiązane sends jako
  // 'opened'. To match z intencją "ktoś z sieci to widział".
  const successfulMessageIds = resendResults
    .filter((r) => r.ok && r.message_id)
    .map((r) => r.message_id);
  const firstSuccessfulMessageId = successfulMessageIds[0] || null;

  if (anySent) {
    const sentAtIso = new Date().toISOString();
    const sentAtDate = sentAtIso.slice(0, 10);
    // Update jeden po drugim — kolizji nie ma (legacy_id unique).
    for (const s of eligible) {
      const newData = {
        ...(s.data || {}),
        status: "sent",
        sentAt: sentAtDate,
        sent_at: sentAtIso,
        emailSentAt: sentAtIso,
        email_sent_at: sentAtIso,
        daysLeft: 14,
        resendMessageIds: successfulMessageIds,
        resendBuyerEmails: resendResults.filter((r) => r.ok).map((r) => r.buyer),
      };
      const updatePayload = { status: "sent", data: newData };
      if (firstSuccessfulMessageId) {
        updatePayload.resend_message_id = firstSuccessfulMessageId;
      }
      const { error: upErr } = await supaSvc
        .from("legacy_sends")
        .update(updatePayload)
        .eq("legacy_id", s.legacy_id);
      if (!upErr) markedSendIds.push(s.legacy_id);
    }

    // [B2B Round supplier-onboarding-access-and-communication]
    // Email F — powiadom dostawcę zbiorczo per sieć/batch, żeby przy kilku
    // ofertach nie wysyłać kilku niemal identycznych maili.
    const supplierEmailsByCompanyId = new Map();
    const supplierIdToCompanyId = new Map();
    for (const co of companiesMap.values()) {
      if (co?.id && !supplierEmailsByCompanyId.has(co.id)) {
        supplierEmailsByCompanyId.set(co.id, null);
        supplierIdToCompanyId.set(co.legacy_supplier_id, co.id);
        supplierIdToCompanyId.set(co.id, co.id);
      }
    }
    if (supplierEmailsByCompanyId.size) {
      const companyIds = [...supplierEmailsByCompanyId.keys()];
      // [P2-backend-mails C2] Pull supplier `locale` so notification mail
      // (offers_sent_to_retailer) renders in supplier's language.
      const { data: ownerProfiles } = await supaSvc
        .from("profiles")
        .select("name, email, role, active, company_id, locale")
        .in("company_id", companyIds)
        .eq("role", "supplier");
      for (const p of ownerProfiles || []) {
        if (p.active && p.email && !supplierEmailsByCompanyId.get(p.company_id)) {
          supplierEmailsByCompanyId.set(p.company_id, p);
        }
      }
      const groupsByCompanyId = new Map();
      for (const s of eligible) {
        const supplierKey = (s.data || {}).supplierId;
        const companyId = supplierIdToCompanyId.get(supplierKey);
        const owner = companyId ? supplierEmailsByCompanyId.get(companyId) : null;
        if (!owner?.email) continue;
        const offer = offersMap.get((s.data || {}).offerId) || {};
        const co = companiesMap.get(supplierKey) || companiesMap.get(companyId) || {};
        if (!groupsByCompanyId.has(companyId)) {
          groupsByCompanyId.set(companyId, {
            owner,
            company: co,
            offers: [],
          });
        }
        groupsByCompanyId.get(companyId).offers.push({
          title: offer.title || offer.product || `Oferta`,
        });
      }

      for (const group of groupsByCompanyId.values()) {
        const tpl = tplOffersSentToRetailer({
          companyName: group.company?.name || "",
          contactName: group.owner.name || null,
          offers: group.offers,
          offerCount: group.offers.length,
          retailerName: retailer.name || "",
          sentAt: sentAtDate,
          appUrl: env.b2bAppUrl,
          // [P2-backend-mails C2] Supplier sees notification in their language.
          locale: group.owner.locale || "pl",
        });
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Fresh Market <newsletter@freshmarket.eu>",
              to: [group.owner.email],
              subject: tpl.subject,
              html: tpl.html,
            }),
          });
        } catch (e) {
          // Logujemy ale nie blokujemy odpowiedzi — kupiec już dostał maila,
          // status sends jest zapisany. Notyfikacja do supplera to nice-to-have.
          console.warn("[email_supplier_offer_sent]", group.owner.email, e?.message || e);
        }
      }
    }
  }

  // [P2-backend-mails C3 fix] `subject` was undefined here after the per-locale
  // refactor (it only existed inside dry_run + the buyer loop). Codex review
  // flagged this as ReferenceError blocker. Extract subjects from
  // renderedByLocale map and return both: a default subject (first rendered)
  // for back-compat plus a `subjects_by_locale` map for full diagnostics.
  const subjectByLocale = Object.fromEntries(
    [...renderedByLocale.entries()].map(([lng, rendered]) => [lng, rendered.subject])
  );
  const firstRendered = renderedByLocale.values().next().value || pickRender("pl");
  return json(200, {
    ok: anySent,
    sent_count: eligible.length,
    buyer_count: activeBuyers.length,
    buyers_succeeded: resendResults.filter((r) => r.ok).map((r) => r.buyer),
    buyers_failed: resendResults.filter((r) => !r.ok),
    send_ids_marked: markedSendIds,
    skipped: skipped.map((s) => ({ legacy_id: s.legacy_id, status: s.status })),
    subject: firstRendered.subject,
    subjects_by_locale: subjectByLocale,
  });
};

// [P2-backend-mails C2] Locale-aware month label dla nagłówka maila retailera.
function monthLabel(locale = "pl") {
  const monthsPL = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
  const monthsEN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const months = locale === "en" ? monthsEN : monthsPL;
  const d = new Date();
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
