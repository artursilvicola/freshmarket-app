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
//   "no"        — poczta ODRZUCIŁA ładunek. Wiadomość nie powstała.
//   "in_flight" — 409 „concurrent": żądanie z tym kluczem WŁAŚNIE trwa. To nie jest
//                 potwierdzenie wysyłki ani jej brak — po prostu ponawiamy później.
//   "conflict"  — 409 „different payload": pod tym kluczem leży INNA treść. Nie wiemy,
//                 czy dostawca dostał to, co trzeba — sprawa do wyjaśnienia.
//   "unknown"   — brak odpowiedzi albo błąd serwera poczty. Mail MÓGŁ pójść.
//
// ŻADEN z 409 nie oznacza „powiadomiono" (review Codexa, tura 4: wcześniej oba
// warianty zapisywały sukces). Tożsamości nie kasujemy w żadnym z nich.
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
    let delivered;
    if (res.status === 409) {
      // Resend rozróżnia dwa 409: `concurrent_idempotent_requests` (poprzednie żądanie
      // z tym kluczem jeszcze trwa) i `invalid_idempotent_request` (ten klucz niesie
      // inną treść). Pierwszy wolno ponowić, drugi wymaga wyjaśnienia.
      let name = "";
      try { name = String(JSON.parse(detail)?.name || ""); } catch { name = ""; }
      delivered = name.includes("concurrent") || /concurrent/i.test(detail) ? "in_flight" : "conflict";
    } else {
      delivered = RESEND_PAYLOAD_REJECTED.has(res.status) ? "no" : "unknown";
    }
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
      if (!byMessage.has(key)) byMessage.set(key, { ids: [], attempt: 0 });
      const bucket = byMessage.get(key);
      bucket.ids.push(row.legacy_id);
      bucket.attempt = Math.max(bucket.attempt, row.attempt || 1);
    }

    for (const [messageId, bucket] of byMessage) {
      const legacyIds = bucket.ids;
      // [review Codexa, tura 4] Pełny reset tożsamości wolno zrobić TYLKO wtedy, gdy
      // to pierwsza próba tej wiadomości. Przy kolejnych poprzedni mail mógł już pójść
      // (odpowiedź zginęła), a niepowodzenie BIEŻĄCEJ próby — odczytu treści, 401,
      // braku klucza poczty — niczego o tamtym nie dowodzi. Skasowanie historii
      // otwierało wtedy drogę do drugiego maila.
      const firstAttempt = (bucket.attempt || 1) <= 1;
      const releaseClaim = async (ids = legacyIds) => {
        const { error } = await supaSvc.rpc("release_legacy_sends_supplier_notify_claim", {
          p_legacy_ids: ids,
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
      // Reset wolno zrobić tylko przy pierwszej próbie. Przy kolejnych zostawiamy
      // tożsamość, treść i początek okna bezpieczeństwa, a sam fakt notujemy.
      const abandonAttempt = async (reason) => (firstAttempt
        ? { released: !(await releaseClaim()), note: null }
        : { released: false, note: await markUncertain(reason) });

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
        const { released, note } = await abandonAttempt("no_template");
        notifications.push({ ok: false, status: "error", reason: "no_template", legacy_ids: legacyIds, message_id: messageId, attempt: bucket.attempt, claim_released: released, uncertain_error: note });
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
        // Bez zapisanej treści ponowienie byłoby inną wiadomością pod tym samym kluczem.
        // Przy kolejnej próbie NIE kasujemy historii: poprzedni mail mógł już pójść,
        // a nieudany odczyt treści niczego o tym nie mówi (review Codexa, tura 4).
        const { released, note } = await abandonAttempt(`message_store_failed: ${storeErr ? storeErr.message : "brak wiersza"}`);
        notifications.push({
          ok: false, status: "error", reason: "message_store_failed",
          to: owner.email, legacy_ids: legacyIds, message_id: messageId, attempt: bucket.attempt,
          store_error: storeErr ? storeErr.message : "brak zapisanej wiadomości",
          claim_released: released, uncertain_error: note,
        });
        continue;
      }

      // [review Codexa, tura 4] Zapisana wiadomość jest JEDYNYM źródłem prawdy o tym,
      // co dostawca zobaczy. Proces mógł zarezerwować A+B i paść przed zapisem treści;
      // kolejne zdarzenie dotyczące samego A zapisałoby wtedy wiadomość o A pod tą samą
      // tożsamością. Potwierdzenie B na podstawie takiej wiadomości byłoby kłamstwem —
      // B w mailu nie ma. Dlatego potwierdzamy WYŁĄCZNIE propozycje obecne w zapisanej
      // treści, a resztę zwalniamy: nigdy nie były w żadnym wysłanym mailu, więc
      // bezpiecznie zaczną własną wiadomość przy następnym zdarzeniu.
      const messageIds = new Set((stored.legacy_ids || []).map(Number));
      const covered = legacyIds.filter((id) => messageIds.has(id));
      const uncovered = legacyIds.filter((id) => !messageIds.has(id));
      let uncoveredReleaseError = null;
      if (uncovered.length) uncoveredReleaseError = await releaseClaim(uncovered);
      if (!covered.length) {
        notifications.push({
          ok: false, status: "error", reason: "message_missing_offers",
          to: stored.to_email, legacy_ids: uncovered, message_id: messageId, attempt: bucket.attempt,
          message_legacy_ids: stored.legacy_ids,
          claim_released: !uncoveredReleaseError, release_error: uncoveredReleaseError,
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

      if (!sent.ok) {
        // „no"        → poczta odrzuciła ładunek; wiadomość nie powstała.
        // „in_flight" → 409: żądanie z tym kluczem właśnie trwa. Ani sukces, ani porażka.
        // „conflict"  → 409: pod tym kluczem leży INNA treść. Do wyjaśnienia.
        // „unknown"   → mail MÓGŁ pójść.
        // Żaden z nich nie pozwala zapisać „powiadomiono". Tożsamość kasujemy wyłącznie
        // przy odrzuconym ładunku i tylko przy PIERWSZEJ próbie.
        const payloadRejected = sent.delivered === "no";
        const { released, note } = payloadRejected
          ? await abandonAttempt(sent.reason)
          : { released: false, note: await markUncertain(sent.reason) };
        notifications.push({
          ok: false,
          status: sent.delivered === "conflict" ? "needs_review" : "error",
          reason: sent.delivered === "conflict" ? "idempotency_payload_conflict" : sent.reason,
          detail: sent.delivered === "conflict" ? sent.reason : undefined,
          retryable: sent.delivered === "in_flight" || sent.delivered === "unknown",
          to: stored.to_email,
          legacy_ids: covered,
          message_id: messageId,
          attempt: bucket.attempt,
          delivery: sent.delivered,
          claim_released: released,
          uncertain_error: note,
        });
        continue;
      }

      const { data: confirmedCount, error: confirmErr } = await supaSvc.rpc("confirm_legacy_sends_supplier_notified", {
        p_legacy_ids: covered,
        p_claim_token: claimToken,
        p_via: openedVia,
        p_batch_size: covered.length,
        p_notified_at: new Date().toISOString(),
      });
      // Potwierdzenie CZĘŚCI wierszy to nie sukces: niepotwierdzone wrócą po
      // wygaśnięciu dzierżawy. Brak błędu bazy nie dowodzi, że zapis objął wszystko.
      const confirmed = confirmErr ? 0 : Number(confirmedCount ?? 0);
      const confirmComplete = !confirmErr && confirmed === covered.length;
      // Mail POSZEDŁ — to jest fakt i status go odzwierciedla. Niekompletny zapis
      // notujemy jako niepewny: ponowienie pójdzie tym samym kluczem i tą samą
      // treścią, więc dostawca nie dostanie drugiego maila, a ślad zostaje w raporcie.
      const confirmUncertainError = confirmComplete
        ? null
        : await markUncertain(confirmErr ? `confirm_failed: ${confirmErr.message}` : `confirm_partial: ${confirmed}/${covered.length}`);

      notifications.push({
        ok: confirmComplete && !uncovered.length,
        status: "sent",
        message_id: messageId,
        provider_message_id: sent.message_id ?? null,
        attempt: bucket.attempt,
        to: stored.to_email,
        offer_count: covered.length,
        legacy_ids: covered,
        message_legacy_ids: stored.legacy_ids,
        released_not_in_message: uncovered.length ? uncovered : undefined,
        release_error: uncoveredReleaseError,
        confirm_ok: confirmComplete,
        confirm_rows: confirmed,
        confirm_expected: covered.length,
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
