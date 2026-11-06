-- KONTROLA (tylko odczyt) — uruchomić PRZED migracją (oczekiwane: sygnatury = 1 stara; param text[] 0) i PO (sygnatury = 1 nowa; param text[] 1)
select 'sygnatury marketing_claim_messages' as co, string_agg(pg_get_function_identity_arguments(p.oid), ' || ') as n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'marketing_claim_messages'
union all select 'liczba sygnatur', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'marketing_claim_messages'
union all select 'sygnatura z p_allowed_emails text[]', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'marketing_claim_messages' and pg_get_function_identity_arguments(p.oid) like '%p_allowed_emails text[]%'
union all select 'service_role ma EXECUTE na nowej sygnaturze', case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'marketing_claim_messages' and pg_get_function_identity_arguments(p.oid) like '%text[]%'
  and has_function_privilege('service_role', p.oid, 'execute')) then '1' else '0' end
union all select 'authenticated bez EXECUTE', case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'marketing_claim_messages' and has_function_privilege('authenticated', p.oid, 'execute')) then '0 (BŁĄD)' else '1' end
union all select 'kampanie w bazie', count(*)::text from public.marketing_campaigns
union all select 'wiadomości w rejestrze', count(*)::text from public.marketing_messages
union all select 'wiadomości claimed/pending', count(*)::text from public.marketing_messages where state in ('pending','claimed');
