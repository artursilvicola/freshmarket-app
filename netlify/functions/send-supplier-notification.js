/**
 * Netlify Function: send-supplier-notification
 * POST /.netlify/functions/send-supplier-notification
 * Body: { template, company_id, payload }
 *
 * [B2B Round supplier-onboarding-access-and-communication]
 *
 * Wysyła pojedynczy mail transakcyjny do dostawcy (lub admina) używając
 * jednego z templateów z _shared/supplier-email-templates.js.
 *
 * Auth:
 *   - Templates dostawcy (registration_accepted, account_activated, ...)
 *     wymagają tokena JWT — wywoływane są z UI admina lub z self-register
 *     fn (która ma własny service-role kontekst).
 *   - admin_new_registration jest wewnętrzny i wymaga service role / wyłącznie
 *     z register-supplier-self.js — nie z UI.
 *
 * Endpoint NIE ma anti-spamu poza wymogiem auth tokena. Self-register
 * używa innej, dedykowanej funkcji (register-supplier-self) która
 * następnie woła ten endpoint po stronie serwera.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { pickTemplate } from "./_shared/supplier-email-templates.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  // [P2-backend-mails C3] Caller-facing locale resolution (Accept-Language → body → profile).
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let callerLocale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(callerLocale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "resendApiKey"]);
  if (missing.length) return json(500, envErrorPayload("send-supplier-notification", missing));

  // ── Body ─────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: errLoc(callerLocale, "invalid_json") });
  }
  // [P2-backend-mails C3] body.callerLocale overrides Accept-Language dla błędów.
  callerLocale = resolveLocale({ bodyLocale: body.callerLocale, acceptLanguage: acceptLang });
  const { template, company_id, payload = {} } = body || {};
  if (!template) return json(400, { error: errLoc(callerLocale, "missing_template") });

  // ── Auth: admin/supplier dla większości; service-role override dla
  //         wewnętrznych wywołań (admin_new_registration / registration_accepted) ─
  const internalToken = event.headers["x-internal-token"] || event.headers["X-Internal-Token"];
  const isInternal = Boolean(internalToken && internalToken === env.supabaseServiceRoleKey);

  let callerRole = null;
  if (!isInternal) {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: errLoc(callerLocale, "no_auth_token") });
    const token = authHeader.slice(7);
    const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser(token);
    if (userErr || !userData?.user) return json(401, { error: errLoc(callerLocale, "invalid_token") });
    const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
    // [P2-backend-mails C3] Pull caller `locale` for error messages (admin or supplier UI).
    const { data: caller } = await supaSvc.from("profiles").select("role, locale").eq("id", userData.user.id).maybeSingle();
    callerRole = caller?.role || null;
    if (!["admin", "supplier"].includes(callerRole)) {
      return json(403, { error: errLoc(callerLocale, "only_admin_or_supplier") });
    }
    callerLocale = resolveLocale({ bodyLocale: body.callerLocale, profileLocale: caller?.locale, acceptLanguage: acceptLang });
  }

  // ── Resolve recipient ────────────────────────────────────────────────
  let recipientEmail = payload.recipientEmail || null;
  let companyName = payload.companyName || null;
  let contactName = payload.contactName || null;
  let country = payload.country || null;
  // [P2-backend-mails C2] Resolve recipient locale: payload first, then DB.
  let recipientLocale = payload.locale || null;

  // Dla większości templateów chcemy wyciągnąć email z profiles + nazwę z companies.
  if (company_id) {
    const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
    const { data: co } = await supaSvc
      .from("companies")
      .select("id, name, country, status_note")
      .eq("id", company_id)
      .maybeSingle();
    if (co) {
      companyName = companyName || co.name;
      country = country || co.country;
      if (!payload.statusNote && co.status_note) payload.statusNote = co.status_note;
    }
    if (!recipientEmail || !recipientLocale) {
      // [P2-backend-mails C2] Pull supplier `locale` so tpl is rendered in
      // supplier language when payload.locale missing (admin trigger path).
      const { data: ownerProfiles } = await supaSvc
        .from("profiles")
        .select("name, email, role, active, locale")
        .eq("company_id", company_id)
        .eq("role", "supplier")
        .order("created_at", { ascending: true })
        .limit(1);
      const owner = ownerProfiles?.[0];
      if (owner) {
        if (!recipientEmail) recipientEmail = owner.email;
        if (!contactName) contactName = contactName || owner.name;
        if (!recipientLocale && owner.locale) recipientLocale = owner.locale;
      }
    }
  }

  // admin_new_registration kierujemy do Fresh Market admin mailbox
  if (template === "admin_new_registration") {
    recipientEmail = recipientEmail || "newsletter@freshmarket.eu";
  }

  if (!recipientEmail) return json(400, { error: errLoc(callerLocale, "missing_recipient") });

  const tpl = pickTemplate(template, {
    ...payload,
    companyName: companyName || payload.companyName,
    contactName: contactName || payload.contactName,
    country: country || payload.country,
    appUrl: env.b2bAppUrl,
    // [P2-backend-mails C2] Pass resolved locale to template dispatcher.
    // admin_new_registration ignoruje locale (zostaje PL — internal admin notification).
    locale: recipientLocale || payload.locale || "pl",
  });
  if (!tpl) return json(400, { error: errLoc(callerLocale, "unknown_template", { template }) });

  const { subject, html } = tpl;

  // ── Wysyłka przez Resend ─────────────────────────────────────────────
  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Fresh Market <newsletter@freshmarket.eu>",
      to: [recipientEmail],
      subject,
      html,
    }),
  });
  if (!resendRes.ok) {
    const detail = await resendRes.text();
    return json(502, { error: errLoc(callerLocale, "resend_error"), status: resendRes.status, detail });
  }
  const r = await resendRes.json().catch(() => ({}));

  return json(200, { ok: true, template, recipient: recipientEmail, subject, message_id: r.id || null });
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
