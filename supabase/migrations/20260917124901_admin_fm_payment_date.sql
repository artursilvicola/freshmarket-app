-- Requires 055 and 20260917120519. No participant data is changed on installation.
create or replace function public.admin_set_fm_payment_date(
  p_company_id uuid, p_payment_date date, p_expected_date date
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_company public.companies%rowtype;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not coalesce(public.is_admin(), false) then
    raise exception 'fm_payment_date_forbidden' using errcode = '42501';
  end if;
  if p_payment_date is null or not isfinite(p_payment_date)
    or p_payment_date < date '0001-01-01' or p_payment_date > date '9999-12-31' then
    raise exception 'fm_payment_date_invalid' using errcode = '22023';
  end if;
  select * into v_company from public.companies where id=p_company_id for update;
  if not found then raise exception 'fm_payment_date_not_found' using errcode='P0002'; end if;
  -- Match the existing companies -> profiles lock order; recheck the live admin account.
  perform id from public.profiles where id=v_actor and role='admin' and active is true for share;
  if not found then raise exception 'fm_payment_date_forbidden' using errcode='42501'; end if;
  if not coalesce(v_company.fm_b2b_enabled, false) then
    raise exception 'fm_payment_date_b2b_disabled' using errcode='22023';
  end if;
  if v_company.fm_payment_date is distinct from p_expected_date then
    raise exception 'fm_payment_date_conflict' using errcode='40001',
      detail=coalesce(v_company.fm_payment_date::text, '');
  end if;
  if v_company.fm_payment_date is distinct from p_payment_date then
    update public.companies set fm_payment_date=p_payment_date, updated_at=now()
      where id=p_company_id returning * into v_company;
  end if;
  return jsonb_build_object('id',v_company.id,'fm_payment_date',v_company.fm_payment_date,
    'updated_at',v_company.updated_at);
end;
$fn$;
revoke all on function public.admin_set_fm_payment_date(uuid,date,date) from public,anon;
grant execute on function public.admin_set_fm_payment_date(uuid,date,date) to authenticated;

-- Trusted audit runs only after a real date change; audit failure rolls back the UPDATE.
create or replace function public.audit_fm_payment_date_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.audit_log(user_id,action,entity,entity_id,meta)
  values(auth.uid(),'fm_inputs_payment_date_changed','company',new.id::text,
    jsonb_build_object('before',old.fm_payment_date,'after',new.fm_payment_date));
  return new;
end;
$fn$;
revoke all on function public.audit_fm_payment_date_change() from public,anon,authenticated;
drop trigger if exists trg_audit_fm_payment_date_change on public.companies;
create trigger trg_audit_fm_payment_date_change after update of fm_payment_date on public.companies
  for each row when(old.fm_payment_date is distinct from new.fm_payment_date)
  execute function public.audit_fm_payment_date_change();
