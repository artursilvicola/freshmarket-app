/**
 * db.js — warstwa danych (CRUD do Supabase)
 *
 * Wszystkie funkcje zwracają Promise. Używaj w komponentach z useEffect lub
 * (lepiej) z TanStack Query.
 *
 * Na początek wszystkie funkcje zwracają tablice/obiekty kompatybilne z
 * formatem z Twojego PreconnectFM.jsx (OFFERS_INIT, COMPANIES_DB, etc.),
 * więc migracja jest minimalna — wystarczy zastąpić useState(SEED) wywołaniem
 * tej funkcji.
 */
import { supabase } from "./supabase";

// ===================================================================
// COMPANIES
// ===================================================================
export async function getCompanies() {
  const { data, error } = await supabase
    .from("companies")
    .select(`
      *,
      contacts:company_contacts(*),
      certs:company_certs(*)
    `)
    .order("name");
  if (error) throw error;
  return data;
}

export async function getCompany(id) {
  const { data, error } = await supabase
    .from("companies")
    .select(`*, contacts:company_contacts(*), certs:company_certs(*)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateCompany(id, patch) {
  const { data, error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================================================================
// RETAILERS
// ===================================================================
export async function getRetailers() {
  const { data, error } = await supabase
    .from("retailers")
    .select("*")
    .order("name");
  if (error) throw error;
  return data;
}

export async function updateRetailer(id, patch) {
  const { data, error } = await supabase
    .from("retailers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================================================================
// OFFERS
// ===================================================================
export async function getOffers({ supplierCompanyId } = {}) {
  let q = supabase
    .from("offers")
    .select(`*, photos:offer_photos(*)`)
    .order("created_at", { ascending: false });
  if (supplierCompanyId) q = q.eq("supplier_company_id", supplierCompanyId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function getOffer(id) {
  const { data, error } = await supabase
    .from("offers")
    .select(`*, photos:offer_photos(*)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveOffer(offer) {
  // Jeśli ma id — update; inaczej insert
  if (offer.id) {
    const { data, error } = await supabase
      .from("offers")
      .update(offer)
      .eq("id", offer.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from("offers")
      .insert(offer)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

export async function deleteOffer(id) {
  const { error } = await supabase.from("offers").delete().eq("id", id);
  if (error) throw error;
}

// ===================================================================
// SENDS
// ===================================================================
export async function getSends({ supplierCompanyId, retailerId } = {}) {
  let q = supabase
    .from("sends")
    .select(`*, offer:offers(*), retailer:retailers(*)`)
    .order("created_at", { ascending: false });
  if (supplierCompanyId) q = q.eq("supplier_company_id", supplierCompanyId);
  if (retailerId) q = q.eq("retailer_id", retailerId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function createSend(payload) {
  const { data, error } = await supabase
    .from("sends")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSend(id, patch) {
  const { data, error } = await supabase
    .from("sends")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================================================================
// WALLET / PACKAGES
// ===================================================================
export async function getWallet(companyId) {
  const { data, error } = await supabase
    .from("wallet_tx")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const balance = (data || []).reduce((sum, t) => sum + Number(t.amount), 0);
  return { balance, transactions: data || [] };
}

export async function getPackages(companyId) {
  const { data, error } = await supabase
    .from("packages")
    .select("*")
    .eq("company_id", companyId)
    .order("purchased_at", { ascending: false });
  if (error) throw error;
  return data;
}

// ===================================================================
// BUYER STARRED
// ===================================================================
export async function getStarred(userId) {
  const { data, error } = await supabase
    .from("buyer_starred")
    .select("send_id")
    .eq("buyer_user_id", userId);
  if (error) throw error;
  return (data || []).map((r) => r.send_id);
}

export async function toggleStar(userId, sendId, currentlyStarred) {
  if (currentlyStarred) {
    const { error } = await supabase
      .from("buyer_starred")
      .delete()
      .eq("buyer_user_id", userId)
      .eq("send_id", sendId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("buyer_starred")
      .insert({ buyer_user_id: userId, send_id: sendId });
    if (error) throw error;
  }
}

// ===================================================================
// FRESH MARKET (event)
// ===================================================================
function normalizeFmSettings(row) {
  if (!row) return null;
  const phase = row.algo_phase || "closed";
  const schedulingOpen = phase !== "closed";
  const planPublished = ["published", "final_published", "event_day"].includes(phase);
  const currentPhase = planPublished
    ? 4
    : ["matching", "algorithm", "corrections"].includes(phase)
      ? 3
      : schedulingOpen
        ? 2
        : 1;
  return {
    ...row,
    schedulingOpen,
    currentPhase,
    planPublished,
    openDate: row.open_date ? String(row.open_date).slice(0, 10) : "2026-09-01",
  };
}

function serializeFmSettings(settings = {}) {
  const algo_phase = !settings.schedulingOpen
    ? "closed"
    : settings.planPublished
      ? "published"
      : Number(settings.currentPhase || 1) >= 3
        ? "matching"
        : "preferences_open";
  return {
    open_date: settings.openDate || settings.open_date || "2026-09-01",
    algo_phase,
    updated_at: new Date().toISOString(),
  };
}

export async function getFmSettings() {
  const { data, error } = await supabase
    .from("fm_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return normalizeFmSettings(data);
}

export async function saveFmSettings(settings) {
  const existing = await getFmSettings();
  const row = serializeFmSettings(settings);
  if (existing?.id) {
    const { data, error } = await supabase
      .from("fm_settings")
      .update(row)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return normalizeFmSettings(data);
  }
  const { data, error } = await supabase
    .from("fm_settings")
    .insert({
      ...row,
      venue: settings.venue || "MCC Mazurkas Conference Centre, Ozarow Mazowiecki",
      event_date: settings.event_date || "2026-09-24",
      message: settings.message || "Fresh Market 2026",
      schedule: settings.schedule || {},
    })
    .select()
    .single();
  if (error) throw error;
  return normalizeFmSettings(data);
}

export async function getFmPrefs(retailerId) {
  const { data, error } = await supabase
    .from("fm_prefs")
    .select("*")
    .eq("retailer_id", retailerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveFmPrefs(retailerId, prefs) {
  const { data, error } = await supabase
    .from("fm_prefs")
    .upsert({ retailer_id: retailerId, prefs }, { onConflict: "retailer_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================================================================
// LEGACY SYNC — offers i sends w formacie zgodnym z PreconnectFM.jsx
// (przechowywane jako JSONB pełnej oferty/wysylki)
// ===================================================================
export async function loadLegacyOffers() {
  const { data, error } = await supabase
    .from("legacy_offers")
    .select("data")
    .order("legacy_id", { ascending: true });
  if (error) {
    console.warn("[loadLegacyOffers]", error.message);
    return null;
  }
  return (data || []).map((r) => r.data);
}

// [B2B Round 5] Per-action writes: throw on error so callers can show
// an error toast instead of falsely reporting success. Hot-path callers
// (saveOffer, sendToChain, moderate, ...) MUST await these and handle
// the rejection. The legacy bulk wrappers in PreconnectFM.jsx still call
// the bulk variants in fire-and-forget mode for state-driven syncs.
export async function upsertLegacyOffer(offer) {
  if (!offer || !offer.id) return;
  const row = {
    legacy_id: offer.id,
    supplier_legacy_id: offer.supplierId || "",
    status: offer.status || null,
    category: offer.category || null,
    origin: offer.origin || null,
    data: offer,
  };
  const { error } = await supabase
    .from("legacy_offers")
    .upsert(row, { onConflict: "legacy_id" });
  if (error) throw error;
}

export async function bulkUpsertLegacyOffers(offers) {
  if (!offers || !offers.length) return;
  const rows = offers.map((offer) => ({
    legacy_id: offer.id,
    supplier_legacy_id: offer.supplierId || "",
    status: offer.status || null,
    category: offer.category || null,
    origin: offer.origin || null,
    data: offer,
  }));
  const { error } = await supabase
    .from("legacy_offers")
    .upsert(rows, { onConflict: "legacy_id" });
  if (error) throw error;
}

export async function deleteLegacyOffer(legacyId) {
  const { error } = await supabase
    .from("legacy_offers")
    .delete()
    .eq("legacy_id", legacyId);
  if (error) throw error;
}

export async function loadLegacySends() {
  const { data, error } = await supabase
    .from("legacy_sends")
    .select("data")
    .order("legacy_id", { ascending: true });
  if (error) {
    console.warn("[loadLegacySends]", error.message);
    return null;
  }
  return (data || []).map((r) => r.data);
}

export async function upsertLegacySend(send) {
  if (!send || !send.id) return;
  const row = {
    legacy_id: send.id,
    supplier_legacy_id: send.supplierId || "",
    offer_legacy_id: send.offerId || null,
    retailer_id: send.retailerId || null,
    status: send.status || null,
    data: send,
  };
  const { error } = await supabase
    .from("legacy_sends")
    .upsert(row, { onConflict: "legacy_id" });
  if (error) throw error;
}

export async function bulkUpsertLegacySends(sends) {
  if (!sends || !sends.length) return;
  const rows = sends.map((send) => ({
    legacy_id: send.id,
    supplier_legacy_id: send.supplierId || "",
    offer_legacy_id: send.offerId || null,
    retailer_id: send.retailerId || null,
    status: send.status || null,
    data: send,
  }));
  const { error } = await supabase
    .from("legacy_sends")
    .upsert(rows, { onConflict: "legacy_id" });
  if (error) throw error;
}

export async function deleteLegacySend(legacyId) {
  const { error } = await supabase
    .from("legacy_sends")
    .delete()
    .eq("legacy_id", legacyId);
  if (error) throw error;
}

// [B2B Round 5] Buyer marks a "sent" send as opened/read. Backed by
// SECURITY DEFINER RPC because buyer RLS only allows SELECT, not UPDATE.
// RPC verifies the caller is the right buyer for that send's retailer.
export async function markLegacySendRead(legacyId) {
  if (!legacyId) return null;
  const { data, error } = await supabase.rpc("mark_legacy_send_read", { p_legacy_id: Number(legacyId) });
  if (error) throw error;
  return data;
}

// [B2B Round 5] Idempotent 14-day expiry sweep. Any authenticated user can
// call it; SECURITY DEFINER RPC promotes "sent" sends older than 14 days
// to "unread_expired". Returns count of rows updated. Called once per
// hydration so the first user each day triggers expiry.
export async function expireLegacySends14d() {
  const { data, error } = await supabase.rpc("expire_legacy_sends_14d");
  if (error) throw error;
  return data || 0;
}

// ===================================================================
// AUDIT LOG
// ===================================================================
export async function logAction(action, entity, entityId, meta = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("audit_log").insert({
    user_id: user.id,
    action,
    entity,
    entity_id: entityId,
    meta,
  });
}

// ===================================================================
// FM 2026 — RETAILERS / COMPANIES legacy mapping
// ===================================================================

/**
 * Pobierz retailera po legacy_chain_id (np. "100" dla Biedronki w PreconnectFM).
 * Zwraca null jeśli nie znaleziono.
 */
export async function getRetailerByLegacyId(legacyChainId) {
  const { data, error } = await supabase
    .from("retailers")
    .select("*")
    .eq("legacy_chain_id", String(legacyChainId))
    .maybeSingle();
  if (error) {
    console.warn("[getRetailerByLegacyId]", error.message);
    return null;
  }
  return data;
}

/**
 * Pobierz firmę dostawcy po legacy_fm_id (np. "s1" dla UNICA).
 */
export async function getCompanyByLegacyFmId(legacyFmId) {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("legacy_fm_id", String(legacyFmId))
    .maybeSingle();
  if (error) {
    console.warn("[getCompanyByLegacyFmId]", error.message);
    return null;
  }
  return data;
}

// ===================================================================
// FM 2026 — RESPONSES (buyer akceptuje/odrzuca dostawce)
// ===================================================================

export async function getFmResps(retailerId) {
  let q = supabase.from("fm_resps").select("*");
  if (retailerId !== undefined && retailerId !== null) {
    q = q.eq("retailer_id", retailerId);
  }
  const { data, error } = await q.order("position", { ascending: true });
  if (error) {
    console.warn("[getFmResps]", error.message);
    return [];
  }
  return data || [];
}

/**
 * Zapisz odpowiedź kupca dla dostawcy (zone: green/orange/red/blocked).
 * Upsert po (retailer_id + supplier_company_id) — kazdy kupiec ma jedna
 * odpowiedz dla danego dostawcy.
 */
export async function saveFmResp({ retailer_id, supplier_company_id, position, zone, status, meta }) {
  if (!retailer_id || !supplier_company_id) {
    throw new Error("saveFmResp wymaga retailer_id + supplier_company_id");
  }
  // Sprawdz czy istnieje
  const { data: existing } = await supabase
    .from("fm_resps")
    .select("id")
    .eq("retailer_id", retailer_id)
    .eq("supplier_company_id", supplier_company_id)
    .maybeSingle();
  if (existing?.id) {
    const { data, error } = await supabase
      .from("fm_resps")
      .update({ position, zone, status, meta })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("fm_resps")
    .insert({ retailer_id, supplier_company_id, position, zone, status, meta })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFmResp(id) {
  const { error } = await supabase.from("fm_resps").delete().eq("id", id);
  if (error) throw error;
}

// ===================================================================
// FM 2026 — SCHEDULE (publikowany przez admina, czytaja wszyscy)
// ===================================================================

export async function getFmSchedule() {
  const settings = await getFmSettings();
  const sched = settings?.schedule;
  if (!sched || typeof sched !== "object" || !sched.res) return null;
  return sched;
}

export async function saveFmSchedule(schedule) {
  // fm_settings ma 1-row pattern (limit 1, order updated_at desc)
  const existing = await getFmSettings();
  if (existing?.id) {
    const { data, error } = await supabase
      .from("fm_settings")
      .update({ schedule, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("fm_settings")
    .insert({ schedule })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================================================================
// FM 2026 — TARGET RETAILERS (preferencje dostawcy)
// ===================================================================

export async function getCompanyTargetRetailers(companyId) {
  const { data, error } = await supabase
    .from("company_target_retailers")
    .select("retailer_id, priority, note, retailer:retailers(*)")
    .eq("company_id", companyId)
    .order("priority", { ascending: false });
  if (error) {
    console.warn("[getCompanyTargetRetailers]", error.message);
    return [];
  }
  return data || [];
}

export async function getAllCompanyTargetRetailers() {
  const { data, error } = await supabase
    .from("company_target_retailers")
    .select("company_id, retailer_id, priority, note, retailer:retailers(*)")
    .order("priority", { ascending: false });
  if (error) {
    console.warn("[getAllCompanyTargetRetailers]", error.message);
    return [];
  }
  return data || [];
}

// [B2B Round supplier-FM-UX] Mark a supplier's FM 2026 chain selection as
// confirmed. Called when supplier clicks "Potwierdz wybor" in PageSupplierFM
// (subPage fm-sched). Idempotent: re-confirming overwrites the timestamp,
// which is the desired behavior — admin sees the LATEST confirmation.
// Pass null to clear (currently not used, but allowed).
export async function saveFmSelectionConfirmation(companyId, confirmedAt = new Date().toISOString()) {
  if (!companyId) throw new Error("saveFmSelectionConfirmation: companyId wymagane");
  const { data, error } = await supabase
    .from("companies")
    .update({ fm_selection_confirmed_at: confirmedAt })
    .eq("id", companyId)
    .select("id, fm_selection_confirmed_at")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Replace-set: zastąp całą listę preferencji dostawcy nową listą par
 * { retailer_id, priority, note }.
 */
export async function setCompanyTargetRetailers(companyId, items) {
  if (!companyId) throw new Error("setCompanyTargetRetailers: companyId wymagane");
  // Wymaz stare i wpisz nowe (transactional via supabase function w przyszlosci;
  // teraz: 2 osobne kroki)
  const { error: delErr } = await supabase
    .from("company_target_retailers")
    .delete()
    .eq("company_id", companyId);
  if (delErr) throw delErr;
  if (!items || !items.length) return [];
  const rows = items.map((it) => ({
    company_id: companyId,
    retailer_id: it.retailer_id,
    priority: it.priority || 0,
    note: it.note || null,
  }));
  const { data, error } = await supabase
    .from("company_target_retailers")
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}

// ===================================================================
// FM 2026 — WISHLISTS (kupiec stawia priorytet na dostawce)
// ===================================================================

export async function getFmWishlists(retailerId) {
  let q = supabase.from("fm_wishlists").select("*");
  if (retailerId !== undefined && retailerId !== null) {
    q = q.eq("retailer_id", retailerId);
  }
  const { data, error } = await q;
  if (error) {
    console.warn("[getFmWishlists]", error.message);
    return [];
  }
  return data || [];
}

export async function saveFmWishlist({ retailer_id, supplier_legacy_id, data }) {
  if (!retailer_id || !supplier_legacy_id) throw new Error("saveFmWishlist wymaga retailer_id + supplier_legacy_id");
  const { data: row, error } = await supabase
    .from("fm_wishlists")
    .upsert(
      { retailer_id, supplier_legacy_id, data: data || {} },
      { onConflict: "retailer_id,supplier_legacy_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return row;
}

export async function deleteFmWishlist({ retailer_id, supplier_legacy_id }) {
  const { error } = await supabase
    .from("fm_wishlists")
    .delete()
    .eq("retailer_id", retailer_id)
    .eq("supplier_legacy_id", supplier_legacy_id);
  if (error) throw error;
}

// ===================================================================
// FM 2026 — LATE RESPONSES (kupiec po zamknieciu fazy)
// ===================================================================

export async function getFmLateResps(retailerId) {
  let q = supabase.from("fm_late_resps").select("*");
  if (retailerId !== undefined && retailerId !== null) {
    q = q.eq("retailer_id", retailerId);
  }
  const { data, error } = await q;
  if (error) {
    console.warn("[getFmLateResps]", error.message);
    return [];
  }
  return data || [];
}

export async function saveFmLateResp({ retailer_id, supplier_legacy_id, zone, data }) {
  const { data: row, error } = await supabase
    .from("fm_late_resps")
    .upsert(
      { retailer_id, supplier_legacy_id, zone, data: data || {}, responded_at: new Date().toISOString() },
      { onConflict: "retailer_id,supplier_legacy_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return row;
}

// ===================================================================
// FM 2026 — MESSAGES (konwersacje admin/supplier/buyer)
// ===================================================================

export async function getFmMessages({ threadKey, fromUserId, limit = 100 } = {}) {
  let q = supabase.from("fm_messages").select("*").order("created_at", { ascending: false });
  if (threadKey) q = q.eq("thread_key", threadKey);
  if (fromUserId) q = q.eq("from_user_id", fromUserId);
  q = q.limit(limit);
  const { data, error } = await q;
  if (error) {
    console.warn("[getFmMessages]", error.message);
    return [];
  }
  return data || [];
}

export async function saveFmMessage({ thread_key, from_role, to_role, body, data }) {
  const { data: { user } } = await supabase.auth.getUser();
  const row = {
    thread_key,
    from_role,
    from_user_id: user?.id || null,
    to_role,
    body,
    data: data || {},
  };
  const { data: created, error } = await supabase
    .from("fm_messages")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function markFmMessageRead(id) {
  const { error } = await supabase
    .from("fm_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ===================================================================
// COMPANIES — bulk upsert (do migracji COMPANIES_DB seed → Supabase)
// ===================================================================

export async function bulkUpsertCompanies(companies) {
  if (!companies || !companies.length) return [];
  // Mapuj legacy fmId → legacy_fm_id w DB
  const rows = companies.map((c) => ({
    id: c.id && c.id.length === 36 ? c.id : undefined,
    legacy_fm_id: c.fmId || null,
    name: c.name,
    nip: c.nip || null,
    country: c.country || null,
    city: c.city || null,
    phone: c.phone || null,
    website: c.website || null,
    description: c.description || null,
    types: c.types || [],
    categories: c.categories || [],
    products: c.products || null,
    seasonality: c.seasonality || null,
    markets: c.markets || null,
    completeness: c.completeness || 0,
    logo_url: c.logo || null,
    pkg_plan: c.pkg || null,
    pkg_expiry: c.pkgExpiry || null,
  }));
  const { data, error } = await supabase
    .from("companies")
    .upsert(rows, { onConflict: "legacy_fm_id" })
    .select();
  if (error) {
    console.warn("[bulkUpsertCompanies]", error.message);
    return [];
  }
  return data;
}

// ===================================================================
// RETAILERS — bulk upsert (do migracji FM_CHAINS seed → Supabase)
// ===================================================================

export async function bulkUpsertRetailers(retailers) {
  if (!retailers || !retailers.length) return [];
  const rows = retailers.map((r) => ({
    // retailers.id jest integer (legacy)
    id: typeof r.id === "number" ? r.id : (parseInt(r.id, 10) || null),
    legacy_chain_id: r.id ? String(r.id) : null,
    name: r.name,
    country: r.country || null,
    cats: r.cats || [],
    logo_url: r.logo_url || r.logo || null,
    color: r.color || null,
    bg: r.bg || null,
    initials: r.initials || null,
    buyer_name: r.buyer_name || null,
    buyer_email: r.buyer_email || null,
    buyer_phone: r.buyer_phone || null,
    next_send: r.next_send || null,
  }));
  const { data, error } = await supabase
    .from("retailers")
    .upsert(rows, { onConflict: "id" })
    .select();
  if (error) {
    console.warn("[bulkUpsertRetailers]", error.message);
    return [];
  }
  return data;
}

/**
 * [B2B Round 2.5] Pobierz firmę po legacy_supplier_id (PreConnect format, np. "sup-s1").
 * To NIE to samo co getCompanyByLegacyFmId (która używa "s1" z FM 2026).
 */
export async function getCompanyByLegacySupplierId(legacySupplierId) {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("legacy_supplier_id", String(legacySupplierId))
    .maybeSingle();
  if (error) {
    console.warn("[getCompanyByLegacySupplierId]", error.message);
    return null;
  }
  return data;
}
