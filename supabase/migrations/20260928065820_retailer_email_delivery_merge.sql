begin;

-- Transport metadata only. Never replay a browser/server snapshot over a
-- concurrent read, charge or supplier notification. Locks match billing order.
create or replace function public.mark_legacy_sends_retailer_emailed(
  p_send_ids bigint[], p_retailer_id integer, p_message_ids text[],
  p_buyer_count integer, p_sent_at timestamptz default now()
) returns bigint[]
language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_ids bigint[];
  v_row record;
  v_count integer := 0;
  v_data jsonb;
  v_status text;
  v_messages jsonb;
begin
  select array_agg(distinct x order by x) into v_ids from unnest(p_send_ids) x;
  if coalesce(cardinality(v_ids),0)=0 or array_position(v_ids,null) is not null
     or p_retailer_id is null or p_buyer_count is null or p_buyer_count<1
     or p_sent_at is null or coalesce(cardinality(p_message_ids),0)=0
     or exists(select 1 from unnest(p_message_ids) m where m is null or btrim(m)='') then
    raise exception 'Invalid retailer delivery metadata' using errcode='22023';
  end if;

  for v_row in select s.* from public.legacy_sends s
      where s.legacy_id=any(v_ids) order by s.id for update
  loop
    if v_row.retailer_id is distinct from p_retailer_id then
      raise exception 'Retailer mismatch' using errcode='22023';
    end if;
    v_count := v_count+1;
    v_data := coalesce(v_row.data,'{}'::jsonb);
    -- Once advanced, a delivery acknowledgement cannot roll status back to sent.
    -- Even rejection/expiry while the mail was in flight must remain intact.
    v_status := case when v_row.status in ('approved','sent') then 'sent' else v_row.status end;
    select jsonb_agg(m order by m) into v_messages from (
      select distinct jsonb_array_elements_text(
        case when jsonb_typeof(v_data->'resendMessageIds')='array'
             then v_data->'resendMessageIds' else '[]'::jsonb end
        || to_jsonb(p_message_ids)) m
    ) all_messages;
    update public.legacy_sends set
      status=v_status,
      resend_message_id=coalesce(resend_message_id,p_message_ids[1]),
      data=(v_data-'resendBuyerEmails') || jsonb_build_object(
        'status',v_status,
        'sentAt',coalesce(v_data->>'sentAt',to_char(p_sent_at at time zone 'UTC','YYYY-MM-DD')),
        'sent_at',coalesce(v_data->>'sent_at',p_sent_at::text),
        'emailSentAt',coalesce(v_data->>'emailSentAt',p_sent_at::text),
        'email_sent_at',coalesce(v_data->>'email_sent_at',p_sent_at::text),
        'mailingSentAt',coalesce(v_data->>'mailingSentAt',to_char(p_sent_at at time zone 'UTC','YYYY-MM-DD')),
        'inEmailBasket',false,
        'resendMessageIds',v_messages,
        'resendBuyerCount',greatest(coalesce((v_data->>'resendBuyerCount')::integer,0),p_buyer_count)
      ) || case when v_row.status='approved' then jsonb_build_object('daysLeft',14) else '{}'::jsonb end
    where id=v_row.id;
  end loop;
  if v_count<>cardinality(v_ids) then
    raise exception 'Missing delivery rows' using errcode='22023';
  end if;
  return v_ids;
end;
$$;

-- The project also has direct default EXECUTE grants to anon/authenticated.
revoke all on function public.mark_legacy_sends_retailer_emailed(bigint[],integer,text[],integer,timestamptz) from public, anon, authenticated;
grant execute on function public.mark_legacy_sends_retailer_emailed(bigint[],integer,text[],integer,timestamptz) to service_role;
commit;
