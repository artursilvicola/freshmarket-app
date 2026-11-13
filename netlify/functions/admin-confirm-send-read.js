/**
 * POST /.netlify/functions/admin-confirm-send-read
 *
 * Body:    { legacy_id: number, action: "confirm" | "undo", read_type?: string, note?: string }
 * Headers: Authorization: Bearer <JWT administratora>
 *
 * [fix/buyer-entry-seen] Ręczne potwierdzenie odczytu propozycji przez administratora
 * (telefon / e-mail / spotkanie) jest odczytem ROZLICZANYM — decyzja Artura 13.11.2026:
 *   confirm → status read_manual + 1 kredyt z pakietu dostawcy (jedna transakcja w bazie:
 *             confirm_legacy_send_manual) + jedno powiadomienie dostawcy;
 *   undo    → status wraca, kredyt wraca do pakietu, jeśli pobrało go ręczne potwierdzenie
 *             (undo_legacy_send_manual_confirm).
 *
 * Wcześniej przeglądarka zapisywała sam status zwykłym upsertem całego JSON-u wysyłki:
 * kredyt nie schodził, a zapis mógł nadpisać znacznik rozliczenia z równoległego odczytu.
 *
 * Wymaga migracji 20261113120000_manual_read_confirm.sql (najpierw migracja, potem kod).
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { findCompanyBySupplierKey, mapBilling } from "./_shared/legacy-send-seen.js";
import { notifySupplierOffersRead } from "./_shared/supplier-read-notify.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";
import { parseManualConfirmRequest } from "./_shared/manual-confirm-request.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missing.length) return json(500, envErrorPayload("admin-confirm-send-read", missing));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });

  const { data: profile, error: profileErr } = await supaSvc
    .from("profiles")
    .select("id, role, active, locale")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileErr) return json(500, { error: profileErr.message });
  locale = resolveLocale({ profileLocale: profile?.locale, acceptLanguage: acceptLang });
  if (!profile?.active || profile.role !== "admin") return json(403, { error: errLoc(locale, "only_admin") });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: errLoc(locale, "invalid_json") }); }
  const req = parseManualConfirmRequest(body);
  if (!req.ok) return json(400, { error: req.error === "missing_legacy_id" ? errLoc(locale, "missing_legacy_id") : req.error, code: req.error });

  const { data: row, error: rowErr } = await supaSvc
    .from("legacy_sends")
    .select("id, legacy_id, supplier_legacy_id, status, data")
    .eq("legacy_id", req.legacyId)
    .maybeSingle();
  if (rowErr) return json(500, { error: rowErr.message });
  if (!row) return json(404, { error: errLoc(locale, "send_not_found"), code: "send_not_found" });

  try {
    if (req.action === "undo") {
      const { data: r, error } = await supaSvc.rpc("undo_legacy_send_manual_confirm", { p_send_id: row.id });
      if (error) throw error;
      log({ action: "undo", admin: profile.id, legacy_id: row.legacy_id, skipped: !!r?.skipped, reason: r?.reason || null, refunded: !!r?.refunded, kept: r?.kept_reason || null });
      return json(200, {
        ok: true,
        action: "undo",
        legacy_id: Number(row.legacy_id),
        skipped: !!r?.skipped,
        reason: r?.reason || null,
        status: r?.status || row.status,
        data: r?.data || row.data || {},
        refunded: !!r?.refunded,
        // "buyer_read": kupiec sam odczytał propozycję — kredyt zostaje, status z faktycznego odczytu
        kept_reason: r?.kept_reason || null,
      });
    }

    const supplierKey = row.supplier_legacy_id || row.data?.supplierId;
    const company = await findCompanyBySupplierKey(supaSvc, supplierKey);
    const { data: r, error } = await supaSvc.rpc("confirm_legacy_send_manual", {
      p_send_id: row.id,
      p_company_id: company?.id || null,
      p_read_type: req.readType,
      p_note: req.note,
    });
    if (error) throw error;

    const skipped = !!r?.skipped;
    const billing = skipped ? null : mapBilling(r?.billing);
    // jedno powiadomienie dostawcy na odczyt — ten sam mechanizm rezerwacji co przy odczycie kupca
    let notification = null;
    if (!skipped && !r?.supplier_notified_before) {
      try {
        const n = await notifySupplierOffersRead({ supaSvc, env, legacyIds: [Number(row.legacy_id)], openedVia: "manual" });
        notification = { status: n?.status || (n?.ok ? "ok" : "error") };
      } catch (e) {
        notification = { status: "error", reason: e?.message || String(e) };
      }
    }
    log({ action: "confirm", admin: profile.id, legacy_id: row.legacy_id, read_type: req.readType, skipped, reason: r?.reason || null, charged: !!billing?.charged, billing: billing?.billingStatus || null, notification: notification?.status || null });
    return json(200, {
      ok: true,
      action: "confirm",
      legacy_id: Number(row.legacy_id),
      skipped,
      reason: r?.reason || null,
      status: r?.status || row.status,
      data: r?.data || row.data || {},
      billing,
      notification,
    });
  } catch (e) {
    // najczęstsza przyczyna: brak migracji 20261113120000 (funkcji nie ma w bazie) — nic nie zapisano
    console.warn("[admin-confirm-send-read]", e?.code || "", e?.message || e);
    return json(500, { error: e?.message || String(e), code: e?.code || null });
  }
};

function log(payload) {
  try { console.log("[admin-confirm-send-read]", JSON.stringify(payload)); } catch (e) {}
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: statusCode === 204 ? "" : JSON.stringify(payload),
  };
}
