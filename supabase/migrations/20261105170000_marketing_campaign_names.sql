begin;

alter table public.marketing_campaigns
  add column campaign_number bigint generated always as identity;
create unique index marketing_campaign_number_unique on public.marketing_campaigns(campaign_number);

alter table public.marketing_campaigns drop constraint marketing_campaigns_template_key_check;
alter table public.marketing_campaigns add constraint marketing_campaigns_template_key_check
  check (template_key in ('credits_no_proposal', 'credits_proposal_ready', 'used_before_free_credits',
    'credits_expiring', 'no_valid_credits', 'selected_companies', 'start_with_credits', 'return_active'));

create function public.marketing_campaign_assign_name() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  label text;
begin
  label := case new.template_key
    when 'credits_no_proposal' then 'Mają kredyty, brak propozycji'
    when 'credits_proposal_ready' then 'Mają kredyty i gotową propozycję'
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
create trigger marketing_campaign_assign_name before insert on public.marketing_campaigns
for each row execute function public.marketing_campaign_assign_name();

-- Existing names and frozen messages are deliberately left unchanged.
commit;
