-- ============================================================================
-- 20260927120000 — bezpłatne kredyty PreConnect przyznawane przez admina
-- [feat/free-credit-grants] (v2 po review Codexa 27.09)
--
-- Cel:
--   1. Jednoznaczne ŹRÓDŁO kredytu na wierszu `packages`: 'purchase' (zakup,
--      PayU/proforma/ręczne ustawienie) albo 'grant' (bezpłatne przyznanie
--      przez organizatora) + powód, wiadomość dla odbiorcy, kto i kiedy
--      przyznał, partia. Notatka wewnętrzna admina żyje WYŁĄCZNIE w partii
--      (`package_grant_batches.note`) — wiersz `packages` czyta dostawca (RLS).
--   2. Historia przyznań: `package_grant_batches` (jedna partia = jedno
--      kliknięcie admina dla N firm) + klucz idempotencji: powtórka tego samego
--      formularza zwraca pierwotny wynik, ten sam klucz z INNYMI parametrami
--      jest odrzucany, dwa równoległe wywołania nie tworzą dwóch partii.
--   3. RPC `admin_grant_free_credits` — jedyna droga przyznania. Domyślna
--      ważność: 3 miesiące kalendarzowe od przyznania (liczone w bazie).
--      Kupione kredyty bez zmian (purchase_package nadal +1 rok).
--   4. RPC `mark_credit_grant_seen` — dostawca zamyka baner o przyznaniu.
--   5. RPC `charge_legacy_send_first_seen` — ATOMOWE rozliczenie kredytu przy
--      pierwszym odczycie propozycji: blokada wiersza wysyłki i pakietu,
--      kolejność grant → purchase → najbliższa ważność → najstarszy,
--      idempotencja po znaczniku na wysyłce, jeden UPDATE + wallet_tx + znacznik
--      w jednej transakcji (zastępuje nietransakcyjną ścieżkę w Netlify).
--   6. Widok `company_capacity` rozszerzony o rozbicie pozostałych kredytów
--      na bezpłatne / kupione i najbliższe daty ważności każdej puli.
--   7. `business_today()` — JEDEN dzień biznesowy (Europe/Warsaw) dla domyślnej
--      ważności przyznań, kwalifikacji pakietu do pobrania i salda w widoku;
--      nie zależy od strefy sesji ani od UTC (review Codexa v2, P2).
--   8. RPC `mark_legacy_send_seen` — CAŁA aktualizacja „odczytano” (status, seenAt,
--      readAt/readType, emailOpenedAt) + rozliczenie w jednej transakcji, scalanie
--      tylko dozwolonych pól na AKTUALNYM wierszu pod blokadą. Funkcja Netlify nie
--      zapisuje już JSON-u wysyłki, więc spóźniony zapis nie może skasować znacznika
--      rozliczenia (review Codexa v2, P1).
--   9. RPC `mark_legacy_sends_supplier_notified` — znacznik wysłanego powiadomienia
--      dostawcy scalany z AKTUALNYM JSON-em (tylko supplierNotifiedAt/Via/BatchSize);
--      notifier nie zapisuje już całego JSON-u ze snapshotu sprzed wysyłki maila
--      (review Codexa v3, P1).
--  10. Historyczne przyznania (uzupełnienie Codexa 27.09 / decyzja Artura): source
--      'grant' z flagą grant_historical (prezent rejestracyjny 5 kredytów, rekompensata
--      23.09 — 123 kredyty/93 firmy) oraz source 'legacy' (pakiet o nieustalonym źródle,
--      opis neutralny). RPC `admin_record_historical_grants` ODNOTOWUJE historię po
--      jawnej liście id: bez zmiany qty/qty_used/expires_at, bez nowego salda, bez
--      banera (grant_seen_at = now()), bez maila; autor i czas odnotowania osobno od
--      pierwotnego przyznania (granted_at = purchased_at, granted_by = NULL).
--
-- Stare wiersze `packages` dostają source = 'purchase' przez DEFAULT.
-- NIE klasyfikujemy ich po cenie zero — ewentualne wcześniejsze rekompensaty
-- oznacza się osobną, świadomą aktualizacją po ich zidentyfikowaniu.
--
-- Kolejność wdrożenia: kopia + kontrola istniejących przyznań → TA MIGRACJA →
-- weryfikacja → deploy frontu i funkcji. Stary kod funkcji działa po migracji
-- (nie czyta nowych kolumn); nowy kod bez migracji spadnie na starą ścieżkę.
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE, ON CONFLICT DO NOTHING.
-- ============================================================================

begin;

-- ── 0. dzień biznesowy ──────────────────────────────────────────────────────
create or replace function public.business_today(p_at timestamptz default now())
returns date
language sql
stable
as $$ select (p_at at time zone 'Europe/Warsaw')::date $$;
comment on function public.business_today(timestamptz) is
  'Data biznesowa Fresh Market (Europe/Warsaw). Używana do ważności przyznań, kwalifikacji pakietów do pobrania i salda w company_capacity — niezależnie od strefy sesji.';
grant execute on function public.business_today(timestamptz) to anon, authenticated, service_role;

-- ── 1. packages: źródło i metadane przyznania ───────────────────────────────
alter table public.packages
  add column if not exists source text not null default 'purchase',
  add column if not exists grant_reason text,
  add column if not exists grant_message text,
  add column if not exists granted_by uuid,
  add column if not exists granted_at timestamptz,
  add column if not exists grant_batch_id uuid,
  add column if not exists grant_seen_at timestamptz,
  add column if not exists grant_historical boolean not null default false,
  add column if not exists grant_recorded_by uuid,
  add column if not exists grant_recorded_at timestamptz;

-- gdyby wcześniejsza wersja tej migracji zdążyła dodać kolumnę notatki — usuń
alter table public.packages drop constraint if exists packages_grant_fields_check;
alter table public.packages drop column if exists grant_note;

alter table public.packages drop constraint if exists packages_source_check;
alter table public.packages drop constraint if exists packages_grant_reason_check;
alter table public.packages
  add constraint packages_source_check check (source in ('purchase', 'grant', 'legacy'));
alter table public.packages
  add constraint packages_grant_reason_check
  check (grant_reason is null or grant_reason in ('promotion', 'compensation', 'gift', 'registration', 'other'));
-- przyznanie MUSI mieć powód, partię i czas; autor obowiązkowy dla nowych, NULL dla historycznych;
-- zakup i pakiet o nieustalonym źródle NIE MOGĄ mieć pól przyznania
alter table public.packages
  add constraint packages_grant_fields_check check (
    (source = 'grant' and grant_reason is not null and grant_batch_id is not null and granted_at is not null
       and (granted_by is not null or grant_historical))
    or
    (source in ('purchase', 'legacy') and grant_reason is null and grant_batch_id is null
       and granted_by is null and granted_at is null and grant_message is null and grant_historical = false)
  );

create index if not exists idx_packages_company_source on public.packages(company_id, source);
create index if not exists idx_packages_grant_unseen on public.packages(company_id)
  where source = 'grant' and grant_seen_at is null;

comment on column public.packages.source is
  'purchase = kupione (PayU/proforma/ręcznie przez admina), grant = przyznane bezpłatnie przez organizatora (admin_grant_free_credits lub odnotowane historycznie), legacy = pakiet historyczny o nieustalonym źródle (opis neutralny, nie „kupione”).';
comment on column public.packages.grant_historical is
  'true = przyznanie sprzed tej migracji, odnotowane wstecz (admin_record_historical_grants): bez banera, bez nowego salda; granted_at = pierwotny purchased_at, granted_by = NULL, autor odnotowania w grant_recorded_by/at.';
comment on column public.packages.grant_reason is
  'Powód przyznania: promotion | compensation | gift | other. Tylko dla source = grant.';
comment on column public.packages.grant_message is
  'Wiadomość dla odbiorcy (dostawca ją widzi w panelu). Tylko dla source = grant. Notatka wewnętrzna admina jest WYŁĄCZNIE w package_grant_batches.note.';
comment on column public.packages.grant_seen_at is
  'Kiedy dostawca zamknął baner powiadomienia o przyznaniu (mark_credit_grant_seen). NULL = jeszcze nie widział.';

-- Plan katalogowy dla przyznań: FK packages.plan -> package_plans wymaga
-- istniejącego id. active = false → nie pojawia się w cenniku ani w
-- selektorach zakupu (front filtruje active), nie da się go kupić RPC-em.
insert into public.package_plans (id, tier, qty, price_eur, discount_pct, display_order, popular, active)
values ('grant', 'STANDARD', 1, 0, 0, 999, false, false)
on conflict (id) do nothing;

-- ── 2. historia partii przyznań ─────────────────────────────────────────────
create table if not exists public.package_grant_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  qty integer check (qty is null or qty between 1 and 100),          -- NULL dla partii historycznych (różne ilości)
  reason text not null check (reason in ('promotion', 'compensation', 'gift', 'registration', 'legacy', 'other')),
  message text,
  note text,
  expires_at date not null,
  company_ids uuid[] not null,
  company_count integer not null check (company_count >= 1),
  historical boolean not null default false,
  package_ids uuid[]
);
alter table public.package_grant_batches add column if not exists historical boolean not null default false;
alter table public.package_grant_batches add column if not exists package_ids uuid[];

comment on table public.package_grant_batches is
  'Jedna partia = jedno przyznanie bezpłatnych kredytów przez admina dla 1..N firm. idempotency_key chroni przed podwójnym wykonaniem tego samego formularza. note = notatka wewnętrzna (tylko admin).';

alter table public.package_grant_batches enable row level security;

drop policy if exists package_grant_batches_admin_select on public.package_grant_batches;
create policy package_grant_batches_admin_select on public.package_grant_batches
  for select using (is_admin());
-- brak polityk INSERT/UPDATE/DELETE: zapis wyłącznie przez RPC (security definer)

revoke all on public.package_grant_batches from anon, authenticated;
grant select on public.package_grant_batches to authenticated;

-- ── 3. RPC: przyznanie (admin) ──────────────────────────────────────────────
create or replace function public.admin_grant_free_credits(
  p_company_ids uuid[],
  p_qty integer,
  p_reason text,
  p_idempotency_key text,
  p_message text default null,
  p_note text default null,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_batch public.package_grant_batches%rowtype;
  v_ids uuid[];
  v_expires date;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_company uuid;
  v_package_id uuid;
  v_created integer := 0;
  v_missing uuid[];
  v_inserted boolean := false;
begin
  if v_admin is null or not is_admin() then
    raise exception 'admin_grant_free_credits: tylko administrator' using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'admin_grant_free_credits: brak klucza idempotencji' using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100 then
    raise exception 'admin_grant_free_credits: liczba kredytów musi być w zakresie 1..100' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('promotion', 'compensation', 'gift', 'other') then
    raise exception 'admin_grant_free_credits: nieznany powód %', p_reason using errcode = '22023';
  end if;

  -- kanoniczna, posortowana lista firm (deduplikacja) — ta sama dla porównania powtórek
  select array_agg(id order by id) into v_ids
  from (select distinct id from unnest(coalesce(p_company_ids, '{}'::uuid[])) as t(id) where id is not null) d;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'admin_grant_free_credits: brak firm' using errcode = '22023';
  end if;

  select array_agg(id) into v_missing
  from unnest(v_ids) as t(id)
  where not exists (select 1 from public.companies c where c.id = t.id);
  if v_missing is not null then
    raise exception 'admin_grant_free_credits: nieznane firmy: %', v_missing using errcode = '22023';
  end if;

  -- Domyślna ważność: 3 miesiące kalendarzowe od DNIA BIZNESOWEGO (Europe/Warsaw),
  -- liczone TU (koniec miesiąca obcinany przez Postgresa: 30.11 + 3 miesiące = 28/29.02).
  v_expires := coalesce(p_expires_at, (business_today() + interval '3 months')::date);
  if v_expires <= business_today() then
    raise exception 'admin_grant_free_credits: data ważności musi być późniejsza niż dziś' using errcode = '22023';
  end if;

  -- Partia: ON CONFLICT po kluczu idempotencji = jedna partia także przy dwóch
  -- równoległych wywołaniach (drugie nie dostaje 23505, tylko wchodzi w ścieżkę powtórki).
  insert into public.package_grant_batches
    (idempotency_key, created_by, qty, reason, message, note, expires_at, company_ids, company_count)
  values
    (p_idempotency_key, v_admin, p_qty, p_reason, v_message, v_note, v_expires, v_ids, array_length(v_ids, 1))
  on conflict (idempotency_key) do nothing
  returning * into v_batch;
  v_inserted := found;

  if not v_inserted then
    -- Powtórka klucza. Blokujemy partię (czekamy, aż równoległa transakcja skończy),
    -- potem porównujemy PARAMETRY: ta sama treść → wynik pierwotnej partii;
    -- inna treść pod tym samym kluczem → błąd, nic nie dopisujemy.
    select * into v_batch from public.package_grant_batches where idempotency_key = p_idempotency_key for update;
    if v_batch.qty is distinct from p_qty
       or v_batch.reason is distinct from p_reason
       or v_batch.company_ids is distinct from v_ids
       or v_batch.message is distinct from v_message
       or v_batch.note is distinct from v_note
       or (p_expires_at is not null and v_batch.expires_at is distinct from p_expires_at) then
      raise exception 'admin_grant_free_credits: klucz idempotencji użyty z innymi parametrami (partia % z %)', v_batch.id, v_batch.created_at
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'batch_id', v_batch.id,
      'created', 0,
      'already_done', true,
      'company_count', v_batch.company_count,
      'qty', v_batch.qty,
      'expires_at', v_batch.expires_at,
      'created_at', v_batch.created_at
    );
  end if;

  foreach v_company in array v_ids loop
    -- payment_ref = klucz unikalny (ux_packages_payment_ref): druga bariera przed
    -- podwójnym wierszem w tej samej partii dla tej samej firmy.
    insert into public.packages
      (company_id, plan, qty_total, qty_used, price_paid, currency, purchased_at, expires_at, payment_ref,
       source, grant_reason, grant_message, granted_by, granted_at, grant_batch_id)
    values
      (v_company, 'grant', p_qty, 0, 0, 'EUR', now(), v_expires, 'grant:' || v_batch.id || ':' || v_company,
       'grant', p_reason, v_message, v_admin, now(), v_batch.id)
    on conflict (payment_ref) where payment_ref is not null do nothing
    returning id into v_package_id;

    if v_package_id is not null then
      v_created := v_created + 1;
      insert into public.wallet_tx (company_id, type, amount, currency, description, reference_id, meta)
      values (
        v_company, 'adjustment', 0, 'EUR',
        'Bezpłatne kredyty PreConnect od organizatora: +' || p_qty || ' (' || p_reason || ')',
        v_package_id,
        jsonb_build_object(
          'kind', 'free_credit_grant',
          'grant_batch_id', v_batch.id,
          'package_id', v_package_id,
          'qty', p_qty,
          'reason', p_reason,
          'expires_at', v_expires,
          'granted_by', v_admin
        )
      );
    end if;
    v_package_id := null;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'created', v_created,
    'already_done', false,
    'company_count', v_batch.company_count,
    'qty', v_batch.qty,
    'expires_at', v_batch.expires_at,
    'created_at', v_batch.created_at
  );
end;
$$;

revoke all on function public.admin_grant_free_credits(uuid[], integer, text, text, text, text, date) from public;
grant execute on function public.admin_grant_free_credits(uuid[], integer, text, text, text, text, date) to authenticated;

-- ── 3b. RPC: odnotowanie HISTORYCZNYCH przyznań (bez zmiany salda) ─────────
-- Wejście: jawna lista id pakietów (z uzgodnionego archiwum), powód
-- ('registration' | 'compensation' | 'gift' | 'promotion' | 'other' → source 'grant',
--  'legacy' → source 'legacy', opis neutralny), klucz idempotencji, notatka.
-- Wolno wywołać: admin z aplikacji (auth.uid()) albo z SQL Editora / service_role
-- z jawnym p_recorded_by (id profilu admina). Nie tworzy kredytów, nie zmienia
-- qty/qty_used/expires_at, nie pokazuje banera (grant_seen_at = now()), nie wysyła nic.
create or replace function public.admin_record_historical_grants(
  p_reason text,
  p_package_ids uuid[],
  p_idempotency_key text,
  p_note text default null,
  p_recorded_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_batch public.package_grant_batches%rowtype;
  v_missing uuid[];
  v_taken uuid[];
  v_company_ids uuid[];
  v_expires date;
  v_updated integer := 0;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_actor is not null then
    if not is_admin() then
      raise exception 'admin_record_historical_grants: tylko administrator' using errcode = '42501';
    end if;
  else
    -- SQL Editor / service_role: wymagany jawny autor odnotowania będący adminem
    if current_user not in ('postgres', 'service_role', 'supabase_admin') then
      raise exception 'admin_record_historical_grants: tylko administrator' using errcode = '42501';
    end if;
    if p_recorded_by is null or not exists (select 1 from public.profiles where id = p_recorded_by and role = 'admin') then
      raise exception 'admin_record_historical_grants: p_recorded_by musi wskazywać profil administratora' using errcode = '22023';
    end if;
    v_actor := p_recorded_by;
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'admin_record_historical_grants: brak klucza idempotencji' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('promotion', 'compensation', 'gift', 'registration', 'legacy', 'other') then
    raise exception 'admin_record_historical_grants: nieznany powód %', p_reason using errcode = '22023';
  end if;

  select array_agg(id order by id) into v_ids
  from (select distinct id from unnest(coalesce(p_package_ids, '{}'::uuid[])) as t(id) where id is not null) d;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'admin_record_historical_grants: brak pakietów' using errcode = '22023';
  end if;

  -- powtórka klucza → wynik pierwotnej partii (porównanie listy i powodu)
  select * into v_batch from public.package_grant_batches where idempotency_key = p_idempotency_key for update;
  if found then
    if v_batch.reason is distinct from p_reason or v_batch.package_ids is distinct from v_ids then
      raise exception 'admin_record_historical_grants: klucz idempotencji użyty z innymi parametrami (partia %)', v_batch.id using errcode = '22023';
    end if;
    return jsonb_build_object('batch_id', v_batch.id, 'recorded', 0, 'already_done', true,
                              'company_count', v_batch.company_count, 'package_count', coalesce(array_length(v_batch.package_ids, 1), 0));
  end if;

  select array_agg(t.id) into v_missing from unnest(v_ids) as t(id)
  where not exists (select 1 from public.packages p where p.id = t.id);
  if v_missing is not null then
    raise exception 'admin_record_historical_grants: nieznane pakiety: %', v_missing using errcode = '22023';
  end if;
  -- wolno odnotować tylko pakiety dotąd nieoznaczone (source = purchase)
  select array_agg(p.id) into v_taken from public.packages p where p.id = any(v_ids) and p.source <> 'purchase';
  if v_taken is not null then
    raise exception 'admin_record_historical_grants: pakiety już oznaczone: %', v_taken using errcode = '22023';
  end if;

  select array_agg(distinct company_id order by company_id), max(coalesce(expires_at, business_today()))
    into v_company_ids, v_expires
  from public.packages where id = any(v_ids);

  insert into public.package_grant_batches
    (idempotency_key, created_by, qty, reason, message, note, expires_at, company_ids, company_count, historical, package_ids)
  values
    (p_idempotency_key, v_actor, null, p_reason, null, v_note, v_expires, v_company_ids, array_length(v_company_ids, 1), true, v_ids)
  returning * into v_batch;

  if p_reason = 'legacy' then
    update public.packages
       set source = 'legacy'
     where id = any(v_ids);
  else
    update public.packages
       set source = 'grant',
           grant_reason = p_reason,
           grant_historical = true,
           granted_at = coalesce(purchased_at, now()),
           granted_by = null,
           grant_batch_id = v_batch.id,
           grant_seen_at = now(),            -- bez banera: to nie jest nowe przyznanie
           grant_recorded_by = v_actor,
           grant_recorded_at = now()
     where id = any(v_ids);
  end if;
  get diagnostics v_updated = row_count;

  insert into public.wallet_tx (company_id, type, amount, currency, description, reference_id, meta)
  select p.company_id, 'adjustment', 0, coalesce(p.currency, 'EUR'),
         case when p_reason = 'legacy' then 'Pakiet historyczny — źródło nieustalone (odnotowanie)'
              else 'Odnotowanie wcześniejszego przyznania: ' || p_reason || ' (' || p.qty_total || ' kredytów)' end,
         p.id,
         jsonb_build_object('kind', 'historical_grant_record', 'grant_batch_id', v_batch.id, 'package_id', p.id,
                            'reason', p_reason, 'qty', p.qty_total, 'recorded_by', v_actor)
  from public.packages p where p.id = any(v_ids);

  return jsonb_build_object('batch_id', v_batch.id, 'recorded', v_updated, 'already_done', false,
                            'company_count', v_batch.company_count, 'package_count', array_length(v_ids, 1));
end;
$$;

revoke all on function public.admin_record_historical_grants(text, uuid[], text, text, uuid) from public, anon;
grant execute on function public.admin_record_historical_grants(text, uuid[], text, text, uuid) to authenticated, service_role;

-- ── 4. RPC: dostawca zamyka powiadomienie o przyznaniu ──────────────────────
create or replace function public.mark_credit_grant_seen(p_package_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := app_company_id();
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'mark_credit_grant_seen: wymagane zalogowanie' using errcode = '42501';
  end if;
  update public.packages
     set grant_seen_at = coalesce(grant_seen_at, now())
   where id = p_package_id
     and source = 'grant'
     and (company_id = v_company or is_admin());
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.mark_credit_grant_seen(uuid) from public;
grant execute on function public.mark_credit_grant_seen(uuid) to authenticated;

-- ── 5. RPC: atomowe rozliczenie kredytu przy pierwszym odczycie ─────────────
-- Wołane WYŁĄCZNIE z funkcji Netlify (service_role). Zastępuje sekwencję
-- select→update→insert w legacy-send-seen.js, która nie sprawdzała liczby
-- zmienionych wierszy (dwa równoległe odczyty mogły obciążyć ten sam ostatni
-- kredyt dwa razy) i nie była transakcyjna.
--
-- Zwraca jsonb:
--   charged=true  → {charged, billing_status:'charged', charge_at, package_id,
--                    package_source, charge_tx_id, charge_amount, currency}
--   charged=false → {charged:false, billing_status:'already_charged' | 'no_package_available',
--                    (przy already_charged: dotychczasowe pola znacznika)}
create or replace function public.charge_legacy_send_first_seen(
  p_send_id uuid,
  p_company_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send public.legacy_sends%rowtype;
  v_data jsonb;
  v_pkg public.packages%rowtype;
  v_amount numeric := 0;
  v_currency text;
  v_tx_id uuid;
  v_updated integer;
  v_marker jsonb;
begin
  if p_send_id is null or p_company_id is null then
    raise exception 'charge_legacy_send_first_seen: brak wysyłki lub firmy' using errcode = '22023';
  end if;

  -- 1. blokada wiersza wysyłki: drugi równoległy odczyt tej samej propozycji czeka tu
  select * into v_send from public.legacy_sends where id = p_send_id for update;
  if not found then
    raise exception 'charge_legacy_send_first_seen: wysyłka % nie istnieje', p_send_id using errcode = 'P0002';
  end if;
  v_data := coalesce(v_send.data, '{}'::jsonb);

  -- 2. idempotencja po znaczniku (te same pola, które czyta getChargeMarker w JS)
  if coalesce(v_data->>'chargeAt', v_data->>'chargedAt', v_data->>'chargeTxId') is not null
     or v_data->>'billingStatus' = 'charged' then
    return jsonb_build_object(
      'charged', false,
      'already_charged', true,
      'billing_status', 'charged',
      'charge_at', coalesce(v_data->>'chargeAt', v_data->>'chargedAt'),
      'package_id', v_data->>'packageId',
      'package_source', v_data->>'packageSource',
      'charge_tx_id', v_data->>'chargeTxId',
      'charge_amount', coalesce((v_data->>'chargeAmount')::numeric, 0),
      'currency', coalesce(v_data->>'chargeCurrency', 'EUR')
    );
  end if;

  -- 3. wybór pakietu: wolny kredyt, niewygasły; grant → purchase; najbliższa ważność
  --    (brak daty na końcu); remis = najstarszy. FOR UPDATE: równoległa transakcja
  --    czeka i po odblokowaniu widzi już zwiększone qty_used (wiersz odpada z WHERE).
  select * into v_pkg
  from public.packages p
  where p.company_id = p_company_id
    and (p.expires_at is null or p.expires_at >= business_today(p_now))
    and coalesce(p.qty_used, 0) < coalesce(p.qty_total, 0)
  order by (case when p.source = 'grant' then 0 else 1 end),
           p.expires_at asc nulls last,
           p.purchased_at asc nulls last,
           p.id
  limit 1
  for update of p;

  if not found then
    return jsonb_build_object('charged', false, 'already_charged', false, 'billing_status', 'no_package_available');
  end if;

  update public.packages
     set qty_used = coalesce(qty_used, 0) + 1
   where id = v_pkg.id
     and coalesce(qty_used, 0) = coalesce(v_pkg.qty_used, 0);
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'charge_legacy_send_first_seen: pakiet % zmieniony równolegle', v_pkg.id using errcode = '40001';
  end if;

  -- kwota informacyjna (jak dotąd: data.price → data.chargeAmount → cena/kredyt z pakietu);
  -- nienumeryczne wartości ignorujemy zamiast wywalać rozliczenie
  v_amount := coalesce(
    case when (v_data->>'price') ~ '^[0-9]+(\.[0-9]+)?$' then (v_data->>'price')::numeric end,
    case when (v_data->>'chargeAmount') ~ '^[0-9]+(\.[0-9]+)?$' then (v_data->>'chargeAmount')::numeric end,
    case when coalesce(v_pkg.price_paid, 0) > 0 and coalesce(v_pkg.qty_total, 0) > 0
         then v_pkg.price_paid / v_pkg.qty_total else 0 end,
    0);
  v_currency := coalesce(nullif(v_data->>'currency', ''), v_pkg.currency, 'EUR');

  insert into public.wallet_tx (company_id, type, amount, currency, description, reference_id, meta)
  values (
    p_company_id, 'send_charge', 0, v_currency,
    'Rozliczenie wysyłki PreConnect #' || v_send.legacy_id,
    v_send.id,
    jsonb_build_object(
      'legacy_send_id', v_send.legacy_id,
      'supplier_legacy_id', v_send.supplier_legacy_id,
      'package_id', v_pkg.id,
      'package_plan', v_pkg.plan,
      'package_source', coalesce(v_pkg.source, 'purchase'),
      'amount_eur', v_amount,
      'billing_model', 'package_credit'
    )
  )
  returning id into v_tx_id;

  v_marker := jsonb_build_object(
    'billingStatus', 'charged',
    'chargeAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'packageId', v_pkg.id,
    'packageSource', coalesce(v_pkg.source, 'purchase'),
    'chargeTxId', v_tx_id,
    'chargeAmount', v_amount,
    'chargeCurrency', v_currency
  );
  -- 4. znacznik na wysyłce w TEJ SAMEJ transakcji — kolejny odczyt trafia w krok 2
  update public.legacy_sends set data = v_data || v_marker, updated_at = now() where id = v_send.id;

  return jsonb_build_object(
    'charged', true,
    'already_charged', false,
    'billing_status', 'charged',
    'charge_at', v_marker->>'chargeAt',
    'package_id', v_pkg.id,
    'package_source', coalesce(v_pkg.source, 'purchase'),
    'charge_tx_id', v_tx_id,
    'charge_amount', v_amount,
    'currency', v_currency
  );
end;
$$;

revoke all on function public.charge_legacy_send_first_seen(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.charge_legacy_send_first_seen(uuid, uuid, timestamptz) to service_role;

-- ── 5b. RPC: „odczytano” + rozliczenie w JEDNEJ transakcji ─────────────────
-- Zastępuje sekwencję z legacy-send-seen.js (RPC rozliczenia → bezwarunkowy UPDATE
-- całego JSON-u ze starego odczytu), w której spóźniony zapis A mógł skasować znacznik
-- zapisany przez B i pozwolić na trzecie pobranie. Tu: blokada wiersza, następny status
-- liczony z AKTUALNEGO statusu (e-mail „opened” nie cofa „read”), scalanie TYLKO pól
-- odczytu (coalesce = pierwszy zapis wygrywa), potem rozliczenie tą samą transakcją.
-- Pola rozliczeń (chargeAt/packageId/chargeTxId/...) zapisuje wyłącznie
-- charge_legacy_send_first_seen; tutaj nigdy nie są nadpisywane ani czyszczone.
create or replace function public.mark_legacy_send_seen(
  p_send_id uuid,
  p_company_id uuid,
  p_channel text default 'app_list',
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send public.legacy_sends%rowtype;
  v_data jsonb;
  v_prev text;
  v_next text;
  v_read_type text;
  v_now_txt text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_patch jsonb;
  v_billing jsonb;
begin
  if p_send_id is null then
    raise exception 'mark_legacy_send_seen: brak wysyłki' using errcode = '22023';
  end if;
  if p_channel not in ('app_list', 'app_detail', 'email') then
    raise exception 'mark_legacy_send_seen: nieznany kanał %', p_channel using errcode = '22023';
  end if;

  select * into v_send from public.legacy_sends where id = p_send_id for update;
  if not found then
    raise exception 'mark_legacy_send_seen: wysyłka % nie istnieje', p_send_id using errcode = 'P0002';
  end if;
  v_prev := v_send.status;
  v_data := coalesce(v_send.data, '{}'::jsonb);

  if v_prev not in ('sent', 'opened', 'read', 'read_manual') then
    return jsonb_build_object('skipped', true, 'reason', 'status_' || coalesce(v_prev, 'null'), 'previous_status', v_prev, 'status', v_prev, 'data', v_data);
  end if;

  v_next := case
    when p_channel = 'email' then (case when v_prev = 'sent' then 'opened' else v_prev end)
    when v_prev in ('sent', 'opened') then 'read'
    else v_prev end;
  v_read_type := case p_channel when 'app_list' then 'auto_buyer_preconnect_list' when 'app_detail' then 'auto_buyer_open' else null end;

  v_patch := jsonb_build_object(
    'status', v_next,
    'seenAt', coalesce(v_data->>'seenAt', v_now_txt),
    'seenChannel', coalesce(v_data->>'seenChannel', p_channel)
  );
  if p_channel = 'email' then
    v_patch := v_patch || jsonb_build_object('emailOpenedAt', coalesce(v_data->>'emailOpenedAt', v_now_txt));
  end if;
  if v_read_type is not null then
    v_patch := v_patch || jsonb_build_object(
      'readAt', coalesce(v_data->>'readAt', v_now_txt),
      'readType', coalesce(v_data->>'readType', v_read_type)
    );
  end if;

  update public.legacy_sends
     set data = data || v_patch,
         status = v_next,
         updated_at = now(),
         email_opened_at = case when p_channel = 'email' then coalesce(email_opened_at, p_now) else email_opened_at end
   where id = p_send_id;

  if p_company_id is null then
    v_billing := jsonb_build_object('charged', false, 'already_charged', false, 'billing_status', 'company_not_found');
  else
    v_billing := public.charge_legacy_send_first_seen(p_send_id, p_company_id, p_now);
  end if;

  -- billingStatus inne niż 'charged' zapisujemy tylko, gdy wiersz NIE jest rozliczony
  if coalesce(v_billing->>'billing_status', '') <> 'charged' then
    update public.legacy_sends
       set data = data || jsonb_build_object('billingStatus', v_billing->>'billing_status')
     where id = p_send_id and coalesce(data->>'billingStatus', '') <> 'charged';
  end if;

  select data into v_data from public.legacy_sends where id = p_send_id;
  return jsonb_build_object(
    'skipped', false,
    'previous_status', v_prev,
    'status', v_next,
    'data', v_data,
    'billing', v_billing,
    'supplier_notified_before', (v_data->>'supplierNotifiedAt') is not null
  );
end;
$$;

revoke all on function public.mark_legacy_send_seen(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_legacy_send_seen(uuid, uuid, text, timestamptz) to service_role;

-- ── 5c. RPC: znacznik powiadomienia dostawcy o odczycie ────────────────────
-- Notifier (supplier-read-notify.js) czeka na odpowiedź poczty; w tym czasie inny
-- odczyt może rozliczyć kredyt. Dotąd notifier zapisywał CAŁY JSON ze snapshotu
-- sprzed maila i kasował znacznik rozliczenia. Tu: jedna instrukcja UPDATE scalająca
-- wyłącznie trzy pola powiadomienia z aktualnym wierszem; idempotentna (tylko wiersze
-- bez supplierNotifiedAt). Status, pola odczytu i rozliczenia nietknięte.
create or replace function public.mark_legacy_sends_supplier_notified(
  p_legacy_ids bigint[],
  p_via text default null,
  p_batch_size integer default null,
  p_notified_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_at text := to_char(p_notified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_legacy_ids is null or array_length(p_legacy_ids, 1) is null then
    return 0;
  end if;
  update public.legacy_sends
     set data = coalesce(data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'supplierNotifiedAt', v_at,
           'supplierNotifiedVia', p_via,
           'supplierNotifiedBatchSize', p_batch_size
         )),
         updated_at = now()
   where legacy_id = any(p_legacy_ids)
     and (data->>'supplierNotifiedAt') is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.mark_legacy_sends_supplier_notified(bigint[], text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_legacy_sends_supplier_notified(bigint[], text, integer, timestamptz) to service_role;

-- ── 6. company_capacity: rozbicie na pule ───────────────────────────────────
-- CREATE OR REPLACE VIEW pozwala tylko DOPISAĆ kolumny na końcu — istniejąca
-- lista kolumn (023) pozostaje w tej samej kolejności.
create or replace view public.company_capacity as
select
  c.id,
  c.name,
  c.country,
  c.account_status,
  c.preconnect_enabled,
  c.fm_b2b_enabled,
  c.pkg_plan,
  c.legacy_supplier_id,
  c.logo_url,
  coalesce(sum(case when p.expires_at >= business_today() then p.qty_total else 0 end), 0)::integer as qty_total,
  coalesce(sum(case when p.expires_at >= business_today() then p.qty_used  else 0 end), 0)::integer as qty_used,
  coalesce(sum(case when p.expires_at >= business_today() then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining,
  max(case when p.expires_at >= business_today() then p.expires_at end) as pkg_expiry,
  c.created_at,
  coalesce(sum(case when p.expires_at >= business_today() and p.source = 'grant'    then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining_free,
  coalesce(sum(case when p.expires_at >= business_today() and p.source = 'purchase' then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining_paid,
  coalesce(sum(case when p.expires_at >= business_today() and p.source = 'grant'    then p.qty_total else 0 end), 0)::integer as qty_total_free,
  coalesce(sum(case when p.expires_at >= business_today() and p.source = 'purchase' then p.qty_total else 0 end), 0)::integer as qty_total_paid,
  min(case when p.expires_at >= business_today() and p.source = 'grant'    and p.qty_total > p.qty_used then p.expires_at end) as free_expiry,
  min(case when p.expires_at >= business_today() and p.source = 'purchase' and p.qty_total > p.qty_used then p.expires_at end) as paid_expiry,
  coalesce(sum(case when p.expires_at >= business_today() and p.source = 'legacy' then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining_legacy
from public.companies c
left join public.packages p on p.company_id = c.id
group by c.id;

-- Zachowaj ustawienia z 054_views_lockdown (security_invoker + brak zapisu).
alter view public.company_capacity set (security_invoker = true);
revoke insert, update, delete, truncate, references, trigger on public.company_capacity from anon, authenticated;
grant select on public.company_capacity to authenticated;

commit;
