-- ============================================================================
-- 20261107160000 — Marketing: zniesienie wypisu tylko z zapisaną ponowną zgodą, z zachowaniem historii
--
-- Review Codexa (07.11): „wypisów nie usuwajmy bez śladu” — samo „wdrażaj” nie cofa wypisu.
--  * marketing_suppression_lifts: rejestr TYLKO DO DOPISYWANIA. Każde zniesienie = wiersz z kopią pierwotnego wypisu,
--    dosłowną treścią zgody, źródłem zgody i osobą, która zgodę wyraziła.
--  * marketing_lift_suppression(): jedyna droga zniesienia. Znosi WYŁĄCZNIE wypis z powodu `unsubscribe` (własna decyzja
--    adresata). Odbicie, skarga i blokada ręczna zostają: tych nie cofa zgoda w czacie.
--  * Trigger na marketing_suppressions: usunięcie wiersza bez wpisu w rejestrze jest odrzucane — także dla właściciela bazy.
-- Kolejny wypis tego samego adresu działa jak dotąd (nowy wiersz), a następne zniesienie wymaga nowej zgody.
-- Silnik wysyłki (claim, precheck, kandydaci) bez zmian: nadal patrzy tylko na marketing_suppressions.
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

create table if not exists public.marketing_suppression_lifts (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  suppression       jsonb not null,            -- pełna kopia wiersza wypisu z chwili zniesienia
  consent_text      text not null check (length(btrim(consent_text)) >= 10),
  consent_source    text not null check (length(btrim(consent_source)) >= 3),
  consent_given_by  text not null check (length(btrim(consent_given_by)) >= 3),
  lifted_at         timestamptz not null default now()
);
comment on table public.marketing_suppression_lifts is
  'Rejestr zniesień wypisu (tylko dopisywanie): kopia pierwotnego wypisu + dosłowna ponowna zgoda. Historia zostaje po usunięciu wiersza z marketing_suppressions.';
create index if not exists ix_marketing_suppression_lifts_email on public.marketing_suppression_lifts (email, lifted_at desc);

alter table public.marketing_suppression_lifts enable row level security;
drop policy if exists marketing_suppression_lifts_admin_read on public.marketing_suppression_lifts;
create policy marketing_suppression_lifts_admin_read on public.marketing_suppression_lifts for select using (public.is_admin());
revoke all on table public.marketing_suppression_lifts from public, anon, authenticated, service_role;
grant select on table public.marketing_suppression_lifts to authenticated, service_role;

-- rejestr jest nienaruszalny także dla właściciela bazy
create or replace function public.marketing_suppression_lifts_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'marketing_suppression_lifts is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists trg_marketing_suppression_lifts_append_only on public.marketing_suppression_lifts;
create trigger trg_marketing_suppression_lifts_append_only
  before update or delete on public.marketing_suppression_lifts
  for each row execute function public.marketing_suppression_lifts_append_only();

-- usunięcie wypisu bez śladu w rejestrze jest niemożliwe
create or replace function public.marketing_suppressions_no_silent_delete()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.marketing_suppression_lifts l
                  where l.email = old.email
                    and (l.suppression->>'created_at')::timestamptz = old.created_at) then
    raise exception 'suppression of % cannot be deleted without a recorded consent (marketing_lift_suppression)', old.email using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists trg_marketing_suppressions_no_silent_delete on public.marketing_suppressions;
create trigger trg_marketing_suppressions_no_silent_delete
  before delete on public.marketing_suppressions
  for each row execute function public.marketing_suppressions_no_silent_delete();

create or replace function public.marketing_lift_suppression(
  p_email text, p_consent_text text, p_consent_source text, p_consent_given_by text
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.marketing_suppressions%rowtype;
begin
  select * into v_row from public.marketing_suppressions where email = v_email for update;
  if not found then return false; end if;
  if v_row.reason <> 'unsubscribe' then
    raise exception 'only an unsubscribe can be lifted (reason of %: %)', v_email, v_row.reason using errcode = 'P0001';
  end if;
  insert into public.marketing_suppression_lifts (email, suppression, consent_text, consent_source, consent_given_by)
  values (v_email, to_jsonb(v_row), p_consent_text, p_consent_source, p_consent_given_by);
  delete from public.marketing_suppressions where email = v_email;
  return true;
end $$;
revoke all on function public.marketing_lift_suppression(text, text, text, text) from public, anon, authenticated, service_role;

commit;
