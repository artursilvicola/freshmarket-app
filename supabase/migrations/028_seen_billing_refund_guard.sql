-- 028 - PreConnect seen-based billing guard.
--
-- New business rule:
--   A send consumes a package credit only when the buyer actually sees it
--   (email opened or PreConnect list/detail viewed). Therefore unread expiry
--   must not create a refund unless a charge marker exists.

begin;

create or replace function public.refund_unread_expired_legacy_sends()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := app_role();
  v_send record;
  v_amount numeric;
  v_tx_id uuid;
  v_now timestamptz := now();
  v_now_iso text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_count integer := 0;
begin
  if v_role is null then
    raise exception 'refund_unread_expired_legacy_sends: must be authenticated';
  end if;

  for v_send in
    select
      s.legacy_id,
      s.supplier_legacy_id,
      s.data,
      c.id as company_id
    from public.legacy_sends s
    join public.companies c
      on c.legacy_supplier_id = s.supplier_legacy_id
      or c.id::text = s.supplier_legacy_id
    where s.status = 'unread_expired'
      and coalesce(s.data->>'refundAt', '') = ''
      and (
        coalesce(s.data->>'chargeAt', '') <> ''
        or coalesce(s.data->>'chargedAt', '') <> ''
        or coalesce(s.data->>'billingStatus', '') = 'charged'
      )
  loop
    begin
      v_amount := greatest(
        coalesce(nullif(v_send.data->>'chargeAmount', '')::numeric, nullif(v_send.data->>'price', '')::numeric, 40),
        0
      );
    exception
      when others then
        v_amount := 40;
    end;

    insert into public.wallet_tx (
      company_id,
      type,
      amount,
      currency,
      description,
      reference_id,
      meta,
      created_at
    )
    values (
      v_send.company_id,
      'refund',
      v_amount,
      coalesce(nullif(v_send.data->>'chargeCurrency', ''), nullif(v_send.data->>'currency', ''), 'EUR'),
      format('Zwrot za brak odczytu propozycji #%s', v_send.legacy_id),
      null,
      jsonb_build_object(
        'legacy_send_id', v_send.legacy_id,
        'supplier_legacy_id', v_send.supplier_legacy_id,
        'reason', 'unread_expired'
      ),
      v_now
    )
    returning id into v_tx_id;

    update public.legacy_sends s
       set data = coalesce(s.data, '{}'::jsonb) || jsonb_build_object(
         'refundAt', v_now_iso,
         'refundAmount', v_amount,
         'refundTxId', v_tx_id::text
       ),
           updated_at = v_now
     where s.legacy_id = v_send.legacy_id
       and coalesce(s.data->>'refundAt', '') = '';

    if found then
      v_count := v_count + 1;
    else
      delete from public.wallet_tx where id = v_tx_id;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.refund_unread_expired_legacy_sends() from public;
grant execute on function public.refund_unread_expired_legacy_sends() to authenticated;

commit;
