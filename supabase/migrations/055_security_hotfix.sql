-- ============================================================================
-- 055_security_hotfix.sql — hotfix bezpieczeństwa B2B (audyt Codexa 16.09.2026,
-- korekty 1–6 i review 7d90826 — P1 ×4). Widoki są w osobnej, pilnej 054.
-- Szczegóły i plan testów:
-- docs/production/NOTATKA_DLA_CODEX_2026-09-16_HOTFIX_BEZPIECZENSTWA.md
-- ============================================================================
-- Zakres:
--  2. kontakty kupców (retailers.buyer_name/email/phone) → tabela retailer_contacts
--     (RLS: tylko admin); kolumny w retailers zawsze puste (most zgodności);
--     jawny zapis/kasowanie przez admin_set_retailer_contact(); most nie kasuje
--     niewysłanych pól (review P1)
--  3. plan spotkań (fm_settings.schedule) → fm_plan_private (RLS: tylko admin)
--     + RPC fm_my_schedule(): admin = całość, dostawca = własne wiersze (aktywny
--     profil, firma active + fm_b2b_enabled), kupiec = spotkania własnej sieci
--     (aktywny profil, sieć active + fm26_active), obie role dopiero po publikacji
--  4. stare polityki z 002 (dostawca czytał wszystkie fm_prefs; duplikaty)
--  5. triggery: kolumny administracyjne profiles / companies NIE do zmiany przez
--     dostawcę/kupcę — trigger przywraca poprzednią wartość zamiast rzucać błędem;
--     self-INSERT profilu bez admina = zwykły dostawca bez firmy/sieci (review P1)
--  6. storage: company-logos / offer-photos tylko we własnym folderze
--  7. zapis wyborów jako JEDNA transakcja (RPC fm_set_company_targets, review P1),
--     blokada zapisów wyborów/odpowiedzi po zamknięciu fazy LUB po terminie
--     fm_settings.selection_deadline — na poziomie bazy;
--     kopia wejść: select fm_backup_inputs('etykieta')
--  8. legacy_sends.data bez listy adresów e-mail kupców (zostaje liczba)
--
-- Idempotentna (if not exists / drop if exists / create or replace); ponowne
-- zastosowanie nie kasuje kontaktów ani planu.
-- NIE zmienia wyborów uczestników, NIE publikuje planu, NIE wysyła maili.
-- Wymaga 001 (is_admin, app_company_id, app_retailer_id) i 054.
-- ============================================================================
begin;

-- ─── 2. Kontakty kupców poza zasięgiem dostawcy ──────────────────────────────
create table if not exists public.retailer_contacts (
  retailer_id integer primary key references public.retailers(id) on delete cascade,
  buyer_name  text,
  buyer_email text,
  buyer_phone text,
  updated_at  timestamptz not null default now()
);
alter table public.retailer_contacts enable row level security;
drop policy if exists retailer_contacts_admin_all on public.retailer_contacts;
create policy retailer_contacts_admin_all on public.retailer_contacts
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.retailer_contacts from anon;
grant select, insert, update, delete on public.retailer_contacts to authenticated; -- RLS = tylko admin

-- kopia istniejących kontaktów (przy ponownym uruchomieniu kolumny są już puste → nic)
insert into public.retailer_contacts (retailer_id, buyer_name, buyer_email, buyer_phone)
select id, nullif(buyer_name, ''), nullif(buyer_email, ''), nullif(buyer_phone, '')
  from public.retailers
 where coalesce(buyer_name, '') <> '' or coalesce(buyer_email, '') <> '' or coalesce(buyer_phone, '') <> ''
on conflict (retailer_id) do update
  set buyer_name  = coalesce(excluded.buyer_name,  public.retailer_contacts.buyer_name),
      buyer_email = coalesce(excluded.buyer_email, public.retailer_contacts.buyer_email),
      buyer_phone = coalesce(excluded.buyer_phone, public.retailer_contacts.buyer_phone),
      updated_at  = now();

-- Most zgodności: stary bundle / druga aplikacja mogą nadal przysłać buyer_* w
-- wierszu retailers → wartości NIEPUSTE trafiają do retailer_contacts, pola
-- niewysłane (null/'') ZOSTAJĄ bez zmian, a kolumny retailers są zerowane.
-- Świadome wyczyszczenie pola = admin_set_retailer_contact() niżej.
create or replace function public.retailer_contacts_merge(p_retailer_id integer, p_name text, p_email text, p_phone text)
returns void language sql security definer set search_path = public as $$
  insert into public.retailer_contacts (retailer_id, buyer_name, buyer_email, buyer_phone)
  values (p_retailer_id, nullif(p_name, ''), nullif(p_email, ''), nullif(p_phone, ''))
  on conflict (retailer_id) do update
    set buyer_name  = coalesce(excluded.buyer_name,  public.retailer_contacts.buyer_name),
        buyer_email = coalesce(excluded.buyer_email, public.retailer_contacts.buyer_email),
        buyer_phone = coalesce(excluded.buyer_phone, public.retailer_contacts.buyer_phone),
        updated_at  = now()
$$;
revoke all on function public.retailer_contacts_merge(integer, text, text, text) from public, anon, authenticated;

create or replace function public.retailers_route_buyer_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(new.buyer_name, '') is not null or nullif(new.buyer_email, '') is not null or nullif(new.buyer_phone, '') is not null then
    perform public.retailer_contacts_merge(new.id, new.buyer_name, new.buyer_email, new.buyer_phone);
  end if;
  new.buyer_name := null; new.buyer_email := null; new.buyer_phone := null;
  return new;
end $$;

-- INSERT: wiersz retailers musi już istnieć dla klucza obcego → after insert
create or replace function public.retailers_clear_buyer_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(new.buyer_name, '') is not null or nullif(new.buyer_email, '') is not null or nullif(new.buyer_phone, '') is not null then
    perform public.retailer_contacts_merge(new.id, new.buyer_name, new.buyer_email, new.buyer_phone);
    update public.retailers set buyer_name = null, buyer_email = null, buyer_phone = null where id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists trg_retailers_route_buyer_contacts on public.retailers;
create trigger trg_retailers_route_buyer_contacts
  before update on public.retailers
  for each row execute function public.retailers_route_buyer_contacts();
drop trigger if exists trg_retailers_clear_buyer_contacts on public.retailers;
create trigger trg_retailers_clear_buyer_contacts
  after insert on public.retailers
  for each row execute function public.retailers_clear_buyer_contacts();

update public.retailers set buyer_name = null, buyer_email = null, buyer_phone = null
 where buyer_name is not null or buyer_email is not null or buyer_phone is not null;

-- Jawny zapis kontaktu przez admina: wartości ustawiane DOKŁADNIE (null/'' = wyczyść
-- pole); wszystkie trzy puste = usunięcie kontaktu. Zwraca zapisany wiersz albo null.
create or replace function public.admin_set_retailer_contact(p_retailer_id integer, p_name text, p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.retailer_contacts;
begin
  if not public.is_admin() then
    raise exception 'admin_set_retailer_contact: tylko administrator' using errcode = '42501';
  end if;
  if not exists (select 1 from public.retailers where id = p_retailer_id) then
    raise exception 'admin_set_retailer_contact: nie ma sieci %', p_retailer_id;
  end if;
  if nullif(p_name, '') is null and nullif(p_email, '') is null and nullif(p_phone, '') is null then
    delete from public.retailer_contacts where retailer_id = p_retailer_id;
    return null;
  end if;
  insert into public.retailer_contacts (retailer_id, buyer_name, buyer_email, buyer_phone)
  values (p_retailer_id, nullif(p_name, ''), nullif(p_email, ''), nullif(p_phone, ''))
  on conflict (retailer_id) do update
    set buyer_name = excluded.buyer_name, buyer_email = excluded.buyer_email,
        buyer_phone = excluded.buyer_phone, updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke all on function public.admin_set_retailer_contact(integer, text, text, text) from public, anon;
grant execute on function public.admin_set_retailer_contact(integer, text, text, text) to authenticated;

-- ─── 3. Plan spotkań poza zasięgiem dostawcy/kupca ───────────────────────────
create table if not exists public.fm_plan_private (
  id         smallint primary key default 1 check (id = 1),
  schedule   jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.fm_plan_private enable row level security;
drop policy if exists fm_plan_private_admin_all on public.fm_plan_private;
create policy fm_plan_private_admin_all on public.fm_plan_private
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.fm_plan_private from anon;
grant select, insert, update, delete on public.fm_plan_private to authenticated; -- RLS = tylko admin

-- przeniesienie ewentualnego planu (na produkcji 16.09: schedule = {} → nic;
-- ponowne uruchomienie: kolumna jest już null → nic)
insert into public.fm_plan_private (id, schedule)
select 1, s.schedule from public.fm_settings s
 where s.schedule is not null and s.schedule <> '{}'::jsonb
 order by s.updated_at desc nulls last limit 1
on conflict (id) do nothing;

-- stary bundle / saveFmSchedule nadal pisze do fm_settings.schedule → trigger
-- przenosi plan do fm_plan_private, w fm_settings zostaje null
create or replace function public.fm_settings_route_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.schedule is not null and new.schedule <> '{}'::jsonb then
    insert into public.fm_plan_private (id, schedule, updated_at, updated_by)
    values (1, new.schedule, now(), auth.uid())
    on conflict (id) do update
      set schedule = excluded.schedule, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  new.schedule := null;
  return new;
end $$;
drop trigger if exists trg_fm_settings_route_schedule on public.fm_settings;
create trigger trg_fm_settings_route_schedule
  before insert or update on public.fm_settings
  for each row execute function public.fm_settings_route_schedule();

update public.fm_settings set schedule = null where schedule is not null;

-- bieżąca faza bez zależności od RLS fm_settings
create or replace function public.fm_current_phase()
returns text language sql security definer stable set search_path = public as $$
  select lower(coalesce(algo_phase, '')) from public.fm_settings order by updated_at desc nulls last limit 1
$$;
revoke all on function public.fm_current_phase() from public;
grant execute on function public.fm_current_phase() to authenticated, anon;

-- Plan dla zalogowanego: admin → całość (res/nums/cs/cq/warnings);
-- dostawca → tylko własne klucze res/nums (company_id, legacy_fm_id,
-- legacy_supplier_id), pod warunkiem: profil aktywny, firma account_status
-- active i fm_b2b_enabled (jak filtr fmSuppliers w aplikacji);
-- kupiec → tylko dostawcy z jego siecią w m, m = [własny chain], nums tylko
-- własnego chainu, bez ocen r; warunek: profil aktywny, sieć active i fm26_active.
-- Dostawca/kupiec dostają null, dopóki plan nie jest opublikowany.
create or replace function public.fm_my_schedule()
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_sched jsonb;
  v_phase text;
  v_keys  text[];
  v_chain text;
  v_res   jsonb := '{}'::jsonb;
  v_nums  jsonb := '{}'::jsonb;
  k       text;
  entry   jsonb;
begin
  if v_uid is null then return null; end if;
  select role::text into v_role from public.profiles where id = v_uid;
  select schedule into v_sched from public.fm_plan_private where id = 1;
  if v_sched is null or v_sched = '{}'::jsonb then return null; end if;
  if v_role = 'admin' then return v_sched; end if;

  v_phase := coalesce(public.fm_current_phase(), '');
  if v_phase not in ('published', 'final_published', 'event_day') then return null; end if;

  if v_role = 'supplier' then
    select array_remove(array[c.id::text, c.legacy_fm_id::text, c.legacy_supplier_id::text], null)
      into v_keys
      from public.profiles p join public.companies c on c.id = p.company_id
     where p.id = v_uid
       and p.active is distinct from false
       and coalesce(c.account_status, 'active') = 'active'
       and c.fm_b2b_enabled is true;
    if v_keys is null then return null; end if;
    foreach k in array v_keys loop
      if (v_sched->'res') ? k then v_res := v_res || jsonb_build_object(k, v_sched->'res'->k); end if;
      if (v_sched->'nums') ? k then v_nums := v_nums || jsonb_build_object(k, v_sched->'nums'->k); end if;
    end loop;
    return jsonb_build_object('res', v_res, 'nums', v_nums, 'scope', 'supplier');
  end if;

  if v_role = 'buyer' then
    -- własny przełącznik udziału kupca (profiles.fm26_active) + sieć aktywna i w FM
    select r.fm26_chain_id into v_chain
      from public.profiles p join public.retailers r on r.id = p.retailer_id
     where p.id = v_uid
       and p.active is distinct from false
       and p.fm26_active is true
       and r.active is distinct from false
       and r.fm26_active is true;
    if v_chain is null then return null; end if;
    for k, entry in select * from jsonb_each(coalesce(v_sched->'res', '{}'::jsonb)) loop
      if jsonb_typeof(entry->'m') = 'array' and (entry->'m') ? v_chain then
        v_res := v_res || jsonb_build_object(k, jsonb_build_object('m', jsonb_build_array(v_chain)));
        if (v_sched->'nums'->k) ? v_chain then
          v_nums := v_nums || jsonb_build_object(k, jsonb_build_object(v_chain, v_sched->'nums'->k->v_chain));
        end if;
      end if;
    end loop;
    return jsonb_build_object('res', v_res, 'nums', v_nums, 'scope', 'buyer');
  end if;
  return null;
end $$;
revoke all on function public.fm_my_schedule() from public;
grant execute on function public.fm_my_schedule() to authenticated;

-- ─── 3b. Moduł kolejek: import planu z fm_plan_private ───────────────────────
-- fm_queue_open_day (053) czytał plan z fm_settings.schedule — po 055 ta kolumna
-- jest zawsze null. Kopia funkcji z 053 ze zmienionym ŹRÓDŁEM planu (LEFT JOIN
-- fm_plan_private); faza i data nadal z fm_settings, reszta logiki bez zmian.
-- Uwaga dla przyszłych zmian: edytować tu, nie w 053.
CREATE OR REPLACE FUNCTION public.fm_queue_open_day(p_event_date date, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_sched jsonb; v_ret public.retailers; v_group uuid; v_test boolean;
  v_groups int := 0; v_inserted int := 0; v_updated int := 0; v_skipped_groups int := 0;
  r record; v_cnt int; v_match int; v_catchall int; v_existing public.fm_queue_meetings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT test_mode INTO v_test FROM public.fm_queue_settings WHERE event_date = p_event_date;
  IF COALESCE(v_test, false) THEN
    -- proba generalna: najnowszy OPUBLIKOWANY plan niezaleznie od daty (nie ruszamy fm_settings produkcji)
    SELECT p.schedule INTO v_sched FROM public.fm_settings s
      LEFT JOIN public.fm_plan_private p ON p.id = 1
      WHERE s.algo_phase IN ('published','final_published','event_day') ORDER BY s.updated_at DESC LIMIT 1;
  ELSE
    SELECT p.schedule INTO v_sched FROM public.fm_settings s
      LEFT JOIN public.fm_plan_private p ON p.id = 1
      WHERE s.event_date = p_event_date AND s.algo_phase IN ('published','final_published','event_day')
      ORDER BY s.updated_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_PLAN_NOT_PUBLISHED' USING ERRCODE = 'P0002'; END IF;
  IF v_sched IS NULL OR v_sched->'nums' IS NULL OR jsonb_typeof(v_sched->'nums') <> 'object' THEN RAISE EXCEPTION 'FM_NO_SCHEDULE' USING ERRCODE = 'P0002'; END IF;

  -- domyslne grupy/stanowiska dla sieci FM bez konfiguracji
  FOR v_ret IN SELECT * FROM public.retailers WHERE fm26_active AND fm26_chain_id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.fm_queue_groups WHERE event_date = p_event_date AND retailer_id = v_ret.id) THEN
      INSERT INTO public.fm_queue_groups (event_date, retailer_id, gate) VALUES (p_event_date, v_ret.id, v_ret.fm_gate) RETURNING id INTO v_group;
      INSERT INTO public.fm_stations (queue_group_id, idx) VALUES (v_group, 1);
      v_groups := v_groups + 1;
    END IF;
  END LOOP;
  INSERT INTO public.fm_queue_settings (event_date, day_opened_at, updated_by) VALUES (p_event_date, now(), v_uid)
    ON CONFLICT (event_date) DO UPDATE SET day_opened_at = COALESCE(public.fm_queue_settings.day_opened_at, now()), updated_by = v_uid;

  -- blokujemy wszystkie grupy dnia (import nie moze sciac sie z operatorem)
  PERFORM 1 FROM public.fm_queue_groups WHERE event_date = p_event_date ORDER BY id FOR UPDATE;

  DROP TABLE IF EXISTS pg_temp.t_imp;
  CREATE TEMP TABLE pg_temp.t_imp (rid serial PRIMARY KEY, sid text, cid text, nr int, company_id uuid, group_id uuid, reason text) ON COMMIT DROP;
  INSERT INTO pg_temp.t_imp (sid, cid, nr)
    SELECT s.key, c.key, NULLIF(c.value, '')::int
    FROM jsonb_each(v_sched->'nums') s, jsonb_each_text(s.value) c
    WHERE jsonb_typeof(s.value) = 'object';
  UPDATE pg_temp.t_imp SET reason = 'bad_nr' WHERE nr IS NULL OR nr <= 0;
  UPDATE pg_temp.t_imp t SET company_id = c.id FROM public.companies c WHERE t.reason IS NULL AND (c.id::text = t.sid OR c.legacy_fm_id = t.sid);
  UPDATE pg_temp.t_imp SET reason = 'missing_supplier' WHERE reason IS NULL AND company_id IS NULL;

  -- routing do grupy: 1 grupa -> ona; split -> dokladnie jedna zgodna kategoria,
  -- w przeciwnym razie jedyna grupa bez kategorii (catch-all); inaczej 'unrouted'
  FOR r IN SELECT t.rid, t.cid, t.company_id FROM pg_temp.t_imp t WHERE t.reason IS NULL ORDER BY t.rid LOOP
    SELECT count(*) INTO v_cnt FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id
      WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid;
    IF v_cnt = 0 THEN UPDATE pg_temp.t_imp SET reason = 'missing_chain' WHERE rid = r.rid; CONTINUE; END IF;
    IF v_cnt = 1 THEN
      UPDATE pg_temp.t_imp SET group_id = (SELECT g.id FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid) WHERE rid = r.rid;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_match FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id JOIN public.companies c ON c.id = r.company_id
      WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) > 0 AND c.categories && g.categories;
    IF v_match = 1 THEN
      UPDATE pg_temp.t_imp SET group_id = (SELECT g.id FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id JOIN public.companies c ON c.id = r.company_id
        WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) > 0 AND c.categories && g.categories) WHERE rid = r.rid;
      CONTINUE;
    END IF;
    IF v_match = 0 THEN
      SELECT count(*) INTO v_catchall FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id
        WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) = 0;
      IF v_catchall = 1 THEN
        UPDATE pg_temp.t_imp SET group_id = (SELECT g.id FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id
          WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) = 0) WHERE rid = r.rid;
        CONTINUE;
      END IF;
    END IF;
    UPDATE pg_temp.t_imp SET reason = 'unrouted' WHERE rid = r.rid;  -- decyzja admina (split bez jednoznacznej kategorii)
  END LOOP;

  -- grupy juz zaimportowane (stan SPRZED importu) -> pomijane bez p_force
  IF NOT p_force THEN
    UPDATE pg_temp.t_imp t SET reason = 'group_already_imported'
      WHERE t.reason IS NULL AND EXISTS (SELECT 1 FROM public.fm_queue_meetings m WHERE m.queue_group_id = t.group_id AND m.source = 'plan');
    SELECT count(DISTINCT group_id) INTO v_skipped_groups FROM pg_temp.t_imp WHERE reason = 'group_already_imported';
  END IF;

  -- wstawianie / synchronizacja
  FOR r IN SELECT t.* FROM pg_temp.t_imp t WHERE t.reason IS NULL ORDER BY t.group_id, t.nr LOOP
    -- firma ma juz spotkanie w INNEJ grupie tej samej sieci (zmiana routingu split) -> decyzja admina
    IF EXISTS (SELECT 1 FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g2 ON g2.id = m.queue_group_id
               JOIN public.fm_queue_groups g1 ON g1.id = r.group_id
               WHERE m.company_id = r.company_id AND m.queue_group_id <> r.group_id AND g2.retailer_id = g1.retailer_id AND g2.event_date = g1.event_date) THEN
      UPDATE pg_temp.t_imp SET reason = 'group_changed' WHERE rid = r.rid; CONTINUE;
    END IF;
    SELECT * INTO v_existing FROM public.fm_queue_meetings WHERE queue_group_id = r.group_id AND company_id = r.company_id;
    IF FOUND THEN
      IF v_existing.nr = r.nr THEN UPDATE pg_temp.t_imp SET reason = 'unchanged' WHERE rid = r.rid; CONTINUE; END IF;
      IF v_existing.status <> 'planned' THEN UPDATE pg_temp.t_imp SET reason = 'locked_status' WHERE rid = r.rid; CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.queue_group_id = r.group_id AND x.nr = r.nr AND x.id <> v_existing.id) THEN
        UPDATE pg_temp.t_imp SET reason = 'nr_conflict' WHERE rid = r.rid; CONTINUE;
      END IF;
      UPDATE public.fm_queue_meetings SET nr = r.nr, version = version + 1 WHERE id = v_existing.id;
      UPDATE pg_temp.t_imp SET reason = 'updated' WHERE rid = r.rid; v_updated := v_updated + 1;
    ELSE
      IF EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.queue_group_id = r.group_id AND x.nr = r.nr) THEN
        UPDATE pg_temp.t_imp SET reason = 'nr_conflict' WHERE rid = r.rid; CONTINUE;
      END IF;
      INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr, status, source) VALUES (r.group_id, r.company_id, r.nr, 'planned', 'plan');
      UPDATE pg_temp.t_imp SET reason = 'inserted' WHERE rid = r.rid; v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  PERFORM public.fm_queue_log_write(v_uid, NULL, NULL, NULL, 'open_day', NULL, NULL, NULL, NULL,
    jsonb_build_object('event_date', p_event_date, 'force', p_force, 'groups_created', v_groups, 'inserted', v_inserted, 'updated', v_updated, 'skipped_groups', v_skipped_groups,
      'problems', (SELECT count(*) FROM pg_temp.t_imp WHERE reason NOT IN ('inserted','updated','unchanged'))));
  RETURN jsonb_build_object(
    'groups_created', v_groups, 'inserted', v_inserted, 'updated', v_updated, 'skipped_groups', v_skipped_groups,
    'unchanged', (SELECT count(*) FROM pg_temp.t_imp WHERE reason = 'unchanged'),
    'problems', COALESCE((SELECT jsonb_agg(jsonb_build_object('sid', sid, 'cid', cid, 'nr', nr, 'reason', reason) ORDER BY reason, cid, nr)
                          FROM pg_temp.t_imp WHERE reason NOT IN ('inserted','updated','unchanged','group_already_imported')), '[]'::jsonb));
END; $$;

-- ─── 4. Stare polityki z 002 ─────────────────────────────────────────────────
drop policy if exists fm_prefs_select_role_based    on public.fm_prefs;     -- dostawca czytał wszystkie preferencje
drop policy if exists fm_prefs_modify_buyer_or_admin on public.fm_prefs;    -- duplikat fmp_admin_write / fmp_buyer_own
drop policy if exists fm_resps_select_role_based    on public.fm_resps;     -- duplikat fmr_* (admin / kupiec / dostawca o sobie)
drop policy if exists fm_resps_modify_admin         on public.fm_resps;     -- duplikat fmr_admin_all
drop policy if exists fm_settings_admin_write       on public.fm_settings;  -- duplikat fms_admin_write
drop policy if exists fm_settings_modify_admin      on public.fm_settings;  -- duplikat fms_admin_write
drop policy if exists fm_settings_select_authenticated on public.fm_settings; -- objęte fm_settings_public_read
drop policy if exists fms_read_all                  on public.fm_settings;  -- objęte fm_settings_public_read
-- zostają: fmp_admin_read, fmp_admin_write, fmp_buyer_own; fmr_admin_all,
-- fmr_buyer_own, fmr_supplier_about_self; fms_admin_write, fm_settings_public_read
-- (logo, partnerzy stopki, faza, miejsce/data dla ekranu logowania; schedule = null)

-- ─── 5. Kolumny administracyjne profiles / companies ─────────────────────────
-- Sesja uprzywilejowana: service_role, funkcje security definer / pg_cron /
-- SQL Editor (current_user ≠ authenticated/anon) albo admin z profilu.
-- Funkcja i triggery są SECURITY INVOKER — wewnątrz funkcji security definer
-- (purchase_package, handle_new_user, register-supplier-self przez service role)
-- nie blokują niczego.
create or replace function public.fm_is_privileged_session()
returns boolean language plpgsql stable as $$
declare v_jwt_role text;
begin
  if current_user not in ('authenticated', 'anon') then return true; end if;
  -- PostgREST ≥ 9 ustawia request.jwt.claims (json); starsze request.jwt.claim.role
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  if v_jwt_role = 'service_role' then return true; end if;
  return coalesce(public.is_admin(), false);
end $$;

create or replace function public.profiles_guard_protected()
returns trigger language plpgsql as $$
begin
  if public.fm_is_privileged_session() then return new; end if;
  if tg_op = 'INSERT' then
    -- self-INSERT (polityka profiles_insert_admin: id = auth.uid()) bez admina:
    -- rola administracyjna = błąd; przypisania firmy/sieci i flagi udziału
    -- tylko przez admina / serwer (admin-create-user, register-supplier-self)
    if new.role::text in ('admin', 'staff') or new.admin_level is not null then
      raise exception 'profiles_guard: rola administracyjna tylko przez administratora' using errcode = '42501';
    end if;
    new.role            := 'supplier';
    new.company_id      := null;
    new.retailer_id     := null;
    new.active          := true;
    new.fm26_active     := false;
    new.buyer_categories := '{}';
    new.archived_at     := null;
    new.archived_by     := null;
    new.archived_reason := null;
    return new;
  end if;
  -- UPDATE własnego profilu: przywróć kolumny, które ustawia wyłącznie admin
  new.company_id      := old.company_id;
  new.retailer_id     := old.retailer_id;
  new.active          := old.active;
  new.fm26_active     := old.fm26_active;
  new.buyer_categories := old.buyer_categories;
  new.archived_at     := old.archived_at;
  new.archived_by     := old.archived_by;
  new.archived_reason := old.archived_reason;
  return new;
end $$;
drop trigger if exists trg_profiles_guard_protected on public.profiles;
create trigger trg_profiles_guard_protected
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_protected();

create or replace function public.companies_guard_protected()
returns trigger language plpgsql as $$
begin
  if public.fm_is_privileged_session() then return new; end if;
  if tg_op = 'INSERT' then
    new.account_status     := 'pending_review';
    new.preconnect_enabled := false;
    new.fm_b2b_enabled     := false;
    new.fm_b2b_packages    := 1;
    new.fm_b2b_tier        := 'business';
    new.approved_at        := null;
    new.approved_by        := null;
    new.pkg_plan           := null;
    new.pkg_expiry         := null;
    new.legacy_fm_id       := null;
    new.legacy_supplier_id := null;
    new.fm_plan_sent_at    := null;
    new.status_note        := null;
    return new;
  end if;
  new.account_status     := old.account_status;
  new.preconnect_enabled := old.preconnect_enabled;
  new.fm_b2b_enabled     := old.fm_b2b_enabled;
  new.fm_b2b_packages    := old.fm_b2b_packages;
  new.fm_b2b_tier        := old.fm_b2b_tier;
  new.approved_at        := old.approved_at;
  new.approved_by        := old.approved_by;
  new.pkg_plan           := old.pkg_plan;
  new.pkg_expiry         := old.pkg_expiry;
  new.legacy_fm_id       := old.legacy_fm_id;
  new.legacy_supplier_id := old.legacy_supplier_id;
  new.fm_plan_sent_at    := old.fm_plan_sent_at;
  new.status_note        := old.status_note;
  new.created_at         := old.created_at;
  return new;
end $$;
-- nazwa < trg_companies_set_approved_at → guard wykonuje się pierwszy
drop trigger if exists trg_companies_guard_protected on public.companies;
create trigger trg_companies_guard_protected
  before insert or update on public.companies
  for each row execute function public.companies_guard_protected();

-- ─── 6. Storage: własny folder ───────────────────────────────────────────────
drop policy if exists company_logos_write_authenticated  on storage.objects;
drop policy if exists company_logos_update_authenticated on storage.objects;
drop policy if exists company_logos_delete_authenticated on storage.objects;
drop policy if exists offer_photos_write_authenticated   on storage.objects;
drop policy if exists offer_photos_update_authenticated  on storage.objects;
drop policy if exists offer_photos_delete_authenticated  on storage.objects;
drop policy if exists company_logos_modify_owner_or_admin on storage.objects;
create policy company_logos_modify_owner_or_admin on storage.objects
  for all
  using (bucket_id = 'company-logos' and (public.is_admin() or (storage.foldername(name))[1] = public.app_company_id()::text))
  with check (bucket_id = 'company-logos' and (public.is_admin() or (storage.foldername(name))[1] = public.app_company_id()::text));
drop policy if exists offer_photos_modify_owner_or_admin on storage.objects;
create policy offer_photos_modify_owner_or_admin on storage.objects
  for all
  using (bucket_id = 'offer-photos' and (public.is_admin() or (storage.foldername(name))[1] = public.app_company_id()::text))
  with check (bucket_id = 'offer-photos' and (public.is_admin() or (storage.foldername(name))[1] = public.app_company_id()::text));
-- publiczny odczyt (company_logos_read_public, offer_photos_read_public) bez zmian

-- ─── 7. Zapis wyborów: jedna transakcja + blokada fazy/terminu + kopia ───────
-- Termin serwerowy (opcjonalny): po jego minięciu zapisy wyborów/odpowiedzi są
-- odrzucane niezależnie od algo_phase i zegara w UI. Ustawia admin, np.:
--   update fm_settings set selection_deadline = '2026-09-22 23:59:59+02';
alter table public.fm_settings add column if not exists selection_deadline timestamptz;

create or replace function public.fm_inputs_are_locked()
returns boolean language sql security definer stable set search_path = public as $$
  -- clock_timestamp(), nie now(): zapis, który czekał na blokadę, ma być oceniony
  -- wg CZASU BIEŻĄCEGO, nie początku transakcji (review P1/2)
  select coalesce((
    select lower(coalesce(algo_phase, '')) <> 'preferences_open'
        or (selection_deadline is not null and clock_timestamp() > selection_deadline)
      from public.fm_settings order by updated_at desc nulls last limit 1
  ), false)
$$;
revoke all on function public.fm_inputs_are_locked() from public;
grant execute on function public.fm_inputs_are_locked() to authenticated, anon;

-- Sesja serwerowa (service_role / security definer / SQL Editor / pg_cron):
-- triggery wejść jej nie ograniczają — RPC sprawdza uprawnienia samo.
create or replace function public.fm_is_server_session()
returns boolean language plpgsql stable as $$
declare v_jwt_role text;
begin
  if current_user not in ('authenticated', 'anon') then return true; end if;
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  return v_jwt_role = 'service_role';
end $$;

-- Prawo do zapisu wejść (wybory / odpowiedzi) dla sesji użytkownika: null = OK,
-- inaczej kod powodu. Reguła (review Codexa P1/3, P2/5): profil aktywny — także
-- admina; dostawca: firma account_status = active i fm_b2b_enabled (jak filtr
-- fmSuppliers w aplikacji); kupiec: własny przełącznik profiles.fm26_active
-- + sieć active i fm26_active. Odebranie aktywności NIE kasuje zapisanych
-- wyborów — blokuje tylko dalsze operacje.
create or replace function public.fm_inputs_write_check()
returns text language plpgsql security definer stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles;
  c public.companies;
  r public.retailers;
begin
  if v_uid is null then return 'no_session'; end if;
  select * into p from public.profiles where id = v_uid;
  if not found then return 'no_profile'; end if;
  if p.active is false then return 'profile_inactive'; end if;
  if p.role::text = 'admin' then return null; end if;
  if p.role::text = 'supplier' then
    if p.company_id is null then return 'no_company'; end if;
    select * into c from public.companies where id = p.company_id;
    if not found then return 'no_company'; end if;
    if coalesce(c.account_status, 'active') <> 'active' then return 'company_' || coalesce(c.account_status, 'inactive'); end if;
    if c.fm_b2b_enabled is not true then return 'company_not_in_fm'; end if;
    return null;
  end if;
  if p.role::text = 'buyer' then
    if p.fm26_active is not true then return 'buyer_not_in_fm'; end if;
    if p.retailer_id is null then return 'no_retailer'; end if;
    select * into r from public.retailers where id = p.retailer_id;
    if not found then return 'no_retailer'; end if;
    if r.active is false then return 'retailer_inactive'; end if;
    if r.fm26_active is not true then return 'retailer_not_in_fm'; end if;
    return null;
  end if;
  return 'role_' || p.role::text;
end $$;
revoke all on function public.fm_inputs_write_check() from public;
grant execute on function public.fm_inputs_write_check() to authenticated;

-- Blokady współdzielone dla KAŻDEGO zapisu wejść przez sesję użytkownika (RPC dostawcy
-- i bezpośrednie zapisy odpowiedzi kupca): własny profil, własna sieć (kupiec) i
-- fm_settings — wszystkie FOR SHARE, trzymane do końca transakcji. Skutek: admin
-- zmieniający fazę/termin (UPDATE fm_settings) CZEKA na odpowiedzi/wybory w toku,
-- a zapis rozpoczęty po zmianie widzi już nową fazę (review Codexa 78e9dc9 P1).
-- SECURITY DEFINER, bo FOR SHARE wymaga prawa UPDATE, którego kupiec/dostawca nie ma.
-- Kolejność blokad (bez cykli): companies → profiles → retailers → fm_settings.
create or replace function public.fm_inputs_lock_for_write()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rid integer;
begin
  if v_uid is null then return; end if;
  perform 1 from public.profiles where id = v_uid for share;
  select retailer_id into v_rid from public.profiles where id = v_uid;
  if v_rid is not null then
    perform 1 from public.retailers where id = v_rid for share;
  end if;
  perform 1 from public.fm_settings for share;
end $$;
revoke all on function public.fm_inputs_lock_for_write() from public;
grant execute on function public.fm_inputs_lock_for_write() to authenticated;

-- Trigger na company_target_retailers / fm_resps: sesja użytkownika najpierw bierze
-- blokady (wyżej), potem musi mieć prawo udziału (fm_inputs_forbidden), a poza
-- fazą/terminem zapisuje tylko admin (fm_inputs_locked). Stary bundle / bezpośredni
-- zapis przechodzi przez to samo sito.
create or replace function public.fm_inputs_phase_lock()
returns trigger language plpgsql as $$
declare v_reason text;
begin
  if public.fm_is_server_session() then return coalesce(new, old); end if;
  perform public.fm_inputs_lock_for_write();
  v_reason := public.fm_inputs_write_check();
  if v_reason is not null then
    raise exception 'fm_inputs_forbidden' using errcode = '42501', hint = v_reason;
  end if;
  if not coalesce(public.is_admin(), false) and public.fm_inputs_are_locked() then
    raise exception 'fm_inputs_locked'
      using errcode = 'P0001',
            hint = 'Etap zbierania wyborów jest zamknięty (algo_phase=' || coalesce(public.fm_current_phase(), '') || ').';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_ctr_phase_lock on public.company_target_retailers;
create trigger trg_ctr_phase_lock
  before insert or update or delete on public.company_target_retailers
  for each row execute function public.fm_inputs_phase_lock();
drop trigger if exists trg_fm_resps_phase_lock on public.fm_resps;
create trigger trg_fm_resps_phase_lock
  before insert or update or delete on public.fm_resps
  for each row execute function public.fm_inputs_phase_lock();

-- Wybory zapisuje WYŁĄCZNIE RPC fm_set_company_targets (security definer): dostawca
-- I ADMIN (także podgląd konta dostawcy w starym bundlu — review P1/3) mają na
-- company_target_retailers tylko SELECT. Stary bundle robiący DELETE + INSERT:
-- DELETE nie trafia w żaden wiersz (RLS), INSERT jest odrzucony — nic nie ginie,
-- zapis po prostu nie następuje do odświeżenia strony. Zapisy serwerowe / SQL Editor
-- (postgres, service_role) nie podlegają RLS.
drop policy if exists ctr_supplier_own on public.company_target_retailers;
drop policy if exists ctr_supplier_read on public.company_target_retailers;
create policy ctr_supplier_read on public.company_target_retailers
  for select using (public.app_role() = 'supplier'::user_role and company_id = public.app_company_id());
drop policy if exists ctr_admin_all on public.company_target_retailers;
drop policy if exists ctr_admin_read on public.company_target_retailers;
create policy ctr_admin_read on public.company_target_retailers
  for select using (public.is_admin());

-- Atomowy zapis całego zestawu wyborów firmy. Albo zapisuje się cała nowa lista,
-- albo zostaje cała poprzednia. Równoległe zapisy tej samej firmy (dwie karty,
-- dwa konta firmy) są szeregowane blokadą wiersza firmy — wygrywa OSTATNI
-- zatwierdzony zapis W CAŁOŚCI (nigdy suma list). Zwraca listę faktycznie
-- zapisaną w bazie — klient ma do niej dopasować swój stan.
-- p_items: [{retailer_id, priority, note}] — duplikaty sieci scalane (max priority).
create or replace function public.fm_set_company_targets(p_company_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_cid    uuid;
  v_bad    text;
  v_reason text;
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

  delete from public.company_target_retailers where company_id = p_company_id;
  insert into public.company_target_retailers (company_id, retailer_id, priority, note)
  select p_company_id, rid, max(prio), max(note)
    from (select (e->>'retailer_id')::integer as rid,
                 coalesce(nullif(e->>'priority', '')::integer, 0) as prio,
                 nullif(e->>'note', '') as note
            from jsonb_array_elements(p_items) e) x
   group by rid;

  -- ślad każdego zapisu (kto, która firma, ile sieci): po wdrożeniu pozwala
  -- potwierdzić, że prawdziwe zapisy dostawców przechodzą, bez kont testowych
  -- widocznych dla uczestników; tłumaczy też różnice przed/po w porównaniu kopii
  insert into public.audit_log (user_id, action, entity, entity_id, meta)
  values (v_uid, 'fm_targets_saved', 'company', p_company_id::text,
          jsonb_build_object('count', (select count(*) from public.company_target_retailers where company_id = p_company_id),
                             'role', v_role, 'saved_at', clock_timestamp()));

  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.priority desc, t.retailer_id), '[]'::jsonb)
            from public.company_target_retailers t where t.company_id = p_company_id);
end $$;
revoke all on function public.fm_set_company_targets(uuid, jsonb) from public, anon;
grant execute on function public.fm_set_company_targets(uuid, jsonb) to authenticated;

create table if not exists public.fm_inputs_snapshots (
  id         bigserial primary key,
  label      text not null,
  table_name text not null,
  row_count  integer not null,
  rows       jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.fm_inputs_snapshots enable row level security;
drop policy if exists fm_inputs_snapshots_admin_all on public.fm_inputs_snapshots;
create policy fm_inputs_snapshots_admin_all on public.fm_inputs_snapshots
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.fm_inputs_snapshots from anon;
grant select, insert, update, delete on public.fm_inputs_snapshots to authenticated; -- RLS = tylko admin

-- select fm_backup_inputs('przed-przeliczeniem-2026-09-23');
create or replace function public.fm_backup_inputs(p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_n    integer;
  v_rows jsonb;
  t      text;
begin
  if not public.is_admin() then
    raise exception 'fm_backup_inputs: tylko administrator' using errcode = '42501';
  end if;
  if coalesce(p_label, '') = '' then
    raise exception 'fm_backup_inputs: podaj etykietę kopii';
  end if;
  foreach t in array array['company_target_retailers', 'fm_resps', 'fm_prefs', 'fm_wishlists'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select count(*), coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_n, v_rows;
    insert into public.fm_inputs_snapshots (label, table_name, row_count, rows, created_by)
    values (p_label, t, v_n, v_rows, auth.uid());
    v_out := v_out || jsonb_build_object(t, v_n);
  end loop;
  select count(*), coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_n, v_rows
    from (select id, name, account_status, fm_b2b_enabled, fm_b2b_packages, fm_b2b_tier,
                 fm_selection_confirmed_at, legacy_fm_id, legacy_supplier_id
            from public.companies where fm_b2b_enabled) x;
  insert into public.fm_inputs_snapshots (label, table_name, row_count, rows, created_by)
  values (p_label, 'companies', v_n, v_rows, auth.uid());
  v_out := v_out || jsonb_build_object('companies', v_n);
  select count(*), coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_n, v_rows
    from (select id, name, active, fm26_active, fm26_chain_id, legacy_chain_id, fm_gate, cats
            from public.retailers) x;
  insert into public.fm_inputs_snapshots (label, table_name, row_count, rows, created_by)
  values (p_label, 'retailers', v_n, v_rows, auth.uid());
  v_out := v_out || jsonb_build_object('retailers', v_n);
  select count(*), coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_n, v_rows
    from (select id, role, company_id, retailer_id, active, fm26_active
            from public.profiles where role in ('supplier', 'buyer')) x;
  insert into public.fm_inputs_snapshots (label, table_name, row_count, rows, created_by)
  values (p_label, 'profiles', v_n, v_rows, auth.uid());
  v_out := v_out || jsonb_build_object('profiles', v_n);
  select count(*), coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_n, v_rows
    from (select id, algo_phase, event_date, open_date, selection_deadline, updated_at from public.fm_settings) x;
  insert into public.fm_inputs_snapshots (label, table_name, row_count, rows, created_by)
  values (p_label, 'fm_settings', v_n, v_rows, auth.uid());
  return v_out || jsonb_build_object('label', p_label, 'created_at', now());
end $$;
revoke all on function public.fm_backup_inputs(text) from public, anon;
grant execute on function public.fm_backup_inputs(text) to authenticated;

-- ─── 8. legacy_sends: adresy kupców z data → liczba ──────────────────────────
update public.legacy_sends
   set data = (data - 'resendBuyerEmails')
              || jsonb_build_object('resendBuyerCount',
                   case when jsonb_typeof(data->'resendBuyerEmails') = 'array'
                        then jsonb_array_length(data->'resendBuyerEmails') else 0 end)
 where data ? 'resendBuyerEmails';

-- ─── 9. Ślad w audit_log (pomijany w pustej bazie testowej bez administratora) ─
insert into public.audit_log (user_id, action, entity, entity_id, meta)
select coalesce(auth.uid(), a.id), 'security_hotfix', 'migration', '055',
       jsonb_build_object(
         'scope', array['retailer_contacts','fm_plan_private','drop_002_policies','guard_triggers',
                        'storage_owner_scope','fm_set_company_targets','fm_inputs_phase_lock','legacy_sends_emails'],
         'retailer_contacts', (select count(*) from public.retailer_contacts),
         'algo_phase', public.fm_current_phase())
  from (select id from public.profiles where role = 'admin' order by created_at limit 1) a;

commit;
