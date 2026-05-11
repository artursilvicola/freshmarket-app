/**
 * Netlify Function: payu-notify
 * POST /.netlify/functions/payu-notify
 *
 * Webhook od PayU — wywoływany asynchronicznie po zmianie statusu płatności.
 * [B2B Round prod-rollout / faza 3]
 *
 * Headers: OpenPayU-Signature: sender=...;signature=<hex>;algorithm=SHA-256;content=DOCUMENT
 * Body: {
 *   order: {
 *     orderId, extOrderId, status, totalAmount, currencyCode,
 *     products: [...], payMethod, ...
 *   },
 *   localReceiptDateTime, properties
 * }
 *
 * Flow:
 *   1. Weryfikujemy signature (SHA-256(rawBody + SECOND_KEY) == signature).
 *      Jeśli sig zły → 200 OK z {ignored: 'bad_signature'} — NIE 401, bo PayU
 *      by retryował i logi by zapchały.
 *   2. Znajdujemy payu_orders po payu_order_id (z notify.order.orderId)
 *      lub po ext_order_id.
 *   3. Idempotency: jak status już 'completed' → 200 OK, no-op.
 *   4. COMPLETED → wołamy purchase_package RPC z payment_ref=payu_order_id,
 *      INSERT packages + INSERT wallet_tx atomowo. Zapisujemy package_id i
 *      status='completed' w payu_orders.
 *   5. CANCELED/REJECTED/FAILED → tylko zmiana statusu w payu_orders.
 *
 * PayU oczekuje statusu 2xx, inaczej retryuje (~5 razy w rosnących odstępach).
 * Zwracamy 200 z opisem co zrobiliśmy, żeby było widać w logach.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { verifyPayuSignature } from "./_shared/payu.js";

export const handler = async (event) => {
  // PayU używa wyłącznie POST. Inne metody odbijamy.
  if (event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "payuSecondKey"]);
  if (missing.length) {
    // Mimo braków — zwracamy 200, żeby PayU nie retryował (te brak konfiguracji
    // to nasz problem, nie ich). Loguje się w Netlify.
    console.error("[payu-notify] brak konfiguracji:", missing);
    return reply(200, { ignored: "missing_env", missing });
  }

  // ── 1. Verify signature ─────────────────────────────────────────────
  const rawBody = event.body || "";
  const sigHeader = event.headers["openpayu-signature"]
    || event.headers["OpenPayU-Signature"]
    || event.headers["Openpayu-Signature"]
    || "";

  if (!verifyPayuSignature({ rawBody, signatureHeader: sigHeader, secondKey: env.payuSecondKey })) {
    console.warn("[payu-notify] zła sygnatura, ignorujemy");
    return reply(200, { ignored: "bad_signature" });
  }

  // ── 2. Parse body ───────────────────────────────────────────────────
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return reply(200, { ignored: "invalid_json" }); }

  const order = payload?.order;
  if (!order) return reply(200, { ignored: "no_order" });

  const payuOrderId = order.orderId;
  const extOrderId = order.extOrderId;
  const newStatus = String(order.status || "").toUpperCase();

  // ── 3. Lookup payu_orders ───────────────────────────────────────────
  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

  // Prefer payu_order_id (PayU canonical), fallback do ext_order_id (nasz).
  let { data: row } = await supaSvc
    .from("payu_orders")
    .select("*")
    .eq("payu_order_id", payuOrderId)
    .maybeSingle();
  if (!row && extOrderId) {
    const { data: row2 } = await supaSvc
      .from("payu_orders")
      .select("*")
      .eq("ext_order_id", extOrderId)
      .maybeSingle();
    row = row2;
  }
  if (!row) {
    console.warn("[payu-notify] zamówienie nie znalezione", { payuOrderId, extOrderId });
    return reply(200, { ignored: "unknown_order", payuOrderId, extOrderId });
  }

  // Idempotency
  if (row.status === "completed") {
    return reply(200, { ok: true, idempotent: true });
  }

  // ── 4. Branching po statusie ────────────────────────────────────────
  if (newStatus === "COMPLETED") {
    // Wywołaj purchase_package RPC z payment_ref = payu_order_id.
    // RPC jest idempotentne po payment_ref (drugi notify nie utworzy
    // drugiej packages dla tego samego orderId).
    const { data: pkgId, error: rpcErr } = await supaSvc.rpc("purchase_package", {
      p_company_id: row.company_id,
      p_plan_id: row.plan_id,
      p_price_paid: row.price_eur,
      p_currency: row.currency,
      p_payment_ref: payuOrderId || `payu-${row.id}`,
    });

    if (rpcErr) {
      console.error("[payu-notify] purchase_package RPC error", rpcErr);
      await supaSvc.from("payu_orders").update({
        status: "failed",
        failure_reason: `RPC: ${rpcErr.message}`,
        raw_notify: payload,
      }).eq("id", row.id);
      // Mimo błędu zwracamy 200 — pieniądze są u PayU, naprawimy ręcznie.
      // PayU retry by tu nic nie zmienił.
      return reply(200, { error: "rpc_failed", message: rpcErr.message });
    }

    await supaSvc.from("payu_orders").update({
      status: "completed",
      package_id: pkgId,
      payment_method: order.payMethod?.type || order.payMethod || null,
      raw_notify: payload,
      completed_at: new Date().toISOString(),
    }).eq("id", row.id);

    return reply(200, { ok: true, package_id: pkgId });
  }

  if (newStatus === "CANCELED" || newStatus === "CANCELLED") {
    await supaSvc.from("payu_orders").update({
      status: "canceled",
      raw_notify: payload,
    }).eq("id", row.id);
    return reply(200, { ok: true, status: "canceled" });
  }

  if (newStatus === "REJECTED") {
    await supaSvc.from("payu_orders").update({
      status: "rejected",
      raw_notify: payload,
    }).eq("id", row.id);
    return reply(200, { ok: true, status: "rejected" });
  }

  // PENDING, WAITING_FOR_CONFIRMATION, NEW — tylko zapis raw_notify, status pending
  await supaSvc.from("payu_orders").update({
    status: "pending",
    raw_notify: payload,
  }).eq("id", row.id);
  return reply(200, { ok: true, status: newStatus });
};

function reply(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
