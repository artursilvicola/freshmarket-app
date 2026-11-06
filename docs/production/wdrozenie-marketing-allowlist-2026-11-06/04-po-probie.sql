-- ============================================================================
-- PO PRÓBIE poczty (06.11.2026): zawieszenie kont próbnych na PRODUKCJI (sklyfuvzjikkqerxtulo) — wersja 2
-- (review Codexa P1: sprzątanie TYLKO potwierdzonych kont tej próby — UUID + adres + firma;
--  niezgodność = przerwanie bez zmian)
-- Uruchamia ARTUR po zakończeniu próby (dostarczenie → otwarcie → wypis) i po ustawieniu
-- MARKETING_SEND_ENABLED=false. Nic nie kasuje: firmy → suspended + preconnect wyłączony,
-- operatorzy → active=false (silnik marketingu wyklucza je jako „konto nieaktywne”).
-- Wypisy w marketing_suppressions ZOSTAJĄ (dowód próby i trwała blokada adresów).
-- Rejestr wiadomości i zdarzeń zostaje (ślad próby). Kampanię próbną zamknąć w panelu.
-- ============================================================================
begin;

do $$
declare
  c1 constant uuid := 'c0ffee00-0000-4000-8000-000000000001';
  c2 constant uuid := 'c0ffee00-0000-4000-8000-000000000002';
  u1 constant uuid := 'd0ffee00-0000-4000-8000-000000000001';
  u2 constant uuid := 'd0ffee00-0000-4000-8000-000000000002';
  n1 constant text := 'Próba marketingu PL (Artur)';
  n2 constant text := 'Marketing trial EN (Artur)';
  e1 constant text := 'spiker.artur@gmail.com';
  e2 constant text := 'artur.silvicola@gmail.com';
  n_companies integer;
  n_profiles integer;
begin
  -- kontrola tożsamości: każdy istniejący wiersz pod naszym UUID musi być naszym kontem próbnym
  if exists (select 1 from public.companies where id in (c1, c2) and name not in (n1, n2)) then
    raise exception 'KONFLIKT: pod UUID firmy próbnej jest inna firma — przerwano bez zmian';
  end if;
  if exists (select 1 from auth.users where id in (u1, u2) and lower(coalesce(email, '')) not in (e1, e2)) then
    raise exception 'KONFLIKT: pod UUID użytkownika próbnego jest inne konto — przerwano bez zmian';
  end if;
  if exists (select 1 from public.profiles where id in (u1, u2)
               and (lower(coalesce(email, '')) not in (e1, e2) or company_id not in (c1, c2))) then
    raise exception 'KONFLIKT: profil pod UUID próbnym ma inny adres/firmę — przerwano bez zmian';
  end if;

  update public.companies
     set account_status = 'suspended', preconnect_enabled = false
   where (id = c1 and name = n1) or (id = c2 and name = n2);
  get diagnostics n_companies = row_count;

  update public.profiles p
     set active = false
    from auth.users u
   where u.id = p.id and p.id = u.id
     and ((p.id = u1 and lower(u.email) = e1 and p.company_id = c1) or (p.id = u2 and lower(u.email) = e2 and p.company_id = c2));
  get diagnostics n_profiles = row_count;

  raise notice 'zawieszono firm: %, operatorów: %', n_companies, n_profiles;
  if n_companies > 2 or n_profiles > 2 then
    raise exception 'KONTROLA: dotknięto więcej niż 2 wierszy (firmy %, operatorzy %) — przerwano, zmiany wycofane', n_companies, n_profiles;
  end if;
end $$;

-- kontrola (oczekiwane: 2 wiersze, firma suspended / preconnect false / operator active=false)
select u.email, p.active as operator_active, c.name as firma, c.account_status, c.preconnect_enabled,
       (select count(*) from public.marketing_suppressions s where s.email = lower(u.email)) as wypisy
  from auth.users u join public.profiles p on p.id = u.id left join public.companies c on c.id = p.company_id
 where lower(u.email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')
 order by u.email;

commit;
