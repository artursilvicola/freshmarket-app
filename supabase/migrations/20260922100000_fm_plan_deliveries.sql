-- [feat/fm-plan-send-server-card] Rejestr doręczeń kart spotkań B2B (fm-plan-send).
-- Jeden wiersz = jeden adresat jednej karty w jednej wersji zatwierdzonego planu.
-- Cel: ponowienie po częściowym błędzie nie wysyła drugi raz do już obsłużonych
-- adresatów; dwa równoległe wywołania nie wyślą tej samej karty dwa razy
-- (UNIQUE + rezerwacja 'sending' przed wysyłką + Idempotency-Key u dostawcy poczty
-- i identyczne bajty PDF z bucketu fm-plan-cards; niepewny wynik nigdy nie jest
-- usuwany automatycznie — ponowienie odtwarza to samo żądanie).
-- Zapisuje wyłącznie funkcja Netlify (service role). Admin ma odczyt; anon,
-- dostawca i kupiec nie mają dostępu. Bez wpływu na wejścia algorytmu i plan.
-- Apply manually (SQL Editor) przed frontem. Rollback: zostawić tabelę (historia
-- doręczeń), opublikować poprzedni front; stary front nie używa tej tabeli.
begin;

create table if not exists public.fm_plan_deliveries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('supplier','chain')),
  target_id text not null,
  email text not null,
  plan_updated_at timestamptz not null,
  status text not null default 'sending' check (status in ('sending','sent')),
  resend_id text,
  idempotency_key text,
  pdf_path text,
  pdf_sha256 text,
  attempts integer not null default 0,
  -- generacja próby: każda NOWA próba (np. wymuszona po oknie idempotencji) = attempt+1 przez CAS,
  -- własny klucz i własny czas startu; potwierdzenie wyniku jest warunkowane tą samą generacją
  attempt integer not null default 1,
  attempt_started_at timestamptz not null default now(),
  last_error text,
  sent_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (kind, target_id, email, plan_updated_at)
);
create index if not exists idx_fm_plan_deliveries_target on public.fm_plan_deliveries (kind, target_id, plan_updated_at);

alter table public.fm_plan_deliveries enable row level security;
revoke all on public.fm_plan_deliveries from public, anon, authenticated;
grant select on public.fm_plan_deliveries to authenticated;
grant all on public.fm_plan_deliveries to service_role;
drop policy if exists fmpd_admin_read on public.fm_plan_deliveries;
create policy fmpd_admin_read on public.fm_plan_deliveries
  for select to authenticated using ((select public.is_admin()));

-- Prywatny bucket na wygenerowane karty (jeden plik per firma/sieć i wersja planu). Bajty
-- pierwszej wersji są ponownie używane przy każdym ponowieniu, więc żądanie do Resend
-- z tym samym Idempotency-Key jest identyczne. Brak polityk na storage.objects = dostęp
-- wyłącznie przez service role (funkcja). Guard: lokalny shim testowy może nie mieć storage.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fm-plan-cards', 'fm-plan-cards', false, 10485760, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

comment on table public.fm_plan_deliveries is 'Doręczenia kart spotkań B2B per adresat i wersja planu; zapis tylko przez fm-plan-send (service role).';
notify pgrst, 'reload schema';
commit;
