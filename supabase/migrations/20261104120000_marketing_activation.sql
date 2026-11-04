-- ============================================================================
-- 20261104120000 — Marketing → Aktywacja PreConnect (faza 1)
--
-- Plan: preconnect-knowledge/docs/PLAN_MARKETING_PRECONNECT_DO_REVIEW_CLAUDE.md
-- Review + decyzje Artura (4.11.2026): docs/REVIEW_CLAUDE_PLAN_MARKETING_PRECONNECT_2026-11-04.md §8
--
-- Zasady (niezmienne):
--  * MARKETING NIGDY NIE ROZLICZA KREDYTÓW. Ta migracja nie dotyka legacy_sends,
--    legacy_send_messages, legacy_send_email_events, packages ani wallet_tx; żadna
--    funkcja tutaj nie woła mark_legacy_send_seen / charge_legacy_send_first_seen.
--  * Rejestr wiadomości: jeden wiersz = jeden adresat jednej kampanii, z ZAMROŻONĄ
--    treścią (subject/html/text) i stałym kluczem idempotencji do Resend.
--  * Ochrona przed duplikatem: unikalność (campaign_id, profile_id) dla wysyłek
--    nietestowych + unikalny idempotency_key + Idempotency-Key w Resend (ten sam
--    klucz + ten sam ładunek = ta sama wiadomość przez 24 h).
--  * Odzyskiwanie po przerwaniu funkcji: wiersz przechodzi pending → claimed (dzierżawa
--    lease_until). Gdy funkcja padnie w połowie, dzierżawa wygasa i NASTĘPNE wywołanie
--    zajmuje wiersz ponownie (ten sam klucz, ta sama treść → Resend oddaje tę samą
--    wiadomość, nie drugą). Po oknie ochrony Resend (first_claim_at + 23 h) wiersz
--    NIE jest ponawiany automatycznie → needs_review (ręczna decyzja).
--  * Zgoda: consent_source zapisane przy adresacie; wiersz bez consent_source nie
--    przechodzi przez claim (→ blocked_no_consent). Nie przypisujemy zgody
--    automatycznie do regulaminu 1.0 — źródło wpisuje administrator.
--  * Wypis / odbicie / skarga → marketing_suppressions (trwałe, między kampaniami);
--    claim sprawdza suppresję tuż przed wysyłką (→ suppressed).
--  * Dostęp: tabele czyta tylko admin (RLS is_admin()); zapis wyłącznie service_role
--    przez funkcje Netlify (które same sprawdzają rolę admina).
--
-- Idempotentne: IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS. Bez zmian w danych.
-- ============================================================================

begin;

-- ── 1. kampanie ─────────────────────────────────────────────────────────────
create table if not exists public.marketing_campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  template_key      text not null check (template_key in ('start_with_credits','return_active')),
  status            text not null default 'draft'
                    check (status in ('draft','approved','sending','sent','closed')),
  target_categories text[] not null default '{}',     -- potrzeby kupców (Oksana): kategorie
  target_keywords   text[] not null default '{}',     -- potrzeby kupców: słowa kluczowe w asortymencie
  needs_note        text,                             -- skąd potrzeby (notatka admina)
  reply_to          text,                             -- adres do odpowiedzi (do zatwierdzenia)
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  approved_by       uuid references public.profiles(id) on delete set null,
  approved_at       timestamptz,
  snapshot_at       timestamptz,                      -- chwila odczytu danych przy zatwierdzeniu
  sent_at           timestamptz,
  closed_at         timestamptz,
  note              text
);
comment on table public.marketing_campaigns is
  'Kampanie aktywizacyjne PreConnect do dostawców. Zatwierdzenie zamraża adresatów i treść w marketing_messages. Nie ma związku z rozliczaniem kredytów.';

-- ── 2. rejestr wiadomości (zamrożona treść, klucz idempotencji, dzierżawa) ─────
create table if not exists public.marketing_messages (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.marketing_campaigns(id) on delete cascade,
  company_id         uuid references public.companies(id) on delete set null,
  profile_id         uuid references public.profiles(id) on delete set null,
  to_email           text not null,
  locale             text not null default 'pl',
  segment            text,
  consent_source     text,                            -- źródło zgody wpisane przez admina; NULL = blokada wysyłki
  snapshot           jsonb not null default '{}'::jsonb,  -- saldo/rezerwacje/ważność z chwili zatwierdzenia
  subject            text not null,
  html               text not null,
  text_body          text not null,
  payload_hash       text not null,                   -- sha256(subject|html|text) — ponowienie wysyła DOKŁADNIE to
  idempotency_key    text not null unique,            -- marketing:{campaign}:{profile} (test: marketing-test:...)
  is_test            boolean not null default false,
  state              text not null default 'pending'
                     check (state in ('pending','claimed','accepted','rejected','uncertain','needs_review','suppressed','blocked_no_consent')),
  attempts           integer not null default 0,
  first_claim_at     timestamptz,
  claimed_at         timestamptz,
  lease_until        timestamptz,
  resend_message_id  text,
  sent_at            timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists uq_marketing_messages_campaign_profile
  on public.marketing_messages(campaign_id, profile_id) where profile_id is not null and is_test = false;
create index if not exists idx_marketing_messages_campaign_state on public.marketing_messages(campaign_id, state);
create index if not exists idx_marketing_messages_resend on public.marketing_messages(resend_message_id) where resend_message_id is not null;
create index if not exists idx_marketing_messages_email on public.marketing_messages(lower(to_email));
comment on table public.marketing_messages is
  'Jedna wiadomość marketingowa do jednego adresata: zamrożona treść, stały klucz idempotencji, stan wysyłki, dzierżawa (claim) i wynik. Ponowienie po przerwaniu wysyła tę samą treść pod tym samym kluczem.';

drop trigger if exists trg_marketing_messages_updated on public.marketing_messages;
create trigger trg_marketing_messages_updated before update on public.marketing_messages
  for each row execute function set_updated_at();

-- ── 3. trwałe wykluczenia (wypis, odbicie, skarga, ręczne) ───────────────────
create table if not exists public.marketing_suppressions (
  email        text primary key,                       -- zawsze lower(trim())
  reason       text not null check (reason in ('unsubscribe','bounce','complaint','manual')),
  source       text,                                   -- np. 'one-click', 'resend:email.bounced', 'admin'
  campaign_id  uuid references public.marketing_campaigns(id) on delete set null,
  profile_id   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
comment on table public.marketing_suppressions is
  'Adresy wyłączone z marketingu na stałe (między kampaniami). Nie wyłącza maili usługowych. Ponowne dopuszczenie = ręczne usunięcie wiersza z udokumentowaną podstawą.';

-- ── 4. rejestr zdarzeń Resend dla maili z tagiem kind=marketing ──────────────
create table if not exists public.marketing_email_events (
  event_id           text primary key,                 -- svix-id
  resend_message_id  text not null,
  event_type         text not null,
  occurred_at        timestamptz,
  received_at        timestamptz not null default now(),
  payload            jsonb not null,
  status             text not null default 'pending' check (status in ('pending','processed','ignored','error')),
  message_id         uuid references public.marketing_messages(id) on delete set null,
  processed_at       timestamptz,
  last_error         text
);
create index if not exists idx_marketing_email_events_message on public.marketing_email_events(resend_message_id);
create index if not exists idx_marketing_email_events_open on public.marketing_email_events(status) where status = 'pending';
comment on table public.marketing_email_events is
  'Zdarzenia Resend wyłącznie dla wiadomości marketingowych (routing po tagu kind=marketing w webhooku). Deduplikacja po svix-id. Nigdy nie trafiają do rejestru rozliczeń legacy_send_email_events.';

-- ── 5. RLS: odczyt admin, zapis service_role ────────────────────────────────
do $rls$
declare t text;
begin
  foreach t in array array['marketing_campaigns','marketing_messages','marketing_suppressions','marketing_email_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select using (public.is_admin())', t || '_admin_read', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$rls$;

-- ── 6. claim: zajmij wiadomości do wysyłki (dzierżawa + odzyskiwanie) ────────
-- Zwraca wiersze do wysłania. Reguły:
--  * pending → claimed; claimed z wygasłą dzierżawą → claimed ponownie (odzyskanie
--    po przerwaniu funkcji), o ile first_claim_at mieści się w oknie ochrony Resend;
--  * poza oknem → needs_review (bez wysyłki, ręczna decyzja);
--  * brak consent_source → blocked_no_consent; adres w suppresji → suppressed;
--  * FOR UPDATE SKIP LOCKED: dwa równoległe wywołania nie zajmą tego samego wiersza.
create or replace function public.marketing_claim_messages(
  p_campaign_id uuid,
  p_limit integer default 50,
  p_lease_seconds integer default 900,
  p_window_seconds integer default 82800
)
returns setof public.marketing_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := clock_timestamp();
  v_lease interval := make_interval(secs => greatest(coalesce(p_lease_seconds, 900), 1));
  v_win   interval := make_interval(secs => greatest(coalesce(p_window_seconds, 82800), 1));
  v_row   public.marketing_messages%rowtype;
  v_out   public.marketing_messages%rowtype;
  v_n     integer := 0;
begin
  if p_campaign_id is null then return; end if;
  for v_row in
    select m.* from public.marketing_messages m
     where m.campaign_id = p_campaign_id
       and m.is_test = false
       and (m.state = 'pending' or (m.state = 'claimed' and (m.lease_until is null or m.lease_until < v_now)))
     order by m.created_at
     for update skip locked
  loop
    exit when v_n >= greatest(coalesce(p_limit, 50), 1);
    if v_row.consent_source is null or btrim(v_row.consent_source) = '' then
      update public.marketing_messages set state = 'blocked_no_consent', last_error = 'consent_source_missing' where id = v_row.id;
      continue;
    end if;
    if exists (select 1 from public.marketing_suppressions s where s.email = lower(btrim(v_row.to_email))) then
      update public.marketing_messages set state = 'suppressed', last_error = 'suppressed_before_send' where id = v_row.id;
      continue;
    end if;
    if v_row.first_claim_at is not null and v_row.first_claim_at < v_now - v_win then
      update public.marketing_messages set state = 'needs_review', last_error = 'idempotency_window_elapsed' where id = v_row.id;
      continue;
    end if;
    update public.marketing_messages
       set state = 'claimed',
           attempts = attempts + 1,
           first_claim_at = coalesce(first_claim_at, v_now),
           claimed_at = v_now,
           lease_until = v_now + v_lease
     where id = v_row.id
     returning * into v_out;
    v_n := v_n + 1;
    return next v_out;
  end loop;
  return;
end;
$$;
comment on function public.marketing_claim_messages(uuid, integer, integer, integer) is
  'Zajmuje wiadomości marketingowe do wysyłki z dzierżawą. Odzyskuje wiersze po przerwanej funkcji (wygasła dzierżawa) w oknie ochrony Resend; poza oknem → needs_review. Blokuje brak zgody i adresy w suppresji.';

-- ── 7. wynik wysyłki jednej wiadomości ───────────────────────────────────────
-- accepted: poczta przyjęła (id Resend); rejected: poczta odrzuciła ładunek (nie
-- ponawiać automatycznie); uncertain: wynik nieznany (timeout) — zostaje claimed
-- z dzierżawą do odzyskania pod tym samym kluczem. Zdarzenia czekające (pending)
-- dla tego id Resend są dopinane do wiersza.
create or replace function public.marketing_record_result(
  p_message_id uuid,
  p_state text,
  p_resend_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.marketing_messages%rowtype;
  v_events integer := 0;
begin
  if p_state not in ('accepted','rejected','uncertain') then
    raise exception 'marketing_record_result: invalid state %', p_state using errcode = '22023';
  end if;
  select * into v_row from public.marketing_messages where id = p_message_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.state <> 'claimed' then
    -- ponowienie po tym, jak inny przebieg już zapisał wynik — nic nie nadpisujemy
    return jsonb_build_object('ok', false, 'reason', 'not_claimed', 'state', v_row.state);
  end if;
  if p_state = 'accepted' then
    update public.marketing_messages
       set state = 'accepted', resend_message_id = coalesce(p_resend_message_id, resend_message_id),
           sent_at = coalesce(sent_at, now()), lease_until = null, last_error = null
     where id = p_message_id;
    if p_resend_message_id is not null then
      -- [review Codexa #4] odbicie/skarga, które przyszły ZANIM zapisaliśmy id Resend, też wykluczają adres
      if exists (select 1 from public.marketing_email_events e
                  where e.resend_message_id = p_resend_message_id and e.status = 'pending'
                    and e.event_type in ('email.bounced','email.complained')) then
        insert into public.marketing_suppressions (email, reason, source, campaign_id, profile_id)
        select lower(btrim(v_row.to_email)),
               case when bool_or(e.event_type = 'email.complained') then 'complaint' else 'bounce' end,
               'resend:late-link', v_row.campaign_id, v_row.profile_id
          from public.marketing_email_events e
         where e.resend_message_id = p_resend_message_id and e.status = 'pending'
           and e.event_type in ('email.bounced','email.complained')
        on conflict (email) do nothing;
      end if;
      update public.marketing_email_events e
         set message_id = p_message_id, status = 'processed', processed_at = now()
       where e.resend_message_id = p_resend_message_id and e.status = 'pending';
      get diagnostics v_events = row_count;
    end if;
  elsif p_state = 'rejected' then
    update public.marketing_messages
       set state = 'rejected', lease_until = null, last_error = left(coalesce(p_error, 'rejected'), 500)
     where id = p_message_id;
  else
    -- uncertain: dzierżawa zostaje (odzyskanie po jej wygaśnięciu, ten sam klucz)
    update public.marketing_messages
       set state = 'claimed', last_error = left(coalesce(p_error, 'uncertain'), 500)
     where id = p_message_id;
  end if;
  return jsonb_build_object('ok', true, 'state', p_state, 'linked_events', v_events);
end;
$$;

-- ── 7b. [review Codexa #2] kontrola dopuszczenia TUŻ PRZED wysyłką ─────────────
-- Partia jest zajmowana z wyprzedzeniem; wypis/odbicie/cofnięcie zgody w trakcie partii
-- musi zatrzymać wiadomość. Wołane dla każdego wiersza bezpośrednio przed POST do Resend.
create or replace function public.marketing_precheck_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.marketing_messages%rowtype;
begin
  select * into v_row from public.marketing_messages where id = p_message_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.state <> 'claimed' then return jsonb_build_object('ok', false, 'reason', 'not_claimed', 'state', v_row.state); end if;
  if v_row.is_test then return jsonb_build_object('ok', true, 'test', true); end if;
  if v_row.consent_source is null or btrim(v_row.consent_source) = '' then
    update public.marketing_messages set state = 'blocked_no_consent', lease_until = null, last_error = 'consent_source_missing_at_send' where id = p_message_id;
    return jsonb_build_object('ok', false, 'reason', 'blocked_no_consent');
  end if;
  if exists (select 1 from public.marketing_suppressions s where s.email = lower(btrim(v_row.to_email))) then
    update public.marketing_messages set state = 'suppressed', lease_until = null, last_error = 'suppressed_at_send' where id = p_message_id;
    return jsonb_build_object('ok', false, 'reason', 'suppressed');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 8. zdarzenie Resend (tag kind=marketing) ─────────────────────────────────
-- Deduplikacja po svix-id. Odbicie / skarga → suppresja adresu z wiersza wiadomości
-- (gdy wiadomość znana) albo z ładunku `to` (gdy jeszcze nie powiązana).
create or replace function public.marketing_ingest_email_event(
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
  v_inserted boolean := false;
  v_msg public.marketing_messages%rowtype;
  v_email text;
  v_status text := 'processed';
begin
  insert into public.marketing_email_events (event_id, resend_message_id, event_type, occurred_at, payload)
  values (p_event_id, p_resend_message_id, p_event_type, p_occurred_at, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if not v_inserted then
    return jsonb_build_object('duplicate', true);
  end if;

  select * into v_msg from public.marketing_messages where resend_message_id = p_resend_message_id limit 1;
  if found then
    v_email := lower(btrim(v_msg.to_email));
  else
    -- [review Codexa #4] ładunek webhooka = {type, created_at, data:{to:[...]}} — adresat w data.to
    v_email := lower(btrim(coalesce(p_payload #>> '{data,to,0}', p_payload #>> '{data,to}', p_payload #>> '{to,0}', p_payload ->> 'to')));
    v_status := 'pending';   -- wiadomość jeszcze niepowiązana — marketing_record_result ją dopnie
  end if;

  if p_event_type in ('email.bounced','email.complained') and v_email is not null and v_email <> '' then
    insert into public.marketing_suppressions (email, reason, source, campaign_id, profile_id)
    values (v_email, case when p_event_type = 'email.bounced' then 'bounce' else 'complaint' end,
            'resend:' || p_event_type, v_msg.campaign_id, v_msg.profile_id)
    on conflict (email) do nothing;
  end if;

  update public.marketing_email_events
     set status = v_status, message_id = v_msg.id, processed_at = case when v_status = 'processed' then now() else null end
   where event_id = p_event_id;
  return jsonb_build_object('duplicate', false, 'status', v_status, 'message_id', v_msg.id, 'suppressed', p_event_type in ('email.bounced','email.complained'));
end;
$$;

-- ── 9. wypis ─────────────────────────────────────────────────────────────────
create or replace function public.marketing_suppress_email(
  p_email text,
  p_reason text,
  p_source text default null,
  p_campaign_id uuid default null,
  p_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;
  if p_reason not in ('unsubscribe','bounce','complaint','manual') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reason');
  end if;
  insert into public.marketing_suppressions (email, reason, source, campaign_id, profile_id)
  values (v_email, p_reason, p_source, p_campaign_id, p_profile_id)
  on conflict (email) do nothing;
  -- wiadomości jeszcze niewysłane do tego adresu: od razu wykluczone
  update public.marketing_messages
     set state = 'suppressed', last_error = 'suppressed_' || p_reason
   where lower(btrim(to_email)) = v_email and state in ('pending','claimed') and is_test = false;
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- ── 10. uprawnienia funkcji: wyłącznie service_role ─────────────────────────
revoke all on function public.marketing_claim_messages(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.marketing_record_result(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.marketing_ingest_email_event(text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.marketing_suppress_email(text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.marketing_precheck_message(uuid) from public, anon, authenticated;
grant execute on function public.marketing_claim_messages(uuid, integer, integer, integer) to service_role;
grant execute on function public.marketing_record_result(uuid, text, text, text) to service_role;
grant execute on function public.marketing_ingest_email_event(text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.marketing_suppress_email(text, text, text, uuid, uuid) to service_role;
grant execute on function public.marketing_precheck_message(uuid) to service_role;

commit;
