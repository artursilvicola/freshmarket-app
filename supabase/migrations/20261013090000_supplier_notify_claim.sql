-- ============================================================================
-- 20261013090000 — powiadomienie dostawcy o odczycie: rezerwacja + niezmienna wiadomość
--
-- NIEWDROŻONA NIGDZIE w chwili pisania — plik jest poprawiany w miejscu po
-- kolejnych turach review Codexa (13.10). Gdyby trafiła już na jakąkolwiek bazę,
-- różnice trzeba wgrać osobną migracją, nie edycją tej.
--
-- ── Co było nie tak (cztery tury) ───────────────────────────────────────────
--
--  1. POWIADOMIENIE MOGŁO PRZEPAŚĆ. `mark_legacy_sends_supplier_notified` ustawiał
--     `supplierNotifiedAt` PRZED wysłaniem maila. Odmowa poczty blokowała wysyłkę
--     na zawsze: jedno pole pełniło dwie role — „zajęte" i „wysłane".
--
--  2. MAIL MÓGŁ ZAWIERAĆ PROPOZYCJE Z CUDZEJ REZERWACJI. RPC zwracał tylko LICZBĘ
--     zajętych wierszy, a notifier wysyłał mail o CAŁEJ grupie.
--
--  3. SAMA REZERWACJA TYLKO ODSUWAŁA DUBLA. Po wygaśnięciu dzierżawy ponowienie
--     wysyłało drugi mail — 15 minut później.
--
--  4. TOŻSAMOŚĆ BEZ NIEZMIENNEJ TREŚCI NIE WYSTARCZA. Resend wiąże Idempotency-Key
--     z KONKRETNYM ładunkiem: ten sam klucz z inną treścią to błąd 409, nie cicha
--     deduplikacja. Ponowienie wpisywało nową godzinę odczytu, a po częściowym
--     potwierdzeniu paczki A+B wysyłało już tylko B — czyli za każdym razem inną
--     treść pod tym samym kluczem.
--
--  5. OKNO 24 h DAŁO SIĘ OMINĄĆ PRZEZ AWARIĘ. Blokada opierała się na znaczniku
--     „wynik niepewny". Gdy poczta przyjęła mail, a zapis znacznika padł, po 25 h
--     kod ponawiał — a ochrona Resend już wygasła.
--
-- ── Rozwiązanie ─────────────────────────────────────────────────────────────
--
-- Stany w `legacy_sends.data`:
--
--   supplierNotifyClaimToken + …ClaimedAt   „wysyłka w toku" (rezerwacja, dzierżawa)
--   supplierNotifyMessageId                 TOŻSAMOŚĆ WIADOMOŚCI, stała między próbami
--   supplierNotifyFirstClaimAt              początek liczenia bezpiecznego okna
--   supplierNotifiedAt + …Via + …BatchSize  „wysłano"
--
-- Treść wiadomości NIE jest składana od nowa przy każdej próbie: ląduje raz
-- w `legacy_send_notify_messages` (adresat, temat, HTML, pełna lista propozycji)
-- i ponowienie wysyła DOKŁADNIE ją, z tym samym Idempotency-Key. Dzięki temu
-- powtórka jest dla Resend tą samą wiadomością, a nie konfliktem 409.
--
-- Po upływie bezpiecznego okna (domyślnie 24 h = ochrona Resend) NIEPOTWIERDZONY
-- wiersz nie jest ponawiany automatycznie — niezależnie od tego, czy udało się
-- zapisać znacznik niepewności. Brak potwierdzenia sam w sobie znaczy „nie wiemy,
-- czy mail poszedł", a klucz już nie chroni. Taki wiersz wraca jako `needs_review`.
--
--   claim          zajmuje wiersze, nadaje/utrzymuje messageId, ZWRACA STAN KAŻDEGO
--                  z pytanych wierszy: claimed / notified / busy / needs_review
--   ensure_message zapisuje niezmienną treść wiadomości albo oddaje już zapisaną
--   confirm        po udanej wysyłce: zdejmuje rezerwację, stawia znacznik wysłania
--   release        gdy poczta ODRZUCIŁA ładunek: pełny reset (wiadomość nie powstała)
--   mark_uncertain gdy wyniku nie znamy — informacyjnie; blokada po oknie NIE zależy
--                  od tego zapisu
--
-- `mark_legacy_sends_supplier_notified` ZOSTAJE bez zmian — stary kod funkcji
-- Netlify działa po tej migracji. Nowy kod bez migracji nie wyśle nic (brak RPC),
-- więc kolejność wdrożenia: TA MIGRACJA → deploy funkcji.
--
-- Idempotentne: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, bez zmian w danych.
-- ============================================================================

begin;

-- Stare podpisy z wcześniejszych tur — sygnatury się zmieniały, więc trzeba je zdjąć,
-- inaczej CREATE OR REPLACE zostawiłby obok dwie wersje funkcji.
drop function if exists public.claim_legacy_sends_supplier_notify(bigint[], text, timestamptz, integer);
drop function if exists public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz);

-- ── 1. niezmienna treść wiadomości ──────────────────────────────────────────
-- Jeden wiersz = jedna wiadomość do dostawcy. Powstaje przy pierwszej próbie
-- i NIGDY się nie zmienia: ponowienie wysyła dokładnie to samo, więc Resend widzi
-- ten sam ładunek pod tym samym kluczem.
--
-- HTML trzymamy tu, a nie w `legacy_sends.data`, żeby nie powielać treści na każdym
-- wierszu paczki. `legacy_ids` to PEŁNA lista propozycji objętych wiadomością —
-- także tych, które w kolejnej próbie są już potwierdzone.
create table if not exists public.legacy_send_notify_messages (
  message_id text primary key,
  to_email   text not null,
  subject    text not null,
  html       text not null,
  legacy_ids bigint[] not null,
  created_at timestamptz not null default now()
);

comment on table public.legacy_send_notify_messages is
  'Niezmienna treść powiadomienia dostawcy o odczycie. message_id = Idempotency-Key wysyłany do Resend; ponowienie musi wysłać DOKŁADNIE ten ładunek, inaczej Resend odpowie 409.';

alter table public.legacy_send_notify_messages enable row level security;
-- Brak polityk = brak dostępu dla anon/authenticated. service_role omija RLS.

-- „Zapisz albo oddaj już zapisaną" w jednym kroku: przy wyścigu dwóch ścieżek
-- obie dostaną TĘ SAMĄ treść, bo przegrany czyta wiersz zwycięzcy.
create or replace function public.ensure_legacy_send_notify_message(
  p_message_id text,
  p_to_email text,
  p_subject text,
  p_html text,
  p_legacy_ids bigint[]
)
returns table (message_id text, to_email text, subject text, html text, legacy_ids bigint[], created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_message_id is null or btrim(p_message_id) = '' then
    raise exception 'ensure_legacy_send_notify_message: p_message_id jest wymagany';
  end if;

  -- ON CONFLICT (message_id) nie przechodzi: funkcja ma kolumnę wyniku o tej samej
  -- nazwie, więc Postgres zgłasza 42702 „column reference message_id is ambiguous"
  -- i ŻADNA wiadomość się nie zapisuje (znalezisko Codexa z uruchomienia w PGlite).
  -- Wskazanie klucza po nazwie usuwa dwuznaczność.
  insert into public.legacy_send_notify_messages as m (message_id, to_email, subject, html, legacy_ids)
  values (p_message_id, p_to_email, p_subject, p_html, coalesce(p_legacy_ids, '{}'::bigint[]))
  on conflict on constraint legacy_send_notify_messages_pkey do nothing;

  return query
  select m.message_id, m.to_email, m.subject, m.html, m.legacy_ids, m.created_at
    from public.legacy_send_notify_messages m
   where m.message_id = p_message_id;
end;
$$;

comment on function public.ensure_legacy_send_notify_message(text, text, text, text, bigint[]) is
  'Zapisuje treść wiadomości przy pierwszej próbie albo oddaje już zapisaną. Wołający MUSI wysłać to, co funkcja zwróciła, a nie to, co sam zbudował.';

-- ── 2. claim — zajmij wiersze, nadaj tożsamość wiadomości, oddaj stan ───────
--
-- Zajmujemy wiersz, gdy nie ma znacznika wysłania ORAZ (brak rezerwacji LUB
-- rezerwacja wygasła LUB to nasza własna) ORAZ pierwsza próba nie jest starsza
-- niż bezpieczne okno.
--
-- Warunek okna celowo NIE pyta o znacznik niepewności. Gdyby pytał, dałoby się go
-- ominąć awarią: poczta przyjmuje mail, zapis znacznika pada, po 25 h wiersz wraca
-- do obiegu i leci dubel bez ochrony Resend. Dla blokady liczy się sam fakt, że
-- wiersz NIE JEST potwierdzony od ponad doby.
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
       -- niepotwierdzony dłużej niż bezpieczne okno: nie ponawiamy automatycznie,
       -- bez względu na to, czy znacznik niepewności w ogóle się zapisał
       and coalesce((s.data->>'supplierNotifyFirstClaimAt')::timestamptz, p_claimed_at) >= p_claimed_at - v_window
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
           when coalesce((s.data->>'supplierNotifyFirstClaimAt')::timestamptz, p_claimed_at) < p_claimed_at - v_window
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
  'Rezerwuje wysyłki do powiadomienia dostawcy o odczycie i nadaje/utrzymuje stałe supplierNotifyMessageId (Idempotency-Key poczty). Zwraca stan KAŻDEGO pytanego wiersza: claimed / notified / busy / needs_review. Po bezpiecznym oknie niepotwierdzony wiersz NIE jest ponawiany automatycznie, niezależnie od znacznika niepewności.';

-- ── 3. confirm — mail poszedł ───────────────────────────────────────────────
-- Tylko wiersze z NASZĄ rezerwacją i bez znacznika wysłania. Zwracana liczba
-- jest sprawdzana przez notifier: potwierdzenie części wierszy to NIE jest sukces.
-- Pola robocze rezerwacji znikają; messageId zostaje, bo pozwala skojarzyć wiersz
-- z konkretną wiadomością w `legacy_send_notify_messages` i w Resend.
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
                   - 'supplierNotifyUncertainAt'
                   - 'supplierNotifyUncertainReason')
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

-- ── 4. release — poczta ODRZUCIŁA ładunek ───────────────────────────────────
-- Wiadomość nie powstała i nigdy nie powstanie w tej postaci (zły adres, brak
-- klucza API, odrzucony ładunek), więc kasujemy całą historię próby łącznie
-- z messageId: kolejne zdarzenie zacznie czystą wiadomość.
--
-- NIE wolno tego wołać przy 409 ani przy braku odpowiedzi poczty — wtedy mail
-- mógł powstać, a skasowanie tożsamości otwiera drogę do dubla.
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
                  - 'supplierNotifyUncertainAt'
                  - 'supplierNotifyUncertainReason',
         updated_at = now()
   where legacy_id = any(p_legacy_ids)
     and (data->>'supplierNotifyClaimToken') = p_claim_token
     and (data->>'supplierNotifiedAt') is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) is
  'Zwalnia rezerwację, gdy poczta odrzuciła ładunek (wiadomość nie powstała), i kasuje tożsamość wiadomości. Nie wolno wołać przy 409 ani przy braku odpowiedzi.';

-- ── 5. mark_uncertain — nie wiemy, czy mail poszedł ─────────────────────────
-- Rezerwacja i messageId ZOSTAJĄ. Zapis jest informacyjny: blokada po bezpiecznym
-- oknie wynika z braku potwierdzenia, nie z obecności tego znacznika, więc awaria
-- tego zapisu niczego nie otwiera.
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
  'Notuje niepewny wynik wysyłki. Informacyjnie — blokada ponowień po bezpiecznym oknie NIE zależy od tego zapisu.';

-- ── 6. uprawnienia: wyłącznie service_role (funkcje Netlify) ────────────────
revoke all on function public.ensure_legacy_send_notify_message(text, text, text, text, bigint[]) from public, anon, authenticated;
revoke all on function public.claim_legacy_sends_supplier_notify(bigint[], text, text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) from public, anon, authenticated;
revoke all on function public.mark_legacy_sends_supplier_notify_uncertain(bigint[], text, text, timestamptz) from public, anon, authenticated;
revoke all on table public.legacy_send_notify_messages from public, anon, authenticated;

grant execute on function public.ensure_legacy_send_notify_message(text, text, text, text, bigint[]) to service_role;
grant execute on function public.claim_legacy_sends_supplier_notify(bigint[], text, text, timestamptz, integer, integer) to service_role;
grant execute on function public.confirm_legacy_sends_supplier_notified(bigint[], text, text, integer, timestamptz) to service_role;
grant execute on function public.release_legacy_sends_supplier_notify_claim(bigint[], text) to service_role;
grant execute on function public.mark_legacy_sends_supplier_notify_uncertain(bigint[], text, text, timestamptz) to service_role;
grant select, insert on table public.legacy_send_notify_messages to service_role;

commit;
