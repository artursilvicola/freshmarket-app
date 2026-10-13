-- ============================================================================
-- 20261013090000 — powiadomienie dostawcy o odczycie: rezerwacja zamiast znacznika
--
-- Problem (review Codexa 13.10, dwa znaleziska):
--
--  1. POWIADOMIENIE MOGŁO PRZEPAŚĆ. `mark_legacy_sends_supplier_notified` ustawiał
--     `supplierNotifiedAt` PRZED wysłaniem maila. Gdy poczta zwróciła błąd, kolejna
--     próba widziała znacznik i uznawała wiadomość za wysłaną — dostawca nie dostawał
--     jej nigdy. Jeden znacznik pełnił dwie role: „zajęte" i „wysłane".
--
--  2. MAIL MÓGŁ ZAWIERAĆ PROPOZYCJE Z CUDZEJ REZERWACJI. RPC zwracał tylko LICZBĘ
--     zajętych wierszy, a notifier wysyłał mail o CAŁEJ grupie. Przy równoczesnym
--     odczycie propozycji A i paczki A+B: ścieżka pierwsza zajmowała A i wysyłała
--     mail o A, druga zajmowała samo B (liczba 1 > 0) i wysyłała mail o A i B.
--     A pojawiało się w dwóch mailach.
--
-- Rozwiązanie — dwa osobne stany w `legacy_sends.data`:
--
--   supplierNotifyClaimToken + supplierNotifyClaimedAt   „wysyłka w toku" (rezerwacja)
--   supplierNotifiedAt + …Via + …BatchSize               „wysłano" (jak dotąd)
--
--   claim   → zajmuje wiersze i ZWRACA ICH ID, więc mail powstaje wyłącznie z nich
--   confirm → po udanej wysyłce: zdejmuje rezerwację, stawia znacznik wysłania
--   release → po nieudanej wysyłce: zdejmuje rezerwację, ponowienie jest możliwe
--
-- Rezerwacja ma DZIERŻAWĘ (domyślnie 900 s). Gdy funkcja padnie między zajęciem
-- a potwierdzeniem i nie zdąży zwolnić, po wygaśnięciu dzierżawy kolejne zdarzenie
-- odczytu może wiersz zająć ponownie. Świadomy kompromis: skrajnie rzadki podwójny
-- mail (gdy poczta jednak poszła, a potwierdzenie nie) zamiast trwałej ciszy.
--
-- `mark_legacy_sends_supplier_notified` ZOSTAJE bez zmian — stary kod funkcji
-- Netlify działa po tej migracji. Nowy kod bez migracji nie wyśle nic (brak RPC),
-- więc kolejność wdrożenia: TA MIGRACJA → deploy funkcji.
--
-- Idempotentne: same CREATE OR REPLACE, bez zmian w danych.
-- ============================================================================

begin;

-- ── 1. claim — zajmij wiersze i zwróć ICH id ────────────────────────────────
-- Warunek zajęcia: brak znacznika wysłania ORAZ (brak rezerwacji LUB rezerwacja
-- wygasła LUB to nasza własna rezerwacja — ponowienie tej samej próby).
--
-- Współbieżność: dwa równoległe UPDATE na tym samym wierszu szeregują się na
-- blokadzie wiersza. Druga transakcja po zwolnieniu blokady ocenia WHERE na
-- ŚWIEŻEJ wersji wiersza (READ COMMITTED), widzi cudzą rezerwację i nie bierze
-- wiersza. RETURNING zwraca wyłącznie wiersze faktycznie zaktualizowane.
create or replace function public.claim_legacy_sends_supplier_notify(
  p_legacy_ids bigint[],
  p_claim_token text,
  p_claimed_at timestamptz default now(),
  p_lease_seconds integer default 900
)
returns setof bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at text := to_char(p_claimed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_lease interval := make_interval(secs => greatest(coalesce(p_lease_seconds, 900), 1));
begin
  if p_legacy_ids is null or array_length(p_legacy_ids, 1) is null then
    return;
  end if;
  if p_claim_token is null or btrim(p_claim_token) = '' then
    raise exception 'claim_legacy_sends_supplier_notify: p_claim_token jest wymagany';
  end if;

  return query
  update public.legacy_sends
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
           'supplierNotifyClaimToken', p_claim_token,
           'supplierNotifyClaimedAt', v_at
         ),
         updated_at = now()
   where legacy_id = any(p_legacy_ids)
     and (data->>'supplierNotifiedAt') is null
     and (
          (data->>'supplierNotifyClaimToken') is null
       or (data->>'supplierNotifyClaimedAt') is null
       or (data->>'supplierNotifyClaimToken') = p_claim_token
       or (data->>'supplierNotifyClaimedAt')::timestamptz < p_claimed_at - v_lease
     )
  returning legacy_id;
end;
$$;

comment on function public.claim_legacy_sends_supplier_notify(bigint[], text, timestamptz, integer) is
  'Rezerwuje wysyłki do powiadomienia dostawcy o odczycie i ZWRACA ID faktycznie zajętych. Mail wolno zbudować wyłącznie z tych wierszy. Rezerwacja wygasa po p_lease_seconds.';

-- ── 2. confirm — mail poszedł ───────────────────────────────────────────────
-- Tylko wiersze z NASZĄ rezerwacją i bez znacznika wysłania. Rezerwacja znika,
-- zostaje znacznik wysłania. Scalamy wyłącznie pola powiadomienia — status,
-- pola odczytu i rozliczenia nietknięte (jak w RPC z 27.09).
create or replace function public.confirm_legacy_sends_supplier_notified(
  p_legacy_ids bigint[],
  p_claim_token text,
  p_via text default null,
  p_batch_size integer default null,
  p_notified_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_at text := to_char(p_notified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_legacy_ids is null or array_length(p_legacy_ids, 1) is null then
    return 0;
  end if;
  update public.legacy_sends
     set data = (coalesce(data, '{}'::jsonb)
                   - 'supplierNotifyClaimToken'
                   - 'supplierNotifyClaimedAt')
                || jsonb_strip_nulls(jsonb_build_object(
                     'supplierNotifiedAt', v_at,
                     'supplierNotifiedVia', p_via,
                     'supplierNotifiedBatchSize', p_batch_size
                   )),
         updated_at = now()
   where legacy_id = any(p_legacy_ids)
     and (data->>'supplierNotifyClaimToken') = p_claim_token
     and (data->>'supplierNotifiedAt') is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz) is
  'Potwierdza wysłane powiadomienie dostawcy: zdejmuje rezerwację, stawia supplierNotifiedAt. Działa tylko na wierszach z tym samym tokenem rezerwacji.';

-- ── 3. release — mail NIE poszedł ───────────────────────────────────────────
-- Zdejmuje wyłącznie NASZĄ rezerwację i tylko gdy nie ma znacznika wysłania.
-- Dzięki temu kolejne zdarzenie odczytu może spróbować od nowa — bez tego
-- nieudana wysyłka kasowała powiadomienie na zawsze.
create or replace function public.release_legacy_sends_supplier_notify_claim(
  p_legacy_ids bigint[],
  p_claim_token text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_legacy_ids is null or array_length(p_legacy_ids, 1) is null then
    return 0;
  end if;
  update public.legacy_sends
     set data = coalesce(data, '{}'::jsonb)
                  - 'supplierNotifyClaimToken'
                  - 'supplierNotifyClaimedAt',
         updated_at = now()
   where legacy_id = any(p_legacy_ids)
     and (data->>'supplierNotifyClaimToken') = p_claim_token
     and (data->>'supplierNotifiedAt') is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) is
  'Zwalnia rezerwację powiadomienia po nieudanej wysyłce, żeby ponowienie było możliwe.';

-- ── 4. uprawnienia: wyłącznie service_role (funkcje Netlify) ────────────────
revoke all on function public.claim_legacy_sends_supplier_notify(bigint[], text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) from public, anon, authenticated;

grant execute on function public.claim_legacy_sends_supplier_notify(bigint[], text, timestamptz, integer) to service_role;
grant execute on function public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz) to service_role;
grant execute on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) to service_role;

commit;
