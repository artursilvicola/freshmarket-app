/**
 * Supplier notification when buyer sees PreConnect offers.
 *
 * One email is sent per supplier + retailer + seen event, even when a buyer
 * sees several offers in the same batch.
 *
 * Dwie niezależne ścieżki wyzwalają odczyt (webhook Resend `email.opened`
 * i panel kupca), więc powiadomienie idzie przez rezerwację:
 *
 *   claim   → zajmuje wiersze i zwraca ICH id; mail powstaje tylko z nich
 *   confirm → po udanej wysyłce stawia supplierNotifiedAt i zdejmuje rezerwację
 *   release → po odmowie poczty zdejmuje rezerwację, żeby ponowienie było możliwe
 *
 * Migracja 20261013090000_supplier_notify_claim.sql.
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

// `delivered` rozstrzyga, czy wolno zwolnić rezerwację i ponowić:
//   "no"      — wiemy, że poczta wiadomości NIE przyjęła (brak klucza, odpowiedź
//               z błędem). Zwalniamy rezerwację, ponowienie jest bezpieczne.
//   "unknown" — żądanie nie dotarło do odpowiedzi (sieć, timeout). Mail MÓGŁ pójść,
//               więc rezerwacji NIE zwalniamy od ręki — czekamy na wygaśnięcie
//               dzierżawy, żeby nie wysłać drugiego maila o tym samym odczycie.
async function sendResendEmail({ env, to, subject, html }) {
  if (!env.resendApiKey) return { ok: false, reason: "no_resend_key", delivered: "no" };
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
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
  } catch (e) {
    return { ok: false, reason: `resend_unreachable: ${e?.message || e}`, delivered: "unknown" };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, reason: `resend_${res.status}: ${detail}`, delivered: "no" };
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
        });
      }

      const offerId = row.offer_legacy_id || row.data?.offerId;
      const offer = offerMap.get(String(offerId)) || {};
      const title = pickOfferTitle(offer, offerId || row.legacy_id);
      const group = groups.get(groupKey);
      // Tytuł trzymamy PRZY wierszu, nie w osobnej liście grupy. Mail powstaje
      // dopiero z wierszy, które rezerwacja faktycznie zajęła — równoległa ścieżka
      // mogła część z nich zabrać wcześniej i to ona o nich pisze.
      group.rows.push({ legacy_id: Number(row.legacy_id), offerTitle: title });
    } catch (e) {
      errors.push({ legacy_id: row.legacy_id, ok: false, status: "error", reason: e?.message || String(e) });
    }
  }

  const notifications = [...errors];
  for (const group of groups.values()) {
    // [P2-backend-mails C2] Pull supplier `locale` so notification mail
    // renders in supplier language (offers_read_by_buyer dispatches PL/EN).
    const { data: owner } = await supaSvc
      .from("profiles")
      .select("name, email, active, locale")
      .eq("company_id", group.company.id)
      .eq("role", "supplier")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!owner?.email) {
      try { console.log("[notifySupplierOffersRead OWNER_NOT_FOUND]", JSON.stringify({ company_id: group.company.id, company_name: group.company.name })); } catch (e) {}
      notifications.push({
        ok: false,
        status: "error",
        reason: "owner_not_found",
        legacy_ids: group.rows.map((row) => row.legacy_id),
      });
      continue;
    }

    const groupIds = group.rows.map((row) => row.legacy_id);

    // [fix/supplier-read-notify-once v2] REZERWUJ → WYŚLIJ → POTWIERDŹ.
    //
    // Odczyt wyzwalają dwie niezależne ścieżki — webhook Resend (email.opened)
    // i panel kupca — i potrafią trafić w tę samą chwilę. Rezerwacja rozstrzyga,
    // która z nich pisze o których propozycjach.
    //
    // RPC zwraca ID wierszy, które FAKTYCZNIE zajął, i mail powstaje wyłącznie
    // z nich. Sama liczba zajętych nie wystarczy: gdy jedna ścieżka obsługuje
    // propozycję A, a druga paczkę A+B, druga zajmie samo B — ale wysyłając mail
    // o całej swojej grupie napisałaby też o A, o którym pisze już pierwsza.
    const claimToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const { data: claimData, error: claimErr } = await supaSvc.rpc("claim_legacy_sends_supplier_notify", {
      p_legacy_ids: groupIds,
      p_claim_token: claimToken,
    });
    if (claimErr) {
      // Nie wiemy, czy rezerwacja usiadła — wysyłka mogłaby się zdublować. Nie wysyłamy.
      notifications.push({
        ok: false,
        status: "error",
        reason: "claim_failed",
        to: owner.email,
        legacy_ids: groupIds,
        claim_error: claimErr.message,
      });
      continue;
    }

    // RPC zwraca `setof bigint`; PostgREST podaje to jako listę liczb, a przy
    // niektórych klientach jako listę obiektów — obsługujemy obie postaci.
    const claimedIds = new Set(
      (Array.isArray(claimData) ? claimData : claimData == null ? [] : [claimData])
        .map((item) => Number(item && typeof item === "object" ? item.legacy_id ?? item.claim_legacy_sends_supplier_notify : item))
        .filter((id) => Number.isFinite(id)),
    );
    const claimedRows = group.rows.filter((row) => claimedIds.has(row.legacy_id));
    if (!claimedRows.length) {
      // Druga ścieżka zajęła te wiersze wcześniej i to ona wysyła. Nie jest to błąd.
      notifications.push({
        ok: true,
        status: "already_notified",
        to: owner.email,
        legacy_ids: groupIds,
      });
      continue;
    }

    const claimedLegacyIds = claimedRows.map((row) => row.legacy_id);
    async function releaseClaim() {
      const { error } = await supaSvc.rpc("release_legacy_sends_supplier_notify_claim", {
        p_legacy_ids: claimedLegacyIds,
        p_claim_token: claimToken,
      });
      return error ? error.message : null;
    }

    const openedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
    const offers = claimedRows.map((row) => ({ title: row.offerTitle }));
    const tpl = pickTemplate("offers_read_by_buyer", {
      companyName: group.company.name || "",
      contactName: owner.name || null,
      offers,
      offerCount: offers.length,
      retailerName: group.retailer?.name || "",
      openedVia,
      openedAt,
      appUrl: env.b2bAppUrl,
      // [P2-backend-mails C2] locale → tplOffersReadByBuyer dispatcher.
      locale: owner.locale || "pl",
    });
    if (!tpl) {
      // Rezerwacja bez wysyłki zablokowałaby powiadomienie do wygaśnięcia dzierżawy.
      const releaseError = await releaseClaim();
      notifications.push({ ok: false, status: "error", reason: "no_template", legacy_ids: claimedLegacyIds, claim_released: !releaseError, release_error: releaseError });
      continue;
    }

    const sent = await sendResendEmail({ env, to: owner.email, subject: tpl.subject, html: tpl.html });
    if (!sent.ok) {
      // Poczta odmówiła przyjęcia (delivered "no") → zwalniamy rezerwację i kolejne
      // zdarzenie odczytu spróbuje jeszcze raz. Wcześniej znacznik zostawał na stałe
      // i dostawca nie dostawał powiadomienia NIGDY.
      // Gdy nie wiemy, czy mail poszedł (delivered "unknown"), rezerwacji nie ruszamy
      // — wygaśnie sama, więc ewentualne ponowienie jest odsunięte w czasie zamiast
      // natychmiast dokładać drugi mail o tym samym odczycie.
      const canRetry = sent.delivered === "no";
      const releaseError = canRetry ? await releaseClaim() : null;
      notifications.push({
        ok: false,
        status: "error",
        reason: sent.reason,
        to: owner.email,
        legacy_ids: claimedLegacyIds,
        delivery: sent.delivered,
        claim_released: canRetry && !releaseError,
        release_error: releaseError,
      });
      continue;
    }

    const { data: confirmedCount, error: confirmErr } = await supaSvc.rpc("confirm_legacy_sends_supplier_notified", {
      p_legacy_ids: claimedLegacyIds,
      p_claim_token: claimToken,
      p_via: openedVia,
      p_batch_size: claimedLegacyIds.length,
      p_notified_at: new Date().toISOString(),
    });

    notifications.push({
      ok: !confirmErr,
      // Mail POSZEDŁ. Nieudane potwierdzenie to osobna sprawa: rezerwacja wygaśnie
      // i dostawca może dostać powiadomienie ponownie — raportujemy to wprost.
      status: "sent",
      message_id: sent.message_id,
      to: owner.email,
      offer_count: offers.length,
      legacy_ids: claimedLegacyIds,
      confirm_ok: !confirmErr,
      confirm_rows: confirmErr ? null : Number(confirmedCount ?? 0),
      confirm_error: confirmErr ? confirmErr.message : undefined,
    });
  }

  const sentCount = notifications.filter((n) => n.status === "sent").length;
  // Podsumowanie bez adresów i tematów — do logu trafiają tylko liczby i statusy.
  try {
    console.log("[notifySupplierOffersRead]", JSON.stringify({
      openedVia, sent: sentCount, total: notifications.length,
      statuses: notifications.reduce((a, n) => ({ ...a, [n.status]: (a[n.status] || 0) + 1 }), {}),
    }));
  } catch (e) {}
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
