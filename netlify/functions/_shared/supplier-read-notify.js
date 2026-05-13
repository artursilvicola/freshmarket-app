/**
 * Supplier notification when buyer sees PreConnect offers.
 *
 * One email is sent per supplier + retailer + seen event, even when a buyer
 * sees several offers in the same batch. Every legacy_send still gets its own
 * supplierNotifiedAt marker, so retries stay idempotent.
 */

import { pickTemplate } from "./supplier-email-templates.js";

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function findCompanyBySupplierKey(supaSvc, supplierKey) {
  if (!supplierKey) return null;
  const { data: byLegacy, error: legacyErr } = await supaSvc
    .from("companies")
    .select("id, name, legacy_supplier_id")
    .eq("legacy_supplier_id", supplierKey)
    .maybeSingle();
  if (legacyErr) throw legacyErr;
  if (byLegacy) return byLegacy;
  if (!isUuidLike(supplierKey)) return null;
  const { data: byId, error: idErr } = await supaSvc
    .from("companies")
    .select("id, name, legacy_supplier_id")
    .eq("id", supplierKey)
    .maybeSingle();
  if (idErr) throw idErr;
  return byId || null;
}

async function sendResendEmail({ env, to, subject, html }) {
  if (!env.resendApiKey) return { ok: false, reason: "no_resend_key" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Fresh Market <newsletter@freshmarket.eu>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, reason: `resend_${res.status}: ${detail}` };
  }
  const r = await res.json().catch(() => ({}));
  return { ok: true, message_id: r.id || null };
}

function pickOfferTitle(offer, fallbackId) {
  return offer?.title || offer?.product || `Oferta #${fallbackId || ""}`.trim();
}

export async function notifySupplierOffersRead({ supaSvc, env, legacyIds, openedVia }) {
  const ids = [...new Set((legacyIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return { ok: true, status: "skipped", reason: "missing_legacy_ids", notifications: [] };

  const { data: rows, error: rowErr } = await supaSvc
    .from("legacy_sends")
    .select("legacy_id, status, data, retailer_id, offer_legacy_id, supplier_legacy_id")
    .in("legacy_id", ids);
  if (rowErr) return { ok: false, status: "error", reason: rowErr.message, notifications: [] };

  const pendingRows = (rows || []).filter((row) => !(row.data || {}).supplierNotifiedAt);
  if (!pendingRows.length) {
    return { ok: true, status: "skipped", reason: "already_notified", notifications: [] };
  }

  const offerIds = [...new Set(pendingRows.map((row) => row.offer_legacy_id || row.data?.offerId).filter(Boolean))];
  const offerMap = new Map();
  if (offerIds.length) {
    const { data: offerRows } = await supaSvc
      .from("legacy_offers")
      .select("legacy_id, data")
      .in("legacy_id", offerIds);
    for (const offerRow of offerRows || []) {
      offerMap.set(String(offerRow.legacy_id), offerRow.data || {});
    }
  }

  const retailerIds = [...new Set(pendingRows.map((row) => row.retailer_id).filter(Boolean))];
  const retailerMap = new Map();
  if (retailerIds.length) {
    const { data: retailerRows } = await supaSvc
      .from("retailers")
      .select("id, name")
      .in("id", retailerIds);
    for (const retailer of retailerRows || []) {
      retailerMap.set(Number(retailer.id), retailer);
    }
  }

  const companyCache = new Map();
  const groups = new Map();
  const errors = [];

  for (const row of pendingRows) {
    try {
      const supplierKey = row.supplier_legacy_id || row.data?.supplierId;
      if (!companyCache.has(supplierKey)) {
        companyCache.set(supplierKey, await findCompanyBySupplierKey(supaSvc, supplierKey));
      }
      const company = companyCache.get(supplierKey);
      if (!company?.id) {
        errors.push({ legacy_id: row.legacy_id, ok: false, status: "error", reason: "company_not_found" });
        continue;
      }

      const groupKey = `${company.id}|${row.retailer_id || "none"}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          company,
          retailer: retailerMap.get(Number(row.retailer_id)) || null,
          rows: [],
          offers: [],
        });
      }

      const offerId = row.offer_legacy_id || row.data?.offerId;
      const offer = offerMap.get(String(offerId)) || {};
      const title = pickOfferTitle(offer, offerId || row.legacy_id);
      const group = groups.get(groupKey);
      group.rows.push(row);
      group.offers.push({ title });
    } catch (e) {
      errors.push({ legacy_id: row.legacy_id, ok: false, status: "error", reason: e?.message || String(e) });
    }
  }

  const notifications = [...errors];
  for (const group of groups.values()) {
    const { data: owner } = await supaSvc
      .from("profiles")
      .select("name, email, active")
      .eq("company_id", group.company.id)
      .eq("role", "supplier")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!owner?.email) {
      notifications.push({
        ok: false,
        status: "error",
        reason: "owner_not_found",
        legacy_ids: group.rows.map((row) => row.legacy_id),
      });
      continue;
    }

    const openedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
    const tpl = pickTemplate("offers_read_by_buyer", {
      companyName: group.company.name || "",
      contactName: owner.name || null,
      offers: group.offers,
      offerCount: group.offers.length,
      retailerName: group.retailer?.name || "",
      openedVia,
      openedAt,
      appUrl: env.b2bAppUrl,
    });
    if (!tpl) {
      notifications.push({ ok: false, status: "error", reason: "no_template" });
      continue;
    }

    const sent = await sendResendEmail({ env, to: owner.email, subject: tpl.subject, html: tpl.html });
    if (!sent.ok) {
      notifications.push({
        ok: false,
        status: "error",
        reason: sent.reason,
        to: owner.email,
        legacy_ids: group.rows.map((row) => row.legacy_id),
      });
      continue;
    }

    const notifiedAt = new Date().toISOString();
    for (const row of group.rows) {
      const nextData = {
        ...(row.data || {}),
        supplierNotifiedAt: notifiedAt,
        supplierNotifiedVia: openedVia,
        supplierNotifiedBatchSize: group.rows.length,
      };
      await supaSvc
        .from("legacy_sends")
        .update({ data: nextData })
        .eq("legacy_id", row.legacy_id);
    }

    notifications.push({
      ok: true,
      status: "sent",
      message_id: sent.message_id,
      to: owner.email,
      offer_count: group.offers.length,
      legacy_ids: group.rows.map((row) => row.legacy_id),
    });
  }

  const sentCount = notifications.filter((n) => n.status === "sent").length;
  return {
    ok: notifications.every((n) => n.ok),
    status: sentCount ? "sent" : "error",
    notifications,
  };
}

export async function notifySupplierOfferRead({ supaSvc, env, legacyId, openedVia }) {
  const result = await notifySupplierOffersRead({
    supaSvc,
    env,
    legacyIds: [legacyId],
    openedVia,
  });
  const first = result.notifications?.[0];
  if (first) return first;
  return { ok: result.ok, status: result.status, reason: result.reason };
}
