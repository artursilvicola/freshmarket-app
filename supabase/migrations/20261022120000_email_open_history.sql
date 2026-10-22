-- ============================================================================
-- 20261022120000 — historia otwarć per kupiec i niezawodne rozliczanie kredytów
--
-- Dlaczego (ustalenia z 22.10.2026):
--  * `legacy_sends.data.resendMessageIds` trzyma zbiorczą listę identyfikatorów
--    wiadomości i liczbę kupców. Nie wiadomo, KTÓRY kupiec dostał KTÓRY mail —
--    historia per osoba jest z tego nie do odtworzenia (i nie wolno jej zgadywać
--    po kolejności tablic).
--  * webhook Resend nie zostawiał śladu zdarzeń; powtórka tego samego webhooka
--    była nieodróżnialna od nowego, a zdarzenie przychodzące ZANIM zapisaliśmy
--    powiązanie wiadomości przepadało bezpowrotnie (`unknown_message_id`).
--  * wejścia do aplikacji nie były przypisane do uwierzytelnionego kupca.
--
-- Trzy tabele (zapis wyłącznie z backendu service_role przez RPC, odczyt tylko admin):
--
--   legacy_send_messages      wiadomość ↔ odbiorca: id Resend, kupiec, adres z chwili
--                             wysyłki, sieć, DOKŁADNE propozycje zawarte w tym mailu
--   legacy_send_email_events  rejestr zdarzeń Resend z deduplikacją po svix-id;
--                             zdarzenie bez znanej wiadomości czeka jako `orphan`
--   legacy_send_app_reads     wejścia do aplikacji przypisane do kupca (osobno od piksela)
--
-- Rozliczenie kredytu NIE zmienia się: nadal wyłącznie `mark_legacy_send_seen`
-- → `charge_legacy_send_first_seen` (jedna propozycja do jednej sieci = najwyżej
-- jedno pobranie, idempotentnie po znaczniku). Ta migracja dokłada tylko ewidencję
-- i powiązania; nie dotyka `legacy_sends`, `packages` ani `wallet_tx`.
--
-- Decyzja Artura (22.10): otwarcie maila nadal rozlicza kredyt. Zachowane.
--
-- Kolejność wdrożenia: TA MIGRACJA → deploy funkcji. Stary kod nie zna nowych
-- tabel i działa po migracji bez zmian. Nowy kod bez migracji: webhook odpowiada
-- 500 (Svix ponawia), batch raportuje brak powiązania — nic nie rozlicza na ślepo.
--
-- Idempotentne: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE, DROP POLICY IF EXISTS. Bez zmian w danych.
-- ============================================================================

begin;

-- ── 1. wiadomość ↔ odbiorca ─────────────────────────────────────────────────
create table if not exists public.legacy_send_messages (
  resend_message_id text primary key,
  retailer_id       integer not null references public.retailers(id),
  buyer_profile_id  uuid references public.profiles(id) on delete set null,
  to_email          text not null,
  legacy_ids        bigint[] not null,
  send_key          text,            -- Idempotency-Key użyty przy wysyłce do Resend
  locale            text,
  sent_at           timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists idx_legacy_send_messages_retailer on public.legacy_send_messages(retailer_id);
create index if not exists idx_legacy_send_messages_buyer on public.legacy_send_messages(buyer_profile_id) where buyer_profile_id is not null;
create index if not exists idx_legacy_send_messages_legacy_ids on public.legacy_send_messages using gin(legacy_ids);
create index if not exists idx_legacy_send_messages_send_key on public.legacy_send_messages(send_key) where send_key is not null;

comment on table public.legacy_send_messages is
  'Jedna wysłana wiadomość PreConnect do jednego kupca: id Resend, kupiec, adres z chwili wysyłki, sieć i DOKŁADNE propozycje w tym mailu. Źródło prawdy dla historii per odbiorca; zapis tylko z backendu.';

alter table public.legacy_send_messages enable row level security;
drop policy if exists lsm_admin_read on public.legacy_send_messages;
create policy lsm_admin_read on public.legacy_send_messages for select using (public.is_admin());
revoke all on table public.legacy_send_messages from public, anon;
grant select on table public.legacy_send_messages to authenticated;   -- RLS zawęża do admina
grant select, insert, update on table public.legacy_send_messages to service_role;

-- ── 2. rejestr zdarzeń Resend ───────────────────────────────────────────────
create table if not exists public.legacy_send_email_events (
  event_id          text primary key,            -- svix-id: ten sam webhook = ten sam wiersz
  resend_message_id text not null,
  event_type        text not null,
  occurred_at       timestamptz,                 -- created_at z ładunku Resend
  received_at       timestamptz not null default now(),
  payload           jsonb not null,
  status            text not null default 'pending'
                    check (status in ('pending','processed','orphan','ignored','error')),
  attempts          integer not null default 0,
  processed_at      timestamptz,
  last_error        text,
  result            jsonb
);
create index if not exists idx_lsee_message on public.legacy_send_email_events(resend_message_id);
create index if not exists idx_lsee_open on public.legacy_send_email_events(status)
  where status in ('pending','orphan','error');
create index if not exists idx_lsee_type_time on public.legacy_send_email_events(event_type, occurred_at);

comment on table public.legacy_send_email_events is
  'Rejestr zdarzeń Resend (sent/delivered/opened/clicked/bounced/complained) z deduplikacją po svix-id. orphan = wiadomość jeszcze nie powiązana (zdarzenie czeka), error = przetwarzanie do ponowienia.';

alter table public.legacy_send_email_events enable row level security;
drop policy if exists lsee_admin_read on public.legacy_send_email_events;
create policy lsee_admin_read on public.legacy_send_email_events for select using (public.is_admin());
revoke all on table public.legacy_send_email_events from public, anon;
grant select on table public.legacy_send_email_events to authenticated;
grant select, insert, update on table public.legacy_send_email_events to service_role;

-- ── 3. wejścia do aplikacji per kupiec ──────────────────────────────────────
create table if not exists public.legacy_send_app_reads (
  id               bigserial primary key,
  legacy_id        bigint not null,
  buyer_profile_id uuid references public.profiles(id) on delete set null,
  reader_role      text,
  channel          text not null check (channel in ('app_list','app_detail')),
  first_read_at    timestamptz not null default now(),
  last_read_at     timestamptz not null default now(),
  read_count       integer not null default 1
);
create unique index if not exists ux_lsar_read on public.legacy_send_app_reads(legacy_id, channel, coalesce(buyer_profile_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_lsar_legacy on public.legacy_send_app_reads(legacy_id);

comment on table public.legacy_send_app_reads is
  'Wejścia do aplikacji (lista / otwarcie propozycji) przypisane do uwierzytelnionego kupca. Osobno od piksela e-mail: to są różne zdarzenia i nie wolno ich utożsamiać.';

alter table public.legacy_send_app_reads enable row level security;
drop policy if exists lsar_admin_read on public.legacy_send_app_reads;
create policy lsar_admin_read on public.legacy_send_app_reads for select using (public.is_admin());
revoke all on table public.legacy_send_app_reads from public, anon;
grant select on table public.legacy_send_app_reads to authenticated;
grant select, insert, update on table public.legacy_send_app_reads to service_role;
grant usage, select on sequence public.legacy_send_app_reads_id_seq to service_role;

-- ── 4. record_legacy_send_message — powiązanie zaraz po akceptacji przez Resend
-- Idempotentne po resend_message_id. Zdarzenia, które przyszły wcześniej jako
-- `orphan`, wracają do `pending` i są oddane wołającemu do przetworzenia.
-- Wszystkie funkcje zwracają jsonb: brak kolumn wyniku = brak dwuznaczności
-- nazw (lekcja 42702 z 13.10).
create or replace function public.record_legacy_send_message(
  p_resend_message_id text,
  p_retailer_id integer,
  p_buyer_profile_id uuid,
  p_to_email text,
  p_legacy_ids bigint[],
  p_sent_at timestamptz default now(),
  p_send_key text default null,
  p_locale text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean := false;
  v_row public.legacy_send_messages%rowtype;
  v_pending jsonb;
begin
  if p_resend_message_id is null or btrim(p_resend_message_id) = '' then
    raise exception 'record_legacy_send_message: p_resend_message_id jest wymagany' using errcode = '22023';
  end if;
  if p_retailer_id is null or p_to_email is null or btrim(p_to_email) = ''
     or p_legacy_ids is null or cardinality(p_legacy_ids) = 0 or array_position(p_legacy_ids, null) is not null then
    raise exception 'record_legacy_send_message: niepełne dane wiadomości' using errcode = '22023';
  end if;

  insert into public.legacy_send_messages as m
    (resend_message_id, retailer_id, buyer_profile_id, to_email, legacy_ids, sent_at, send_key, locale)
  values
    (p_resend_message_id, p_retailer_id, p_buyer_profile_id, btrim(p_to_email),
     (select array_agg(distinct x order by x) from unnest(p_legacy_ids) x),
     coalesce(p_sent_at, now()), p_send_key, p_locale)
  on conflict on constraint legacy_send_messages_pkey do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_row from public.legacy_send_messages m where m.resend_message_id = p_resend_message_id;

  -- sieroty czekające na to powiązanie wracają do kolejki
  update public.legacy_send_email_events e
     set status = 'pending'
   where e.resend_message_id = p_resend_message_id
     and e.status = 'orphan';

  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', e.event_id, 'event_type', e.event_type,
           'occurred_at', e.occurred_at, 'payload', e.payload) order by e.occurred_at nulls last, e.received_at), '[]'::jsonb)
    into v_pending
    from public.legacy_send_email_events e
   where e.resend_message_id = p_resend_message_id
     and e.status = 'pending';

  return jsonb_build_object(
    'recorded', v_inserted,
    'message', jsonb_build_object(
      'resend_message_id', v_row.resend_message_id, 'retailer_id', v_row.retailer_id,
      'buyer_profile_id', v_row.buyer_profile_id, 'to_email', v_row.to_email,
      'legacy_ids', to_jsonb(v_row.legacy_ids), 'sent_at', v_row.sent_at, 'send_key', v_row.send_key),
    'pending_events', v_pending
  );
end;
$$;

-- ── 5. ingest_legacy_send_email_event — zapis zdarzenia PRZED przetworzeniem
-- Powtórka (ten sam svix-id) → duplicate, bez zmian. Nieznany typ → ignored.
-- Wiadomość nieznana → orphan (czeka na record_legacy_send_message).
create or replace function public.ingest_legacy_send_email_event(
  p_event_id text,
  p_resend_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.legacy_send_email_events%rowtype;
  v_msg public.legacy_send_messages%rowtype;
  v_status text;
  v_known boolean;
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'ingest_legacy_send_email_event: p_event_id jest wymagany' using errcode = '22023';
  end if;
  if p_resend_message_id is null or btrim(p_resend_message_id) = '' then
    raise exception 'ingest_legacy_send_email_event: p_resend_message_id jest wymagany' using errcode = '22023';
  end if;

  select * into v_existing from public.legacy_send_email_events e where e.event_id = p_event_id;
  if found then
    return jsonb_build_object('duplicate', true, 'status', v_existing.status,
                              'event_type', v_existing.event_type, 'resend_message_id', v_existing.resend_message_id);
  end if;

  select * into v_msg from public.legacy_send_messages m where m.resend_message_id = p_resend_message_id;
  v_known := found;

  v_status := case
    when p_event_type not in ('email.sent','email.delivered','email.opened','email.clicked',
                              'email.bounced','email.complained','email.delivery_delayed') then 'ignored'
    when not v_known then 'orphan'
    else 'pending' end;

  insert into public.legacy_send_email_events
    (event_id, resend_message_id, event_type, occurred_at, payload, status)
  values
    (p_event_id, p_resend_message_id, coalesce(p_event_type, ''), p_occurred_at, coalesce(p_payload, '{}'::jsonb), v_status)
  on conflict on constraint legacy_send_email_events_pkey do nothing;
  if not found then
    -- równoległa dostawa tego samego svix-id zdążyła pierwsza
    select * into v_existing from public.legacy_send_email_events e where e.event_id = p_event_id;
    return jsonb_build_object('duplicate', true, 'status', v_existing.status,
                              'event_type', v_existing.event_type, 'resend_message_id', v_existing.resend_message_id);
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'status', v_status,
    'event_type', p_event_type,
    'resend_message_id', p_resend_message_id,
    'message_known', v_known,
    'legacy_ids', case when v_known then to_jsonb(v_msg.legacy_ids) else '[]'::jsonb end,
    'retailer_id', case when v_known then v_msg.retailer_id end,
    'buyer_profile_id', case when v_known then v_msg.buyer_profile_id end
  );
end;
$$;

-- ── 6. finish_legacy_send_email_event — wynik przetwarzania ─────────────────
create or replace function public.finish_legacy_send_email_event(
  p_event_id text,
  p_status text,
  p_result jsonb default null,
  p_error text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_status not in ('processed','error','ignored','orphan','pending') then
    raise exception 'finish_legacy_send_email_event: zły status %', p_status using errcode = '22023';
  end if;
  update public.legacy_send_email_events e
     set status = p_status,
         attempts = e.attempts + 1,
         processed_at = case when p_status = 'processed' then now() else e.processed_at end,
         last_error = p_error,
         result = coalesce(p_result, e.result)
   where e.event_id = p_event_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ── 7. record_legacy_send_app_read — wejście do aplikacji per kupiec ────────
-- Pierwsze wejście tworzy wiersz; kolejne tylko podbijają last_read_at i licznik.
create or replace function public.record_legacy_send_app_read(
  p_legacy_id bigint,
  p_buyer_profile_id uuid,
  p_reader_role text,
  p_channel text,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean;
begin
  if p_legacy_id is null or p_channel not in ('app_list','app_detail') then
    raise exception 'record_legacy_send_app_read: złe dane' using errcode = '22023';
  end if;
  insert into public.legacy_send_app_reads as r
    (legacy_id, buyer_profile_id, reader_role, channel, first_read_at, last_read_at, read_count)
  values (p_legacy_id, p_buyer_profile_id, p_reader_role, p_channel, coalesce(p_at, now()), coalesce(p_at, now()), 1)
  on conflict (legacy_id, channel, coalesce(buyer_profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set last_read_at = greatest(r.last_read_at, excluded.last_read_at),
                read_count = r.read_count + 1,
                reader_role = coalesce(excluded.reader_role, r.reader_role)
  -- xmax = 0 tylko dla świeżo wstawionego wiersza (po DO UPDATE jest niezerowe)
  returning (xmax = 0) into v_inserted;
  return jsonb_build_object('legacy_id', p_legacy_id, 'channel', p_channel, 'first', coalesce(v_inserted, false));
end;
$$;

-- ── 8. admin_retailer_email_history — odczyt dla panelu admina ──────────────
-- Dla sieci: każda wysłana wiadomość z odbiorcą, dostarczeniem, pierwszym/ostatnim
-- otwarciem piksela, błędami — oraz OSOBNO wejścia do aplikacji per kupiec.
-- Brak zdarzenia otwarcia = „brak zarejestrowanego otwarcia", nie „nie przeczytał".
create or replace function public.admin_retailer_email_history(p_retailer_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  v_app_reads jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_retailer_email_history: tylko administrator' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x.sent_at desc, x.resend_message_id), '[]'::jsonb) into v_messages
  from (
    select m.resend_message_id, m.retailer_id, m.buyer_profile_id, m.to_email, m.legacy_ids,
           m.sent_at, m.send_key, m.locale,
           p.name as buyer_name, p.email as buyer_email_now, p.active as buyer_active,
           ev.delivered_at, ev.first_opened_at, ev.last_opened_at, ev.open_count,
           ev.bounced_at, ev.complained_at, ev.delayed_at, ev.last_event_error, ev.event_count
      from public.legacy_send_messages m
      left join public.profiles p on p.id = m.buyer_profile_id
      left join lateral (
        select min(e.occurred_at) filter (where e.event_type = 'email.delivered')  as delivered_at,
               min(e.occurred_at) filter (where e.event_type = 'email.opened')     as first_opened_at,
               max(e.occurred_at) filter (where e.event_type = 'email.opened')     as last_opened_at,
               count(*)           filter (where e.event_type = 'email.opened')     as open_count,
               min(e.occurred_at) filter (where e.event_type = 'email.bounced')    as bounced_at,
               min(e.occurred_at) filter (where e.event_type = 'email.complained') as complained_at,
               min(e.occurred_at) filter (where e.event_type = 'email.delivery_delayed') as delayed_at,
               max(e.last_error)  filter (where e.status = 'error')               as last_event_error,
               count(*) as event_count
          from public.legacy_send_email_events e
         where e.resend_message_id = m.resend_message_id
           and e.status <> 'ignored'
      ) ev on true
     where m.retailer_id = p_retailer_id
  ) x;

  select coalesce(jsonb_agg(y order by y.first_read_at), '[]'::jsonb) into v_app_reads
  from (
    select r.legacy_id, r.buyer_profile_id, r.reader_role, r.channel,
           r.first_read_at, r.last_read_at, r.read_count,
           p.name as buyer_name, p.email as buyer_email_now
      from public.legacy_send_app_reads r
      left join public.profiles p on p.id = r.buyer_profile_id
     where r.legacy_id in (select s.legacy_id from public.legacy_sends s where s.retailer_id = p_retailer_id)
  ) y;

  return jsonb_build_object('messages', v_messages, 'app_reads', v_app_reads);
end;
$$;

-- ── 9. uprawnienia ──────────────────────────────────────────────────────────
revoke all on function public.record_legacy_send_message(text, integer, uuid, text, bigint[], timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.ingest_legacy_send_email_event(text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.finish_legacy_send_email_event(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.record_legacy_send_app_read(bigint, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_retailer_email_history(integer) from public, anon;

grant execute on function public.record_legacy_send_message(text, integer, uuid, text, bigint[], timestamptz, text, text) to service_role;
grant execute on function public.ingest_legacy_send_email_event(text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.finish_legacy_send_email_event(text, text, jsonb, text) to service_role;
grant execute on function public.record_legacy_send_app_read(bigint, uuid, text, text, timestamptz) to service_role;
grant execute on function public.admin_retailer_email_history(integer) to authenticated;   -- guard is_admin() w środku

commit;
