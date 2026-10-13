/**
 * Supplier notification when buyer sees PreConnect offers.
 *
 * One email is sent per supplier + retailer + seen event, even when a buyer
 * sees several offers in the same batch.
 *
 * Dwie niezależne ścieżki wyzwalają odczyt (webhook Resend `email.opened`
 * i panel kupca), więc powiadomienie idzie przez rezerwację ORAZ stałą
 * tożsamość wiadomości:
 *
 *   claim          zajmuje wiersze, nadaje/utrzymuje messageId i zwraca stan
 *                  każdego z nich; mail powstaje tylko z zajętych
 *   confirm        po udanej wysyłce stawia supplierNotifiedAt; wołający sprawdza
 *                  KOMPLETNOŚĆ potwierdzenia, nie tylko brak błędu
 *   release        po jednoznacznej odmowie poczty — mail nie powstał
 *   mark_uncertain gdy wyniku nie znamy; rezerwacja i messageId zostają
 *
 * Rezerwacja pilnuje, by dwie ścieżki nie pisały naraz. Sama nie wystarcza:
 * po jej wygaśnięciu ponowienie wysłałoby drugi mail. Dlatego każda wiadomość
 * ma stały `supplierNotifyMessageId`, który jedzie do Resend jako
 * `Idempotency-Key` (ważny 24 h). Po tym oknie niepewny wynik nie jest
 * ponawiany automatycznie — wraca jako `needs_review`.
 *
 * Migracja 20261013090000_supplier_notify_claim.sql.
 */

import { pickTemplate } from "./supplier-email-templates.js";

function randomToken(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

// `claim_legacy_sends_supplier_notify` zwraca tabelę (legacy_id, state, message_id,
// attempt). PostgREST podaje ją jako listę obiektów; atrapy i starsze klienty potrafią
// oddać samo id, więc obie postaci sprowadzamy do jednej.
function normalizeClaimRows(rows) {
  const list = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
  return list
    .map((item) => {
      if (item && typeof item === "object") {
        return {
          legacy_id: Number(item.legacy_id),
          state: item.state || "claimed",
          message_id: item.message_id || null,
          attempt: Number(item.attempt ?? 0),
        };
      }
      return { legacy_id: Number(item), state: "claimed", message_id: null, attempt: 0 };
    })
    .filter((row) => Number.isFinite(row.legacy_id));
}

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
async function sendResendEmail({ env, to, subject, html, idempotencyKey }) {
  if (!env.resendApiKey) return { ok: false, reason: "no_resend_key", delivered: "no" };
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
        // Ponowienie tej samej wiadomości nie tworzy drugiego maila: Resend trzyma
        // klucz 24 h i na powtórkę oddaje pierwotną wysyłkę.
        // https://resend.com/docs/dashboard/emails/idempotency-keys
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
    const titleById = new Map(group.rows.map((row) => [row.legacy_id, row.offerTitle]));

    // [fix/supplier-read-notify-once v3] REZERWUJ → WYŚLIJ → POTWIERDŹ,
    // z TOŻSAMOŚCIĄ WIADOMOŚCI stałą między próbami.
    //
    // Odczyt wyzwalają dwie niezależne ścieżki — webhook Resend (email.opened)
    // i panel kupca. Rezerwacja rozstrzyga, która z nich pisze o których
    // propozycjach; `supplierNotifyMessageId` rozstrzyga, czy ponowienie jest
    // TĄ SAMĄ wiadomością, czy nową. Pierwsze bez drugiego tylko odsuwało dubla
    // o długość dzierżawy (review Codexa, tura 2).
    //
    // RPC zwraca stan KAŻDEGO pytanego wiersza, nie samą liczbę zajętych: gdy
    // jedna ścieżka obsługuje propozycję A, a druga paczkę A+B, druga zajmie
    // samo B — i tylko o B wolno jej napisać.
    const claimToken = randomToken("claim");
    const newMessageId = randomToken("fmr");
    const { data: claimRows, error: claimErr } = await supaSvc.rpc("claim_legacy_sends_supplier_notify", {
      p_legacy_ids: groupIds,
      p_claim_token: claimToken,
      p_new_message_id: newMessageId,
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

    const states = normalizeClaimRows(claimRows);
    const claimed = states.filter((row) => row.state === "claimed");
    // Niepewny wynik starszy niż okno idempotencji poczty. Mail mógł dotrzeć,
    // a klucz już nie chroni — automatyczne ponowienie wysłałoby dubla. To jest
    // sprawa do wyjaśnienia przez człowieka, nie do cichego powtórzenia.
    const needsReview = states.filter((row) => row.state === "needs_review");
    if (needsReview.length) {
      notifications.push({
        ok: false,
        status: "needs_review",
        reason: "uncertain_outside_idempotency_window",
        to: owner.email,
        legacy_ids: needsReview.map((row) => row.legacy_id),
        message_ids: [...new Set(needsReview.map((row) => row.message_id).filter(Boolean))],
      });
    }
    if (!claimed.length) {
      if (!needsReview.length) {
        // Druga ścieżka zajęła te wiersze wcześniej i to ona wysyła. Nie jest to błąd.
        notifications.push({
          ok: true,
          status: "already_notified",
          to: owner.email,
          legacy_ids: groupIds,
        });
      }
      continue;
    }

    // Zajęte wiersze mogą należeć do RÓŻNYCH wiadomości: część to ponowienie
    // wiadomości sprzed wygasłej dzierżawy (stare messageId), część zaczyna nową.
    // Każda idzie osobnym mailem ze swoim kluczem.
    const byMessage = new Map();
    for (const row of claimed) {
      const key = row.message_id || newMessageId;
      if (!byMessage.has(key)) byMessage.set(key, []);
      byMessage.get(key).push(row.legacy_id);
    }

    for (const [messageId, legacyIds] of byMessage) {
      const releaseClaim = async () => {
        const { error } = await supaSvc.rpc("release_legacy_sends_supplier_notify_claim", {
          p_legacy_ids: legacyIds,
          p_claim_token: claimToken,
        });
        return error ? error.message : null;
      };
      const markUncertain = async (reason) => {
        const { error } = await supaSvc.rpc("mark_legacy_sends_supplier_notify_uncertain", {
          p_legacy_ids: legacyIds,
          p_claim_token: claimToken,
          p_reason: reason,
        });
        return error ? error.message : null;
      };

      const openedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
      const offers = legacyIds.map((id) => ({ title: titleById.get(id) }));
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
        // Rezerwacja bez wysyłki blokowałaby powiadomienie do wygaśnięcia dzierżawy.
        const releaseError = await releaseClaim();
        notifications.push({ ok: false, status: "error", reason: "no_template", legacy_ids: legacyIds, message_id: messageId, claim_released: !releaseError, release_error: releaseError });
        continue;
      }

      const sent = await sendResendEmail({
        env, to: owner.email, subject: tpl.subject, html: tpl.html,
        idempotencyKey: messageId,
      });
      if (!sent.ok) {
        // Poczta jednoznacznie odmówiła (delivered "no") → mail nie powstał,
        // zwalniamy rezerwację i kolejne zdarzenie zacznie od czystej wiadomości.
        // Wcześniej znacznik zostawał na stałe i dostawca nie dostawał nic NIGDY.
        //
        // Gdy wyniku nie znamy (delivered "unknown") → rezerwacja i messageId
        // ZOSTAJĄ. Ponowienie po wygaśnięciu dzierżawy pójdzie tym samym
        // Idempotency-Key, więc poczta nie utworzy drugiej wiadomości.
        const definiteFailure = sent.delivered === "no";
        const releaseError = definiteFailure ? await releaseClaim() : null;
        const uncertainError = definiteFailure ? null : await markUncertain(sent.reason);
        notifications.push({
          ok: false,
          status: "error",
          reason: sent.reason,
          to: owner.email,
          legacy_ids: legacyIds,
          message_id: messageId,
          delivery: sent.delivered,
          claim_released: definiteFailure && !releaseError,
          release_error: releaseError,
          uncertain_error: uncertainError,
        });
        continue;
      }

      const { data: confirmedCount, error: confirmErr } = await supaSvc.rpc("confirm_legacy_sends_supplier_notified", {
        p_legacy_ids: legacyIds,
        p_claim_token: claimToken,
        p_via: openedVia,
        p_batch_size: legacyIds.length,
        p_notified_at: new Date().toISOString(),
      });
      // Potwierdzenie CZĘŚCI wierszy to nie sukces: niepotwierdzone wrócą po
      // wygaśnięciu dzierżawy. Brak błędu bazy nie dowodzi, że zapis objął wszystko.
      const confirmed = confirmErr ? 0 : Number(confirmedCount ?? 0);
      const confirmComplete = !confirmErr && confirmed === legacyIds.length;
      // Mail POSZEDŁ — to jest fakt i status go odzwierciedla. Niekompletny zapis
      // notujemy jako niepewny: ponowienie pójdzie tym samym kluczem, więc dostawca
      // nie dostanie drugiego maila, a ślad zostaje w raporcie.
      const confirmUncertainError = confirmComplete
        ? null
        : await markUncertain(confirmErr ? `confirm_failed: ${confirmErr.message}` : `confirm_partial: ${confirmed}/${legacyIds.length}`);

      notifications.push({
        ok: confirmComplete,
        status: "sent",
        message_id: messageId,
        provider_message_id: sent.message_id,
        to: owner.email,
        offer_count: offers.length,
        legacy_ids: legacyIds,
        confirm_ok: confirmComplete,
        confirm_rows: confirmed,
        confirm_expected: legacyIds.length,
        confirm_error: confirmErr ? confirmErr.message : undefined,
        uncertain_error: confirmUncertainError,
      });
    }
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
