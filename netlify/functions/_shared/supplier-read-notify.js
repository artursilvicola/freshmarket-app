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
 *   ensure_message zapisuje NIEZMIENNĄ treść wiadomości albo oddaje już zapisaną
 *   confirm        po udanej wysyłce stawia supplierNotifiedAt; wołający sprawdza
 *                  KOMPLETNOŚĆ potwierdzenia, nie tylko brak błędu
 *   release        gdy poczta odrzuciła ładunek — wiadomość nie powstała
 *   mark_uncertain gdy wyniku nie znamy; rezerwacja i messageId zostają
 *
 * Rezerwacja pilnuje, by dwie ścieżki nie pisały naraz. Sama nie wystarcza:
 * po jej wygaśnięciu ponowienie wysłałoby drugi mail. Dlatego każda wiadomość
 * ma stały `supplierNotifyMessageId`, który jedzie do Resend jako
 * `Idempotency-Key`. Klucz wiąże się jednak z KONKRETNYM ładunkiem — ten sam
 * klucz z inną treścią to 409, nie deduplikacja — więc treść zapisujemy raz
 * w `legacy_send_notify_messages` i ponowienie wysyła dokładnie ją.
 *
 * Po bezpiecznym oknie (24 h = ochrona Resend) NIEPOTWIERDZONY wiersz nie jest
 * ponawiany automatycznie i wraca jako `needs_review`. Blokada wynika z samego
 * braku potwierdzenia, nie ze znacznika niepewności — inaczej awaria tego zapisu
 * otwierałaby drogę do dubla.
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

// Odpowiedzi poczty, przy których wiadomość NA PEWNO nie powstała i nie powstanie
// w tej postaci: zły ładunek albo odmowa dostępu. Tylko one pozwalają skasować
// tożsamość wiadomości i zacząć od nowa.
const RESEND_PAYLOAD_REJECTED = new Set([400, 401, 403, 404, 422]);

// `delivered` rozstrzyga, co wolno zrobić z rezerwacją:
//   "no"       — poczta ODRZUCIŁA ładunek. Zwalniamy rezerwację i tożsamość,
//                kolejne zdarzenie zbuduje czystą wiadomość.
//   "conflict" — 409: ten klucz już istnieje z INNYM ładunkiem, czyli wiadomość
//                o tej tożsamości powstała wcześniej. Dostawca ją dostał — nie
//                wysyłamy drugiej i NIE kasujemy tożsamości.
//   "unknown"  — brak odpowiedzi albo błąd serwera poczty. Mail MÓGŁ pójść, więc
//                rezerwacja i tożsamość zostają; ponowienie pójdzie tym samym
//                kluczem i tym samym ładunkiem, więc Resend go zdeduplikuje.
async function sendResendEmail({ env, to, subject, html, idempotencyKey }) {
  if (!env.resendApiKey) return { ok: false, reason: "no_resend_key", delivered: "no" };
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
        // Resend wiąże klucz z KONKRETNYM ładunkiem i trzyma go 24 h: ten sam klucz
        // z tą samą treścią to deduplikacja, z inną treścią to błąd 409. Dlatego
        // ponowienie wysyła zapisaną, niezmienną wiadomość, a nie składaną od nowa.
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
    const delivered = res.status === 409
      ? "conflict"
      : (RESEND_PAYLOAD_REJECTED.has(res.status) ? "no" : "unknown");
    return { ok: false, reason: `resend_${res.status}: ${detail}`, delivered, status: res.status };
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

      // [review Codexa, tura 3] Treść wiadomości jest NIEZMIENNA. Resend wiąże
      // Idempotency-Key z konkretnym ładunkiem: ten sam klucz z inną treścią to
      // błąd 409, nie cicha deduplikacja. Składanie maila od nowa przy każdej
      // próbie zmieniało godzinę odczytu, a po częściowym potwierdzeniu paczki
      // A+B zostawiało samo B — czyli za każdym razem inny ładunek.
      //
      // Dlatego wiadomość (adresat, temat, HTML, PEŁNA lista propozycji) ląduje
      // raz w `legacy_send_notify_messages`, a ponowienie wysyła DOKŁADNIE ją.
      // RPC „zapisz albo oddaj zapisaną" rozstrzyga też wyścig dwóch ścieżek:
      // przegrany dostaje treść zwycięzcy, nie swoją.
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

      const { data: storedRows, error: storeErr } = await supaSvc.rpc("ensure_legacy_send_notify_message", {
        p_message_id: messageId,
        p_to_email: owner.email,
        p_subject: tpl.subject,
        p_html: tpl.html,
        p_legacy_ids: legacyIds,
      });
      const stored = Array.isArray(storedRows) ? storedRows[0] : storedRows;
      if (storeErr || !stored) {
        // Bez zapisanej treści ponowienie byłoby inną wiadomością pod tym samym
        // kluczem. Nie wysyłamy; wynik nie jest niepewny, bo poczty nie dotykaliśmy.
        const releaseError = await releaseClaim();
        notifications.push({
          ok: false, status: "error", reason: "message_store_failed",
          to: owner.email, legacy_ids: legacyIds, message_id: messageId,
          store_error: storeErr ? storeErr.message : "brak zapisanej wiadomości",
          claim_released: !releaseError, release_error: releaseError,
        });
        continue;
      }

      // Wysyłamy to, co zwróciła baza — nie to, co właśnie zbudowaliśmy.
      const sent = await sendResendEmail({
        env,
        to: stored.to_email,
        subject: stored.subject,
        html: stored.html,
        idempotencyKey: messageId,
      });

      // 409 = wiadomość o tej tożsamości już u poczty istnieje. Dostawca ją dostał,
      // więc traktujemy to jak wysłane: drugiej nie wysyłamy, tożsamości nie kasujemy.
      const duplicateSuppressed = !sent.ok && sent.delivered === "conflict";
      if (!sent.ok && !duplicateSuppressed) {
        // „no" = poczta odrzuciła ładunek → wiadomość nie powstała, pełny reset.
        // „unknown" = mail MÓGŁ pójść → rezerwacja i tożsamość zostają, a ponowienie
        // pójdzie tym samym kluczem i tym samym ładunkiem, więc Resend je zdeduplikuje.
        const payloadRejected = sent.delivered === "no";
        const releaseError = payloadRejected ? await releaseClaim() : null;
        const uncertainError = payloadRejected ? null : await markUncertain(sent.reason);
        notifications.push({
          ok: false,
          status: "error",
          reason: sent.reason,
          to: stored.to_email,
          legacy_ids: legacyIds,
          message_id: messageId,
          delivery: sent.delivered,
          claim_released: payloadRejected && !releaseError,
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
      // notujemy jako niepewny: ponowienie pójdzie tym samym kluczem i tą samą
      // treścią, więc dostawca nie dostanie drugiego maila, a ślad zostaje w raporcie.
      const confirmUncertainError = confirmComplete
        ? null
        : await markUncertain(confirmErr ? `confirm_failed: ${confirmErr.message}` : `confirm_partial: ${confirmed}/${legacyIds.length}`);

      notifications.push({
        ok: confirmComplete,
        status: "sent",
        message_id: messageId,
        provider_message_id: sent.message_id ?? null,
        duplicate_suppressed: duplicateSuppressed,
        to: stored.to_email,
        offer_count: offers.length,
        legacy_ids: legacyIds,
        message_legacy_ids: stored.legacy_ids,
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
