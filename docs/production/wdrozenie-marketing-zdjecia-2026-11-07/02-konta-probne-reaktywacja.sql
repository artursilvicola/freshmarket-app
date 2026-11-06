-- ============================================================================
-- PRZED PRÓBĄ mail v2: REAKTYWACJA kont próbnych na PRODUKCJI (sklyfuvzjikkqerxtulo) — wersja 2
-- Odwrotność `03-po-probie.sql`, z TĄ SAMĄ kontrolą tożsamości: każda DOKŁADNA para konto–firma, porównania odporne na NULL,
-- każda niezgodność = wyjątek = cała transakcja wycofana.
--
-- WARUNEK: Artur napisał w czacie dokładnie zdanie z `v_consent`. Dopiero wtedy `v_consent_confirmed` zmienia się na true
-- i uzupełnia się `v_consent_source`. Samo „wdrażaj” nie cofa wypisu (review Codexa 07.11). Przy false skrypt nic nie zmienia.
-- Wypisy z 06.11 NIE znikają bez śladu: marketing_lift_suppression() zapisuje kopię wypisu i zgodę w marketing_suppression_lifts.
-- Działa tylko na dwa adresy próbne. Lista MARKETING_SEND_ALLOWLIST nadal blokuje wszystkich pozostałych odbiorców.
-- ============================================================================
begin;

do $$
declare
  v_consent_confirmed boolean := false;  -- true dopiero po zdaniu Artura w czacie
  v_consent text := 'Zgadzam się ponownie otrzymać testowe maile na spiker.artur@gmail.com i artur.silvicola@gmail.com.';
  v_consent_source text := 'UZUPEŁNIĆ: czat Claude Code, data i godzina zgody';
  r record;
  n_bad integer;
begin
  if v_consent_confirmed is not true then
    raise exception 'BRAK POTWIERDZONEJ ZGODY: ustaw v_consent_confirmed dopiero po zdaniu Artura w czacie — przerwano bez zmian';
  end if;
  if v_consent_source like 'UZUPEŁNIĆ%' then
    raise exception 'BRAK ŹRÓDŁA ZGODY: uzupełnij v_consent_source — przerwano bez zmian';
  end if;

  -- ── 1. KONTROLA DOKŁADNYCH PAR (bez zapisu) ──────────────────────────────────
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
  if exists (select 1 from auth.users where lower(email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')
               and id not in ('d0ffee00-0000-4000-8000-000000000001', 'd0ffee00-0000-4000-8000-000000000002')) then
    raise exception 'KONFLIKT: adres próbny istnieje pod innym UUID — przerwano bez zmian';
  end if;

  -- ── 2. REAKTYWACJA — tylko dokładne pary potwierdzone wyżej ──────────────────
  update public.companies c
     set account_status = 'active', preconnect_enabled = true
   where (c.id = 'c0ffee00-0000-4000-8000-000000000001' and c.name = 'Próba marketingu PL (Artur)')
      or (c.id = 'c0ffee00-0000-4000-8000-000000000002' and c.name = 'Marketing trial EN (Artur)');

  update public.profiles p
     set active = true
    from auth.users u
   where u.id = p.id and p.role::text = 'supplier'
     and ((p.id = 'd0ffee00-0000-4000-8000-000000000001' and lower(u.email) = 'spiker.artur@gmail.com'    and p.company_id = 'c0ffee00-0000-4000-8000-000000000001')
       or (p.id = 'd0ffee00-0000-4000-8000-000000000002' and lower(u.email) = 'artur.silvicola@gmail.com' and p.company_id = 'c0ffee00-0000-4000-8000-000000000002'));

  -- ── 3. ZNIESIENIE WYPISÓW z zachowaniem historii i zgody ─────────────────────
  perform public.marketing_lift_suppression('spiker.artur@gmail.com',    v_consent, v_consent_source, 'Artur Stasiak (właściciel skrzynki)');
  perform public.marketing_lift_suppression('artur.silvicola@gmail.com', v_consent, v_consent_source, 'Artur Stasiak (właściciel skrzynki)');

  -- ── 4. KONTROLA KOŃCOWEGO STANU ────────────────────────────────────────────
  select count(*) into n_bad from (values
      ('d0ffee00-0000-4000-8000-000000000001'::uuid, 'c0ffee00-0000-4000-8000-000000000001'::uuid),
      ('d0ffee00-0000-4000-8000-000000000002'::uuid, 'c0ffee00-0000-4000-8000-000000000002'::uuid)
    ) as t(user_id, company_id)
    where not exists (select 1 from public.profiles p join public.companies c on c.id = p.company_id
                       where p.id = t.user_id and c.id = t.company_id
                         and p.active is true and c.account_status = 'active' and c.preconnect_enabled is true);
  if n_bad <> 0 then
    raise exception 'KONTROLA KOŃCOWA: % konto/konta próbne nie są aktywne w całości — przerwano, zmiany wycofane', n_bad;
  end if;
  if exists (select 1 from public.marketing_suppressions where email in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')) then
    raise exception 'KONTROLA KOŃCOWA: wypis adresu próbnego nadal istnieje — przerwano, zmiany wycofane';
  end if;
  raise notice 'reaktywowano 2 firmy i 2 operatorów próbnych; zgoda zapisana w marketing_suppression_lifts';
end $$;

-- kontrola (oczekiwane: 2 wiersze, firma active / preconnect true / operator active=true, wypisy 0, zapisane zgody >= 1)
select u.email, p.active as operator_active, c.name as firma, c.account_status, c.preconnect_enabled,
       (select count(*) from public.marketing_suppressions s where s.email = lower(u.email)) as wypisy,
       (select count(*) from public.marketing_suppression_lifts l where l.email = lower(u.email)) as zapisane_zgody
  from auth.users u join public.profiles p on p.id = u.id join public.companies c on c.id = p.company_id
 where u.id in ('d0ffee00-0000-4000-8000-000000000001', 'd0ffee00-0000-4000-8000-000000000002')
 order by u.email;

commit;
