/** Admin-triggered retailer mailing. Delivery metadata is merged in SQL
 * against current rows; reads, billing and notification markers are preserved.
 * approved/sent rows without an email marker are eligible. No automatic send.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { renderRetailerEmail } from "./_shared/render-retailer-email.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hasRetailerEmailMarker(row) {
  const data = row?.data || {};
  const messageIds = data.resendMessageIds || [];
  // [fix/security-hotfix] od 054 w legacy_sends.data zostaje tylko liczba adresatów
  const buyerCount = Number(data.resendBuyerCount || 0) || (Array.isArray(data.resendBuyerEmails) ? data.resendBuyerEmails.length : 0);
  return Boolean(
    row?.resend_message_id ||
    data.resendMessageId ||
    data.resend_message_id ||
    data.emailSentAt ||
    data.email_sent_at ||
    (Array.isArray(messageIds) && messageIds.length) ||
    buyerCount > 0
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

export default async function handler(request) {
  // [P2-backend-mails C3] adminFacing locale (caller = admin).
  const acceptLang = request.headers.get("accept-language");
  let adminLocale = resolveLocale({ acceptLanguage: acceptLang });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json(405, { error: errLoc(adminLocale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const required = ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "resendApiKey"];
  const missing = missingEnvNames(env, required);
  if (missing.length) return json(500, envErrorPayload("send-retailer-batch", missing));

  // ── Auth: admin only ─────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
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
    .select("id, role, name, email, locale, active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerErr || !caller) return json(403, { error: errLoc(adminLocale, "profile_not_found") });
  if (caller.role !== "admin" || caller.active === false) {
    return json(403, { error: errLoc(adminLocale, "only_admin_send_batch") });
  }
  adminLocale = resolveLocale({ profileLocale: caller.locale, acceptLanguage: acceptLang });

  // ── Body ─────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
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
      .select("id, legacy_supplier_id, legacy_fm_id, name, country, logo_url, description_short, description_short_en, description")
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
        .select("id, legacy_supplier_id, legacy_fm_id, name, country, logo_url, description_short, description_short_en, description")
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
        resendResults.push({ buyer: buyer.email, locale: buyerLocale, ok: Boolean(r.id), message_id: r.id || null });
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

  if (anySent) {
    const sentAtIso = new Date().toISOString();
    let persisted;
    try {
      persisted = await supaSvc.rpc("mark_legacy_sends_retailer_emailed", {
        p_send_ids: eligible.map(s => s.legacy_id), p_retailer_id: retailerId,
        p_message_ids: successfulMessageIds,
        p_buyer_count: resendResults.filter(r => r.ok).length, p_sent_at: sentAtIso,
      });
    } catch (error) { persisted = { error }; }
    if (persisted.error || !Array.isArray(persisted.data) || persisted.data.length !== eligible.length) {
      // Mail may have left. Never report success or encourage a blind resend.
      return json(502, {
        ok: false, delivery_uncertain: true, send_ids_marked: [],
        error: errLoc(adminLocale, "retailer_delivery_unconfirmed"),
      });
    }
    markedSendIds = persisted.data;

    // Supplier notification is tied to the buyer's read, not this optional mailing.
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
    sent_count: markedSendIds.length,
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
  return new Response(JSON.stringify(payload), {
    status: statusCode, headers: { ...cors, "Content-Type": "application/json" },
  });
}
