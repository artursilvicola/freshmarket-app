-- [fix/buyer-entry-seen] KONTROLA PRZED MIGRACJĄ 20261113120000 — TYLKO ODCZYT, jedno zapytanie (sam SELECT).
-- Uruchom w Supabase → SQL Editor na PRODUKCJI. Niczego nie zapisuje.
--   wiersze 1–8   warunki wstępne migracji: każde „ŹLE” = STOP, nie wgrywaj migracji;
--   wiersze 20–31 liczby informacyjne: ile propozycji obejmie nowa reguła po wdrożeniu KODU
--                 (sama migracja niczego nie rozlicza) — zapisz je w dzienniku;
--   wiersze 100+  te same propozycje w podziale na sieci.
-- „Czekająca” = propozycja w statusie sent/opened: po wdrożeniu kodu pierwsze wejście kupca tej sieci
-- do aplikacji zmieni ją na „read”; kredyt zejdzie, jeśli nie zszedł wcześniej (otwarcie maila).
with pending as (
  select s.legacy_id, s.status, s.retailer_id, s.supplier_legacy_id, s.data,
         (coalesce(s.data->>'billingStatus', '') = 'charged' or (s.data->>'chargeAt') is not null) as charged,
         -- mailing do sieci wysłany — te same znaczniki co hasRetailerEmailMarker w aplikacji
         ((s.data->>'mailingSentAt') is not null or (s.data->>'emailSentAt') is not null
          or s.resend_message_id is not null
          or (s.data->>'resendMessageId') is not null or (s.data->>'resend_message_id') is not null
          or (case when (s.data->>'resendBuyerCount') ~ '^[0-9]+$' then (s.data->>'resendBuyerCount')::int else 0 end) > 0
          or (case when jsonb_typeof(s.data->'resendMessageIds') = 'array' then jsonb_array_length(s.data->'resendMessageIds') else 0 end) > 0
         ) as mailed,
         r.name as retailer_name,
         coalesce(r.active, true) as retailer_active,
         (select count(*) from public.profiles p
           where p.role = 'buyer' and p.active is not false and p.retailer_id = s.retailer_id) as active_buyers,
         exists (
           select 1
           from public.companies c
           join public.packages k on k.company_id = c.id
           where (c.legacy_supplier_id = s.supplier_legacy_id or c.id::text = s.supplier_legacy_id)
             and coalesce(k.qty_used, 0) < coalesce(k.qty_total, 0)
             and (k.expires_at is null or k.expires_at >= public.business_today(now()))
         ) as supplier_has_credit
  from public.legacy_sends s
  left join public.retailers r on r.id = s.retailer_id
  where s.status in ('sent', 'opened')
),
checks(lp, kontrola, wynik, oczekiwane) as (
  select 1, 'funkcja charge_legacy_send_first_seen istnieje (zależność)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'charge_legacy_send_first_seen')::text, '1'
  union all
  select 2, 'funkcja mark_legacy_send_seen istnieje',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'mark_legacy_send_seen')::text, '1'
  union all
  select 3, 'funkcja business_today istnieje (zależność)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'business_today')::text, '1'
  union all
  select 4, 'typ wallet_tx_type ma wartości send_charge i refund',
         (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
           where t.typname = 'wallet_tx_type' and e.enumlabel in ('send_charge', 'refund'))::text, '2'
  union all
  select 5, 'nowych funkcji jeszcze nie ma (brak kolizji nazw)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('confirm_legacy_send_manual', 'undo_legacy_send_manual_confirm'))::text, '0'
  union all
  select 6, 'legacy_sends ma kolumny id, legacy_id, supplier_legacy_id, status, data',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'legacy_sends'
             and column_name in ('id', 'legacy_id', 'supplier_legacy_id', 'status', 'data'))::text, '5'
  union all
  select 7, 'packages ma kolumny id, company_id, qty_total, qty_used',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'packages'
             and column_name in ('id', 'company_id', 'qty_total', 'qty_used'))::text, '4'
  union all
  select 8, 'wallet_tx ma kolumny company_id, type, amount, currency, description, reference_id, meta',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'wallet_tx'
             and column_name in ('company_id', 'type', 'amount', 'currency', 'description', 'reference_id', 'meta'))::text, '7'

  -- ── liczby: zakres nowej reguły „kredyt przy wejściu kupca” ──
  union all
  select 20, 'INFO: propozycje czekające razem (sent/opened) — status zmieni pierwsze wejście kupca',
         (select count(*) from pending)::text, 'informacja'
  union all
  select 21, 'INFO: z nich NIEROZLICZONE — tyle kredytów może zejść przy pierwszych wejściach kupców',
         (select count(*) from pending where not charged)::text, 'informacja'
  union all
  select 22, 'INFO: z nierozliczonych — w sieciach aktywnych z co najmniej jednym aktywnym kontem kupca (realny zakres)',
         (select count(*) from pending where not charged and retailer_active and active_buyers > 0)::text, 'informacja'
  union all
  select 23, 'INFO: z nierozliczonych — w sieciach nieaktywnych albo bez aktywnego konta kupca (nikt nie wejdzie)',
         (select count(*) from pending where not charged and not (retailer_active and active_buyers > 0))::text, 'informacja'
  union all
  select 24, 'INFO: z realnego zakresu — dostawca MA wolny kredyt (kredyt zejdzie)',
         (select count(*) from pending where not charged and retailer_active and active_buyers > 0 and supplier_has_credit)::text, 'informacja'
  union all
  select 25, 'INFO: z realnego zakresu — dostawca NIE MA wolnego kredytu (odczyt się zapisze, kredyt nie zejdzie)',
         (select count(*) from pending where not charged and retailer_active and active_buyers > 0 and not supplier_has_credit)::text, 'informacja'
  union all
  select 26, 'INFO: z nierozliczonych — bez wysłanego mailingu (kupiec nie dostał jeszcze maila; wejście i tak rozliczy)',
         (select count(*) from pending where not charged and not mailed)::text, 'informacja'
  union all
  select 27, 'INFO: propozycje „opened” już rozliczone otwarciem maila (wejście zmieni tylko status, bez kredytu)',
         (select count(*) from pending where charged)::text, 'informacja'
  union all
  select 28, 'INFO: sieci / dostawcy z nierozliczonymi czekającymi propozycjami',
         (select count(distinct retailer_id)::text || ' / ' || count(distinct supplier_legacy_id)::text from pending where not charged), 'informacja'
  union all
  select 29, 'INFO: daty wysłania nierozliczonych czekających (najstarsza – najnowsza)',
         (select coalesce(min(left(coalesce(data->>'sentAt', data->>'sendDate'), 10)), '—') || ' – ' ||
                 coalesce(max(left(coalesce(data->>'sentAt', data->>'sendDate'), 10)), '—') from pending where not charged), 'informacja'
  union all
  select 30, 'INFO: odczyty aplikacji zapisane na administratora (dotychczasowe rozliczenia z podglądu konta kupca)',
         (select count(*) from public.legacy_send_app_reads r where r.reader_role = 'admin')::text, 'informacja'
  union all
  select 31, 'INFO: propozycje read_manual bez rozliczenia (stare ręczne potwierdzenia; ani migracja, ani kod ich nie ruszają)',
         (select count(*) from public.legacy_sends s
           where s.status = 'read_manual'
             and coalesce(s.data->>'billingStatus', '') <> 'charged' and (s.data->>'chargeAt') is null)::text, 'informacja'

  -- ── nierozliczone czekające propozycje w podziale na sieci ──
  union all
  select 100 + (row_number() over (order by count(*) desc, retailer_id))::int,
         'INFO sieć: ' || coalesce(max(retailer_name), '—') || ' (#' || coalesce(retailer_id::text, '—')
           || ', aktywna: ' || case when bool_and(retailer_active) then 'tak' else 'NIE' end
           || ', aktywnych kont kupców: ' || max(active_buyers)::text || ')',
         count(*)::text || ' nierozliczonych, w tym ' || count(*) filter (where supplier_has_credit)::text || ' u dostawców z wolnym kredytem, '
           || count(*) filter (where not mailed)::text || ' bez wysłanego mailingu',
         'informacja'
  from pending
  where not charged
  group by retailer_id
)
select lp, kontrola, wynik, oczekiwane,
       case when oczekiwane = 'informacja' then 'informacja' when wynik = oczekiwane then 'OK' else 'ŹLE' end as ocena
from checks
order by lp;
