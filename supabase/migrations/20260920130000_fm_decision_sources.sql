-- ============================================================================
-- 20260920130000_fm_decision_sources — źródło decyzji w module FM 2026
-- Kto ustawił wybór sieci dostawcy (company_target_retailers) i decyzję kupca
-- (fm_resps): 'supplier' | 'buyer' | 'admin' | 'automatic'. Oznaczenie
-- „Wybrane przez administratora” widzi WYŁĄCZNIE osoba, w imieniu której admin
-- działał: dostawca — źródła własnych wyborów; kupiec — źródła własnych decyzji;
-- druga strona pary nigdy. Administrator widzi źródło, autora i czas.
--
-- Model: OSOBNA tabela fm_decision_sources (nie kolumny w tabelach wejściowych),
-- bo dostawca czyta fm_resps o sobie (fmr_supplier_about_self) i kupiec czyta
-- company_target_retailers o swojej sieci (ctr_buyer_read) przez `select *`;
-- kolumna w tych tabelach ujawniłaby źródło drugiej stronie albo wymagałaby
-- uprawnień kolumnowych, które psują istniejące odczyty `*`. Tabela ma tylko
-- polityki SELECT; zapisują ją wyłącznie RPC fm_set_company_targets (różnica
-- starej i nowej listy: oznaczane są tylko sieci nowe lub ze zmienioną klasą)
-- oraz trigger na fm_resps (tylko przy zmianie decyzji). Samodzielna zmiana
-- przez użytkownika nadpisuje źródło na 'supplier'/'buyer' — oznaczenie znika.
-- Punktacja algorytmu bez zmian (źródło nie wchodzi do fm-algo).
-- Bez zmian istniejących wyborów: wiersze sprzed migracji nie mają źródła
-- (= brak oznaczenia). Idempotentna. Sesje serwerowe (service_role, SQL Editor,
-- brak auth.uid()) liczą się jako 'admin' z pustym autorem.
-- ROLLBACK (fail-closed, bez kasowania danych): drop trigger
-- trg_fm_resps_decision_source; przywrócić fm_set_company_targets z 055
-- (sekcja „Atomowy zapis całego zestawu wyborów firmy”); tabela może zostać.
-- ============================================================================
begin;

create table if not exists public.fm_decision_sources (
  entity         text        not null check (entity in ('target', 'resp')),
  company_id     uuid        not null references public.companies(id) on delete cascade,
  retailer_id    integer     not null references public.retailers(id) on delete cascade,
  decision       text,                      -- 'star' / 'thumb' (target) albo strefa odpowiedzi kupca (resp)
  source         text        not null check (source in ('supplier', 'buyer', 'admin', 'automatic')),
  source_user_id uuid,                      -- autor (profil); null = sesja serwerowa / SQL
  source_at      timestamptz not null default now(),
  primary key (entity, company_id, retailer_id),
  constraint fm_decision_sources_source_user_fkey foreign key (source_user_id) references public.profiles(id) on delete set null
);
comment on table public.fm_decision_sources is
  'FM 2026: kto ustawił wybór sieci dostawcy (entity=target) / decyzję kupca (entity=resp). Zapis tylko przez RPC/trigger; odczyt: admin wszystko, dostawca własne target, kupiec własne resp.';
create index if not exists idx_fm_decision_sources_retailer on public.fm_decision_sources(entity, retailer_id);

alter table public.fm_decision_sources enable row level security;
revoke all on public.fm_decision_sources from public, anon, authenticated;
grant select on public.fm_decision_sources to authenticated;

drop policy if exists fds_admin_read   on public.fm_decision_sources;
drop policy if exists fds_supplier_own on public.fm_decision_sources;
drop policy if exists fds_buyer_own    on public.fm_decision_sources;
create policy fds_admin_read on public.fm_decision_sources
  for select using (public.is_admin());
create policy fds_supplier_own on public.fm_decision_sources
  for select using (entity = 'target' and public.app_role() = 'supplier'::user_role and company_id = public.app_company_id());
create policy fds_buyer_own on public.fm_decision_sources
  for select using (entity = 'resp' and public.app_role() = 'buyer'::user_role and retailer_id = public.app_retailer_id());

-- Źródło = rola sesji, która wykonuje zapis. Brak auth.uid() (service_role, SQL
-- Editor, pg_cron) = działanie organizatora → 'admin' bez autora.
create or replace function public.fm_decision_source_of_caller()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then return 'admin'; end if;
  select role::text into v_role from public.profiles where id = v_uid;
  if v_role = 'supplier' then return 'supplier'; end if;
  if v_role = 'buyer' then return 'buyer'; end if;
  return 'admin';
end $$;

-- fm_resps: źródło zapisywane przy INSERT i przy UPDATE zmieniającym decyzję
-- (zone/status); zmiana samego position/meta nie zmienia źródła; DELETE czyści.
create or replace function public.fm_resps_decision_source()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.fm_decision_sources
     where entity = 'resp' and company_id = old.supplier_company_id and retailer_id = old.retailer_id;
    return old;
  end if;
  if tg_op = 'UPDATE'
     and new.zone is not distinct from old.zone
     and new.status is not distinct from old.status
     and new.retailer_id = old.retailer_id
     and new.supplier_company_id = old.supplier_company_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.retailer_id <> old.retailer_id or new.supplier_company_id <> old.supplier_company_id) then
    delete from public.fm_decision_sources
     where entity = 'resp' and company_id = old.supplier_company_id and retailer_id = old.retailer_id;
  end if;
  insert into public.fm_decision_sources (entity, company_id, retailer_id, decision, source, source_user_id, source_at)
  values ('resp', new.supplier_company_id, new.retailer_id, coalesce(new.zone, new.status),
          public.fm_decision_source_of_caller(), auth.uid(), clock_timestamp())
  on conflict (entity, company_id, retailer_id) do update
    set decision = excluded.decision, source = excluded.source,
        source_user_id = excluded.source_user_id, source_at = excluded.source_at;
  return new;
end $$;
drop trigger if exists trg_fm_resps_decision_source on public.fm_resps;
create trigger trg_fm_resps_decision_source
  after insert or update or delete on public.fm_resps
  for each row execute function public.fm_resps_decision_source();

-- fm_set_company_targets (055) + różnica list: źródło tylko dla sieci nowych lub ze
-- zmienioną klasą (główna/rezerwowa); sieci usunięte tracą wpis źródła; sieci bez
-- zmian zachowują poprzednie źródło. Reszta ciała identyczna z 055.
create or replace function public.fm_set_company_targets(p_company_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_cid    uuid;
  v_bad    text;
  v_reason text;
  v_before jsonb;
  v_source text;
begin
  if v_uid is null then
    raise exception 'fm_set_company_targets: brak sesji' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'fm_set_company_targets: p_items musi być tablicą';
  end if;
  -- 1) NAJPIERW blokady (review P1/2): wiersz firmy (szereguje zapisy tej firmy;
  --    czeka też na niezatwierdzoną zmianę firmy, np. fm_b2b_enabled), własny profil
  --    (FOR SHARE — czeka na niezatwierdzoną zmianę aktywności) i ustawienia FM
  --    (FOR SHARE — admin zmieniający fazę/termin czeka na zapisy w toku, a zapis
  --    rozpoczęty po zmianie widzi już nową fazę).
  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'fm_set_company_targets: nie ma firmy %', p_company_id;
  end if;
  perform public.fm_inputs_lock_for_write();   -- profil, (sieć), fm_settings FOR SHARE
  -- 2) kontrole PO blokadach, na aktualnym stanie: właściciel, udział, faza/termin
  select role::text, company_id into v_role, v_cid from public.profiles where id = v_uid;
  if v_role is distinct from 'admin' and not (v_role = 'supplier' and v_cid is not null and v_cid = p_company_id) then
    raise exception 'fm_set_company_targets: brak uprawnień do tej firmy' using errcode = '42501';
  end if;
  v_reason := public.fm_inputs_write_check();
  if v_reason is not null then
    raise exception 'fm_inputs_forbidden' using errcode = '42501', hint = v_reason;
  end if;
  if v_role is distinct from 'admin' and public.fm_inputs_are_locked() then
    raise exception 'fm_inputs_locked'
      using errcode = 'P0001',
            hint = 'Etap zbierania wyborów jest zamknięty (algo_phase=' || coalesce(public.fm_current_phase(), '') || ').';
  end if;
  select string_agg(coalesce(e->>'retailer_id', '?'), ',') into v_bad
    from jsonb_array_elements(p_items) e
   where (e->>'retailer_id') !~ '^\d+$'
      or not exists (select 1 from public.retailers r where r.id = (e->>'retailer_id')::integer);
  if v_bad is not null then
    raise exception 'fm_set_company_targets: nieznana sieć: %', v_bad;
  end if;

  -- [decision-source] klasa każdej sieci PRZED zapisem (do wykrycia realnych zmian)
  select coalesce(jsonb_object_agg(retailer_id::text, case when priority >= 1000 then 'star' else 'thumb' end), '{}'::jsonb)
    into v_before
    from public.company_target_retailers where company_id = p_company_id;

  delete from public.company_target_retailers where company_id = p_company_id;
  insert into public.company_target_retailers (company_id, retailer_id, priority, note)
  select p_company_id, rid, max(prio), max(note)
    from (select (e->>'retailer_id')::integer as rid,
                 coalesce(nullif(e->>'priority', '')::integer, 0) as prio,
                 nullif(e->>'note', '') as note
            from jsonb_array_elements(p_items) e) x
   group by rid;

  -- [decision-source] sieci usunięte → bez wpisu; nowe lub ze zmienioną klasą →
  -- źródło = wywołujący (dostawca sam / admin w jego imieniu); bez zmian → bez zmian
  v_source := public.fm_decision_source_of_caller();
  delete from public.fm_decision_sources s
   where s.entity = 'target' and s.company_id = p_company_id
     and not exists (select 1 from public.company_target_retailers t
                      where t.company_id = p_company_id and t.retailer_id = s.retailer_id);
  insert into public.fm_decision_sources (entity, company_id, retailer_id, decision, source, source_user_id, source_at)
  select 'target', p_company_id, t.retailer_id,
         case when t.priority >= 1000 then 'star' else 'thumb' end, v_source, v_uid, clock_timestamp()
    from public.company_target_retailers t
   where t.company_id = p_company_id
     and (v_before ->> t.retailer_id::text) is distinct from (case when t.priority >= 1000 then 'star' else 'thumb' end)
  on conflict (entity, company_id, retailer_id) do update
    set decision = excluded.decision, source = excluded.source,
        source_user_id = excluded.source_user_id, source_at = excluded.source_at;

  -- ślad każdego zapisu (kto, która firma, ile sieci): po wdrożeniu pozwala
  -- potwierdzić, że prawdziwe zapisy dostawców przechodzą, bez kont testowych
  -- widocznych dla uczestników; tłumaczy też różnice przed/po w porównaniu kopii
  -- meta.items = zapisana lista (sieć, priorytet): wpis identyfikuje KTÓRE wybory
  -- zmieniono, nie tylko ile (review Codexa c3c1e66) — bez danych osobowych
  insert into public.audit_log (user_id, action, entity, entity_id, meta)
  values (v_uid, 'fm_targets_saved', 'company', p_company_id::text,
          jsonb_build_object('count', (select count(*) from public.company_target_retailers where company_id = p_company_id),
                             'items', (select coalesce(jsonb_agg(jsonb_build_object('r', retailer_id, 'p', priority) order by retailer_id), '[]'::jsonb)
                                         from public.company_target_retailers where company_id = p_company_id),
                             'role', v_role, 'source', v_source, 'saved_at', clock_timestamp()));

  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.priority desc, t.retailer_id), '[]'::jsonb)
            from public.company_target_retailers t where t.company_id = p_company_id);
end $$;
revoke all on function public.fm_set_company_targets(uuid, jsonb) from public, anon;
grant execute on function public.fm_set_company_targets(uuid, jsonb) to authenticated;

commit;
