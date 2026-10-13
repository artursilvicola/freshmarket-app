-- ============================================================================
-- 20261013090000 — powiadomienie dostawcy o odczycie: rezerwacja + stała wiadomość
--
-- NIEWDROŻONA NIGDZIE w chwili pisania — plik jest poprawiany w miejscu po
-- kolejnych turach review Codexa (13.10). Gdyby trafiła już na jakąkolwiek bazę,
-- różnice trzeba wgrać osobną migracją, nie edycją tej.
--
-- ── Co było nie tak ─────────────────────────────────────────────────────────
--
--  1. POWIADOMIENIE MOGŁO PRZEPAŚĆ. `mark_legacy_sends_supplier_notified` ustawiał
--     `supplierNotifiedAt` PRZED wysłaniem maila. Odmowa poczty blokowała wysyłkę
--     na zawsze: kolejna próba widziała znacznik i uznawała mail za wysłany.
--     Jedno pole pełniło dwie role — „zajęte" i „wysłane".
--
--  2. MAIL MÓGŁ ZAWIERAĆ PROPOZYCJE Z CUDZEJ REZERWACJI. RPC zwracał tylko LICZBĘ
--     zajętych wierszy, a notifier wysyłał mail o CAŁEJ grupie. Przy równoczesnym
--     odczycie propozycji A i paczki A+B: pierwsza ścieżka zajmowała A i pisała
--     o A, druga zajmowała samo B (liczba 1 > 0) i pisała o A i B.
--
--  3. (review Codexa, tura 2) SAMA REZERWACJA TYLKO ODSUWAŁA DUBLA. Gdy poczta
--     przyjęła wiadomość, ale aplikacja nie dostała odpowiedzi albo nie zapisała
--     potwierdzenia, po wygaśnięciu dzierżawy kolejny odczyt wysyłał mail jeszcze
--     raz — po prostu 15 minut później.
--
-- ── Rozwiązanie ─────────────────────────────────────────────────────────────
--
-- Trzy niezależne stany w `legacy_sends.data`:
--
--   supplierNotifyClaimToken + …ClaimedAt   „wysyłka w toku" (rezerwacja, dzierżawa)
--   supplierNotifyMessageId                 TOŻSAMOŚĆ WIADOMOŚCI — stała między próbami
--   supplierNotifiedAt + …Via + …BatchSize  „wysłano"
--
-- `supplierNotifyMessageId` powstaje przy PIERWSZEJ rezerwacji i przeżywa kolejne
-- próby. Notifier wysyła go do Resend jako `Idempotency-Key`, więc ponowienie tej
-- samej wiadomości nie tworzy drugiego maila (Resend trzyma klucz 24 h).
-- Dzierżawa pilnuje, by dwie ścieżki nie pisały naraz; klucz pilnuje, by ponowienie
-- po jej wygaśnięciu nie zdublowało wiadomości.
--
-- Po 24 h klucz już nie chroni, więc niepewny wynik NIE jest ponawiany automatycznie:
-- wiersz wraca jako `needs_review` i wymaga decyzji człowieka (mail mógł dotrzeć).
--
--   claim          zajmuje wiersze, nadaje/utrzymuje messageId, ZWRACA STAN KAŻDEGO
--                  z pytanych wierszy: claimed / notified / busy / needs_review
--   confirm        po udanej wysyłce: zdejmuje rezerwację, stawia znacznik wysłania
--   release        po JEDNOZNACZNEJ odmowie poczty: pełny reset (mail nie powstał)
--   mark_uncertain gdy nie znamy wyniku: zostawia rezerwację i messageId, notuje czas
--
-- `mark_legacy_sends_supplier_notified` ZOSTAJE bez zmian — stary kod funkcji
-- Netlify działa po tej migracji. Nowy kod bez migracji nie wyśle nic (brak RPC),
-- więc kolejność wdrożenia: TA MIGRACJA → deploy funkcji.
--
-- Idempotentne: same CREATE OR REPLACE, bez zmian w danych.
-- ============================================================================

begin;

-- Stare podpisy (tura 1 review) — sygnatury się zmieniły, więc trzeba je zdjąć,
-- inaczej CREATE OR REPLACE zostawiłby obok dwie wersje funkcji.
drop function if exists public.claim_legacy_sends_supplier_notify(bigint[], text, timestamptz, integer);
drop function if exists public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz);

-- ── 1. claim — zajmij wiersze, nadaj tożsamość wiadomości, oddaj stan ───────
--
-- Zajmujemy wiersz, gdy nie ma znacznika wysłania ORAZ (brak rezerwacji LUB
-- rezerwacja wygasła LUB to nasza własna) ORAZ nie jest to niepewny wynik starszy
-- niż okno idempotencji poczty.
--
-- Współbieżność: dwa równoległe UPDATE na tym samym wierszu szeregują się na
-- blokadzie wiersza. Druga transakcja po zwolnieniu blokady ocenia WHERE na
-- ŚWIEŻEJ wersji wiersza (READ COMMITTED), widzi cudzą rezerwację i nie bierze
-- wiersza. RETURNING zwraca wyłącznie wiersze faktycznie zaktualizowane.
--
-- messageId: `coalesce(istniejący, p_new_message_id)` — pierwsza próba nadaje,
-- każda następna dziedziczy. Dzięki temu ponowienie jest TĄ SAMĄ wiadomością.
create or replace function public.claim_legacy_sends_supplier_notify(
  p_legacy_ids bigint[],
  p_claim_token text,
  p_new_message_id text,
  p_claimed_at timestamptz default now(),
  p_lease_seconds integer default 900,
  p_idempotency_window_seconds integer default 86400
)
returns table (legacy_id bigint, state text, message_id text, attempt integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at text := to_char(p_claimed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_lease interval := make_interval(secs => greatest(coalesce(p_lease_seconds, 900), 1));
  v_window interval := make_interval(secs => greatest(coalesce(p_idempotency_window_seconds, 86400), 1));
begin
  if p_legacy_ids is null or array_length(p_legacy_ids, 1) is null then
    return;
  end if;
  if p_claim_token is null or btrim(p_claim_token) = '' then
    raise exception 'claim_legacy_sends_supplier_notify: p_claim_token jest wymagany';
  end if;
  if p_new_message_id is null or btrim(p_new_message_id) = '' then
    raise exception 'claim_legacy_sends_supplier_notify: p_new_message_id jest wymagany';
  end if;

  return query
  with claimed as (
    update public.legacy_sends s
       set data = coalesce(s.data, '{}'::jsonb) || jsonb_build_object(
             'supplierNotifyClaimToken', p_claim_token,
             'supplierNotifyClaimedAt', v_at,
             'supplierNotifyMessageId', coalesce(s.data->>'supplierNotifyMessageId', p_new_message_id),
             'supplierNotifyFirstClaimAt', coalesce(s.data->>'supplierNotifyFirstClaimAt', v_at),
             'supplierNotifyAttempts', coalesce((s.data->>'supplierNotifyAttempts')::integer, 0) + 1
           ),
           updated_at = now()
     where s.legacy_id = any(p_legacy_ids)
       and (s.data->>'supplierNotifiedAt') is null
       -- niepewny wynik poza oknem idempotencji: nie ponawiamy automatycznie
       and not (
             (s.data->>'supplierNotifyUncertainAt') is not null
         and coalesce((s.data->>'supplierNotifyFirstClaimAt')::timestamptz, p_claimed_at) < p_claimed_at - v_window
       )
       and (
            (s.data->>'supplierNotifyClaimToken') is null
         or (s.data->>'supplierNotifyClaimedAt') is null
         or (s.data->>'supplierNotifyClaimToken') = p_claim_token
         or (s.data->>'supplierNotifyClaimedAt')::timestamptz < p_claimed_at - v_lease
       )
    returning s.legacy_id, s.data
  )
  select c.legacy_id,
         'claimed'::text,
         c.data->>'supplierNotifyMessageId',
         coalesce((c.data->>'supplierNotifyAttempts')::integer, 1)
    from claimed c
  union all
  -- Wiersze, których nie wzięliśmy — z powodem. CTE modyfikujące dane i ten SELECT
  -- widzą TEN SAM snapshot, więc `s.data` jest tu sprzed aktualizacji; dlatego
  -- wykluczamy zajęte po id, a nie po zawartości.
  select s.legacy_id,
         case
           when (s.data->>'supplierNotifiedAt') is not null then 'notified'
           when (s.data->>'supplierNotifyUncertainAt') is not null
            and coalesce((s.data->>'supplierNotifyFirstClaimAt')::timestamptz, p_claimed_at) < p_claimed_at - v_window
             then 'needs_review'
           else 'busy'
         end,
         s.data->>'supplierNotifyMessageId',
         coalesce((s.data->>'supplierNotifyAttempts')::integer, 0)
    from public.legacy_sends s
   where s.legacy_id = any(p_legacy_ids)
     and s.legacy_id not in (select c2.legacy_id from claimed c2);
end;
$$;

comment on function public.claim_legacy_sends_supplier_notify(bigint[], text, text, timestamptz, integer, integer) is
  'Rezerwuje wysyłki do powiadomienia dostawcy o odczycie i nadaje/utrzymuje stałe supplierNotifyMessageId (Idempotency-Key poczty). Zwraca stan KAŻDEGO pytanego wiersza: claimed / notified / busy / needs_review. Mail wolno zbudować wyłącznie z wierszy claimed, osobno dla każdego message_id.';

-- ── 2. confirm — mail poszedł ───────────────────────────────────────────────
-- Tylko wiersze z NASZĄ rezerwacją i bez znacznika wysłania. Zwracana liczba
-- jest sprawdzana przez notifier: potwierdzenie części wierszy to NIE jest sukces.
-- Pola robocze rezerwacji znikają; messageId zostaje, bo pozwala skojarzyć wiersz
-- z konkretną wiadomością u dostawcy i w Resend.
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
                   - 'supplierNotifyClaimedAt'
                   - 'supplierNotifyFirstClaimAt'
                   - 'supplierNotifyAttempts'
                   - 'supplierNotifyUncertainAt')
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
  'Potwierdza wysłane powiadomienie dostawcy: zdejmuje rezerwację, stawia supplierNotifiedAt. Działa tylko na wierszach z tym samym tokenem rezerwacji. Zwraca liczbę potwierdzonych — wołający MUSI sprawdzić kompletność.';

-- ── 3. release — poczta JEDNOZNACZNIE odmówiła ──────────────────────────────
-- Mail nie powstał, więc kasujemy całą historię próby łącznie z messageId: kolejne
-- zdarzenie zacznie czystą wiadomość. Bez tego nieudana wysyłka kasowała
-- powiadomienie na zawsze.
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
                  - 'supplierNotifyClaimedAt'
                  - 'supplierNotifyMessageId'
                  - 'supplierNotifyFirstClaimAt'
                  - 'supplierNotifyAttempts'
                  - 'supplierNotifyUncertainAt',
         updated_at = now()
   where legacy_id = any(p_legacy_ids)
     and (data->>'supplierNotifyClaimToken') = p_claim_token
     and (data->>'supplierNotifiedAt') is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) is
  'Zwalnia rezerwację po jednoznacznej odmowie poczty (mail nie powstał) i kasuje tożsamość wiadomości, żeby ponowienie zaczęło od czystej.';

-- ── 4. mark_uncertain — nie wiemy, czy mail poszedł ─────────────────────────
-- Rezerwacja i messageId ZOSTAJĄ. Ponowienie po wygaśnięciu dzierżawy pójdzie
-- z tym samym Idempotency-Key, więc poczta nie utworzy drugiej wiadomości.
-- Po wyjściu poza okno idempotencji claim zwróci ten wiersz jako `needs_review`.
create or replace function public.mark_legacy_sends_supplier_notify_uncertain(
  p_legacy_ids bigint[],
  p_claim_token text,
  p_reason text default null,
  p_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_at text := to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_legacy_ids is null or array_length(p_legacy_ids, 1) is null then
    return 0;
  end if;
  update public.legacy_sends
     set data = coalesce(data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'supplierNotifyUncertainAt', v_at,
           'supplierNotifyUncertainReason', p_reason
         )),
         updated_at = now()
   where legacy_id = any(p_legacy_ids)
     and (data->>'supplierNotifyClaimToken') = p_claim_token
     and (data->>'supplierNotifiedAt') is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.mark_legacy_sends_supplier_notify_uncertain(bigint[], text, text, timestamptz) is
  'Notuje niepewny wynik wysyłki (brak odpowiedzi poczty, nieudane potwierdzenie). Rezerwacja i messageId zostają, więc ponowienie idzie tym samym Idempotency-Key; po oknie idempotencji wiersz wraca jako needs_review.';

-- ── 5. uprawnienia: wyłącznie service_role (funkcje Netlify) ────────────────
revoke all on function public.claim_legacy_sends_supplier_notify(bigint[], text, text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) from public, anon, authenticated;
revoke all on function public.mark_legacy_sends_supplier_notify_uncertain(bigint[], text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.claim_legacy_sends_supplier_notify(bigint[], text, text, timestamptz, integer, integer) to service_role;
grant execute on function public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz) to service_role;
grant execute on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) to service_role;
grant execute on function public.mark_legacy_sends_supplier_notify_uncertain(bigint[], text, text, timestamptz) to service_role;

commit;
