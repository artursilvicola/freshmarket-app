/**
 * Helper: wyślij dostawcy mail "Twoja oferta została zobaczona przez kupca".
 * [B2B Round prod-rollout / email-open-tracking]
 *
 * Wywoływany z dwóch miejsc:
 *   1. resend-webhook.js gdy Resend zgłasza email.opened (kupiec otworzył mail)
 *   2. notify-supplier-read.js wywoływane z frontendu po markSendOpened
 *      (kupiec kliknął w aplikacji)
 *
 * Idempotency: data.supplierNotifiedAt w legacy_sends.data JSONB. Jeśli już
 * ustawione — no-op. Bez nowej migracji (kolumna JSONB już jest).
 *
 * Failure mode: błędy maila NIE wstrzymują flow ani wywołującego endpointu.
 * Logujemy do console, zwracamy ok/skipped/error w stringu.
 *
 * Zwraca: { ok, status: 'sent'|'skipped'|'error', reason?, message_id? }
 */

import { pickTemplate } from "./supplier-email-templates.js";

export async function notifySupplierOfferRead({ supaSvc, env, legacyId, openedVia }) {
  if (!legacyId) return { ok: false, status: "error", reason: "missing_legacy_id" };

  // 1. Load send + powiązane dane
  const { data: row, error: rowErr } = await supaSvc
    .from("legacy_sends")
    .select("legacy_id, status, data, retailer_id, offer_legacy_id, supplier_legacy_id")
    .eq("legacy_id", legacyId)
    .maybeSingle();

  if (rowErr) return { ok: false, status: "error", reason: rowErr.message };
  if (!row) return { ok: false, status: "error", reason: "send_not_found" };

  const data = row.data || {};

  // 2. Idempotency: już wysłano? (po dowolnym z dwóch kanałów)
  if (data.supplierNotifiedAt) {
    return { ok: true, status: "skipped", reason: "already_notified" };
  }

  // 3. Load offer (po offer_legacy_id z JSONB lub kolumny)
  const offerId = row.offer_legacy_id || data.offerId;
  const { data: offerRow } = await supaSvc
    .from("legacy_offers")
    .select("data")
    .eq("legacy_id", offerId)
    .maybeSingle();
  const offer = offerRow?.data || {};
  const offerTitle = offer.title || offer.product || `Oferta #${offerId || legacyId}`;

  // 4. Find supplier company
  const supplierKey = row.supplier_legacy_id || data.supplierId;
  const { data: company } = await supaSvc
    .from("companies")
    .select("id, name, legacy_supplier_id")
    .or(`legacy_supplier_id.eq.${supplierKey},id.eq.${supplierKey}`)
    .maybeSingle();
  if (!company?.id) return { ok: false, status: "error", reason: "company_not_found" };

  // 5. Find supplier owner email (rola supplier w profiles tej firmy)
  const { data: owner } = await supaSvc
    .from("profiles")
    .select("name, email, active")
    .eq("company_id", company.id)
    .eq("role", "supplier")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!owner?.email) return { ok: false, status: "error", reason: "owner_not_found" };

  // 6. Find retailer name
  const { data: retailer } = await supaSvc
    .from("retailers")
    .select("name")
    .eq("id", row.retailer_id)
    .maybeSingle();

  // 7. Render + send mail
  const tpl = pickTemplate("offer_read_by_buyer", {
    companyName: company.name || "",
    contactName: owner.name || null,
    offerTitle,
    retailerName: retailer?.name || "",
    openedVia,
    openedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    appUrl: env.b2bAppUrl,
  });
  if (!tpl) return { ok: false, status: "error", reason: "no_template" };

  if (!env.resendApiKey) {
    console.warn("[supplier-read-notify] brak RESEND_API_KEY — pomijam wysyłkę");
    return { ok: false, status: "error", reason: "no_resend_key" };
  }

  let messageId = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Fresh Market <newsletter@freshmarket.eu>",
        to: [owner.email],
        subject: tpl.subject,
        html: tpl.html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, status: "error", reason: `resend_${res.status}: ${detail}` };
    }
    const r = await res.json().catch(() => ({}));
    messageId = r.id || null;
  } catch (e) {
    return { ok: false, status: "error", reason: e?.message || String(e) };
  }

  // 8. Mark as notified — JSONB data.supplierNotifiedAt + via
  const newData = {
    ...data,
    supplierNotifiedAt: new Date().toISOString(),
    supplierNotifiedVia: openedVia,
  };
  await supaSvc
    .from("legacy_sends")
    .update({ data: newData })
    .eq("legacy_id", legacyId);

  return { ok: true, status: "sent", message_id: messageId, to: owner.email };
}
