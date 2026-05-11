-- ============================================================================
-- 022 — supplier onboarding & access control
-- [B2B Round supplier-onboarding-access-and-communication]
--
-- Cel:
--   Trzy NIEZALEŻNE warstwy uprawnień dostawcy. Do tej pory były zlane —
--   kto miał konto, ten miał wszystko.
--
--   account_status      -- czy admin zatwierdził konto firmy
--                          'pending_review' | 'active' | 'rejected' | 'suspended'
--   preconnect_enabled  -- czy firma może wysyłać oferty do sieci (PreConnect)
--   fm_b2b_enabled      -- czy firma jest dopuszczona do Spotkań B2B (FM 2026)
--
--   approved_at / approved_by — audit dla zmiany account_status z pending_review
--   na active. Trigger ustawia oba automatycznie.
--
-- Backfill: wszystkie istniejące companies mają account_status='active' i
-- preconnect_enabled=true (bo działały w starym modelu bez statusu — nie
-- chcemy zlamać workflow). fm_b2b_enabled domyślnie false dla wszystkich,
-- żeby admin świadomie aktywował firmy do FM B2B.
--
-- Nowe wpisy z self-registration będą tworzone z account_status='pending_review'
-- + preconnect_enabled=false + fm_b2b_enabled=false (bo to default ich kolumn).
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO UPDATE.
-- ============================================================================

begin;

-- ── Companies — nowe kolumny ────────────────────────────────────────────
alter table companies
  add column if not exists account_status text default 'pending_review'
    check (account_status in ('pending_review', 'active', 'rejected', 'suspended'));

alter table companies
  add column if not exists preconnect_enabled boolean default false;

alter table companies
  add column if not exists fm_b2b_enabled boolean default false;

alter table companies
  add column if not exists approved_at timestamptz;

alter table companies
  add column if not exists approved_by uuid references profiles(id) on delete set null;

-- Powód odrzucenia / zawieszenia (admin może wpisać dla siebie + dla supplera w mailu)
alter table companies
  add column if not exists status_note text;

-- ── Backfill ────────────────────────────────────────────────────────────
-- Istniejące rekordy: traktujemy jak już zaakceptowane przez admina.
update companies
  set account_status = coalesce(account_status, 'active'),
      preconnect_enabled = coalesce(preconnect_enabled, true),
      fm_b2b_enabled = coalesce(fm_b2b_enabled, false)
  where created_at is null or created_at < now();

-- Dla rekordów które mają account_status NULL (przed migracją) lub default
-- 'pending_review' a powstały ZANIM ta migracja zaaplikowała się — flipnij
-- na 'active' (w starym świecie były aktywne przez sam fakt istnienia).
update companies
  set account_status = 'active',
      preconnect_enabled = true
  where account_status = 'pending_review'
    and created_at < now() - interval '1 hour';

-- ── Indeks na pending_review (admin panel filtruje po tym) ──────────────
create index if not exists idx_companies_account_status on companies(account_status);

-- ── Trigger: gdy account_status flipuje na 'active', ustaw approved_at ──
create or replace function set_company_approved_at()
returns trigger as $$
begin
  if new.account_status = 'active' and (old.account_status is distinct from 'active') then
    new.approved_at = coalesce(new.approved_at, now());
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_companies_set_approved_at on companies;
create trigger trg_companies_set_approved_at
  before update on companies
  for each row execute function set_company_approved_at();

commit;
