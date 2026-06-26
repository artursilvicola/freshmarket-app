/**
 * Netlify Function: create-payu-order
 * POST /.netlify/functions/create-payu-order
 *
 * Body: { plan_id: string }   // np. 'std_10', 'prem_5'
 * Headers: Authorization: Bearer <user JWT>
 *
 * [B2B Round prod-rollout / faza 3]
 *
 * Inicjuje płatność PayU dla aktualnie zalogowanego dostawcy:
 *   1. Weryfikuje JWT, pobiera company_id z profiles.
 *   2. Sprawdza że plan istnieje w package_plans i jest aktywny.
 *   3. Pobiera OAuth token PayU (client_credentials).
 *   4. Tworzy zamówienie w PayU — z extOrderId = nasz UUID, notifyUrl
 *      i continueUrl prowadzące do Netlify functions / strony /zakup-ok.
 *   5. Wstawia payu_orders w statusie 'pending' z raw_create.
 *   6. Zwraca { redirectUri } — frontend przekierowuje przeglądarkę.
 *
 * Bezpieczeństwo: kwota zakupu jest brana Z BAZY (package_plans.price_eur),
 * nigdy z body requestu — żeby user nie mógł sobie ustawić ceny 0.01.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import {
  createPayuOrder,
  fetchPayuToken,
  normalizePayuCurrencyCode,
  parsePayuStatusCode,
  parsePositiveNumber,
  payuBaseUrl,
  toMinorUnits,
} from "./_shared/payu.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  // [P2-backend-mails C3] Pre-body locale fallback z Accept-Language.
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, [
    "supabaseUrl",
    "supabaseServiceRoleKey",
    "payuPosId",
    "payuClientId",
    "payuClientSecret",
    "payuCurrencyCode",
  ]);
  if (missing.length) return json(500, envErrorPayload("create-payu-order", missing));
  let payuCurrencyCode;
  try {
    payuCurrencyCode = normalizePayuCurrencyCode(env.payuCurrencyCode);
  } catch (e) {
    return json(500, { error: errLoc(locale, "payu_config_error", { detail: e?.message || String(e) }) });
  }

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: errLoc(locale, "invalid_token") });
  }
  const userId = userData.user.id;

  // ── Body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: errLoc(locale, "invalid_json") }); }
  // [P2-backend-mails C3] body.locale wins jeśli klient przekazał.
  locale = resolveLocale({ bodyLocale: body.locale, acceptLanguage: acceptLang });
  const planId = String(body.plan_id || "").trim();
  if (!planId) return json(400, { error: errLoc(locale, "missing_plan_id") });

  // ── Profile + plan ──────────────────────────────────────────────────
  // [P2-backend-mails C3] Pull `locale` z profile jako backup-source.
  const { data: profile, error: profErr } = await supaSvc
    .from("profiles")
    .select("id, email, name, role, company_id, locale, company:companies!company_id(id, name)")
    .eq("id", userId)
    .maybeSingle();
  if (profErr || !profile) return json(403, { error: errLoc(locale, "profile_not_found") });
  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: profile.locale, acceptLanguage: acceptLang });
  if (profile.role !== "supplier" && profile.role !== "admin") {
    return json(403, { error: errLoc(locale, "only_supplier_buy_pkg") });
  }
  const companyId = profile.company_id;
  if (!companyId) {
    return json(400, { error: errLoc(locale, "no_company_assigned") });
  }

  const { data: plan, error: planErr } = await supaSvc
    .from("package_plans")
    .select("*")
    .eq("id", planId)
    .eq("active", true)
    .maybeSingle();
  if (planErr || !plan) return json(400, { error: errLoc(locale, "plan_not_found", { planId }) });

  // ── Kwoty ───────────────────────────────────────────────────────────
  // package_plans.price_eur jest kwota NETTO w EUR. UI i proforma pokazuja
  // kwote BRUTTO z VAT 23%, wiec PayU musi pobrac brutto. Waluta createOrder
  // musi byc zgodna z POS w panelu PayU (PAYU_CURRENCY_CODE).
  const extOrderId = randomUUID();
  const priceNetEur = roundMoney(Number(plan.price_eur));
  const vatRate = parsePositiveNumber(env.payuVatRate, 23);
  const grossEur = roundMoney(priceNetEur * (1 + vatRate / 100));
  const eurToPayuRate = payuCurrencyCode === "EUR" ? 1 : parsePositiveNumber(env.payuEurToPayuRate, null);

  if (payuCurrencyCode !== "EUR" && !eurToPayuRate) {
    return json(500, {
      error: errLoc(locale, "payu_currency_rate_missing", { currency: payuCurrencyCode }),
    });
  }

  const payuGrossAmount = roundMoney(grossEur * eurToPayuRate);
  const totalAmountMinor = toMinorUnits(payuGrossAmount, payuCurrencyCode);

  // ── Insert payu_orders (status=created) ─────────────────────────────

  const { data: orderRow, error: orderErr } = await supaSvc
    .from("payu_orders")
    .insert({
      company_id: companyId,
      plan_id: plan.id,
      price_eur: priceNetEur,
      currency: "EUR",
      status: "created",
      ext_order_id: extOrderId,
    })
    .select()
    .single();
  if (orderErr) {
    return json(500, { error: errLoc(locale, "payu_order_register_failed", { detail: orderErr.message }) });
  }

  // ── PayU API ────────────────────────────────────────────────────────
  const baseUrl = payuBaseUrl(env.payuEnv);
  const notifyUrl = `${env.b2bAppUrl}/.netlify/functions/payu-notify`;
  const continueUrl = `${env.b2bAppUrl}/zakup-ok?ext=${extOrderId}`;

  // [P2-backend-mails C3] PayU description i nazwa produktu — locale-aware.
  // PL: "Pakiet Standard 10 wysyłek (Fresh Market)"
  // EN: "Standard 10 submissions package (Fresh Market)"
  const payuDescription = locale === "en"
    ? `${plan.tier} ${plan.qty} submissions package (Fresh Market)`
    : `Pakiet ${plan.tier} ${plan.qty} wysyłek (Fresh Market)`;
  const payuProductName = locale === "en"
    ? `${plan.tier} ${plan.qty} submissions`
    : `${plan.tier} ${plan.qty} wysyłek`;
  const fallbackFirstName = locale === "en" ? "Customer" : "Klient";

  let payuResult;
  try {
    const accessToken = await fetchPayuToken({
      baseUrl,
      clientId: env.payuClientId,
      clientSecret: env.payuClientSecret,
    });

    payuResult = await createPayuOrder({
      baseUrl,
      accessToken,
      posId: env.payuPosId,
      customerIp: event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "127.0.0.1",
      description: payuDescription,
      currencyCode: payuCurrencyCode,
      totalAmount: totalAmountMinor,
      extOrderId,
      buyer: {
        email: profile.email,
        firstName: (profile.name || "").split(" ")[0] || fallbackFirstName,
        lastName: (profile.name || "").split(" ").slice(1).join(" ") || "FM",
        // [P2-backend-mails C3] PayU `language` controls checkout UI lang.
        // pl|en supported; fallback pl.
        language: locale === "en" ? "en" : "pl",
      },
      products: [{
        name: payuProductName,
        unitPrice: totalAmountMinor,
        quantity: "1",
      }],
      notifyUrl,
      continueUrl,
      metadata: {
        accountingCurrency: "EUR",
        netEur: priceNetEur,
        vatRate,
        grossEur,
        payuCurrencyCode,
        eurToPayuRate,
        payuGrossAmount,
        totalAmountMinor,
      },
    });
  } catch (e) {
    const statusCode = parsePayuStatusCode(e);
    const debugContext = payuDebugContext(env, payuCurrencyCode);
    const userMessage = statusCode === "ERROR_INCONSISTENT_CURRENCIES"
      ? errLoc(locale, "payu_currency_mismatch", { currency: payuCurrencyCode, context: debugContext })
      : errLoc(locale, "payu_api_error", { detail: e?.message || "unknown" });
    console.error("[create-payu-order] PayU error", {
      statusCode,
      message: e?.message || String(e),
      payu: debugContext,
      extOrderId,
      planId: plan.id,
      amount: { netEur: priceNetEur, grossEur, payuCurrencyCode, totalAmountMinor },
    });
    // Oznacz order jako failed
    await supaSvc.from("payu_orders").update({
      status: "failed",
      failure_reason: `${e?.message || String(e)} | ${debugContext}`,
    }).eq("id", orderRow.id);
    return json(502, { error: userMessage });
  }

  // Update z payu_order_id + raw_create
  await supaSvc.from("payu_orders").update({
    payu_order_id: payuResult.orderId,
    status: "pending",
    raw_create: payuResult.raw,
  }).eq("id", orderRow.id);

  return json(200, {
    redirectUri: payuResult.redirectUri,
    ext_order_id: extOrderId,
    payu_order_id: payuResult.orderId,
  });
};

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function payuDebugContext(env, currencyCode) {
  return [
    `env=${String(env.payuEnv || "sandbox")}`,
    `currency=${currencyCode}`,
    `pos=${maskValue(env.payuPosId)}`,
    `client=${maskValue(env.payuClientId)}`,
  ].join(", ");
}

function maskValue(value) {
  const str = String(value || "");
  if (!str) return "(brak)";
  if (str.length <= 4) return "***";
  return `***${str.slice(-4)}`;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
