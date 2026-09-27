import { notifySupplierOffersRead } from "./supplier-read-notify.js";

// [feat/free-credit-grants v3] Ten moduł NIE zapisuje już wiersza `legacy_sends` sam.
// Cała aktualizacja „odczytano” (status, seenAt, readAt/readType, emailOpenedAt)
// i rozliczenie kredytu dzieją się w jednej transakcji w bazie:
//   mark_legacy_send_seen → charge_legacy_send_first_seen (obie: service_role).
// Powód (review Codexa v2, P1): wcześniejszy bezwarunkowy UPDATE całego JSON-u ze
// starego odczytu mógł, gdy się spóźnił, skasować znacznik rozliczenia zapisany przez
// równoległe wywołanie i pozwolić pobrać kredyt drugi raz za tę samą propozycję.
// Brak fallbacku na starą ścieżkę: kolejność wdrożenia = migracja → deploy; jeśli RPC
// nie istnieje, wiersz dostaje wynik "error" (nic nie jest rozliczane na ślepo).

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

// Wynik rozliczenia z RPC (snake_case) → kształt, który dotąd zwracała ta funkcja.
export function mapBilling(b) {
  const r = b || {};
  const status = r.billing_status || (r.charged ? "charged" : "no_package_available");
  const out = { charged: !!r.charged, billingStatus: status };
  if (r.already_charged) out.alreadyCharged = true;
  if (status === "charged") {
    out.chargeAt = r.charge_at || null;
    out.packageId = r.package_id || null;
    out.packageSource = r.package_source || null;
    out.chargeTxId = r.charge_tx_id || null;
    out.chargeAmount = Number(r.charge_amount || 0);
    out.currency = r.currency || "EUR";
  }
  return out;
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

      const { data: rpcData, error: rpcErr } = await supaSvc.rpc("mark_legacy_send_seen", {
        p_send_id: row.id,
        p_company_id: company?.id || null,
        p_channel: channel,
        p_now: nowIso,
      });
      if (rpcErr) throw rpcErr;
      const r = rpcData || {};
      if (r.skipped) {
        results.push({ legacy_id: row.legacy_id, ok: true, status: "skipped", reason: r.reason || `status_${r.status}` });
        continue;
      }
      const billing = mapBilling(r.billing);
      const notifiedBefore = !!r.supplier_notified_before;

      if (notifySupplier && !notifiedBefore) {
        notifyLegacyIds.push(row.legacy_id);
      }

      results.push({
        legacy_id: row.legacy_id,
        ok: true,
        previousStatus: r.previous_status ?? row.status,
        status: r.status,
        data: r.data || row.data || {},
        billing,
        notification: notifySupplier && !notifiedBefore ? { status: "queued" } : null,
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
