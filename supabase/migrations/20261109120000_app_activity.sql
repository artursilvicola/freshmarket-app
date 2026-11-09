-- ============================================================================
-- [feat/admin-activity] Zakładka administratora „Aktywność” — wersja 1
--
-- 1. Dziennik wejść do aplikacji (app_visits): kupcy i dostawcy, tożsamość i czas
--    WYŁĄCZNIE po stronie serwera (auth.uid(), now()). Kolejne wejścia w ciągu
--    30 minut od ostatniego zarejestrowanego wejścia = jedna wizyta (hit_count++),
--    także przy kilku kartach i równoległych żądaniach (blokada doradcza per konto).
-- 2. Konta admina NIE są zapisywane. Podgląd konta przez administratora działa na
--    sesji admina, więc nigdy nie zostanie zapisany jako wejście kupca/dostawcy.
-- 3. Jawne oznaczenie kont testowych (app_activity_test_accounts) — tylko admin.
-- 4. Retencja 12 miesięcy: purge_app_visits() wołane przy każdej nowej wizycie,
--    przy odczycie raportu i codziennie z funkcji zaplanowanej (activity-retention).
-- 5. admin_activity_report(): odczyt dla panelu admina — dziennik wejść + istniejące
--    rejestry maili PreConnect (legacy_send_messages/_email_events) i marketingu
--    (marketing_messages/_email_events) + wyświetlenia propozycji w aplikacji
--    (legacy_send_app_reads). TYLKO ODCZYT tych rejestrów: brak wpływu na kredyty,
--    statusy propozycji i informacje o odczytach widoczne dla dostawcy.
--
-- Bez adresów IP, bez user-agenta, bez tokenów. Pole profiles.last_active_at
-- (migracja 042) zostaje bez zmian — raport pokazuje je osobno jako dane historyczne.
-- Idempotentna: IF NOT EXISTS / OR REPLACE / ON CONFLICT.
-- ============================================================================

begin;

-- ── 1. dziennik wejść ───────────────────────────────────────────────────────
create table if not exists public.app_visits (
  id            bigserial primary key,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  role          text not null check (role in ('buyer','supplier')),
  company_id    uuid,                                -- stan z chwili wejścia (dostawca)
  retailer_id   integer,                             -- stan z chwili wejścia (kupiec)
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  hit_count     integer not null default 1 check (hit_count >= 1)
);
create index if not exists idx_app_visits_profile_seen on public.app_visits(profile_id, last_seen_at desc);
create index if not exists idx_app_visits_started on public.app_visits(started_at);
create index if not exists idx_app_visits_last_seen on public.app_visits(last_seen_at);
comment on table public.app_visits is
  'Zarejestrowane wejścia kupców i dostawców do aplikacji (jedna wizyta = wejścia w odstępach < 30 min). Zapis tylko przez record_app_visit(); odczyt tylko admin. Retencja 12 miesięcy.';

-- ── 2. ustawienia dziennika (data rozpoczęcia zbierania) ────────────────────
create table if not exists public.app_activity_settings (
  id                boolean primary key default true check (id),
  collecting_since  timestamptz
);
comment on table public.app_activity_settings is
  'Jeden wiersz: collecting_since = pierwsze wejście zapisane w dzienniku (początek historii w zakładce Aktywność).';

-- ── 3. jawnie oznaczone konta testowe ───────────────────────────────────────
create table if not exists public.app_activity_test_accounts (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  note        text,
  marked_by   uuid references public.profiles(id) on delete set null,
  marked_at   timestamptz not null default now()
);
comment on table public.app_activity_test_accounts is
  'Konta oznaczone przez administratora jako testowe — zakładka Aktywność ukrywa je domyślnie. Zmiana tylko przez admin_set_activity_test_account().';

-- ── 4. RLS: tylko odczyt admina, zapis wyłącznie przez funkcje ──────────────
alter table public.app_visits enable row level security;
alter table public.app_activity_settings enable row level security;
alter table public.app_activity_test_accounts enable row level security;

drop policy if exists app_visits_admin_read on public.app_visits;
create policy app_visits_admin_read on public.app_visits for select using (public.is_admin());
drop policy if exists app_activity_settings_admin_read on public.app_activity_settings;
create policy app_activity_settings_admin_read on public.app_activity_settings for select using (public.is_admin());
drop policy if exists app_activity_test_admin_read on public.app_activity_test_accounts;
create policy app_activity_test_admin_read on public.app_activity_test_accounts for select using (public.is_admin());

-- domyślne uprawnienia Supabase dają anon/authenticated ALL na nowych tabelach
revoke all on table public.app_visits, public.app_activity_settings, public.app_activity_test_accounts from public, anon, authenticated;
grant select on table public.app_visits, public.app_activity_settings, public.app_activity_test_accounts to authenticated;  -- RLS zawęża do admina
grant select, insert, update, delete on table public.app_visits, public.app_activity_settings, public.app_activity_test_accounts to service_role;
revoke all on sequence public.app_visits_id_seq from public, anon, authenticated;
grant usage, select on sequence public.app_visits_id_seq to service_role;

-- ── 5. retencja 12 miesięcy ─────────────────────────────────────────────────
create or replace function public.purge_app_visits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.app_visits where last_seen_at < now() - interval '12 months';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ── 6. zapis wejścia (wołany przez zalogowanego użytkownika, bez argumentów) ──
create or replace function public.record_app_visit()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_company uuid;
  v_retailer integer;
  v_id    bigint;
  v_new   boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('recorded', false, 'reason', 'no_session');
  end if;

  select p.role::text, p.company_id, p.retailer_id into v_role, v_company, v_retailer
    from public.profiles p where p.id = v_uid;
  if not found then
    return jsonb_build_object('recorded', false, 'reason', 'no_profile');
  end if;
  -- admin (także w trybie podglądu cudzego konta), obsługa dnia eventu — nie zapisujemy
  if v_role not in ('buyer','supplier') then
    return jsonb_build_object('recorded', false, 'reason', 'not_participant');
  end if;

  -- jedna wizyta na konto także przy kilku kartach / równoległych żądaniach:
  -- blokada per konto do końca transakcji, kolejne polecenia widzą zatwierdzony wiersz
  perform pg_advisory_xact_lock(hashtextextended('app_visit:' || v_uid::text, 0));

  update public.app_visits v
     set last_seen_at = greatest(v.last_seen_at, now()),
         hit_count    = v.hit_count + 1
   where v.id = (select x.id from public.app_visits x
                  where x.profile_id = v_uid
                    and x.last_seen_at > now() - interval '30 minutes'
                  order by x.last_seen_at desc
                  limit 1)
  returning v.id into v_id;

  if v_id is null then
    insert into public.app_visits (profile_id, role, company_id, retailer_id)
    values (v_uid, v_role, case when v_role = 'supplier' then v_company end, case when v_role = 'buyer' then v_retailer end)
    returning id into v_id;
    v_new := true;
    insert into public.app_activity_settings (id, collecting_since) values (true, now())
      on conflict (id) do update set collecting_since = coalesce(public.app_activity_settings.collecting_since, excluded.collecting_since);
    perform public.purge_app_visits();
  end if;

  return jsonb_build_object('recorded', true, 'visit_id', v_id, 'new_visit', v_new);
end;
$$;

-- ── 7. oznaczenie konta testowego (admin) ───────────────────────────────────
create or replace function public.admin_set_activity_test_account(p_profile_id uuid, p_is_test boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_set_activity_test_account: tylko administrator' using errcode = '42501';
  end if;
  if p_profile_id is null or p_is_test is null then
    raise exception 'admin_set_activity_test_account: złe dane' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and role::text in ('buyer','supplier')) then
    raise exception 'admin_set_activity_test_account: konto nie jest kupcem ani dostawcą' using errcode = '22023';
  end if;
  if p_is_test then
    insert into public.app_activity_test_accounts (profile_id, note, marked_by, marked_at)
    values (p_profile_id, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
    on conflict (profile_id) do update set note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
  else
    delete from public.app_activity_test_accounts where profile_id = p_profile_id;
  end if;
  return jsonb_build_object('profile_id', p_profile_id, 'is_test', p_is_test);
end;
$$;

-- ── 8. raport dla zakładki Aktywność (admin) ────────────────────────────────
-- Okres [p_from, p_to). Domyślnie ostatnie 30 dni, najwyżej 366 dni.
-- Słownictwo zdarzeń: visit (zarejestrowane wejście), email_sent (wysłano = przyjęte
-- przez Resend), email_delivered (doręczono = przyjęte przez serwer pocztowy odbiorcy),
-- email_opened (zarejestrowane otwarcie = pobrany obraz śledzący), app_view
-- (wyświetlono propozycję w aplikacji). Żadne nie jest dowodem zainteresowania zakupem.
create or replace function public.admin_activity_report(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_to   timestamptz := coalesce(p_to, now());
  v_from timestamptz := coalesce(p_from, coalesce(p_to, now()) - interval '30 days');
  v_since timestamptz;
  v_accounts jsonb;
  v_events jsonb;
  v_backfill jsonb;
  v_event_limit integer := 20000;
  v_event_total integer;
begin
  if not public.is_admin() then
    raise exception 'admin_activity_report: tylko administrator' using errcode = '42501';
  end if;
  if v_from >= v_to then
    raise exception 'admin_activity_report: początek okresu musi być przed końcem' using errcode = '22023';
  end if;
  if v_to - v_from > interval '366 days' then
    raise exception 'admin_activity_report: okres dłuższy niż 366 dni' using errcode = '22023';
  end if;

  perform public.purge_app_visits();
  select s.collecting_since into v_since from public.app_activity_settings s where s.id;

  -- wartości last_active_at wspólne dla wielu kont = zbiorcze ustawienie przy wdrożeniu 042,
  -- a nie wejście do aplikacji
  select coalesce(jsonb_agg(b.last_active_at order by b.last_active_at), '[]'::jsonb) into v_backfill
    from (select p.last_active_at from public.profiles p
           where p.last_active_at is not null
           group by p.last_active_at having count(*) >= 5) b;

  with
  acc as (
    select p.id, p.role::text as role, p.name, p.email, p.active, p.company_id, p.retailer_id,
           p.last_active_at, p.created_at,
           c.name as company_name, r.name as retailer_name,
           (t.profile_id is not null) as is_test, t.note as test_note
      from public.profiles p
      left join public.companies c on c.id = p.company_id
      left join public.retailers r on r.id = p.retailer_id
      left join public.app_activity_test_accounts t on t.profile_id = p.id
     where p.role::text in ('buyer','supplier')
  ),
  vis as (
    select v.profile_id,
           count(*) filter (where v.last_seen_at >= v_from and v.started_at < v_to) as visits,
           max(v.last_seen_at) filter (where v.started_at < v_to)                   as last_visit_at,
           min(v.started_at)                                                         as first_logged_at
      from public.app_visits v group by v.profile_id
  ),
  pc as (   -- maile PreConnect do kupców (rejestr od 22.10.2026)
    select m.buyer_profile_id as profile_id, m.resend_message_id, m.sent_at,
           (select min(e.occurred_at) from public.legacy_send_email_events e
             where e.resend_message_id = m.resend_message_id and e.status <> 'ignored' and e.event_type = 'email.delivered') as delivered_at,
           (select min(e.occurred_at) from public.legacy_send_email_events e
             where e.resend_message_id = m.resend_message_id and e.status <> 'ignored' and e.event_type = 'email.opened') as first_opened_at,
           (select max(e.occurred_at) from public.legacy_send_email_events e
             where e.resend_message_id = m.resend_message_id and e.status <> 'ignored' and e.event_type = 'email.opened') as last_opened_at
      from public.legacy_send_messages m
     where m.buyer_profile_id is not null and m.sent_at >= v_from and m.sent_at < v_to
  ),
  mk as (   -- maile marketingowe (bez wiadomości testowych na adres zespołu)
    select mm.profile_id, mm.resend_message_id, mm.sent_at,
           (select min(e.occurred_at) from public.marketing_email_events e
             where e.resend_message_id = mm.resend_message_id and e.status <> 'ignored' and e.event_type = 'email.delivered') as delivered_at,
           (select min(e.occurred_at) from public.marketing_email_events e
             where e.resend_message_id = mm.resend_message_id and e.status <> 'ignored' and e.event_type = 'email.opened') as first_opened_at,
           (select max(e.occurred_at) from public.marketing_email_events e
             where e.resend_message_id = mm.resend_message_id and e.status <> 'ignored' and e.event_type = 'email.opened') as last_opened_at
      from public.marketing_messages mm
     where mm.profile_id is not null and mm.is_test = false and mm.state = 'accepted'
       and mm.resend_message_id is not null and mm.sent_at >= v_from and mm.sent_at < v_to
  ),
  mail as (select * from pc union all select * from mk),
  mail_agg as (
    select profile_id,
           count(*)                                   as emails_sent,
           count(delivered_at)                        as emails_delivered,
           count(first_opened_at)                     as emails_opened,
           max(last_opened_at)                        as last_opened_at
      from mail group by profile_id
  ),
  views as (
    select ar.buyer_profile_id as profile_id,
           count(distinct ar.legacy_id) as proposals_viewed,
           max(ar.last_read_at)         as last_view_at
      from public.legacy_send_app_reads ar
     where ar.buyer_profile_id is not null and ar.last_read_at >= v_from and ar.first_read_at < v_to
     group by ar.buyer_profile_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', a.id, 'role', a.role, 'name', a.name, 'email', a.email, 'active', a.active,
           'company_id', a.company_id, 'company_name', a.company_name,
           'retailer_id', a.retailer_id, 'retailer_name', a.retailer_name,
           'is_test', a.is_test, 'test_note', a.test_note, 'created_at', a.created_at,
           'visits', coalesce(vi.visits, 0), 'last_visit_at', vi.last_visit_at, 'first_logged_at', vi.first_logged_at,
           'emails_sent', coalesce(ma.emails_sent, 0), 'emails_delivered', coalesce(ma.emails_delivered, 0),
           'emails_opened', coalesce(ma.emails_opened, 0), 'last_opened_at', ma.last_opened_at,
           'proposals_viewed', coalesce(w.proposals_viewed, 0), 'last_view_at', w.last_view_at,
           'legacy_last_active_at', a.last_active_at,
           'legacy_last_active_kind', case
               when a.last_active_at is null then null
               when v_backfill @> to_jsonb(a.last_active_at) then 'bulk_set'
               else 'app' end
         ) order by coalesce(vi.last_visit_at, a.last_active_at) desc nulls last, a.name), '[]'::jsonb)
    into v_accounts
    from acc a
    left join vis vi on vi.profile_id = a.id
    left join mail_agg ma on ma.profile_id = a.id
    left join views w on w.profile_id = a.id;

  with ev as (
    select v.profile_id, 'visit'::text as kind, null::text as source, v.started_at as at,
           jsonb_build_object('last_seen_at', v.last_seen_at, 'hit_count', v.hit_count) as detail
      from public.app_visits v
     where v.last_seen_at >= v_from and v.started_at < v_to
    union all
    select m.buyer_profile_id, 'email_sent', 'preconnect', m.sent_at,
           jsonb_build_object('message', m.resend_message_id, 'retailer_id', m.retailer_id, 'proposals', coalesce(array_length(m.legacy_ids, 1), 0), 'to', m.to_email)
      from public.legacy_send_messages m
     where m.buyer_profile_id is not null and m.sent_at >= v_from and m.sent_at < v_to
    union all
    select m.buyer_profile_id,
           case e.event_type when 'email.delivered' then 'email_delivered' when 'email.opened' then 'email_opened'
                             when 'email.bounced' then 'email_bounced' when 'email.complained' then 'email_complained'
                             else 'email_other' end,
           'preconnect', e.occurred_at,
           jsonb_build_object('message', m.resend_message_id, 'event_type', e.event_type, 'sent_at', m.sent_at)
      from public.legacy_send_email_events e
      join public.legacy_send_messages m on m.resend_message_id = e.resend_message_id
     where m.buyer_profile_id is not null and e.status <> 'ignored'
       and e.event_type in ('email.delivered','email.opened','email.bounced','email.complained')
       and e.occurred_at >= v_from and e.occurred_at < v_to
    union all
    select mm.profile_id, 'email_sent', 'marketing', mm.sent_at,
           jsonb_build_object('message', mm.resend_message_id, 'campaign', c.name, 'subject', mm.subject, 'to', mm.to_email)
      from public.marketing_messages mm
      left join public.marketing_campaigns c on c.id = mm.campaign_id
     where mm.profile_id is not null and mm.is_test = false and mm.state = 'accepted'
       and mm.resend_message_id is not null and mm.sent_at >= v_from and mm.sent_at < v_to
    union all
    select mm.profile_id,
           case e.event_type when 'email.delivered' then 'email_delivered' when 'email.opened' then 'email_opened'
                             when 'email.bounced' then 'email_bounced' when 'email.complained' then 'email_complained'
                             else 'email_other' end,
           'marketing', e.occurred_at,
           jsonb_build_object('message', mm.resend_message_id, 'event_type', e.event_type, 'campaign', c.name, 'sent_at', mm.sent_at)
      from public.marketing_email_events e
      join public.marketing_messages mm on mm.resend_message_id = e.resend_message_id
      left join public.marketing_campaigns c on c.id = mm.campaign_id
     where mm.profile_id is not null and mm.is_test = false and e.status <> 'ignored'
       and e.event_type in ('email.delivered','email.opened','email.bounced','email.complained')
       and e.occurred_at >= v_from and e.occurred_at < v_to
    union all
    select ar.buyer_profile_id, 'app_view', 'preconnect', ar.first_read_at,
           jsonb_build_object('legacy_id', ar.legacy_id, 'channel', ar.channel, 'last_read_at', ar.last_read_at, 'read_count', ar.read_count)
      from public.legacy_send_app_reads ar
     where ar.buyer_profile_id is not null and ar.last_read_at >= v_from and ar.first_read_at < v_to
  ),
  ev_acc as (
    select ev.* from ev join public.profiles p on p.id = ev.profile_id where p.role::text in ('buyer','supplier')
  )
  select (select count(*) from ev_acc),
         coalesce((select jsonb_agg(jsonb_build_object('profile_id', x.profile_id, 'kind', x.kind, 'source', x.source, 'at', x.at, 'detail', x.detail)
                                   order by x.at desc)
                     from (select * from ev_acc order by at desc limit v_event_limit) x), '[]'::jsonb)
    into v_event_total, v_events;

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'from', v_from, 'to', v_to, 'generated_at', now(),
      'collecting_since', v_since,
      'history_from', case when v_since is null then null else greatest(v_since, now() - interval '12 months') end,
      'retention_months', 12, 'dedupe_minutes', 30,
      'bulk_last_active_values', v_backfill,
      'events_total', v_event_total, 'events_truncated', v_event_total > v_event_limit),
    'accounts', v_accounts,
    'events', v_events);
end;
$$;

-- ── 9. uprawnienia funkcji ──────────────────────────────────────────────────
revoke all on function public.purge_app_visits() from public, anon, authenticated;
revoke all on function public.record_app_visit() from public, anon;
revoke all on function public.admin_set_activity_test_account(uuid, boolean, text) from public, anon;
revoke all on function public.admin_activity_report(timestamptz, timestamptz) from public, anon;

grant execute on function public.purge_app_visits() to service_role;
grant execute on function public.record_app_visit() to authenticated;                                   -- tożsamość z auth.uid()
grant execute on function public.admin_set_activity_test_account(uuid, boolean, text) to authenticated;  -- guard is_admin() w środku
grant execute on function public.admin_activity_report(timestamptz, timestamptz) to authenticated;       -- guard is_admin() w środku

commit;
