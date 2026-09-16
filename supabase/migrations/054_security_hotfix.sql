-- ============================================================================
-- 054_security_hotfix.sql — hotfix bezpieczeństwa B2B (audyt Codexa 16.09.2026
-- + korekty 1–6). Szczegóły i plan testów:
-- docs/production/NOTATKA_DLA_CODEX_2026-09-16_HOTFIX_BEZPIECZENSTWA.md
-- ============================================================================
-- Zakres:
--  1. widoki security definer → security_invoker; zero uprawnień do ZAPISU przez
--     widoki; anon bez consent_audit / v_admin_* (24 adresy kupców bez logowania)
--  2. kontakty kupców (retailers.buyer_name/email/phone) → tabela retailer_contacts
--     (RLS: tylko admin); kolumny w retailers zawsze puste (trigger); lista sieci
--     dla dostawców bez zmian
--  3. plan spotkań (fm_settings.schedule) → fm_plan_private (RLS: tylko admin)
--     + RPC fm_my_schedule(): admin = całość, dostawca = własne wiersze,
--     kupiec = spotkania własnej sieci, obie role dopiero po publikacji;
--     brand_logo_url / ui_content / algo_phase czytane jak dotąd (select *)
--  4. stare polityki z 002 (dostawca czytał wszystkie fm_prefs; duplikaty)
--  5. triggery: kolumny administracyjne profiles / companies NIE do zmiany przez
--     dostawcę/kupca — trigger przywraca poprzednią wartość zamiast rzucać
--     błędem, więc zapis „Mój profil”, profilu firmy, kontaktów, certyfikatów,
--     fm_selection_confirmed_at, locale, last_active_at działa jak dotąd
--  6. storage: company-logos / offer-photos tylko we własnym folderze
--     (pierwszy segment ścieżki = company_id, jak certs); admin wszędzie
--  7. blokada zapisów wyborów (company_target_retailers, fm_resps) po zamknięciu
--     fazy preferences_open — na poziomie bazy, nie tylko UI;
--     kopia zapasowa wejść: select fm_backup_inputs('etykieta')
--  8. legacy_sends.data bez listy adresów e-mail kupców (zostaje liczba)
--
-- Idempotentna (if not exists / drop if exists / create or replace).
-- NIE zmienia wyborów uczestników, NIE publikuje planu, NIE wysyła maili.
-- Wymaga funkcji is_admin(), app_company_id(), app_retailer_id() z 001.
-- ============================================================================
begin;

-- ─── 1. Widoki ───────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  foreach v in array array['consent_audit','company_capacity','v_admin_registrations','v_admin_stats'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = true)', v);
    end if;
  end loop;
  -- domyślne uprawnienia projektu dają anon/authenticated INSERT/UPDATE/DELETE
  -- także na widokach (prosty widok jest aktualizowalny → np. delete przez
  -- consent_audit trafiałby w profiles z pominięciem RLS)
  foreach v in array array['consent_audit','company_capacity','v_admin_registrations','v_admin_stats','articles_with_facts'] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', v);
    end if;
  end loop;
  foreach v in array array['consent_audit','v_admin_registrations','v_admin_stats'] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke select on public.%I from anon', v);
    end if;
  end loop;
end $$;

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

-- kopia istniejących kontaktów
insert into public.retailer_contacts (retailer_id, buyer_name, buyer_email, buyer_phone)
select id, nullif(buyer_name, ''), nullif(buyer_email, ''), nullif(buyer_phone, '')
  from public.retailers
 where coalesce(buyer_name, '') <> '' or coalesce(buyer_email, '') <> '' or coalesce(buyer_phone, '') <> ''
on conflict (retailer_id) do update
  set buyer_name = excluded.buyer_name, buyer_email = excluded.buyer_email,
      buyer_phone = excluded.buyer_phone, updated_at = now();

-- Zapisy z panelu admina (toRetailerDbRow) i z drugiej aplikacji nadal mogą
-- przysłać buyer_* w wierszu retailers — trigger przenosi je do
-- retailer_contacts i zostawia kolumny puste. Puste wartości nie kasują
-- istniejącego kontaktu (kasowanie: delete from retailer_contacts).
create or replace function public.retailers_route_buyer_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(new.buyer_name, '') is not null or nullif(new.buyer_email, '') is not null or nullif(new.buyer_phone, '') is not null then
    insert into public.retailer_contacts (retailer_id, buyer_name, buyer_email, buyer_phone)
    values (new.id, nullif(new.buyer_name, ''), nullif(new.buyer_email, ''), nullif(new.buyer_phone, ''))
    on conflict (retailer_id) do update
      set buyer_name = excluded.buyer_name, buyer_email = excluded.buyer_email,
          buyer_phone = excluded.buyer_phone, updated_at = now();
  end if;
  if tg_op = 'UPDATE' then
    new.buyer_name := null; new.buyer_email := null; new.buyer_phone := null;
    return new;
  end if;
  -- INSERT: wiersz retailers musi już istnieć dla klucza obcego → after insert
  -- (patrz retailers_clear_buyer_contacts)
  return new;
end $$;

create or replace function public.retailers_clear_buyer_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(new.buyer_name, '') is not null or nullif(new.buyer_email, '') is not null or nullif(new.buyer_phone, '') is not null then
    insert into public.retailer_contacts (retailer_id, buyer_name, buyer_email, buyer_phone)
    values (new.id, nullif(new.buyer_name, ''), nullif(new.buyer_email, ''), nullif(new.buyer_phone, ''))
    on conflict (retailer_id) do update
      set buyer_name = excluded.buyer_name, buyer_email = excluded.buyer_email,
          buyer_phone = excluded.buyer_phone, updated_at = now();
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

-- przeniesienie ewentualnego planu (na produkcji 16.09: schedule = {} → nic)
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
-- legacy_supplier_id); kupiec → tylko dostawcy, którzy mają spotkanie z jego
-- siecią, z m = [własny chain] i nums tylko dla własnego chain.
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
     where p.id = v_uid;
    if v_keys is null then return null; end if;
    foreach k in array v_keys loop
      if (v_sched->'res') ? k then v_res := v_res || jsonb_build_object(k, v_sched->'res'->k); end if;
      if (v_sched->'nums') ? k then v_nums := v_nums || jsonb_build_object(k, v_sched->'nums'->k); end if;
    end loop;
    return jsonb_build_object('res', v_res, 'nums', v_nums, 'scope', 'supplier');
  end if;

  if v_role = 'buyer' then
    select r.fm26_chain_id into v_chain
      from public.profiles p join public.retailers r on r.id = p.retailer_id
     where p.id = v_uid;
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
-- (logo/partnerzy/faza dla ekranu logowania; schedule już nie istnieje w tym wierszu)

-- ─── 5. Kolumny administracyjne profiles / companies ─────────────────────────
-- Sesja uprzywilejowana: service_role, funkcje security definer / pg_cron /
-- SQL Editor (current_user ≠ authenticated/anon) albo admin z profilu.
-- Funkcja i triggery są SECURITY INVOKER — wewnątrz funkcji security definer
-- (np. purchase_package) current_user to właściciel, więc nie blokują RPC.
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
    if new.role::text in ('admin', 'staff') or new.admin_level is not null then
      raise exception 'profiles_guard: rola administracyjna tylko przez administratora' using errcode = '42501';
    end if;
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

-- ─── 7. Blokada wyborów po zamknięciu fazy + kopia zapasowa ──────────────────
create or replace function public.fm_inputs_phase_lock()
returns trigger language plpgsql as $$
declare v_phase text;
begin
  if public.fm_is_privileged_session() then return coalesce(new, old); end if;
  v_phase := coalesce(public.fm_current_phase(), '');
  if v_phase <> 'preferences_open' then
    raise exception 'fm_inputs_locked'
      using errcode = 'P0001',
            hint = 'Etap zbierania wyborów jest zamknięty (algo_phase=' || v_phase || ').';
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
    from (select id, algo_phase, event_date, open_date, updated_at from public.fm_settings) x;
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

-- ─── 9. Ślad w audit_log ─────────────────────────────────────────────────────
-- (pomijane w pustej bazie testowej, gdzie nie ma jeszcze administratora)
insert into public.audit_log (user_id, action, entity, entity_id, meta)
select coalesce(auth.uid(), a.id), 'security_hotfix', 'migration', '054',
       jsonb_build_object(
         'scope', array['views_invoker','retailer_contacts','fm_plan_private','drop_002_policies',
                        'guard_triggers','storage_owner_scope','fm_inputs_phase_lock','legacy_sends_emails'],
         'retailer_contacts', (select count(*) from public.retailer_contacts),
         'algo_phase', public.fm_current_phase())
  from (select id from public.profiles where role = 'admin' order by created_at limit 1) a;

commit;
