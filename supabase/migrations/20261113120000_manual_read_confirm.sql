-- [fix/buyer-entry-seen] Ręczne potwierdzenie odczytu przez administratora = odczyt ROZLICZANY.
--
-- Zasada (decyzja Artura 13.11.2026): kredyt schodzi, gdy kupiec otworzył maila,
-- wszedł do aplikacji ALBO administrator ręcznie wpisał odczyt (telefon / e-mail /
-- spotkanie). Dotąd ręczne potwierdzenie zmieniało tylko status na `read_manual`
-- zwykłym zapisem całego JSON-u z przeglądarki — kredyt nie schodził nigdy, a zapis
-- mógł nadpisać znacznik rozliczenia postawiony równolegle przez odczyt kupca.
--
-- Zawartość:
--   0. mark_legacy_send_seen           ZASTĄPIONA: treść z migracji 20260927120000 bez zmian w zachowaniu
--                                      + zapis faktu odczytu przez kupca (buyerSeenAt / buyerSeenChannel,
--                                      a dla odczytu w aplikacji także buyerAppSeenAt / buyerAppSeenChannel).
--                                      Sygnatura, wynik i rozliczenie bez zmian; nowe pola są tylko dopisywane.
--   1. confirm_legacy_send_manual      NOWA: status → read_manual + rozliczenie w jednej transakcji
--   2. undo_legacy_send_manual_confirm NOWA: cofnięcie; kredyt wraca tylko, gdy pobrało go ręczne
--                                      potwierdzenie I kupiec sam propozycji nie odczytał
-- Wszystkie trzy tylko dla service_role.
--
-- Po co punkt 0 (review Codexa 13.11, P1): po ręcznym potwierdzeniu prawdziwy odczyt kupca nie zostawiał
-- w wierszu śladu, po którym cofnięcie mogłoby go rozpoznać (status zostaje `read_manual`, pola odczytu są
-- uzupełniane tylko, gdy puste). Cofnięcie zwracało więc kredyt i przywracało „sent”, choć kupiec
-- propozycję odczytał. Fakt odczytu musi powstać w tej samej transakcji co odczyt.
--
-- Kolejność wdrożenia: NAJPIERW ta migracja, POTEM kod. Stary kod woła mark_legacy_send_seen tak samo
-- jak dotąd (te same argumenty i ten sam wynik), a nowych funkcji nie używa.

-- ── 0. Odczyt przez kupca: zapis faktu odczytu ───────────────────────────────
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
  -- [fix/buyer-entry-seen] FAKT NIEZALEŻNEGO ODCZYTU PRZEZ KUPCA, zapisywany w tej samej transakcji
  -- i pod tą samą blokadą wiersza co odczyt. Tę funkcję wołają wyłącznie odczyty kupca
  -- (otwarcie maila, wejście do aplikacji, otwarcie propozycji), więc każde wywołanie jest takim faktem —
  -- także wtedy, gdy propozycja jest już `read_manual` i status się nie zmienia.
  -- Cofnięcie ręcznego potwierdzenia sprawdza te pola, zanim zwróci kredyt (undo_legacy_send_manual_confirm).
  v_patch := v_patch || jsonb_build_object(
    'buyerSeenAt', coalesce(v_data->>'buyerSeenAt', v_now_txt),
    'buyerSeenChannel', coalesce(v_data->>'buyerSeenChannel', p_channel)
  );
  if p_channel <> 'email' then
    v_patch := v_patch || jsonb_build_object(
      'buyerAppSeenAt', coalesce(v_data->>'buyerAppSeenAt', v_now_txt),
      'buyerAppSeenChannel', coalesce(v_data->>'buyerAppSeenChannel', p_channel)
    );
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

comment on function public.mark_legacy_send_seen(uuid, uuid, text, timestamptz) is
  'Odczyt propozycji przez kupca (mail / lista / szczegół): status, pola odczytu, fakt odczytu przez kupca (buyerSeenAt, buyerSeenChannel, buyerAppSeenAt, buyerAppSeenChannel) i rozliczenie kredytu w jednej transakcji pod blokadą wiersza.';

revoke all on function public.mark_legacy_send_seen(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_legacy_send_seen(uuid, uuid, text, timestamptz) to service_role;

-- ── 1. Ręczne potwierdzenie ──────────────────────────────────────────────────
create or replace function public.confirm_legacy_send_manual(
  p_send_id uuid,
  p_company_id uuid,
  p_read_type text,
  p_note text default null,
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
  v_now_txt text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_hist jsonb;
  v_patch jsonb;
  v_billing jsonb;
begin
  if p_send_id is null then
    raise exception 'confirm_legacy_send_manual: brak wysyłki' using errcode = '22023';
  end if;
  if p_read_type is null or p_read_type not in ('manual_phone', 'manual_email', 'manual_meeting') then
    raise exception 'confirm_legacy_send_manual: nieznany rodzaj potwierdzenia %', p_read_type using errcode = '22023';
  end if;

  -- blokada wiersza: równoległy odczyt kupca (mark_legacy_send_seen) czeka tutaj
  select * into v_send from public.legacy_sends where id = p_send_id for update;
  if not found then
    raise exception 'confirm_legacy_send_manual: wysyłka % nie istnieje', p_send_id using errcode = 'P0002';
  end if;
  v_prev := v_send.status;
  v_data := coalesce(v_send.data, '{}'::jsonb);

  -- ręcznie potwierdzamy tylko to, czego kupiec jeszcze nie przeczytał w aplikacji
  if v_prev not in ('sent', 'opened') then
    return jsonb_build_object('skipped', true, 'reason', 'status_' || coalesce(v_prev, 'null'),
                              'previous_status', v_prev, 'status', v_prev, 'data', v_data);
  end if;

  v_hist := (case when jsonb_typeof(v_data->'confirmHistory') = 'array' then v_data->'confirmHistory' else '[]'::jsonb end)
            || jsonb_build_array(jsonb_build_object(
                 'action', 'confirm', 'type', p_read_type, 'note', coalesce(p_note, ''), 'at', v_now_txt));

  v_patch := jsonb_build_object(
    'status', 'read_manual',
    'readAt', v_now_txt,
    'readType', p_read_type,
    'manualNote', coalesce(p_note, ''),
    'daysLeft', 0,
    'seenAt', coalesce(v_data->>'seenAt', v_now_txt),
    'seenChannel', coalesce(v_data->>'seenChannel', 'manual'),
    'manualPrevStatus', v_prev,
    'confirmHistory', v_hist
  );

  update public.legacy_sends
     set data = data || v_patch,
         status = 'read_manual',
         updated_at = now()
   where id = p_send_id;

  if p_company_id is null then
    v_billing := jsonb_build_object('charged', false, 'already_charged', false, 'billing_status', 'company_not_found');
  else
    v_billing := public.charge_legacy_send_first_seen(p_send_id, p_company_id, p_now);
  end if;

  if coalesce((v_billing->>'charged')::boolean, false) then
    -- kredyt zszedł WŁAŚNIE z ręcznego potwierdzenia: tylko taki kredyt wolno zwrócić przy cofnięciu
    update public.legacy_sends
       set data = data || jsonb_build_object('chargeChannel', 'manual')
     where id = p_send_id;
  elsif coalesce(v_billing->>'billing_status', '') <> 'charged' then
    -- billingStatus inne niż 'charged' zapisujemy tylko, gdy wiersz NIE jest rozliczony
    update public.legacy_sends
       set data = data || jsonb_build_object('billingStatus', v_billing->>'billing_status')
     where id = p_send_id and coalesce(data->>'billingStatus', '') <> 'charged';
  end if;

  select data into v_data from public.legacy_sends where id = p_send_id;
  return jsonb_build_object(
    'skipped', false,
    'previous_status', v_prev,
    'status', 'read_manual',
    'data', v_data,
    'billing', v_billing,
    'supplier_notified_before', (v_data->>'supplierNotifiedAt') is not null
  );
end;
$$;

comment on function public.confirm_legacy_send_manual(uuid, uuid, text, text, timestamptz) is
  'Ręczne potwierdzenie odczytu przez administratora: status read_manual i rozliczenie kredytu (charge_legacy_send_first_seen) w jednej transakcji. Kredyt pobrany tą drogą dostaje znacznik chargeChannel=manual.';

revoke all on function public.confirm_legacy_send_manual(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_legacy_send_manual(uuid, uuid, text, text, timestamptz) to service_role;

-- ── 2. Cofnięcie ręcznego potwierdzenia ──────────────────────────────────────
-- Wszystko pod blokadą wiersza wysyłki (ta sama, którą bierze mark_legacy_send_seen), więc kolejność
-- „odczyt kupca / cofnięcie” jest zawsze jednoznaczna:
--   * kupiec sam odczytał propozycję (przed potwierdzeniem albo po nim) → kredyt ZOSTAJE, a propozycja
--     dostaje stan wynikający z faktycznego odczytu: „read” po odczycie w aplikacji, „opened” po samym mailu;
--   * niezależnego odczytu nie było → status wraca do stanu sprzed potwierdzenia, a kredyt wraca do pakietu
--     WYŁĄCZNIE wtedy, gdy pobrało go ręczne potwierdzenie (chargeChannel=manual).
create or replace function public.undo_legacy_send_manual_confirm(
  p_send_id uuid,
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
  v_restore text;
  v_now_txt text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_hist jsonb;
  v_refunded boolean := false;
  v_app_read boolean;
  v_email_read boolean;
  v_buyer_read boolean;
  v_buyer_channel text;
  v_buyer_at text;
  v_pkg_id uuid;
  v_company_id uuid;
  v_tx_id uuid;
  v_rows integer := 0;
  v_days integer := 3;
begin
  if p_send_id is null then
    raise exception 'undo_legacy_send_manual_confirm: brak wysyłki' using errcode = '22023';
  end if;

  select * into v_send from public.legacy_sends where id = p_send_id for update;
  if not found then
    raise exception 'undo_legacy_send_manual_confirm: wysyłka % nie istnieje', p_send_id using errcode = 'P0002';
  end if;
  v_data := coalesce(v_send.data, '{}'::jsonb);

  if v_send.status is distinct from 'read_manual' then
    return jsonb_build_object('skipped', true, 'reason', 'status_' || coalesce(v_send.status, 'null'),
                              'previous_status', v_send.status, 'status', v_send.status, 'data', v_data,
                              'refunded', false, 'kept_reason', null);
  end if;

  -- niezależny odczyt przez kupca: w aplikacji albo otwarcie maila (przed potwierdzeniem lub po nim)
  v_app_read := (v_data->>'buyerAppSeenAt') is not null
                or v_data->>'buyerSeenChannel' in ('app_list', 'app_detail');
  v_email_read := (v_data->>'emailOpenedAt') is not null
                  or v_send.email_opened_at is not null
                  or v_data->>'buyerSeenChannel' = 'email'
                  or v_data->>'manualPrevStatus' = 'opened';
  v_buyer_read := v_app_read or v_email_read or (v_data->>'buyerSeenAt') is not null;

  if v_buyer_read then
    -- Kupiec propozycję odczytał: rozliczenie wynika z tego odczytu i zostaje. Zdejmujemy tylko to,
    -- co wpisało ręczne potwierdzenie, i przywracamy stan odpowiadający faktycznemu odczytowi.
    v_restore := case when v_app_read then 'read' else 'opened' end;
    v_buyer_channel := coalesce(
      case when v_app_read then coalesce(v_data->>'buyerAppSeenChannel',
                                         case when v_data->>'buyerSeenChannel' in ('app_list', 'app_detail') then v_data->>'buyerSeenChannel' end) end,
      v_data->>'buyerSeenChannel',
      'email');
    v_buyer_at := coalesce(
      v_data->>'buyerSeenAt',
      v_data->>'emailOpenedAt',
      to_char(v_send.email_opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      v_now_txt);

    if v_data->>'chargeChannel' = 'manual' then
      -- kredyt pobrało ręczne potwierdzenie, ale należy się za odczyt kupca: przestaje być „zwrotny”
      v_data := v_data || jsonb_build_object('chargeChannel', v_buyer_channel);
    end if;

    v_data := v_data - 'readAt' - 'readType' - 'manualNote' - 'manualPrevStatus';
    if v_app_read then
      v_data := v_data || jsonb_build_object(
        'readAt', coalesce(v_data->>'buyerAppSeenAt', v_buyer_at),
        'readType', case coalesce(v_data->>'buyerAppSeenChannel', v_buyer_channel)
                      when 'app_list' then 'auto_buyer_preconnect_list' else 'auto_buyer_open' end
      );
    end if;
    if coalesce(v_data->>'seenChannel', 'manual') = 'manual' then
      v_data := v_data || jsonb_build_object('seenAt', v_buyer_at, 'seenChannel', coalesce(v_data->>'buyerSeenChannel', v_buyer_channel));
    end if;

    v_hist := (case when jsonb_typeof(v_data->'confirmHistory') = 'array' then v_data->'confirmHistory' else '[]'::jsonb end)
              || jsonb_build_array(jsonb_build_object(
                   'action', 'undo', 'note', 'Cofnięcie potwierdzenia — kredyt zostaje, kupiec odczytał propozycję',
                   'at', v_now_txt, 'refunded', false, 'kept', 'buyer_read'));
    v_data := v_data || jsonb_build_object('status', v_restore, 'confirmHistory', v_hist);

    update public.legacy_sends
       set data = v_data,
           status = v_restore,
           updated_at = now()
     where id = p_send_id;

    return jsonb_build_object(
      'skipped', false,
      'previous_status', 'read_manual',
      'status', v_restore,
      'data', v_data,
      'refunded', false,
      'refund_tx_id', null,
      'kept_reason', 'buyer_read'
    );
  end if;

  -- ── niezależnego odczytu nie było ──
  v_restore := case when v_data->>'manualPrevStatus' in ('sent', 'opened') then v_data->>'manualPrevStatus' else 'sent' end;

  -- zwrot kredytu: tylko gdy pobrało go ręczne potwierdzenie
  if v_data->>'chargeChannel' = 'manual'
     and (v_data->>'billingStatus' = 'charged' or (v_data->>'chargeAt') is not null) then
    if (v_data->>'packageId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_pkg_id := (v_data->>'packageId')::uuid;
      select p.company_id into v_company_id from public.packages p where p.id = v_pkg_id for update;
      if found then
        update public.packages
           set qty_used = coalesce(qty_used, 0) - 1
         where id = v_pkg_id and coalesce(qty_used, 0) > 0;
        get diagnostics v_rows = row_count;
      end if;
    end if;
    v_refunded := v_rows = 1;

    if v_refunded then
      insert into public.wallet_tx (company_id, type, amount, currency, description, reference_id, meta)
      values (
        v_company_id, 'refund', 0, coalesce(nullif(v_data->>'chargeCurrency', ''), 'EUR'),
        'Zwrot kredytu — cofnięcie ręcznego potwierdzenia wysyłki PreConnect #' || v_send.legacy_id,
        v_send.id,
        jsonb_build_object(
          'legacy_send_id', v_send.legacy_id,
          'supplier_legacy_id', v_send.supplier_legacy_id,
          'package_id', v_pkg_id,
          'reverses_tx', v_data->>'chargeTxId',
          'reason', 'manual_confirm_undo',
          'billing_model', 'package_credit'
        )
      )
      returning id into v_tx_id;
    end if;

    -- znacznik rozliczenia znika razem z potwierdzeniem: następny prawdziwy odczyt rozliczy od nowa
    v_data := v_data - 'billingStatus' - 'chargeAt' - 'chargedAt' - 'packageId' - 'packageSource'
                     - 'chargeTxId' - 'chargeAmount' - 'chargeCurrency' - 'chargeChannel';

    -- dostawca dostał maila o ręcznym potwierdzeniu; prawdziwy odczyt ma go powiadomić ponownie
    if v_data->>'supplierNotifiedVia' = 'manual' then
      v_data := v_data - 'supplierNotifiedAt' - 'supplierNotifiedVia' - 'supplierNotifiedBatchSize'
                       - 'supplierNotifyMessageId' - 'supplierNotifyClaimToken' - 'supplierNotifyClaimedAt'
                       - 'supplierNotifyFirstClaimAt' - 'supplierNotifyAttempts'
                       - 'supplierNotifyUncertainAt' - 'supplierNotifyUncertainReason';
    end if;
  end if;

  -- pola odczytu wpisane przez ręczne potwierdzenie
  v_data := v_data - 'readAt' - 'readType' - 'manualNote' - 'manualPrevStatus';
  if v_data->>'seenChannel' = 'manual' then
    v_data := v_data - 'seenAt' - 'seenChannel';
  end if;

  -- dni do wygaśnięcia liczone od daty wysłania (jak w panelu); bez daty — jak dotąd 3
  if (v_data->>'sentAt') ~ '^\d{4}-\d{2}-\d{2}' then
    v_days := greatest(0, 14 - (public.business_today(p_now) - left(v_data->>'sentAt', 10)::date));
  end if;

  v_hist := (case when jsonb_typeof(v_data->'confirmHistory') = 'array' then v_data->'confirmHistory' else '[]'::jsonb end)
            || jsonb_build_array(jsonb_build_object(
                 'action', 'undo', 'note', 'Cofnięcie potwierdzenia', 'at', v_now_txt, 'refunded', v_refunded));

  v_data := v_data || jsonb_build_object('status', v_restore, 'daysLeft', v_days, 'confirmHistory', v_hist);

  update public.legacy_sends
     set data = v_data,
         status = v_restore,
         updated_at = now()
   where id = p_send_id;

  return jsonb_build_object(
    'skipped', false,
    'previous_status', 'read_manual',
    'status', v_restore,
    'data', v_data,
    'refunded', v_refunded,
    'refund_tx_id', v_tx_id,
    'kept_reason', null
  );
end;
$$;

comment on function public.undo_legacy_send_manual_confirm(uuid, timestamptz) is
  'Cofa ręczne potwierdzenie odczytu pod blokadą wiersza wysyłki. Gdy kupiec sam odczytał propozycję (mail lub aplikacja, przed potwierdzeniem albo po nim), kredyt zostaje, a status odpowiada faktycznemu odczytowi (read/opened). W przeciwnym razie status wraca do stanu sprzed potwierdzenia, a kredyt wraca do pakietu tylko, gdy pobrało go ręczne potwierdzenie (chargeChannel=manual).';

revoke all on function public.undo_legacy_send_manual_confirm(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.undo_legacy_send_manual_confirm(uuid, timestamptz) to service_role;
