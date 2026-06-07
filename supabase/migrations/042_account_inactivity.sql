-- ============================================================================
-- 042 — nieaktywne konta: śledzenie aktywności + ostrzeżenia (30/7 dni)
-- [feat/account-inactivity-foundation / Poprawki Lany #8 — część BEZPIECZNA]
--
-- Zakres tej migracji = TYLKO bezpieczny fundament:
--   - last_active_at na profiles (bumpowane przy wejściu do aplikacji),
--   - markery wysłanych ostrzeżeń (30 i 7 dni przed usunięciem),
--   - kolumny archiwum (archived_at/by/reason) — przygotowane, jeszcze nieużywane,
--   - RPC touch_last_active() — aktualizuje last_active_at dla auth.uid(),
--   - RPC claim_due_inactivity_warnings() — atomowo zaklepuje i zwraca konta do
--     ostrzeżenia (okna 30d i 7d ROZŁĄCZNE, by nie aktualizować wiersza 2x).
--
-- PRÓG: konto nieaktywne 24 miesiące → kwalifikuje się do archiwizacji/anonimizacji.
-- Ostrzeżenia: 30 dni i 7 dni przed tym progiem.
--
-- NIE MA tu logiki DESTRUKCYJNEJ (archiwizacja-wykonanie, anonimizacja, hard-delete) —
-- to świadomie osobny etap za flagą do testów na sandboxie (decyzja użytkownika).
--
-- Backfill: istniejącym kontom ustawiamy last_active_at = now(), żeby zegar 24 mc
-- startował od wdrożenia — ZERO fałszywych alarmów / przedwczesnych usunięć.
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, OR REPLACE, backfill warunkowy.
-- ============================================================================

begin;

alter table profiles
  add column if not exists last_active_at timestamptz,
  add column if not exists inactivity_warn30_sent_at timestamptz,
  add column if not exists inactivity_warn7_sent_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references profiles(id) on delete set null,
  add column if not exists archived_reason text;

comment on column profiles.last_active_at is
  'Ostatnia aktywność użytkownika (bump przy wejściu do aplikacji). Baza zegara 24-mies. nieaktywności.';

-- Backfill: istniejące konta dostają zegar od teraz (bez przedwczesnych usunięć).
update profiles set last_active_at = now() where last_active_at is null;

create index if not exists idx_profiles_last_active on profiles(last_active_at)
  where archived_at is null;

-- ── RPC: bump last_active_at dla zalogowanego usera ─────────────────────────
create or replace function touch_last_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set last_active_at = now() where id = auth.uid();
end;
$$;

-- ── RPC: zaklep konta do ostrzeżenia (okna 30d i 7d rozłączne) ──────────────
-- Okno 30d: (now()-24mo+7d) < last_active_at <= (now()-24mo+30d)  → ostrzeżenie 30 dni
-- Okno 7d:  last_active_at <= (now()-24mo+7d)                     → ostrzeżenie 7 dni
-- Rozłączność po granicy (now()-24mo+7d) gwarantuje, że ten sam wiersz nie jest
-- aktualizowany przez obie CTE w jednym statemencie (wymóg Postgresa).
create or replace function claim_due_inactivity_warnings(p_limit int default 200)
returns table (
  profile_id uuid,
  email text,
  locale text,
  name text,
  stage text,
  delete_after date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with c30 as (
    update profiles p
    set inactivity_warn30_sent_at = now()
    where p.id in (
      select id from profiles
      where active = true and archived_at is null
        and last_active_at is not null
        and last_active_at <= now() - interval '24 months' + interval '30 days'
        and last_active_at >  now() - interval '24 months' + interval '7 days'
        and inactivity_warn30_sent_at is null
      for update skip locked
      limit p_limit
    )
    returning p.id, p.email, p.locale, p.name, '30d'::text as stage,
              (p.last_active_at + interval '24 months')::date as delete_after
  ),
  c7 as (
    update profiles p
    set inactivity_warn7_sent_at = now()
    where p.id in (
      select id from profiles
      where active = true and archived_at is null
        and last_active_at is not null
        and last_active_at <= now() - interval '24 months' + interval '7 days'
        and inactivity_warn7_sent_at is null
      for update skip locked
      limit p_limit
    )
    returning p.id, p.email, p.locale, p.name, '7d'::text as stage,
              (p.last_active_at + interval '24 months')::date as delete_after
  )
  select * from c30
  union all
  select * from c7;
end;
$$;

commit;
