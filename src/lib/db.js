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
// [B2B Round prod-rollout / i18n MVP — P2-2 buyer panel]
// i18n singleton dla bilingual error messages w funkcjach wywoływanych
// z buyer flow (updateOwnBuyerProfile, updateOwnSupplierProfile,
// changeOwnPassword). Klucze w legacy.errors.db.*. Pozostałe funkcje
// db.js mają dalej hardcoded PL — będą bilingualizowane w kolejnych
// branchach P2-N razem ze swoimi konsumentami w PreconnectFM.
import i18n from "../i18n";

const BUYER_CATEGORY_OPTIONS = new Set(["owoce", "warzywa", "kwiaty"]);

function normalizeText(value) {
  if (value == null) return null;
  const next = String(value).trim();
  return next || null;
}

function normalizeEmail(value) {
  const next = normalizeText(value);
  return next ? next.toLowerCase() : null;
}

function normalizeBuyerCategories(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter((v) => BUYER_CATEGORY_OPTIONS.has(v)))];
}

function validateBuyerAccountPayload(payload, { allowRetailerless = false } = {}) {
  const name = normalizeText(payload.name);
  const email = normalizeEmail(payload.email);
  const phone = normalizeText(payload.phone);
  const position = normalizeText(payload.position);
  const retailer_id = Number(payload.retailer_id);
  const buyer_categories = normalizeBuyerCategories(payload.buyer_categories);
  const active = payload.active !== false;
  const fm26_active = !!payload.fm26_active;

  if (!name) throw new Error(i18n.t("legacy:errors.db.buyer_name_required"));
  if (!email) throw new Error(i18n.t("legacy:errors.db.buyer_email_required"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(i18n.t("legacy:errors.db.buyer_email_invalid_format"));
  if (!allowRetailerless && !Number.isInteger(retailer_id)) throw new Error(i18n.t("legacy:errors.db.buyer_retailer_required"));
  if (active && buyer_categories.length === 0) throw new Error(i18n.t("legacy:errors.db.buyer_category_required"));

  return {
    name,
    email,
    phone,
    position,
    retailer_id,
    buyer_categories,
    active,
    fm26_active,
  };
}

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

export async function getCompanyHiddenRetailers(companyId = null) {
  let q = supabase
    .from("company_hidden_retailers")
    .select("company_id, retailer_id, created_at");
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  if (error) {
    // Table exists after migration 037. Until production deploy catches up,
    // keep catalog usable and simply behave as "visible to everyone".
    console.warn("[getCompanyHiddenRetailers]", error.message);
    return [];
  }
  return data || [];
}

export async function setCompanyHiddenRetailers(companyId, retailerIds = []) {
  if (!companyId) throw new Error(i18n.t("legacy:errors.db.company_id_required"));
  const ids = [...new Set((Array.isArray(retailerIds) ? retailerIds : [])
    .map((id) => Number(id))
    .filter(Number.isFinite)
  )];

  const { error: deleteError } = await supabase
    .from("company_hidden_retailers")
    .delete()
    .eq("company_id", companyId);
  if (deleteError) throw deleteError;

  if (!ids.length) return [];

  const rows = ids.map((retailer_id) => ({
    company_id: companyId,
    retailer_id,
  }));
  const { data, error } = await supabase
    .from("company_hidden_retailers")
    .insert(rows)
    .select("company_id, retailer_id, created_at");
  if (error) throw error;
  return data || [];
}

export async function updateCompany(id, patch) {
  // [B2B Round adaptive-company-profile-ai + supplier-onboarding-access-and-communication]
  // Whitelist kolumn. patch może pochodzić ze stanu komponentu z dodatkowymi
  // kluczami legacy (logo, pkg, contacts, certs jako relacje), które nie
  // istnieją w companies. Daj tu explicite nazwy kolumn i tylko te.
  const allowed = [
    "name", "nip", "country", "city", "phone", "website",
    "description", "description_short",
    "types", "categories", "products", "seasonality", "markets",
    "completeness", "logo_url",
    "pkg_plan", "pkg_expiry", "fm_passport_completeness",
    "profile_data", "ai_review_status",
    // Round supplier-onboarding-access-and-communication: trzy warstwy
    // uprawnień + audit
    "account_status", "preconnect_enabled", "fm_b2b_enabled",
    "approved_at", "approved_by", "status_note",
  ];
  const row = {};
  for (const k of allowed) if (k in patch) row[k] = patch[k];
  // Aliasy z legacy shape — łatwiej dla callerów które trzymają stary kształt
  if ("logo" in patch && !("logo_url" in row)) row.logo_url = patch.logo;
  if ("pkg" in patch && !("pkg_plan" in row)) row.pkg_plan = patch.pkg;
  if ("pkgExpiry" in patch && !("pkg_expiry" in row)) row.pkg_expiry = patch.pkgExpiry;
  if (Object.keys(row).length === 0) {
    // Nic do zapisania — zwróć aktualny rekord żeby caller mógł kontynuować.
    return await getCompany(id);
  }
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("companies")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveCompanyContacts(companyId, contacts = []) {
  // [P2-5] Bilingual via legacy.errors.db.company_id_required
  if (!companyId) throw new Error(i18n.t("legacy:errors.db.company_id_required"));

  const { data: existing, error: loadError } = await supabase
    .from("company_contacts")
    .select("id")
    .eq("company_id", companyId);
  if (loadError) throw loadError;

  const existingIds = new Set((existing || []).map((row) => row.id));
  const rows = (Array.isArray(contacts) ? contacts : [])
    .map((contact, index) => ({
      id: contact.id && existingIds.has(contact.id) ? contact.id : undefined,
      company_id: companyId,
      role: normalizeText(contact.role) || "sales",
      name: normalizeText(contact.name),
      position: normalizeText(contact.position),
      phone: normalizeText(contact.phone),
      email: normalizeEmail(contact.email),
      sort_order: index,
    }))
    .filter((contact) => contact.name || contact.position || contact.phone || contact.email);

  const keptExistingIds = new Set(rows.map((row) => row.id).filter(Boolean));
  const idsToDelete = [...existingIds].filter((id) => !keptExistingIds.has(id));

  let saved = [];
  if (rows.length) {
    const { data, error } = await supabase
      .from("company_contacts")
      .upsert(rows, { onConflict: "id" })
      .select()
      .order("sort_order", { ascending: true });
    if (error) throw error;
    saved = data || [];
  }

  await Promise.all(idsToDelete.map(async (id) => {
    const { error } = await supabase
      .from("company_contacts")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }));

  return saved;
}

export async function saveCompanyCerts(companyId, certs = []) {
  if (!companyId) throw new Error(i18n.t("legacy:errors.db.company_id_required"));

  const rows = (Array.isArray(certs) ? certs : [])
    .map((cert) => {
      const type = normalizeText(
        typeof cert === "string"
          ? cert
          : cert?.type || cert?.name
      );
      if (!type) return null;
      return {
        company_id: companyId,
        type,
      };
    })
    .filter(Boolean);

  const { error: deleteError } = await supabase
    .from("company_certs")
    .delete()
    .eq("company_id", companyId);
  if (deleteError) throw deleteError;

  if (!rows.length) return [];

  const { data, error } = await supabase
    .from("company_certs")
    .insert(rows)
    .select();
  if (error) throw error;
  return data || [];
}

// ===================================================================
// RETAILERS
// ===================================================================
function toRetailerDbRow(r = {}) {
  const primaryBuyer = (r.buyers || []).find((b) => b.active !== false) || r.buyers?.[0] || null;
  return {
    id: typeof r.id === "number" ? r.id : (parseInt(r.id, 10) || null),
    legacy_chain_id: r.legacy_chain_id || r.legacyChainId || (r.id ? String(r.id) : null),
    name: r.name,
    country: r.country || null,
    cats: r.cats || [],
    logo_url: r.logo_url || r.logo || null,
    color: r.color || null,
    bg: r.bg || null,
    initials: r.initials || null,
    buyer_name: r.buyer_name || primaryBuyer?.name || r.buyer || null,
    buyer_email: r.buyer_email || primaryBuyer?.email || r.email || null,
    buyer_phone: r.buyer_phone || primaryBuyer?.phone || r.phone || null,
    next_send: r.next_send || r.nextSend || null,
    active: r.active !== false,
    // [B2B Round prod-rollout / admin-toggle-fix] PRIORITY: camelCase z state'u aplikacji
    // (świeża wartość z UI) NAD snake_case (stara wartość z DB join). Wcześniej było
    // `r.fm26_active ?? r.fm26Active` — bug: `??` traktuje `false` z DB jako "valid",
    // więc świeże `fm26Active=true` z toggle nie nadpisywało. Skutek: chainId się
    // zapisywał (bo `||`), ale fm26_active nigdy nie zmieniał wartości.
    fm26_active: !!(r.fm26Active ?? r.fm26_active),
    fm26_chain_id: r.fm26ChainId ?? r.fm26_chain_id ?? null,
    description: r.description || null,
  };
}

export async function getRetailers() {
  const { data, error } = await supabase
    .from("retailers")
    .select(`
      *,
      buyers:profiles!fk_profiles_retailer(
        id,
        role,
        name,
        email,
        phone,
        position,
        retailer_id,
        active,
        fm26_active,
        buyer_categories
      )
    `)
    .order("name");
  if (error) throw error;
  return data;
}

export async function generateCompanyDescriptionAI({ company_id = null, company }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error(i18n.t("legacy:errors.db.no_active_session"));

  const res = await fetch("/.netlify/functions/ai-company-description", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      company_id,
      company,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || i18n.t("legacy:errors.db.ai_company_description_failed"));
  return json;
}

export async function createRetailer(retailer) {
  const row = toRetailerDbRow(retailer);
  const { data, error } = await supabase
    .from("retailers")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRetailer(id, patch) {
  const row = toRetailerDbRow({ id, ...patch });
  delete row.id;
  delete row.legacy_chain_id;
  const { data, error } = await supabase
    .from("retailers")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBuyerProfile(id, patch) {
  // [P2-final-qa post-review] Dev sanity assertion — fires only if a programmer
  // calls updateBuyerProfile(undefined, ...) directly. NIE user-facing (UI calls
  // always pass a real id). Stays PL/dev-only intentionally.
  if (!id) throw new Error("updateBuyerProfile wymaga id");
  const normalized = validateBuyerAccountPayload(patch);
  const row = {
    name: normalized.name,
    email: normalized.email,
    phone: normalized.phone,
    position: normalized.position,
    retailer_id: normalized.retailer_id,
    active: normalized.active,
    fm26_active: normalized.fm26_active,
    buyer_categories: normalized.buyer_categories,
    role: "buyer",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("profiles")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateOwnBuyerProfile(id, patch) {
  // [P2-2] Bilingual via legacy.errors.db.*
  if (!id) throw new Error(i18n.t("legacy:errors.db.buyer_profile_id_required"));
  const row = {
    name: normalizeText(patch.name),
    phone: normalizeText(patch.phone),
    position: normalizeText(patch.position),
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error(i18n.t("legacy:errors.db.buyer_profile_name_required"));
  const { data, error } = await supabase
    .from("profiles")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// [B2B Round profile-supplier-self-edit] Dostawca edytuje wlasne dane konta
// (imie/nazwisko, telefon, stanowisko). Email read-only (zmiana wymaga admina).
// RLS: profiles UPDATE policy zezwala na self-edit gdzie id = auth.uid().
export async function updateOwnSupplierProfile(id, patch) {
  // [P2-2] Bilingual via legacy.errors.db.* — wspólne klucze z buyer
  // (same teksty walidacji "Full name is required"). Caller PageSupplierProfile
  // dalej PL w UI (zostaje na P2-3 supplier flow), ale jeśli kiedyś użyje
  // i18n.language='en' to ten error też będzie po angielsku.
  if (!id) throw new Error(i18n.t("legacy:errors.db.buyer_profile_id_required"));
  const row = {
    name: normalizeText(patch.name),
    phone: normalizeText(patch.phone),
    position: normalizeText(patch.position),
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error(i18n.t("legacy:errors.db.buyer_profile_name_required"));
  const { data, error } = await supabase
    .from("profiles")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// [B2B Round profile-self-password-change] Zmiana hasla przez zalogowanego
// uzytkownika. Wymaga re-auth (sprawdzenie aktualnego hasla via
// signInWithPassword) zeby nie pozwolic na hijack sesji. Po sukcesie wola
// supabase.auth.updateUser z nowym haslem.
export async function changeOwnPassword(currentPassword, newPassword) {
  // [P2-2] Bilingual via legacy.errors.db.password_* — używany przez
  // ChangePasswordSection (buyer + supplier profile sections).
  if (!currentPassword) throw new Error(i18n.t("legacy:errors.db.password_current_required"));
  if (!newPassword || newPassword.length < 8) {
    throw new Error(i18n.t("legacy:errors.db.password_length"));
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData?.session?.user?.email;
  if (!email) throw new Error(i18n.t("legacy:errors.db.password_no_session"));
  const { error: signErr } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signErr) throw new Error(i18n.t("legacy:errors.db.password_current_invalid"));
  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updErr) throw new Error(updErr.message || i18n.t("legacy:errors.db.password_change_failed"));
  return { ok: true };
}

export async function createBuyerAccount({
  email,
  name,
  retailer_id,
  phone = null,
  position = null,
  buyer_categories = [],
  active = true,
  fm26_active = false,
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error(i18n.t("legacy:errors.db.no_active_admin_session"));
  const normalized = validateBuyerAccountPayload({
    email,
    name,
    retailer_id,
    phone,
    position,
    buyer_categories,
    active,
    fm26_active,
  });

  const res = await fetch("/.netlify/functions/admin-create-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: normalized.email,
      role: "buyer",
      name: normalized.name,
      retailer_id: normalized.retailer_id,
      phone: normalized.phone,
      position: normalized.position,
      buyer_categories: normalized.buyer_categories,
      active: normalized.active,
      fm26_active: normalized.fm26_active,
      send_magic_link: true,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || i18n.t("legacy:errors.db.buyer_create_failed"));
  return json;
}

export async function adminUpdateBuyerAccount({
  user_id,
  email,
  name,
  phone = null,
  position = null,
  retailer_id,
  active = true,
  fm26_active = false,
  buyer_categories = [],
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error(i18n.t("legacy:errors.db.no_active_admin_session"));
  if (!user_id) throw new Error(i18n.t("legacy:errors.db.buyer_id_required"));
  const normalized = validateBuyerAccountPayload({
    email,
    name,
    retailer_id,
    phone,
    position,
    buyer_categories,
    active,
    fm26_active,
  });

  const res = await fetch("/.netlify/functions/admin-update-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      user_id,
      role: "buyer",
      email: normalized.email,
      name: normalized.name,
      phone: normalized.phone,
      position: normalized.position,
      retailer_id: normalized.retailer_id,
      active: normalized.active,
      fm26_active: normalized.fm26_active,
      buyer_categories: normalized.buyer_categories,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || i18n.t("legacy:errors.db.buyer_update_failed"));
  return json;
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

// Admin manual package override. The admin company panel edits the real
// active package rows because company_capacity is computed from packages,
// not from companies.pkg_plan alone.
export async function adminSetCompanyPackage(companyId, { planId, qtyTotal }) {
  if (!companyId) throw new Error(i18n.t("legacy:errors.db.company_id_required"));
  const nextPlanId = normalizeText(planId);
  if (!nextPlanId) throw new Error(i18n.t("legacy:errors.db.package_plan_required"));
  const nextQty = Number.parseInt(String(qtyTotal), 10);
  if (!Number.isFinite(nextQty) || nextQty < 0) {
    throw new Error(i18n.t("legacy:errors.db.package_limit_invalid"));
  }

  const { data: plan, error: planError } = await supabase
    .from("package_plans")
    .select("id, qty, price_eur")
    .eq("id", nextPlanId)
    .eq("active", true)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) throw new Error(i18n.t("legacy:errors.db.package_plan_inactive"));

  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${new Date().getFullYear()}-12-31`;
  const { data: activePackages, error: packagesError } = await supabase
    .from("packages")
    .select("id, qty_total, qty_used, expires_at, purchased_at")
    .eq("company_id", companyId)
    .gte("expires_at", today)
    .order("purchased_at", { ascending: false });
  if (packagesError) throw packagesError;

  const packages = activePackages || [];
  const usedTotal = packages.reduce((sum, pkg) => sum + Number(pkg.qty_used || 0), 0);
  if (nextQty < usedTotal) {
    throw new Error(i18n.t("legacy:errors.db.package_limit_below_used_format", { used: usedTotal }));
  }

  const expiryDates = packages
    .map((pkg) => pkg.expires_at)
    .filter(Boolean)
    .sort();
  const expiresAt = expiryDates[expiryDates.length - 1] || yearEnd;

  if (packages.length > 0) {
    const [primary, ...others] = packages;
    const otherUsedTotal = others.reduce((sum, pkg) => sum + Number(pkg.qty_used || 0), 0);

    for (const pkg of others) {
      const used = Number(pkg.qty_used || 0);
      if (Number(pkg.qty_total || 0) !== used) {
        const { error } = await supabase
          .from("packages")
          .update({ qty_total: used })
          .eq("id", pkg.id);
        if (error) throw error;
      }
    }

    const { error: updatePackageError } = await supabase
      .from("packages")
      .update({
        plan: nextPlanId,
        qty_total: nextQty - otherUsedTotal,
        expires_at: expiresAt,
      })
      .eq("id", primary.id);
    if (updatePackageError) throw updatePackageError;
  } else {
    const { error: insertPackageError } = await supabase
      .from("packages")
      .insert({
        company_id: companyId,
        plan: nextPlanId,
        qty_total: nextQty,
        qty_used: 0,
        price_paid: 0,
        currency: "EUR",
        expires_at: expiresAt,
      });
    if (insertPackageError) throw insertPackageError;
  }

  const { error: companyError } = await supabase
    .from("companies")
    .update({ pkg_plan: nextPlanId, pkg_expiry: expiresAt })
    .eq("id", companyId);
  if (companyError) throw companyError;

  const { data: capacity, error: capacityError } = await supabase
    .from("company_capacity")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  if (capacityError) throw capacityError;
  return capacity;
}

// [B2B Round prod-rollout / faza 2] Katalog dostępnych planów pakietów,
// zastępuje hardcoded PRICING_PLANS w PreconnectFM.jsx. Czyta z tabeli
// package_plans (seed w migracji 023).
export async function getPackagePlans() {
  const { data, error } = await supabase
    .from("package_plans")
    .select("*")
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

// [B2B Round prod-rollout / faza 2] View company_capacity zwraca dla każdej
// firmy sumarycznie qty_total/qty_used/qty_remaining z aktywnych pakietów +
// pola statusu (account_status, preconnect_enabled, fm_b2b_enabled). Używane
// przez admin panel firm zamiast LIMITS_INIT (mock).
export async function getAllCompanyCapacity() {
  const { data, error } = await supabase
    .from("company_capacity")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getCompanyCapacity(companyId) {
  const { data, error } = await supabase
    .from("company_capacity")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// [B2B Round prod-rollout / faza 3] PayU integration
// Inicjuje zakup pakietu: woła Netlify function create-payu-order, dostaje
// redirectUri do hosted checkout PayU. Frontend przekierowuje window.location.
export async function createPayuOrder(planId) {
  // [P2-5] Bilingual via legacy.errors.db.payu_*. body?.error pochodzi z PayU
  // / Netlify function i jest passthrough (zwykle EN diagnostyki).
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error(i18n.t("legacy:errors.db.payu_must_be_logged_in"));

  const res = await fetch("/.netlify/functions/create-payu-order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ plan_id: planId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || i18n.t("legacy:errors.db.payu_status_format", { status: res.status }));
  if (!body.redirectUri) throw new Error(i18n.t("legacy:errors.db.payu_no_redirect_uri"));
  return body;
}

// [B2B Round prod-rollout / faza 3] Czyta payu_orders dla supplier (RLS
// dopuszcza widok własnych). Używane przez /zakup-ok do pokazania statusu.
export async function getPayuOrderByExt(extOrderId) {
  const { data, error } = await supabase
    .from("payu_orders")
    .select("id, status, plan_id, price_eur, currency, payu_order_id, ext_order_id, package_id, completed_at, failure_reason, created_at")
    .eq("ext_order_id", extOrderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyPayuOrders(companyId, limit = 20) {
  const { data, error } = await supabase
    .from("payu_orders")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
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

// [B2B Round prod-rollout / branding]
// Pobierz tylko brand_logo_url z fm_settings. Funkcja DOSTĘPNA bez logowania
// (RLS na fm_settings ma public read po migracji 029) — strony Login/Register
// też potrzebują tego URL żeby pokazać brand zamiast placeholder "FM".
//
// Zwraca: { brandLogoUrl: string | null }
export async function getBrandSettings() {
  try {
    const { data, error } = await supabase
      .from("fm_settings")
      .select("brand_logo_url")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { brandLogoUrl: null };
    return { brandLogoUrl: data?.brand_logo_url || null };
  } catch (e) {
    console.warn("[getBrandSettings]", e?.message || e);
    return { brandLogoUrl: null };
  }
}

// Upload pliku logo do storage bucket "brand-assets" i zapis URL w fm_settings.
// Wywołane TYLKO z UI admina (RLS pozwala tylko adminowi).
//
// file: File (z <input type="file">)
// Zwraca: { ok: true, url } albo { ok: false, error }
export async function uploadBrandLogo(file) {
  if (!file) return { ok: false, error: i18n.t("legacy:errors.db.upload_no_file") };
  const ext = (file.name?.split(".").pop() || "png").toLowerCase();
  // Path: brand/logo-<timestamp>.<ext> — timestamp zapobiega cache problem'om
  // w przeglądarce (każdy upload to nowy URL).
  const objectPath = `brand/logo-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("brand-assets")
    .upload(objectPath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || `image/${ext}`,
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { data: pub } = supabase.storage.from("brand-assets").getPublicUrl(objectPath);
  const url = pub?.publicUrl || null;
  if (!url) return { ok: false, error: i18n.t("legacy:errors.db.public_url_fetch_failed") };

  // Zapisz URL w fm_settings (single row). Wykorzystuje istniejący saveFmSettings —
  // pobiera obecne settings, mergeuje brand_logo_url, zapisuje z powrotem.
  const existing = await getFmSettings();
  if (existing?.id) {
    const { error: updErr } = await supabase
      .from("fm_settings")
      .update({ brand_logo_url: url, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updErr) return { ok: false, error: i18n.t("legacy:errors.db.upload_ok_url_failed_format", { detail: updErr.message }) };
  } else {
    const { error: insErr } = await supabase
      .from("fm_settings")
      .insert({ brand_logo_url: url });
    if (insErr) return { ok: false, error: i18n.t("legacy:errors.db.upload_ok_insert_failed_format", { detail: insErr.message }) };
  }
  return { ok: true, url };
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
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    const res = await fetch("/.netlify/functions/upsert-legacy-offer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ offer }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || i18n.t("legacy:errors.db.save_offer_failed_format", { status: res.status }));
    return body?.offer || offer;
  }
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

export async function refundUnreadExpiredLegacySends() {
  const { data, error } = await supabase.rpc("refund_unread_expired_legacy_sends");
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
  // [P2-final-qa post-review] Dev sanity assertion (programmer error if called
  // with missing IDs). NIE user-facing — UI ścieżki zawsze podają oba.
  if (!retailer_id || !supplier_company_id) {
    throw new Error("saveFmResp wymaga retailer_id + supplier_company_id");
  }
  const payload = { retailer_id, supplier_company_id, position, zone, status, meta };

  const { data: upserted, error: upsertError } = await supabase
    .from("fm_resps")
    .upsert(payload, { onConflict: "retailer_id,supplier_company_id" })
    .select()
    .maybeSingle();
  if (!upsertError) return upserted;

  const { data: existingRows, error: existingError } = await supabase
    .from("fm_resps")
    .select("id, created_at")
    .eq("retailer_id", retailer_id)
    .eq("supplier_company_id", supplier_company_id)
    .order("created_at", { ascending: false });
  if (existingError) throw existingError;

  if (existingRows?.length) {
    const keepId = existingRows[0].id;
    const duplicateIds = existingRows.slice(1).map((row) => row.id).filter(Boolean);
    if (duplicateIds.length) {
      const { error: deleteError } = await supabase.from("fm_resps").delete().in("id", duplicateIds);
      if (deleteError) throw deleteError;
    }
    const { data, error } = await supabase
      .from("fm_resps")
      .update({ position, zone, status, meta })
      .eq("id", keepId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("fm_resps")
    .insert(payload)
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
  // [P2-final-qa post-review] Dev sanity assertion — UI zawsze podaje companyId.
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
  // [P2-final-qa post-review] Dev sanity assertion — UI ścieżki podają companyId.
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
  // [P2-final-qa post-review] Dev sanity assertion — UI ścieżki podają oba.
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

export async function deleteFmLateResp({ retailer_id, supplier_legacy_id }) {
  const { error } = await supabase
    .from("fm_late_resps")
    .delete()
    .eq("retailer_id", retailer_id)
    .eq("supplier_legacy_id", supplier_legacy_id);
  if (error) throw error;
}

// ===================================================================
// FM 2026 — MESSAGES (konwersacje admin/supplier/buyer)
// ===================================================================

export async function getFmMessages({ threadKey, fromUserId, toUserId, limit = 100 } = {}) {
  let q = supabase.from("fm_messages").select("*").order("created_at", { ascending: false });
  if (threadKey) q = q.eq("thread_key", threadKey);
  if (fromUserId) q = q.eq("from_user_id", fromUserId);
  if (toUserId) q = q.eq("to_user_id", toUserId);
  q = q.limit(limit);
  const { data, error } = await q;
  if (error) {
    console.warn("[getFmMessages]", error.message);
    return [];
  }
  return data || [];
}

export async function saveFmMessage({ thread_key, from_role, to_role, to_user_id = null, body, data }) {
  const { data: { user } } = await supabase.auth.getUser();
  const row = {
    thread_key,
    from_role,
    from_user_id: user?.id || null,
    to_role,
    to_user_id,
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

// [B2B Round supplier-onboarding-access-and-communication]
// Lista firm oczekujących na zatwierdzenie przez admina. Używana w panelu
// admina (badge w nawigacji + filtr listy firm).
export async function getPendingSupplierCount() {
  const { count, error } = await supabase
    .from("companies")
    .select("*", { count: "exact", head: true })
    .eq("account_status", "pending_review");
  if (error) {
    console.warn("[getPendingSupplierCount]", error.message);
    return 0;
  }
  return count || 0;
}

// [B2B Round supplier-onboarding-access-and-communication]
// Wywołuje zewnętrzny Netlify endpoint do wysłania maila transakcyjnego
// dostawcy. Templates: A registration_accepted, B account_activated,
// C account_rejected/suspended, D offer_to_moderation, E offer_approved,
// F offer_sent_to_retailer, G offer_expired.
// Fire-and-forget — nie blokujemy UI gdy email padnie. Loguje warning
// w konsoli i wraca z {ok:false} bez throwa.
export async function notifySupplier({ template, company_id, payload }) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { ok: false, error: "no_session" };

    const res = await fetch("/.netlify/functions/send-supplier-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ template, company_id, payload: payload || {} }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[notifySupplier]", template, json?.error || res.status);
      return { ok: false, error: json?.error || `HTTP ${res.status}` };
    }
    return json;
  } catch (e) {
    console.warn("[notifySupplier]", template, e?.message || e);
    return { ok: false, error: e?.message };
  }
}

// [B2B Round supplier-onboarding-access-and-communication]
// Self-registration: tworzy nowe konto dostawcy + firmę w stanie
// pending_review. Nie wymaga auth (publiczny endpoint).
export async function selfRegisterSupplier({
  email,
  password,
  company_name,
  country,
  contact_name,
  contact_phone,
  nip,
  accepted_terms_version,
  accepted_privacy_version,
  // [B2B Round prod-rollout / i18n MVP — Krok 3b]
  // Aktualnie wybrany język UI w momencie rejestracji.
  // Backend zapisuje go do profile.locale + auth.users.user_metadata.locale.
  locale,
}) {
  const res = await fetch("/.netlify/functions/register-supplier-self", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      company_name,
      country,
      contact_name,
      contact_phone,
      nip,
      accepted_terms_version,
      accepted_privacy_version,
      locale,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || i18n.t("legacy:errors.db.supplier_register_failed"));
    err.payload = json;
    throw err;
  }
  return json;
}

// [B2B Round pipeline-retailer-email-mvp]
// Wysłanie zbiorczego maila (wielu ofert, jedna sieć) do wszystkich
// aktywnych kupców tej sieci. Endpoint po stronie netlify aktualizuje
// legacy_sends.status='sent' tylko dla send_ids które przeszły jako
// 'approved' i należą do retailer_id.
export async function sendRetailerBatch({ retailer_id, send_ids, dry_run = false }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error(i18n.t("legacy:errors.db.no_active_admin_session"));

  const res = await fetch("/.netlify/functions/send-retailer-batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ retailer_id, send_ids, dry_run }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error || i18n.t("legacy:errors.db.send_email_failed"));
    err.payload = json;
    throw err;
  }
  return json;
}

export async function suggestAdminChatReplyAI({ participant, thread }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error(i18n.t("legacy:errors.db.no_active_admin_session"));

  const res = await fetch("/.netlify/functions/ai-admin-chat-suggestion", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ participant, thread }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || i18n.t("legacy:errors.db.ai_chat_suggestion_failed"));
  return json;
}

export async function analyzeModerationOfferAI(payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error(i18n.t("legacy:errors.db.no_active_admin_session"));

  const res = await fetch("/.netlify/functions/ai-moderation-offer-review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || i18n.t("legacy:errors.db.ai_moderation_review_failed"));
  return json;
}

// ===================================================================
// COMPANIES — bulk upsert (do migracji COMPANIES_DB seed → Supabase)
// ===================================================================

export async function bulkUpsertCompanies(companies) {
  if (!companies || !companies.length) return [];
  // Mapuj legacy fmId → legacy_fm_id w DB
  // [B2B Round adaptive-company-profile-ai] Round-trip nowych pól:
  //   description_short, profile_data (jsonb), ai_review_status. Te pola
  //   są w legacy state jako top-level keys o tej samej nazwie.
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
    description_short: c.description_short || null,
    types: c.types || [],
    categories: c.categories || [],
    products: c.products || null,
    seasonality: c.seasonality || null,
    markets: c.markets || null,
    completeness: c.completeness || 0,
    logo_url: c.logo || null,
    pkg_plan: c.pkg || null,
    pkg_expiry: c.pkgExpiry || null,
    profile_data: c.profile_data && typeof c.profile_data === "object" ? c.profile_data : {},
    ai_review_status: c.ai_review_status || "pending",
    // [B2B Round supplier-onboarding-access-and-communication] Round-trip
    // status pól. Stary kod nie ustawiał ich, więc undefined → DB użyje
    // defaultów z migracji 022. Dla istniejących rekordów backfill już
    // ustawił sensowne wartości.
    account_status: c.account_status || undefined,
    preconnect_enabled: typeof c.preconnect_enabled === "boolean" ? c.preconnect_enabled : undefined,
    fm_b2b_enabled: typeof c.fm_b2b_enabled === "boolean" ? c.fm_b2b_enabled : undefined,
    status_note: c.status_note ?? undefined,
  }));
  const byId = rows.filter((row) => row.id);
  const byLegacyId = rows.filter((row) => !row.id);
  const saved = [];

  if (byId.length) {
    const { data, error } = await supabase
      .from("companies")
      .upsert(byId, { onConflict: "id" })
      .select();
    if (error) {
      console.warn("[bulkUpsertCompanies:id]", error.message);
    } else {
      saved.push(...(data || []));
    }
  }

  if (byLegacyId.length) {
    const { data, error } = await supabase
      .from("companies")
      .upsert(byLegacyId, { onConflict: "legacy_fm_id" })
      .select();
    if (error) {
      console.warn("[bulkUpsertCompanies:legacy_fm_id]", error.message);
    } else {
      saved.push(...(data || []));
    }
  }

  return saved;
}

// ===================================================================
// RETAILERS — bulk upsert (do migracji FM_CHAINS seed → Supabase)
// ===================================================================

export async function bulkUpsertRetailers(retailers) {
  if (!retailers || !retailers.length) return [];
  const rows = retailers.map((r) => toRetailerDbRow(r));
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

// ===================================================================
// ADMIN TEAM MANAGEMENT
// [B2B Round prod-rollout / admin-team]
//
// 2-poziomowy system administratorów (po migracji 031_admin_levels.sql):
//   • SUPER ADMIN — role=admin AND admin_level='super'
//                   Pełen dostęp + może zarządzać zespołem
//   • ZWYKŁY ADMIN — role=admin AND admin_level IS NULL
//                    Pełen dostęp poza zarządzaniem zespołem
//
// Operacje na role/admin_level są chronione przez RLS policy
// `profiles_super_admin_role_change` — tylko super admin może zmienić.
// ===================================================================

// Pobierz listę wszystkich adminów (super + zwykli).
// Zwraca: [{ id, email, name, admin_level, created_at }, ...]
export async function getAllAdmins() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, name, admin_level, created_at")
    .eq("role", "admin")
    .order("admin_level", { ascending: false })  // 'super' przed NULL
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[getAllAdmins]", error.message);
    return [];
  }
  return data || [];
}

// Promuj istniejącego user'a (po emailu) do roli admin.
// Wymaga: super admin uprawnień (RLS).
// User MUSI już istnieć w auth.users — najpierw musi zarejestrować się przez
// normalny flow (zarejestruj dostawcę lub zostać dodany jako buyer).
//
// Zwraca: { ok: true, profile } albo { ok: false, error }
// Lightweight identity map for the admin chat. Admin RLS can read profiles;
// suppliers/buyers never call this helper.
export async function getProfilesForAdminChat() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, name, email, phone, position, company_id, retailer_id, active, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[getProfilesForAdminChat]", error.message);
    return [];
  }
  return data || [];
}

export async function promoteToAdmin(email) {
  if (!email || !email.includes("@")) {
    return { ok: false, error: i18n.t("legacy:errors.db.admin_invalid_email") };
  }
  // Znajdź profile po emailu
  const { data: existing, error: findErr } = await supabase
    .from("profiles")
    .select("id, email, role, admin_level")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();
  if (findErr) return { ok: false, error: findErr.message };
  if (!existing) {
    return {
      ok: false,
      error: i18n.t("legacy:errors.db.admin_promote_user_not_found_format", { email }),
    };
  }
  if (existing.role === "admin") {
    return { ok: false, error: i18n.t("legacy:errors.db.admin_promote_already_admin_format", { email }) };
  }
  // Promuj
  const { data: updated, error: updErr } = await supabase
    .from("profiles")
    .update({ role: "admin", updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .select()
    .single();
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true, profile: updated };
}

// Zdejmij rolę admin z user'a (degraduj do zwykłego user'a — role staje się NULL).
// Wymaga: super admin (RLS).
// NIE pozwalamy zdjąć roli sobie samemu (frontend gating + safety w RLS).
export async function demoteFromAdmin(userId) {
  if (!userId) return { ok: false, error: i18n.t("legacy:errors.db.admin_missing_user_id") };
  const { data: me } = await supabase.auth.getUser();
  if (me?.user?.id === userId) {
    return { ok: false, error: i18n.t("legacy:errors.db.admin_demote_self_forbidden") };
  }
  const { data, error } = await supabase
    .from("profiles")
    .update({ role: null, admin_level: null, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, profile: data };
}

// Toggle super-admin: enabled=true → ustaw 'super', false → NULL (zostaje zwykłym adminem)
// Wymaga: super admin (RLS).
// NIE pozwalamy zdjąć sobie samemu super-admin (żeby nie zostać samemu odciętym).
export async function setSuperAdmin(userId, enabled) {
  if (!userId) return { ok: false, error: i18n.t("legacy:errors.db.admin_missing_user_id") };
  const { data: me } = await supabase.auth.getUser();
  if (me?.user?.id === userId && !enabled) {
    return { ok: false, error: i18n.t("legacy:errors.db.admin_super_demote_self_forbidden") };
  }
  const { data, error } = await supabase
    .from("profiles")
    .update({ admin_level: enabled ? "super" : null, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, profile: data };
}
