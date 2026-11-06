-- ============================================================================
-- PRZED PRÓBĄ mail v2 (07.11.2026): REAKTYWACJA kont próbnych na PRODUKCJI (sklyfuvzjikkqerxtulo)
-- Odwrotność `04-po-probie.sql` v3 z pakietu 06.11, z TĄ SAMĄ kontrolą tożsamości: każda DOKŁADNA para
-- konto–firma (UUID użytkownika, adres, rola supplier, firma z właściwą nazwą), porównania odporne na NULL;
-- każda niezgodność = wyjątek = cała transakcja wycofana, nic nie zmienione.
-- Uruchamia ARTUR po akceptacji wyglądu i „wdrażaj”, PRZED ustawieniem MARKETING_SEND_ENABLED=true.
-- Zmiany: operator → active=true, firma → active + PreConnect włączony, USUNIĘCIE dokładnie dwóch wpisów wypisu
-- (adresy z próby 06.11 wypisały się świadomie; to własne skrzynki Artura — bez tego nowa kampania oznaczy je `suppressed`).
-- Nie dotyka rejestru wiadomości, zdarzeń ani innych wypisów.
-- ============================================================================
begin;

do $$
declare
  r record;
  n_bad integer;
  n_sup integer;
begin
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

  -- ── 3. WYPISY z próby 06.11 — tylko te dwa adresy (własne skrzynki Artura) ───
  delete from public.marketing_suppressions where lower(email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com');
  get diagnostics n_sup = row_count;
  if n_sup > 2 then
    raise exception 'KONTROLA: usunięto by % wpisów wypisu (oczekiwano ≤ 2) — przerwano, zmiany wycofane', n_sup;
  end if;

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
  if exists (select 1 from public.marketing_suppressions where lower(email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')) then
    raise exception 'KONTROLA KOŃCOWA: wypis adresu próbnego nadal istnieje — przerwano, zmiany wycofane';
  end if;
  raise notice 'reaktywowano 2 firmy i 2 operatorów próbnych; usunięto % wpisów wypisu', n_sup;
end $$;

-- kontrola (oczekiwane: 2 wiersze, firma active / preconnect true / operator active=true, wypisy 0)
select u.email, p.active as operator_active, c.name as firma, c.account_status, c.preconnect_enabled,
       (select count(*) from public.marketing_suppressions s where lower(s.email) = lower(u.email)) as wypisy
  from auth.users u join public.profiles p on p.id = u.id join public.companies c on c.id = p.company_id
 where u.id in ('d0ffee00-0000-4000-8000-000000000001', 'd0ffee00-0000-4000-8000-000000000002')
 order by u.email;

commit;
