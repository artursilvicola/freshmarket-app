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
export async function getFmSettings() {
  const { data, error } = await supabase
    .from("fm_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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
