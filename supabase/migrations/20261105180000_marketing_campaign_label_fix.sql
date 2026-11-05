-- ============================================================================
-- [feat/marketing-activation] Ujednolicenie etykiety grupy w automatycznej nazwie kampanii
-- (review Claude b279e44, pkt 3; Codex 05.11): trigger nadawał „Mają kredyty i gotową propozycję",
-- panel pokazuje „Mają kredyty i propozycję gotową do zgłoszenia". Poprzednia migracja
-- (20261105170000) została już wykonana na bazie testowej, dlatego tylko CREATE OR REPLACE funkcji —
-- sekwencja, indeks i trigger zostają. Istniejące nazwy kampanii celowo bez zmian.
-- Addytywne. Uruchamiane TYLKO na bazie testowej do czasu decyzji o produkcji; przy wdrożeniu
-- migracje 170000 + 180000 muszą poprzedzać publikację nowego kodu (create wstawia pustą nazwę).
-- ============================================================================
begin;

create or replace function public.marketing_campaign_assign_name() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  label text;
begin
  label := case new.template_key
    when 'credits_no_proposal' then 'Mają kredyty, brak propozycji'
    when 'credits_proposal_ready' then 'Mają kredyty i propozycję gotową do zgłoszenia'
    when 'used_before_free_credits' then 'Korzystali wcześniej, mają wolne kredyty'
    when 'credits_expiring' then 'Kredyty niedługo wygasają'
    when 'no_valid_credits' then 'Brak ważnych kredytów'
    when 'selected_companies' then btrim(new.name)
    else new.name end;
  if label is null or label = '' or length(label) > 160 then
    raise exception 'Invalid campaign name';
  end if;
  new.name := label || ' | #' || new.campaign_number::text || ' | ' ||
    to_char(current_timestamp at time zone 'Europe/Warsaw', 'DD.MM.YYYY');
  return new;
end;
$$;
revoke all on function public.marketing_campaign_assign_name() from public, anon, authenticated;
grant execute on function public.marketing_campaign_assign_name() to service_role;

commit;
