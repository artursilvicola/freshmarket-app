-- [fix/buyer-entry-seen] WYCOFANIE MIGRACJI 20261113120000 — uruchamiać TYLKO po cofnięciu kodu
-- (Netlify → Deploys → opublikuj poprzedni deploy 6af2db23 = main 9c8e747) i tylko, gdy to potrzebne.
--
-- Nowa mark_legacy_send_seen działa ze starym kodem bez zmian (te same argumenty i wynik; dopisuje tylko
-- pola buyerSeenAt/buyerSeenChannel/buyerAppSeenAt/buyerAppSeenChannel), a dwóch nowych funkcji stary kod
-- nie woła — migracja MOŻE więc zostać w bazie po cofnięciu kodu. Ten skrypt jest opcjonalny.
--
-- NIE cofa rozliczeń wykonanych w czasie działania nowego kodu — te koryguje się przyciskiem
-- „Cofnij potwierdzenie” (przed cofnięciem kodu) albo bezpłatnym kredytem od organizatora.
-- Pola buyerSeen* zapisane już w wysyłkach zostają; stary kod ich nie czyta.

-- 1. nowe funkcje
drop function if exists public.undo_legacy_send_manual_confirm(uuid, timestamptz);
drop function if exists public.confirm_legacy_send_manual(uuid, uuid, text, text, timestamptz);

-- 2. mark_legacy_send_seen w treści z migracji 20260927120000 (md5 treści bez CR: 8b3a720e7374e0bfe873969401706f63)
create or replace function public.mark_legacy_send_seen(
  p_send_id uuid,
  p_company_id uuid,
  p_channel text default 'app_list',
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send public.legacy_sends%rowtype;
  v_data jsonb;
  v_prev text;
  v_next text;
  v_read_type text;
  v_now_txt text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_patch jsonb;
  v_billing jsonb;
begin
  if p_send_id is null then
    raise exception 'mark_legacy_send_seen: brak wysyłki' using errcode = '22023';
  end if;
  if p_channel not in ('app_list', 'app_detail', 'email') then
    raise exception 'mark_legacy_send_seen: nieznany kanał %', p_channel using errcode = '22023';
  end if;

  select * into v_send from public.legacy_sends where id = p_send_id for update;
  if not found then
    raise exception 'mark_legacy_send_seen: wysyłka % nie istnieje', p_send_id using errcode = 'P0002';
  end if;
  v_prev := v_send.status;
  v_data := coalesce(v_send.data, '{}'::jsonb);

  if v_prev not in ('sent', 'opened', 'read', 'read_manual') then
    return jsonb_build_object('skipped', true, 'reason', 'status_' || coalesce(v_prev, 'null'), 'previous_status', v_prev, 'status', v_prev, 'data', v_data);
  end if;

  v_next := case
    when p_channel = 'email' then (case when v_prev = 'sent' then 'opened' else v_prev end)
    when v_prev in ('sent', 'opened') then 'read'
    else v_prev end;
  v_read_type := case p_channel when 'app_list' then 'auto_buyer_preconnect_list' when 'app_detail' then 'auto_buyer_open' else null end;

  v_patch := jsonb_build_object(
    'status', v_next,
    'seenAt', coalesce(v_data->>'seenAt', v_now_txt),
    'seenChannel', coalesce(v_data->>'seenChannel', p_channel)
  );
  if p_channel = 'email' then
    v_patch := v_patch || jsonb_build_object('emailOpenedAt', coalesce(v_data->>'emailOpenedAt', v_now_txt));
  end if;
  if v_read_type is not null then
    v_patch := v_patch || jsonb_build_object(
      'readAt', coalesce(v_data->>'readAt', v_now_txt),
      'readType', coalesce(v_data->>'readType', v_read_type)
    );
  end if;

  update public.legacy_sends
     set data = data || v_patch,
         status = v_next,
         updated_at = now(),
         email_opened_at = case when p_channel = 'email' then coalesce(email_opened_at, p_now) else email_opened_at end
   where id = p_send_id;

  if p_company_id is null then
    v_billing := jsonb_build_object('charged', false, 'already_charged', false, 'billing_status', 'company_not_found');
  else
    v_billing := public.charge_legacy_send_first_seen(p_send_id, p_company_id, p_now);
  end if;

  -- billingStatus inne niż 'charged' zapisujemy tylko, gdy wiersz NIE jest rozliczony
  if coalesce(v_billing->>'billing_status', '') <> 'charged' then
    update public.legacy_sends
       set data = data || jsonb_build_object('billingStatus', v_billing->>'billing_status')
     where id = p_send_id and coalesce(data->>'billingStatus', '') <> 'charged';
  end if;

  select data into v_data from public.legacy_sends where id = p_send_id;
  return jsonb_build_object(
    'skipped', false,
    'previous_status', v_prev,
    'status', v_next,
    'data', v_data,
    'billing', v_billing,
    'supplier_notified_before', (v_data->>'supplierNotifiedAt') is not null
  );
end;
$$;

revoke all on function public.mark_legacy_send_seen(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_legacy_send_seen(uuid, uuid, text, timestamptz) to service_role;
