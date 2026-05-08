-- ===================================================================
-- 018 - refund unread expired legacy sends
-- [B2B Round 6]
--
-- Business rule:
--   If a PreConnect send expires unread after 14 days, the supplier receives
--   an automatic refund. Refund must be durable and idempotent.
-- ===================================================================

begin;

alter table public.wallet_tx
  add column if not exists meta jsonb default '{}'::jsonb;

drop function if exists public.refund_unread_expired_legacy_sends();
create function public.refund_unread_expired_legacy_sends()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_now_iso text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_count integer := 0;
  v_send record;
  v_amount numeric(10,2);
  v_tx_id uuid;
begin
  if auth.uid() is null then
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
    where s.status = 'unread_expired'
      and coalesce(s.data->>'refundAt', '') = ''
  loop
    begin
      v_amount := greatest(
        coalesce(nullif(v_send.data->>'price', '')::numeric, 40),
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
      coalesce(nullif(v_send.data->>'currency', ''), 'EUR'),
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
