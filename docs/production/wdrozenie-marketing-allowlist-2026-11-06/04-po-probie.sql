-- ============================================================================
-- PO PRÓBIE poczty (06.11.2026): zawieszenie kont próbnych na PRODUKCJI (sklyfuvzjikkqerxtulo).
-- Uruchamia ARTUR po zakończeniu próby (dostarczenie → otwarcie → wypis) i po ustawieniu
-- MARKETING_SEND_ENABLED=false. Nic nie kasuje: firmy → suspended + preconnect wyłączony,
-- operatorzy → active=false (silnik marketingu wyklucza je jako „konto nieaktywne”).
-- Wypisy w marketing_suppressions ZOSTAJĄ (dowód próby i trwała blokada adresów).
-- Rejestr wiadomości i zdarzeń zostaje (ślad próby). Kampanię próbną zamknąć w panelu.
-- ============================================================================
begin;

update public.companies
   set account_status = 'suspended', preconnect_enabled = false
 where id in ('c0ffee00-0000-4000-8000-000000000001', 'c0ffee00-0000-4000-8000-000000000002');

update public.profiles
   set active = false
 where id in ('d0ffee00-0000-4000-8000-000000000001', 'd0ffee00-0000-4000-8000-000000000002');

-- kontrola (oczekiwane: 2 wiersze, firma suspended / preconnect false / operator active=false)
select u.email, p.active as operator_active, c.name as firma, c.account_status, c.preconnect_enabled,
       (select count(*) from public.marketing_suppressions s where s.email = lower(u.email)) as wypisy
  from auth.users u join public.profiles p on p.id = u.id left join public.companies c on c.id = p.company_id
 where lower(u.email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')
 order by u.email;

commit;
