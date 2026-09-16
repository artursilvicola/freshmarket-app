-- [fix/security-hotfix] Eksport wejść algorytmu do porównania przed/po wdrożeniu
-- (scripts/fm-inputs-compare.mjs). TYLKO ODCZYT. Bez nazwisk, e-maili i telefonów.
-- SQL Editor → Run → skopiuj wartość kolumny "export" do before.json / after.json.
select json_build_object(
  'exported_at', now(),
  'company_target_retailers', (select coalesce(json_agg(json_build_object(
      'company_id', company_id, 'retailer_id', retailer_id, 'priority', priority, 'note', note)
      order by company_id, retailer_id), '[]'::json) from public.company_target_retailers),
  'fm_resps', (select coalesce(json_agg(json_build_object(
      'retailer_id', retailer_id, 'supplier_company_id', supplier_company_id, 'zone', zone, 'status', status, 'position', position)
      order by retailer_id, supplier_company_id), '[]'::json) from public.fm_resps),
  'companies', (select coalesce(json_agg(json_build_object(
      'id', id, 'fm_selection_confirmed_at', fm_selection_confirmed_at, 'fm_b2b_enabled', fm_b2b_enabled,
      'fm_b2b_tier', fm_b2b_tier, 'fm_b2b_packages', fm_b2b_packages, 'account_status', account_status)
      order by id), '[]'::json) from public.companies where fm_b2b_enabled),
  'profiles', (select coalesce(json_agg(json_build_object(
      'id', id, 'role', role, 'company_id', company_id, 'retailer_id', retailer_id, 'active', active, 'fm26_active', fm26_active)
      order by id), '[]'::json) from public.profiles where role in ('supplier', 'buyer')),
  'retailers', (select coalesce(json_agg(json_build_object(
      'id', id, 'active', active, 'fm26_active', fm26_active, 'fm26_chain_id', fm26_chain_id, 'fm_gate', fm_gate)
      order by id), '[]'::json) from public.retailers),
  'fm_settings', (select coalesce(json_agg(json_build_object(
      'id', id, 'algo_phase', algo_phase, 'selection_deadline', to_jsonb(s)->>'selection_deadline')), '[]'::json)
      from public.fm_settings s)
) as export;
