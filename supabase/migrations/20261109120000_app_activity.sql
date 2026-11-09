-- ============================================================================
-- [feat/admin-activity] Zakładka administratora „Aktywność” — wersja 1
--
-- 1. Dziennik wejść do aplikacji (app_visits): kupcy i dostawcy, tożsamość i czas
--    WYŁĄCZNIE po stronie serwera (auth.uid(), now()). Kolejne wejścia w ciągu
--    30 minut od ostatniego zarejestrowanego wejścia = jedna wizyta (hit_count++),
--    także przy kilku kartach i równoległych żądaniach (blokada doradcza per konto).
-- 2. WYŁĄCZNIK W BAZIE: app_activity_settings.enabled = false po migracji. Dopóki nie
--    zostanie świadomie włączony poleceniem SQL na właściwym projekcie, record_app_visit()
--    niczego nie zapisuje — niezależnie od flag frontendu i bezpośrednich wywołań API.
--    Zmiana przełącznika (03/04) bierze wyłączną blokadę 'app_activity:switch', a zapis —
--    współdzieloną: wyłączenie czeka na trwające zapisy i jest barierą dla kolejnych.
-- 3. Konta admina NIE są zapisywane. Podgląd konta przez administratora działa na
--    sesji admina, więc nigdy nie zostanie zapisany jako wejście kupca/dostawcy.
-- 4. Jawne oznaczenie kont testowych (app_activity_test_accounts) — tylko admin.
-- 5. Retencja 12 miesięcy: purge_app_visits() przy każdej nowej wizycie, przy odczycie
--    raportu i z harmonogramu w bazie (pg_cron, osobny skrypt w pakiecie wdrożeniowym).
-- 6. admin_activity_report(): podsumowanie per konto; admin_activity_events(): zdarzenia
--    stronicowane, filtrowane po kontach. Każde zdarzenie liczone według WŁASNEJ daty
--    (wysyłka wg sent_at, doręczenie i otwarcie wg occurred_at, wejście wg started_at,
--    wyświetlenie propozycji wg znanych dat pierwszego/ostatniego odczytu).
--    TYLKO ODCZYT rejestrów maili i odczytów: brak wpływu na kredyty, statusy propozycji
--    i informacje o odczytach widoczne dla dostawcy.
--
-- Bez adresów IP, bez user-agenta, bez tokenów. Pole profiles.last_active_at
-- (migracja 042) zostaje bez zmian — raport pokazuje je osobno jako dane sprzed
-- dziennika, bez wnioskowania o jego pochodzeniu (podaje tylko, ile kont ma tę samą wartość).
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

-- ── 2. ustawienia dziennika: wyłącznik + początek zbierania ─────────────────
create table if not exists public.app_activity_settings (
  id                boolean primary key default true check (id),
  collecting_since  timestamptz
);
alter table public.app_activity_settings
  add column if not exists enabled boolean not null default false,
  add column if not exists enabled_changed_at timestamptz;
insert into public.app_activity_settings (id, enabled) values (true, false) on conflict (id) do nothing;
comment on table public.app_activity_settings is
  'Jeden wiersz. enabled = zapis wejść włączony (domyślnie false; włączenie świadomym poleceniem SQL). collecting_since = pierwsze wejście zapisane w dzienniku.';

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
revoke all on table public.app_visits, public.app_activity_settings, public.app_activity_test_accounts from public, anon, authenticated, service_role;
grant select on table public.app_visits, public.app_activity_settings, public.app_activity_test_accounts to authenticated;  -- RLS zawęża do admina
revoke all on sequence public.app_visits_id_seq from public, anon, authenticated, service_role;

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
  -- bariera z wyłącznikiem: blokada WSPÓŁDZIELONA modułu do końca transakcji. Skrypt
  -- wyłączenia (04) bierze blokadę WYŁĄCZNĄ, więc czeka na trwające zapisy, a wywołania
  -- rozpoczęte po nim czytają już enabled = false. Po zakończeniu 04 nic się nie dopisze.
  -- Bariera działa przy READ COMMITTED (domyślny poziom PostgREST): każde polecenie po blokadzie
  -- widzi zatwierdzony stan przełącznika. Na wyższym poziomie migawka mogłaby pochodzić sprzed
  -- wyłączenia — wtedy niczego nie zapisujemy.
  if current_setting('transaction_isolation') <> 'read committed' then
    return jsonb_build_object('recorded', false, 'reason', 'isolation');
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('app_activity:switch', 0));
  if not coalesce((select s.enabled from public.app_activity_settings s where s.id), false) then
    return jsonb_build_object('recorded', false, 'reason', 'disabled');
  end if;
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
    update public.app_activity_settings set collecting_since = coalesce(collecting_since, now()) where id;
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

-- ── 8. wspólna walidacja okresu ─────────────────────────────────────────────
create or replace function public.app_activity_period(p_from timestamptz, p_to timestamptz)
returns table (v_from timestamptz, v_to timestamptz)
language plpgsql
stable
set search_path = public
as $$
declare
  t timestamptz := coalesce(p_to, now());
  f timestamptz := coalesce(p_from, coalesce(p_to, now()) - interval '30 days');
begin
  if f >= t then
    raise exception 'aktywność: początek okresu musi być przed końcem' using errcode = '22023';
  end if;
  if t - f > interval '366 days' then
    raise exception 'aktywność: okres dłuższy niż 366 dni' using errcode = '22023';
  end if;
  return query select f, t;
end;
$$;

-- ── 9. zdarzenia w okresie (wspólne źródło dla raportu i osi czasu) ─────────
-- Każde zdarzenie ma własną datę `at` i mieści się w [from, to). Rodzaje:
--   visit            zarejestrowane wejście (data rozpoczęcia wizyty)
--   email_sent       wysłano (przyjęte do wysyłki przez Resend) — PreConnect / marketing
--   email_delivered  doręczono (przyjęte przez serwer odbiorcy)
--   email_opened     zarejestrowane otwarcie (pobrany obraz śledzący)
--   email_bounced / email_complained
--   app_view_first / app_view_last  pierwsze / ostatnie wyświetlenie propozycji w aplikacji
--                    (rejestr przechowuje tylko te dwie daty i łączną liczbę odczytów)
create or replace function public.app_activity_event_rows(p_from timestamptz, p_to timestamptz, p_profile_ids uuid[] default null)
returns table (profile_id uuid, kind text, source text, at timestamptz, ref text, detail jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select v.profile_id, 'visit'::text as kind, null::text as source, v.started_at as at, 'v' || v.id as ref,
           jsonb_build_object('last_seen_at', v.last_seen_at, 'hit_count', v.hit_count) as detail
      from public.app_visits v
     where v.started_at >= p_from and v.started_at < p_to
    union all
    select m.buyer_profile_id, 'email_sent', 'preconnect', m.sent_at, 'pc:' || m.resend_message_id,
           jsonb_build_object('message', m.resend_message_id, 'retailer_id', m.retailer_id, 'proposals', coalesce(array_length(m.legacy_ids, 1), 0))
      from public.legacy_send_messages m
     where m.buyer_profile_id is not null and m.sent_at >= p_from and m.sent_at < p_to
    union all
    select m.buyer_profile_id,
           case e.event_type when 'email.delivered' then 'email_delivered' when 'email.opened' then 'email_opened'
                             when 'email.bounced' then 'email_bounced' else 'email_complained' end,
           'preconnect', e.occurred_at, 'pce:' || e.event_id,
           jsonb_build_object('message', m.resend_message_id, 'sent_at', m.sent_at)
      from public.legacy_send_email_events e
      join public.legacy_send_messages m on m.resend_message_id = e.resend_message_id
     where m.buyer_profile_id is not null and e.status <> 'ignored'
       and e.event_type in ('email.delivered','email.opened','email.bounced','email.complained')
       and e.occurred_at >= p_from and e.occurred_at < p_to
    union all
    select mm.profile_id, 'email_sent', 'marketing', mm.sent_at, 'mk:' || mm.resend_message_id,
           jsonb_build_object('message', mm.resend_message_id, 'campaign', c.name)
      from public.marketing_messages mm
      left join public.marketing_campaigns c on c.id = mm.campaign_id
     -- wysłano = potwierdzenie wysyłki (id Resend + sent_at): `accepted` albo `suppressed` po wypisie
     -- W TRAKCIE wysyłki (marketing_record_result zachowuje wtedy id i sent_at). Wiadomość wykluczona
     -- PRZED wysyłką (suppressed_before_send / suppressed_at_send) nie ma id Resend — nie liczy się.
     where mm.profile_id is not null and mm.is_test = false
       and (mm.state = 'accepted' or (mm.state = 'suppressed' and mm.resend_message_id is not null and mm.sent_at is not null))
       and mm.resend_message_id is not null and mm.sent_at >= p_from and mm.sent_at < p_to
    union all
    select mm.profile_id,
           case e.event_type when 'email.delivered' then 'email_delivered' when 'email.opened' then 'email_opened'
                             when 'email.bounced' then 'email_bounced' else 'email_complained' end,
           'marketing', e.occurred_at, 'mke:' || e.event_id,
           jsonb_build_object('message', mm.resend_message_id, 'campaign', c.name, 'sent_at', mm.sent_at)
      from public.marketing_email_events e
      join public.marketing_messages mm on mm.resend_message_id = e.resend_message_id
      left join public.marketing_campaigns c on c.id = mm.campaign_id
     where mm.profile_id is not null and mm.is_test = false and e.status <> 'ignored'
       and e.event_type in ('email.delivered','email.opened','email.bounced','email.complained')
       and e.occurred_at >= p_from and e.occurred_at < p_to
    union all
    select ar.buyer_profile_id, 'app_view_first', 'preconnect', ar.first_read_at, 'arf' || ar.id,
           jsonb_build_object('legacy_id', ar.legacy_id, 'channel', ar.channel, 'read_count_total', ar.read_count)
      from public.legacy_send_app_reads ar
     where ar.buyer_profile_id is not null and ar.first_read_at >= p_from and ar.first_read_at < p_to
    union all
    select ar.buyer_profile_id, 'app_view_last', 'preconnect', ar.last_read_at, 'arl' || ar.id,
           jsonb_build_object('legacy_id', ar.legacy_id, 'channel', ar.channel, 'read_count_total', ar.read_count)
      from public.legacy_send_app_reads ar
     where ar.buyer_profile_id is not null and ar.last_read_at > ar.first_read_at
       and ar.last_read_at >= p_from and ar.last_read_at < p_to
  )
  select ev.profile_id, ev.kind, ev.source, ev.at, ev.ref, ev.detail
    from ev
    join public.profiles p on p.id = ev.profile_id
   where p.role::text in ('buyer','supplier')
     and (p_profile_ids is null or ev.profile_id = any(p_profile_ids));
$$;

-- ── 10. raport: podsumowanie per konto (admin) ──────────────────────────────
create or replace function public.admin_activity_report(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_set  public.app_activity_settings%rowtype;
  v_accounts jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_activity_report: tylko administrator' using errcode = '42501';
  end if;
  select pp.v_from, pp.v_to into v_from, v_to from public.app_activity_period(p_from, p_to) pp;

  perform public.purge_app_visits();
  select * into v_set from public.app_activity_settings s where s.id;

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
  shared as (
    select p.last_active_at, count(*)::int as n
      from public.profiles p where p.last_active_at is not null group by p.last_active_at
  ),
  last_vis as (   -- ostatnie ZAPISANE wejście przed końcem okresu (także sprzed okresu): początek wizyty
                  -- albo jej ostatnie wczytanie, jeśli było przed końcem — bez tworzenia czasu granicznego
    select v.profile_id,
           max(greatest(v.started_at, case when v.last_seen_at < v_to then v.last_seen_at end)) as last_visit_at
      from public.app_visits v where v.started_at < v_to group by v.profile_id
  ),
  ev as (select * from public.app_activity_event_rows(v_from, v_to, null)),
  agg as (
    select e.profile_id,
           count(*) filter (where e.kind = 'visit')                                              as visits,
           count(*) filter (where e.kind = 'email_sent')                                         as emails_sent,
           count(distinct e.detail->>'message') filter (where e.kind = 'email_delivered')        as emails_delivered,
           count(distinct e.detail->>'message') filter (where e.kind = 'email_opened')           as emails_opened,
           max(e.at) filter (where e.kind = 'email_opened')                                      as last_opened_at,
           count(distinct e.detail->>'legacy_id') filter (where e.kind in ('app_view_first','app_view_last')) as proposals_viewed,
           max(e.at) filter (where e.kind in ('app_view_first','app_view_last'))                 as last_view_at,
           count(*)                                                                              as events
      from ev e group by e.profile_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', a.id, 'role', a.role, 'name', a.name, 'email', a.email, 'active', a.active,
           'company_id', a.company_id, 'company_name', a.company_name,
           'retailer_id', a.retailer_id, 'retailer_name', a.retailer_name,
           'is_test', a.is_test, 'test_note', a.test_note, 'created_at', a.created_at,
           'visits', coalesce(g.visits, 0), 'last_visit_at', lv.last_visit_at,
           'emails_sent', coalesce(g.emails_sent, 0), 'emails_delivered', coalesce(g.emails_delivered, 0),
           'emails_opened', coalesce(g.emails_opened, 0), 'last_opened_at', g.last_opened_at,
           'proposals_viewed', coalesce(g.proposals_viewed, 0), 'last_view_at', g.last_view_at,
           'events', coalesce(g.events, 0),
           'legacy_last_active_at', a.last_active_at,
           'legacy_last_active_shared', sh.n
         ) order by coalesce(lv.last_visit_at, a.last_active_at) desc nulls last, a.name, a.id), '[]'::jsonb)
    into v_accounts
    from acc a
    left join last_vis lv on lv.profile_id = a.id
    left join agg g on g.profile_id = a.id
    left join shared sh on sh.last_active_at = a.last_active_at;

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'from', v_from, 'to', v_to, 'generated_at', now(),
      'enabled', coalesce(v_set.enabled, false),
      'collecting_since', v_set.collecting_since,
      'history_from', case when v_set.collecting_since is null then null else greatest(v_set.collecting_since, now() - interval '12 months') end,
      'retention_months', 12, 'dedupe_minutes', 30),
    'accounts', v_accounts);
end;
$$;

-- ── 11. zdarzenia: filtrowane po kontach (admin) ────────────────────────────
-- Jedno wywołanie = jedna migawka danych. Eksport i oś czasu pobierają całość JEDNYM
-- wywołaniem (limit do 50 000); gdy total > limit, interfejs odmawia zamiast łączyć strony
-- z różnych chwil (dopisany webhook między stronami dublowałby lub gubił zdarzenia).
create or replace function public.admin_activity_events(
  p_from timestamptz default null, p_to timestamptz default null,
  p_profile_ids uuid[] default null, p_limit integer default 1000, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 50000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_events jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_activity_events: tylko administrator' using errcode = '42501';
  end if;
  select pp.v_from, pp.v_to into v_from, v_to from public.app_activity_period(p_from, p_to) pp;

  select count(*)::int into v_total from public.app_activity_event_rows(v_from, v_to, p_profile_ids);
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', x.profile_id, 'kind', x.kind, 'source', x.source, 'at', x.at, 'detail', x.detail)
                            order by x.at desc, x.profile_id, x.ref), '[]'::jsonb)
    into v_events
    from (select * from public.app_activity_event_rows(v_from, v_to, p_profile_ids)
           order by at desc, profile_id, ref
           limit v_limit offset v_offset) x;

  return jsonb_build_object('from', v_from, 'to', v_to, 'total', v_total, 'offset', v_offset, 'limit', v_limit, 'events', v_events);
end;
$$;

-- ── 12. uprawnienia funkcji ─────────────────────────────────────────────────
revoke all on function public.purge_app_visits() from public, anon, authenticated, service_role;
revoke all on function public.app_activity_period(timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.app_activity_event_rows(timestamptz, timestamptz, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.record_app_visit() from public, anon, service_role;
revoke all on function public.admin_set_activity_test_account(uuid, boolean, text) from public, anon, service_role;
revoke all on function public.admin_activity_report(timestamptz, timestamptz) from public, anon, service_role;
revoke all on function public.admin_activity_events(timestamptz, timestamptz, uuid[], integer, integer) from public, anon, service_role;

grant execute on function public.record_app_visit() to authenticated;                                                  -- tożsamość z auth.uid()
grant execute on function public.admin_set_activity_test_account(uuid, boolean, text) to authenticated;                 -- guard is_admin() w środku
grant execute on function public.admin_activity_report(timestamptz, timestamptz) to authenticated;                      -- guard is_admin() w środku
grant execute on function public.admin_activity_events(timestamptz, timestamptz, uuid[], integer, integer) to authenticated;  -- guard is_admin() w środku

commit;
