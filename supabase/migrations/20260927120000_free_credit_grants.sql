-- ============================================================================
-- 20260927120000 — bezpłatne kredyty PreConnect przyznawane przez admina
-- [feat/free-credit-grants]
--
-- Cel:
--   1. Jednoznaczne ŹRÓDŁO kredytu na wierszu `packages`: 'purchase' (zakup,
--      PayU/proforma/ręczne ustawienie) albo 'grant' (bezpłatne przyznanie
--      przez organizatora) + powód przyznania, wiadomość dla odbiorcy, notatka
--      wewnętrzna, kto i kiedy przyznał, partia.
--   2. Historia przyznań: `package_grant_batches` (jedna partia = jedno
--      kliknięcie admina dla N firm) + klucz idempotencji, żeby ponowne
--      wysłanie tego samego formularza (retry, dwuklik) nie przyznało
--      kredytów drugi raz.
--   3. RPC `admin_grant_free_credits` — jedyna droga przyznania. Domyślna
--      ważność: 3 miesiące kalendarzowe od przyznania. Kupione kredyty bez
--      zmian (purchase_package nadal +1 rok).
--   4. RPC `mark_credit_grant_seen` — dostawca potwierdza (zamyka) baner
--      powiadomienia o przyznaniu; bez e-maili.
--   5. Widok `company_capacity` rozszerzony o rozbicie pozostałych kredytów
--      na bezpłatne / kupione i najbliższe daty ważności każdej puli.
--
-- Rozliczanie (kolejność zużycia) jest w kodzie funkcji Netlify
-- (`legacy-send-seen.js`): najpierw 'grant', wewnątrz puli najbliższa data
-- ważności; pobranie nadal przy pierwszym odczycie propozycji.
--
-- Stare wiersze `packages` dostają source = 'purchase' przez DEFAULT.
-- NIE klasyfikujemy ich po cenie zero — ewentualne wcześniejsze rekompensaty
-- oznacza się osobną, świadomą aktualizacją po ich zidentyfikowaniu.
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE, ON CONFLICT DO NOTHING.
-- ============================================================================

begin;

-- ── 1. packages: źródło i metadane przyznania ───────────────────────────────
alter table public.packages
  add column if not exists source text not null default 'purchase',
  add column if not exists grant_reason text,
  add column if not exists grant_message text,
  add column if not exists grant_note text,
  add column if not exists granted_by uuid,
  add column if not exists granted_at timestamptz,
  add column if not exists grant_batch_id uuid,
  add column if not exists grant_seen_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'packages_source_check') then
    alter table public.packages
      add constraint packages_source_check check (source in ('purchase', 'grant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_grant_reason_check') then
    alter table public.packages
      add constraint packages_grant_reason_check
      check (grant_reason is null or grant_reason in ('promotion', 'compensation', 'gift', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_grant_fields_check') then
    -- przyznanie MUSI mieć powód, partię, autora i czas; zakup NIE MOŻE ich mieć
    alter table public.packages
      add constraint packages_grant_fields_check check (
        (source = 'grant' and grant_reason is not null and grant_batch_id is not null
           and granted_by is not null and granted_at is not null)
        or
        (source = 'purchase' and grant_reason is null and grant_batch_id is null
           and granted_by is null and granted_at is null and grant_message is null and grant_note is null)
      );
  end if;
end $$;

create index if not exists idx_packages_company_source on public.packages(company_id, source);
create index if not exists idx_packages_grant_unseen on public.packages(company_id)
  where source = 'grant' and grant_seen_at is null;

comment on column public.packages.source is
  'purchase = kupione (PayU/proforma/ręcznie przez admina), grant = przyznane bezpłatnie przez organizatora (admin_grant_free_credits).';
comment on column public.packages.grant_reason is
  'Powód przyznania: promotion | compensation | gift | other. Tylko dla source = grant.';
comment on column public.packages.grant_message is
  'Wiadomość dla odbiorcy (dostawca ją widzi w panelu). Tylko dla source = grant.';
comment on column public.packages.grant_note is
  'Notatka wewnętrzna admina (dostawca jej NIE widzi — patrz widok packages dla dostawcy w RLS: kolumna czytelna, ale front jej nie pokazuje; do rozważenia osobny widok).';
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
  qty integer not null check (qty between 1 and 100),
  reason text not null check (reason in ('promotion', 'compensation', 'gift', 'other')),
  message text,
  note text,
  expires_at date not null,
  company_ids uuid[] not null,
  company_count integer not null check (company_count >= 1)
);

comment on table public.package_grant_batches is
  'Jedna partia = jedno przyznanie bezpłatnych kredytów przez admina dla 1..N firm. idempotency_key chroni przed podwójnym wykonaniem tego samego formularza.';

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
  v_company uuid;
  v_package_id uuid;
  v_created integer := 0;
  v_missing uuid[];
begin
  if v_admin is null or not is_admin() then
    raise exception 'admin_grant_free_credits: tylko administrator' using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'admin_grant_free_credits: brak klucza idempotencji' using errcode = '22023';
  end if;

  -- Powtórka tego samego formularza → zwróć wynik pierwszego wykonania, nic nie dopisuj.
  select * into v_batch from public.package_grant_batches where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'batch_id', v_batch.id,
      'created', 0,
      'already_done', true,
      'company_count', v_batch.company_count,
      'expires_at', v_batch.expires_at
    );
  end if;

  if p_qty is null or p_qty < 1 or p_qty > 100 then
    raise exception 'admin_grant_free_credits: liczba kredytów musi być w zakresie 1..100' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('promotion', 'compensation', 'gift', 'other') then
    raise exception 'admin_grant_free_credits: nieznany powód %', p_reason using errcode = '22023';
  end if;

  select array_agg(distinct id) into v_ids from unnest(coalesce(p_company_ids, '{}'::uuid[])) as t(id) where id is not null;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'admin_grant_free_credits: brak firm' using errcode = '22023';
  end if;

  select array_agg(id) into v_missing
  from unnest(v_ids) as t(id)
  where not exists (select 1 from public.companies c where c.id = t.id);
  if v_missing is not null then
    raise exception 'admin_grant_free_credits: nieznane firmy: %', v_missing using errcode = '22023';
  end if;

  -- Domyślna ważność: 3 miesiące kalendarzowe od przyznania.
  v_expires := coalesce(p_expires_at, (current_date + interval '3 months')::date);
  if v_expires <= current_date then
    raise exception 'admin_grant_free_credits: data ważności musi być późniejsza niż dziś' using errcode = '22023';
  end if;

  insert into public.package_grant_batches
    (idempotency_key, created_by, qty, reason, message, note, expires_at, company_ids, company_count)
  values
    (p_idempotency_key, v_admin, p_qty, p_reason, nullif(trim(p_message), ''), nullif(trim(p_note), ''),
     v_expires, v_ids, array_length(v_ids, 1))
  returning * into v_batch;

  foreach v_company in array v_ids loop
    -- payment_ref = klucz unikalny (ux_packages_payment_ref): druga próba
    -- w tej samej partii dla tej samej firmy nie może wstawić drugiego wiersza.
    insert into public.packages
      (company_id, plan, qty_total, qty_used, price_paid, currency, purchased_at, expires_at, payment_ref,
       source, grant_reason, grant_message, grant_note, granted_by, granted_at, grant_batch_id)
    values
      (v_company, 'grant', p_qty, 0, 0, 'EUR', now(), v_expires, 'grant:' || v_batch.id || ':' || v_company,
       'grant', p_reason, v_batch.message, v_batch.note, v_admin, now(), v_batch.id)
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
    'expires_at', v_batch.expires_at
  );
end;
$$;

revoke all on function public.admin_grant_free_credits(uuid[], integer, text, text, text, text, date) from public;
grant execute on function public.admin_grant_free_credits(uuid[], integer, text, text, text, text, date) to authenticated;

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

-- ── 5. company_capacity: rozbicie na pule ───────────────────────────────────
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
  coalesce(sum(case when p.expires_at >= current_date then p.qty_total else 0 end), 0)::integer as qty_total,
  coalesce(sum(case when p.expires_at >= current_date then p.qty_used  else 0 end), 0)::integer as qty_used,
  coalesce(sum(case when p.expires_at >= current_date then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining,
  max(case when p.expires_at >= current_date then p.expires_at end) as pkg_expiry,
  c.created_at,
  coalesce(sum(case when p.expires_at >= current_date and p.source = 'grant'    then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining_free,
  coalesce(sum(case when p.expires_at >= current_date and p.source = 'purchase' then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining_paid,
  coalesce(sum(case when p.expires_at >= current_date and p.source = 'grant'    then p.qty_total else 0 end), 0)::integer as qty_total_free,
  coalesce(sum(case when p.expires_at >= current_date and p.source = 'purchase' then p.qty_total else 0 end), 0)::integer as qty_total_paid,
  min(case when p.expires_at >= current_date and p.source = 'grant'    and p.qty_total > p.qty_used then p.expires_at end) as free_expiry,
  min(case when p.expires_at >= current_date and p.source = 'purchase' and p.qty_total > p.qty_used then p.expires_at end) as paid_expiry
from public.companies c
left join public.packages p on p.company_id = c.id
group by c.id;

-- Zachowaj ustawienia z 054_views_lockdown (security_invoker + brak zapisu).
alter view public.company_capacity set (security_invoker = true);
revoke insert, update, delete, truncate, references, trigger on public.company_capacity from anon, authenticated;
grant select on public.company_capacity to authenticated;

commit;
