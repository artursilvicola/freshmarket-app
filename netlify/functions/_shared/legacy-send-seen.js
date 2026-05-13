import { notifySupplierOffersRead } from "./supplier-read-notify.js";

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function findCompanyBySupplierKey(supaSvc, supplierKey) {
  if (!supplierKey) return null;
  const { data: byLegacy, error: legacyErr } = await supaSvc
    .from("companies")
    .select("id, name, legacy_supplier_id, pkg_plan")
    .eq("legacy_supplier_id", supplierKey)
    .maybeSingle();
  if (legacyErr) throw legacyErr;
  if (byLegacy) return byLegacy;
  if (!isUuidLike(supplierKey)) return null;
  const { data: byId, error: idErr } = await supaSvc
    .from("companies")
    .select("id, name, legacy_supplier_id, pkg_plan")
    .eq("id", supplierKey)
    .maybeSingle();
  if (idErr) throw idErr;
  return byId || null;
}

function getChargeMarker(row) {
  const data = row?.data || {};
  return row?.charged_at || data.chargeAt || data.chargedAt || data.chargeTxId || data.billingStatus === "charged";
}

function getNextStatus(currentStatus, channel) {
  if (channel === "email") return currentStatus === "sent" ? "opened" : currentStatus;
  if (["sent", "opened"].includes(currentStatus)) return "read";
  return currentStatus;
}

function getReadType(channel) {
  if (channel === "app_list") return "auto_buyer_preconnect_list";
  if (channel === "app_detail") return "auto_buyer_open";
  return null;
}

async function chargeFirstSeen({ supaSvc, row, company, nowIso }) {
  const data = row?.data || {};
  if (getChargeMarker(row)) {
    return {
      charged: false,
      alreadyCharged: true,
      chargeAt: data.chargeAt || data.chargedAt || row.charged_at || null,
      packageId: data.packageId || row.package_id || null,
      chargeTxId: data.chargeTxId || row.charge_tx_id || null,
      chargeAmount: Number(data.chargeAmount || 0),
      billingStatus: "charged",
    };
  }
  if (!company?.id) {
    return { charged: false, billingStatus: "company_not_found" };
  }

  const today = nowIso.slice(0, 10);
  const { data: packages, error: pkgErr } = await supaSvc
    .from("packages")
    .select("id, plan, qty_total, qty_used, price_paid, currency, purchased_at, expires_at")
    .eq("company_id", company.id)
    .or(`expires_at.is.null,expires_at.gte.${today}`)
    .order("purchased_at", { ascending: true });
  if (pkgErr) throw pkgErr;

  const pkg = (packages || []).find((p) => Number(p.qty_used || 0) < Number(p.qty_total || 0));
  if (!pkg) {
    return { charged: false, billingStatus: "no_package_available" };
  }

  const nextUsed = Number(pkg.qty_used || 0) + 1;
  const { error: upPkgErr } = await supaSvc
    .from("packages")
    .update({ qty_used: nextUsed })
    .eq("id", pkg.id)
    .eq("qty_used", pkg.qty_used || 0);
  if (upPkgErr) throw upPkgErr;

  const fallbackAmount = Number(pkg.price_paid || 0) && Number(pkg.qty_total || 0)
    ? Number(pkg.price_paid) / Number(pkg.qty_total)
    : 0;
  const chargeAmount = Number(data.price || data.chargeAmount || fallbackAmount || 0);
  const currency = data.currency || pkg.currency || "EUR";

  const { data: tx, error: txErr } = await supaSvc
    .from("wallet_tx")
    .insert({
      company_id: company.id,
      type: "send_charge",
      amount: 0,
      currency,
      description: `Rozliczenie wysyłki PreConnect #${row.legacy_id}`,
      reference_id: row.id,
      meta: {
        legacy_send_id: row.legacy_id,
        supplier_legacy_id: row.supplier_legacy_id,
        package_id: pkg.id,
        package_plan: pkg.plan,
        amount_eur: chargeAmount,
        billing_model: "package_credit",
      },
    })
    .select("id")
    .single();
  if (txErr) throw txErr;

  return {
    charged: true,
    billingStatus: "charged",
    chargeAt: nowIso,
    packageId: pkg.id,
    chargeTxId: tx?.id || null,
    chargeAmount,
    currency,
  };
}

export async function markLegacySendsSeen({
  supaSvc,
  env,
  legacyIds,
  channel = "app_list",
  allowedRetailerId = null,
  notifySupplier = true,
}) {
  const ids = [...new Set((legacyIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return { ok: true, results: [] };

  const { data: rows, error: selErr } = await supaSvc
    .from("legacy_sends")
    .select("id, legacy_id, supplier_legacy_id, offer_legacy_id, retailer_id, status, data")
    .in("legacy_id", ids);
  if (selErr) throw selErr;

  const nowIso = new Date().toISOString();
  const results = [];
  const notifyLegacyIds = [];

  for (const row of rows || []) {
    try {
      if (allowedRetailerId && Number(row.retailer_id) !== Number(allowedRetailerId)) {
        results.push({ legacy_id: row.legacy_id, ok: false, status: "skipped", reason: "retailer_mismatch" });
        continue;
      }
      if (!["sent", "opened", "read", "read_manual"].includes(row.status)) {
        results.push({ legacy_id: row.legacy_id, ok: true, status: "skipped", reason: `status_${row.status}` });
        continue;
      }

      const supplierKey = row.supplier_legacy_id || row.data?.supplierId;
      const company = await findCompanyBySupplierKey(supaSvc, supplierKey);
      const billing = await chargeFirstSeen({ supaSvc, row, company, nowIso });
      const nextStatus = getNextStatus(row.status, channel);
      const readType = getReadType(channel);
      const existingData = row.data || {};
      const seenAt = existingData.seenAt || nowIso;
      const nextData = {
        ...existingData,
        status: nextStatus,
        seenAt,
        seenChannel: existingData.seenChannel || channel,
        billingStatus: billing.billingStatus,
      };

      if (channel === "email") {
        nextData.emailOpenedAt = existingData.emailOpenedAt || nowIso;
      }
      if (readType) {
        nextData.readAt = existingData.readAt || nowIso;
        nextData.readType = existingData.readType || readType;
      }
      if (billing.billingStatus === "charged") {
        nextData.chargeAt = billing.chargeAt || existingData.chargeAt || nowIso;
        nextData.packageId = billing.packageId || existingData.packageId || null;
        nextData.chargeTxId = billing.chargeTxId || existingData.chargeTxId || null;
        nextData.chargeAmount = billing.chargeAmount || existingData.chargeAmount || 0;
        nextData.chargeCurrency = billing.currency || existingData.chargeCurrency || "EUR";
      }

      const updatePayload = { status: nextStatus, data: nextData };
      if (channel === "email") updatePayload.email_opened_at = existingData.emailOpenedAt || nowIso;

      const { error: upErr } = await supaSvc
        .from("legacy_sends")
        .update(updatePayload)
        .eq("id", row.id);
      if (upErr) throw upErr;

      if (notifySupplier && !existingData.supplierNotifiedAt) {
        notifyLegacyIds.push(row.legacy_id);
      }

      results.push({
        legacy_id: row.legacy_id,
        ok: true,
        previousStatus: row.status,
        status: nextStatus,
        data: nextData,
        billing,
        notification: notifySupplier && !existingData.supplierNotifiedAt ? { status: "queued" } : null,
      });
    } catch (e) {
      results.push({ legacy_id: row.legacy_id, ok: false, status: "error", reason: e?.message || String(e) });
    }
  }

  let notificationSummary = null;
  if (notifyLegacyIds.length) {
    notificationSummary = await notifySupplierOffersRead({
      supaSvc,
      env,
      legacyIds: notifyLegacyIds,
      openedVia: channel,
    });
  }

  return { ok: true, results, notificationSummary };
}
