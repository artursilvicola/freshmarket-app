-- FM 2026: approved payment priority; missing dates count as 2026-09-17.
-- Safe whether 049 has already been applied or not. No grants or RLS changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.companies
  add column if not exists fm_payment_date date default date '2026-09-17';
alter table public.companies
  alter column fm_payment_date set default date '2026-09-17';

comment on column public.companies.fm_payment_date is
  'FM 2026 algorithm priority date approved by admin; unlisted firms default to 2026-09-17. Not proof of payment.';

create or replace function public.companies_guard_payment_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $guard$
begin
  if public.fm_is_privileged_session() then return new; end if;
  if tg_op = 'INSERT' then
    new.fm_payment_date := date '2026-09-17';
  else
    new.fm_payment_date := old.fm_payment_date;
  end if;
  return new;
end;
$guard$;

revoke all on function public.companies_guard_payment_date() from public, anon, authenticated;
drop trigger if exists trg_companies_guard_payment_date on public.companies;
create trigger trg_companies_guard_payment_date
  before insert or update on public.companies
  for each row execute function public.companies_guard_payment_date();
