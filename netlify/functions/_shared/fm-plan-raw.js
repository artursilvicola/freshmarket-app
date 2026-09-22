/**
 * [feat/fm-plan-send-server-card] Wspólny odczyt danych do kart spotkań B2B.
 * Używany przez fm-plan-data (eksport w panelu / CLI) i fm-plan-send (karta
 * generowana na serwerze dla konkretnego odbiorcy). Jeden loader = ten sam
 * obraz danych w obu ścieżkach; klient nigdy nie dostarcza danych planu.
 *
 * Wymaga klienta Supabase z service role (omija RLS) — autoryzację admina
 * sprawdza wywołująca funkcja, zanim tu trafi.
 *
 * Zwraca { ok, generated_at, plan_updated_at, settings, companies,
 *          supplier_profiles, retailers, prefs, resps } albo { error }.
 * plan_updated_at = znacznik wersji zatwierdzonego planu (fm_plan_private);
 * null, gdy planu nie ma.
 */
export async function loadFmPlanRaw(db) {
  const fail = (scope, error) => ({ error: `${scope}: ${error.message || error}` });

  const settingsQ = await db.from("fm_settings").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (settingsQ.error) return fail("fm_settings", settingsQ.error);
  // [fix/security-hotfix] plan spotkań żyje w fm_plan_private (054); fm_settings.schedule = null
  const planQ = await db.from("fm_plan_private").select("schedule, updated_at").eq("id", 1).maybeSingle();
  if (planQ.error && !/fm_plan_private/i.test(planQ.error.message || "")) return fail("fm_plan_private", planQ.error);
  const plan = planQ.data && planQ.data.schedule ? planQ.data : null;
  const settings = settingsQ.data
    ? { ...settingsQ.data, schedule: plan?.schedule ?? settingsQ.data.schedule ?? null }
    : null;

  const companiesQ = await db
    .from("companies")
    .select("*, company_contacts(name, position, phone, email, role, sort_order)")
    .eq("fm_b2b_enabled", true)
    .neq("account_status", "suspended")
    .neq("account_status", "rejected")
    .order("name");
  if (companiesQ.error) return fail("companies", companiesQ.error);
  const companyIds = (companiesQ.data || []).map((c) => c.id);

  let supplierProfiles = [];
  if (companyIds.length) {
    const profQ = await db
      .from("profiles")
      .select("id, company_id, email, name, phone, position, role, locale, active")
      .in("company_id", companyIds);
    if (profQ.error) return fail("profiles", profQ.error);
    supplierProfiles = profQ.data || [];
  }

  const retailersQ = await db
    .from("retailers")
    .select(`*, buyers:profiles!fk_profiles_retailer(id, role, name, email, phone, position, active, fm26_active, buyer_categories, locale)`)
    .eq("fm26_active", true)
    .order("name");
  if (retailersQ.error) return fail("retailers", retailersQ.error);

  const prefsQ = await db.from("company_target_retailers").select("*");
  if (prefsQ.error) return fail("company_target_retailers", prefsQ.error);
  const respsQ = await db.from("fm_resps").select("*");
  if (respsQ.error) return fail("fm_resps", respsQ.error);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    plan_updated_at: plan?.updated_at || null,
    settings,
    companies: companiesQ.data || [],
    supplier_profiles: supplierProfiles,
    retailers: retailersQ.data || [],
    prefs: prefsQ.data || [],
    resps: respsQ.data || [],
  };
}
