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
import { payuBaseUrl, fetchPayuToken, createPayuOrder } from "./_shared/payu.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, [
    "supabaseUrl",
    "supabaseServiceRoleKey",
    "payuPosId",
    "payuClientId",
    "payuClientSecret",
  ]);
  if (missing.length) return json(500, envErrorPayload("create-payu-order", missing));

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: "Brak tokenu autoryzacji" });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: "Nieprawidłowy token" });
  }
  const userId = userData.user.id;

  // ── Body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Niepoprawny JSON" }); }
  const planId = String(body.plan_id || "").trim();
  if (!planId) return json(400, { error: "Brak plan_id" });

  // ── Profile + plan ──────────────────────────────────────────────────
  const { data: profile, error: profErr } = await supaSvc
    .from("profiles")
    .select("id, email, name, role, company_id, company:companies!company_id(id, name)")
    .eq("id", userId)
    .maybeSingle();
  if (profErr || !profile) return json(403, { error: "Profil nie znaleziony" });
  if (profile.role !== "supplier" && profile.role !== "admin") {
    return json(403, { error: "Tylko dostawca może kupować pakiety" });
  }
  const companyId = profile.company_id;
  if (!companyId) {
    return json(400, { error: "Konto nie jest przypisane do firmy. Skontaktuj się z administratorem." });
  }

  const { data: plan, error: planErr } = await supaSvc
    .from("package_plans")
    .select("*")
    .eq("id", planId)
    .eq("active", true)
    .maybeSingle();
  if (planErr || !plan) return json(400, { error: `Plan ${planId} nie istnieje lub jest nieaktywny` });

  // ── Insert payu_orders (status=created) ─────────────────────────────
  const extOrderId = randomUUID();
  const priceEur = Number(plan.price_eur);
  const totalAmountCents = Math.round(priceEur * 100).toString();

  const { data: orderRow, error: orderErr } = await supaSvc
    .from("payu_orders")
    .insert({
      company_id: companyId,
      plan_id: plan.id,
      price_eur: priceEur,
      currency: "EUR",
      status: "created",
      ext_order_id: extOrderId,
    })
    .select()
    .single();
  if (orderErr) {
    return json(500, { error: "Nie udało się zarejestrować zamówienia: " + orderErr.message });
  }

  // ── PayU API ────────────────────────────────────────────────────────
  const baseUrl = payuBaseUrl(env.payuEnv);
  const notifyUrl = `${env.b2bAppUrl}/.netlify/functions/payu-notify`;
  const continueUrl = `${env.b2bAppUrl}/zakup-ok?ext=${extOrderId}`;

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
      description: `Pakiet ${plan.tier} ${plan.qty} wysyłek (Fresh Market)`,
      currencyCode: "EUR",
      totalAmount: totalAmountCents,
      extOrderId,
      buyer: {
        email: profile.email,
        firstName: (profile.name || "").split(" ")[0] || "Klient",
        lastName: (profile.name || "").split(" ").slice(1).join(" ") || "FM",
        language: "pl",
      },
      products: [{
        name: `${plan.tier} ${plan.qty} wysyłek`,
        unitPrice: totalAmountCents,
        quantity: "1",
      }],
      notifyUrl,
      continueUrl,
    });
  } catch (e) {
    // Oznacz order jako failed
    await supaSvc.from("payu_orders").update({
      status: "failed",
      failure_reason: e?.message || String(e),
    }).eq("id", orderRow.id);
    return json(502, { error: "PayU API: " + (e?.message || "unknown") });
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

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
