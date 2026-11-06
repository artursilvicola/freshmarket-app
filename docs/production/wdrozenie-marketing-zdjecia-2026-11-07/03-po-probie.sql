-- ============================================================================
-- PO PRÓBIE poczty (06.11.2026): zawieszenie kont próbnych na PRODUKCJI (sklyfuvzjikkqerxtulo) — wersja 3
-- (review Codexa 52fc873 P2: każda DOKŁADNA para konto–firma sprawdzana osobno — UUID użytkownika,
--  jego adres, rola supplier, przypisana firma z właściwą nazwą; porównania odporne na NULL;
--  zamienione przypisania albo brak firmy = przerwanie PRZED zmianami; kontrola końcowego stanu kont)
-- Uruchamia ARTUR po zakończeniu próby (dostarczenie → otwarcie → wypis) i po ustawieniu
-- MARKETING_SEND_ENABLED=false. Nic nie kasuje: firmy → suspended + preconnect wyłączony,
-- operatorzy → active=false (silnik marketingu wyklucza je jako „konto nieaktywne”).
-- Wypisy w marketing_suppressions ZOSTAJĄ (dowód próby i trwała blokada adresów).
-- Rejestr wiadomości i zdarzeń zostaje (ślad próby). Kampanię próbną zamknąć w panelu.
-- ============================================================================
begin;

do $$
declare
  r record;
  n_bad integer;
begin
  -- ── 1. KONTROLA DOKŁADNYCH PAR (bez zapisu) ──────────────────────────────────
  -- Dla każdego konta próbnego: auth.users (UUID + adres), profil (rola supplier, adres, firma),
  -- firma (UUID + nazwa). Każda niezgodność, także NULL, przerywa całą transakcję.
  for r in select * from (values
      ('d0ffee00-0000-4000-8000-000000000001'::uuid, 'spiker.artur@gmail.com',    'c0ffee00-0000-4000-8000-000000000001'::uuid, 'Próba marketingu PL (Artur)'),
      ('d0ffee00-0000-4000-8000-000000000002'::uuid, 'artur.silvicola@gmail.com', 'c0ffee00-0000-4000-8000-000000000002'::uuid, 'Marketing trial EN (Artur)')
    ) as t(user_id, email, company_id, company_name)
  loop
    if not exists (select 1 from auth.users u where u.id = r.user_id and lower(u.email) is not distinct from r.email) then
      raise exception 'KONFLIKT: brak konta % z adresem % (albo inny adres pod tym UUID) — przerwano bez zmian', r.user_id, r.email;
    end if;
    if not exists (select 1 from public.companies c where c.id = r.company_id and c.name is not distinct from r.company_name) then
      raise exception 'KONFLIKT: brak firmy % o nazwie „%” (albo inna nazwa pod tym UUID) — przerwano bez zmian', r.company_id, r.company_name;
    end if;
    if not exists (select 1 from public.profiles p
                    where p.id = r.user_id
                      and p.role::text is not distinct from 'supplier'
                      and lower(p.email) is not distinct from r.email
                      and p.company_id is not distinct from r.company_id) then
      raise exception 'KONFLIKT: profil % nie jest dokładnie parą (supplier, %, firma %) — zamienione przypisanie, brak firmy albo inny adres; przerwano bez zmian',
        r.user_id, r.email, r.company_id;
    end if;
  end loop;
  -- adresy próbne nie mogą istnieć pod innymi UUID (inaczej zawieszalibyśmy niewłaściwe konto / zostawili drugie aktywne)
  if exists (select 1 from auth.users where lower(email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')
               and id not in ('d0ffee00-0000-4000-8000-000000000001', 'd0ffee00-0000-4000-8000-000000000002')) then
    raise exception 'KONFLIKT: adres próbny istnieje pod innym UUID — przerwano bez zmian';
  end if;

  -- ── 2. ZAWIESZENIE — tylko dokładne pary potwierdzone wyżej ──────────────────
  update public.companies c
     set account_status = 'suspended', preconnect_enabled = false
   where (c.id = 'c0ffee00-0000-4000-8000-000000000001' and c.name = 'Próba marketingu PL (Artur)')
      or (c.id = 'c0ffee00-0000-4000-8000-000000000002' and c.name = 'Marketing trial EN (Artur)');

  update public.profiles p
     set active = false
    from auth.users u
   where u.id = p.id and p.role::text = 'supplier'
     and ((p.id = 'd0ffee00-0000-4000-8000-000000000001' and lower(u.email) = 'spiker.artur@gmail.com'    and p.company_id = 'c0ffee00-0000-4000-8000-000000000001')
       or (p.id = 'd0ffee00-0000-4000-8000-000000000002' and lower(u.email) = 'artur.silvicola@gmail.com' and p.company_id = 'c0ffee00-0000-4000-8000-000000000002'));

  -- ── 3. KONTROLA KOŃCOWEGO STANU (nie „ile wierszy”, tylko jak wyglądają konta) ─
  select count(*) into n_bad from (values
      ('d0ffee00-0000-4000-8000-000000000001'::uuid, 'c0ffee00-0000-4000-8000-000000000001'::uuid),
      ('d0ffee00-0000-4000-8000-000000000002'::uuid, 'c0ffee00-0000-4000-8000-000000000002'::uuid)
    ) as t(user_id, company_id)
    where not exists (select 1 from public.profiles p join public.companies c on c.id = p.company_id
                       where p.id = t.user_id and c.id = t.company_id
                         and p.active is false and c.account_status = 'suspended' and c.preconnect_enabled is false);
  if n_bad <> 0 then
    raise exception 'KONTROLA KOŃCOWA: % konto/konta próbne nie są zawieszone w całości — przerwano, zmiany wycofane', n_bad;
  end if;
  if (select count(*) from public.companies where account_status = 'suspended' and id in ('c0ffee00-0000-4000-8000-000000000001', 'c0ffee00-0000-4000-8000-000000000002')) <> 2
     or (select count(*) from public.profiles where active is false and id in ('d0ffee00-0000-4000-8000-000000000001', 'd0ffee00-0000-4000-8000-000000000002')) <> 2 then
    raise exception 'KONTROLA KOŃCOWA: oczekiwano dokładnie 2 zawieszonych firm i 2 nieaktywnych operatorów — przerwano, zmiany wycofane';
  end if;
  raise notice 'zawieszono 2 firmy i 2 operatorów próbnych';
end $$;

-- kontrola (oczekiwane: 2 wiersze, firma suspended / preconnect false / operator active=false)
select u.email, p.active as operator_active, c.name as firma, c.account_status, c.preconnect_enabled,
       (select count(*) from public.marketing_suppressions s where s.email = lower(u.email)) as wypisy
  from auth.users u join public.profiles p on p.id = u.id left join public.companies c on c.id = p.company_id
 where lower(u.email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')
 order by u.email;

commit;
