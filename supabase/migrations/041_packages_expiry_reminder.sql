-- ============================================================================
-- 041 — przypomnienie o wygaśnięciu kredytów (14 dni przed)
-- [feat/credit-expiry-reminder / Poprawki Lany #6]
--
-- Cel:
--   Wysłać dostawcy e-mail 14 dni przed wygaśnięciem pakietu kredytów, dokładnie
--   RAZ na pakiet. Marker `packages.expiry_reminder_sent_at` zapewnia idempotencję
--   (ponowne wywołania nie wyślą drugiego maila).
--
-- Trigger: leniwy sweep przy wejściu do aplikacji (jak expire_legacy_sends_14d) —
--   funkcja Netlify send-expiry-reminders woła RPC claim_due_expiry_reminders,
--   który ATOMOWO oznacza pakiety jako "przypomniane" i zwraca je do wysyłki.
--   Mark-then-send = at-most-once (rzadka utrata przy crashu OK; brak podwójnych maili).
--
-- NIE dotyka purchase_package, qty_used, company_capacity, PayU — tylko dodaje
-- kolumnę-marker i RPC odczytowo-oznaczający.
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, OR REPLACE.
-- ============================================================================

begin;

alter table packages
  add column if not exists expiry_reminder_sent_at timestamptz;

comment on column packages.expiry_reminder_sent_at is
  'Znacznik wysłania przypomnienia o wygaśnięciu (14 dni przed expires_at). NULL = nie wysłano. Ustawiany atomowo przez claim_due_expiry_reminders.';

-- Indeks częściowy: szybkie odnajdywanie pakietów do przypomnienia.
create index if not exists idx_packages_reminder_due
  on packages(expires_at)
  where expiry_reminder_sent_at is null;

-- ── RPC: atomowo "zaklep" pakiety do przypomnienia i zwróć je do wysyłki ────
-- Wybiera pakiety w oknie [dziś, dziś+14 dni] z dostępnymi kredytami, których
-- jeszcze nie przypomniano; oznacza expiry_reminder_sent_at=now() (FOR UPDATE
-- SKIP LOCKED chroni przed wyścigiem równoległych wywołań) i zwraca dane do maila.
create or replace function claim_due_expiry_reminders(p_limit int default 200)
returns table (
  package_id uuid,
  company_id uuid,
  company_name text,
  supplier_email text,
  supplier_locale text,
  plan text,
  qty_remaining int,
  expires_at date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select p.id
    from packages p
    where p.expiry_reminder_sent_at is null
      and p.expires_at is not null
      and p.expires_at >= current_date
      and p.expires_at <= current_date + interval '14 days'
      and (coalesce(p.qty_total, 0) - coalesce(p.qty_used, 0)) > 0
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update packages p
    set expiry_reminder_sent_at = now()
    from due
    where p.id = due.id
    returning p.id,
              p.company_id,
              p.plan,
              (coalesce(p.qty_total, 0) - coalesce(p.qty_used, 0)) as qty_remaining,
              p.expires_at
  )
  select
    c.id as package_id,
    c.company_id,
    co.name as company_name,
    (select pr.email  from profiles pr where pr.company_id = c.company_id and pr.role = 'supplier' order by pr.created_at nulls last limit 1) as supplier_email,
    (select pr.locale from profiles pr where pr.company_id = c.company_id and pr.role = 'supplier' order by pr.created_at nulls last limit 1) as supplier_locale,
    c.plan,
    c.qty_remaining,
    c.expires_at
  from claimed c
  left join companies co on co.id = c.company_id;
end;
$$;

commit;
