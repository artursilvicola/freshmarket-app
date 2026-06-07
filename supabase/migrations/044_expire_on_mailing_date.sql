-- ===================================================================
-- 044 — expire_legacy_sends_14d na KOTWICY DATY MAILINGU (Faza 2)
-- [feat/preconnect-expire-on-mailing-date]
--
-- Cel: 14-dniowy zegar wygasania liczyć od DATY MAILINGU, nie od `sentAt`
-- (moment moderacji / „wyślij zatwierdzone", który może być PRZED realną
-- wysyłką e-maila). Domyka Fazę 1 (UI „pierwszy wtorek" + stempel mailingSentAt),
-- żeby UI i realny zwrot kredytu się nie rozjeżdżały.
--
-- Kotwica (mirror frontu `sendMailingDate` z PreconnectFM.jsx):
--   mailingSentAt → emailSentAt → first_tuesday_on_or_after(sendDate/sentAt/updated_at)
--   → sentAt → updated_at
-- (sentAt/updated_at to tylko ostateczne guardy non-null, NIE preferowana kotwica.)
--
-- Guard „mailing nieaktywny" jest automatyczny: rekord, którego data mailingu
-- jest w przyszłości, ma kotwicę > now() → nigdy < cutoff → NIE wygasa
-- (spójne ze statusem „Zaplanowane do mailingu" z Fazy 1).
--
-- BEZ backfillu: globalny `mailingSentAt = sentAt` jest ZAKAZANY (łamałby Fazę 1 —
-- rekordy zaplanowane do mailingu wyglądałyby jak po mailingu). DRY-RUN wykazał
-- 0 rekordów `emailSentAt` bez `mailingSentAt`, więc bezpieczny backfill i tak
-- byłby no-op — pomijamy go całkowicie.
--
-- ⚠️ PRZED APLIKACJĄ: powtórzyć DRY-RUN (docs/billing/PRECONNECT_MAILING_FAZA2_DRYRUN.sql,
--    zapytanie 1). Warunek wejścia: extra_would_expire = 0 ALBO ręczna akceptacja
--    listy EXTRA (zapytanie 2). Dane są małe i zmienne — werdykt to migawka.
--
-- Zależność: public.safe_to_timestamptz(text) z migracji 014 (bezpieczny cast).
-- Brak zmian danych w samej migracji (poza tym, co RPC zrobi przy późniejszym
-- sweepie). Idempotentne (create or replace / drop + create). Aplikować ręcznie.
-- ===================================================================

begin;

-- ============================================================
-- 1) Helper: pierwszy wtorek miesiąca >= podanej daty (mirror frontowego
--    firstTuesdayOnOrAfter). Date-only, immutable, nie rzuca.
--    2026-06-01→06-02, 06-02→06-02, 06-07→07-07, 07-08→08-04.
-- ============================================================
create or replace function public.first_tuesday_on_or_after(p_date date)
returns date
language sql
immutable
as $$
  with m as (
    select date_trunc('month', p_date)::date                          as m1,  -- 1. dzień miesiąca p_date
           (date_trunc('month', p_date) + interval '1 month')::date    as m2   -- 1. dzień następnego miesiąca
  )
  select case
    -- pierwszy wtorek miesiąca p_date = m1 + offset do wtorku (dow: 0=nd, 2=wt)
    when p_date <= (m1 + ((2 - extract(dow from m1)::int + 7) % 7))
      then (m1 + ((2 - extract(dow from m1)::int + 7) % 7))
    -- p_date po pierwszym wtorku → pierwszy wtorek następnego miesiąca
    else      (m2 + ((2 - extract(dow from m2)::int + 7) % 7))
  end
  from m;
$$;

comment on function public.first_tuesday_on_or_after(date) is
  '[Faza 2] Najbliższy pierwszy wtorek miesiąca >= p_date. Mirror frontowego '
  'firstTuesdayOnOrAfter (reguła mailingu PreConnect = pierwszy wtorek).';

-- ============================================================
-- 2) Podmiana expire_legacy_sends_14d — kotwica = data mailingu.
--    (Zachowuje strukturę z 014: SECURITY DEFINER, auth guard, safe cast,
--     brak silent exception handler — błędy widoczne; klient ma try/catch.)
-- ============================================================
drop function if exists public.expire_legacy_sends_14d();
create function public.expire_legacy_sends_14d()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - interval '14 days';
begin
  if auth.uid() is null then
    raise exception 'expire_legacy_sends_14d: must be authenticated';
  end if;

  -- Kotwica dnia 0 = data mailingu:
  --   (1) mailingSentAt  — realny stempel z Fazy 1 (ręczne „Wyślij e-mail")
  --   (2) emailSentAt     — realna wysyłka e-maila (mailing-basket, też pre-Faza 1)
  --   (3) planowany pierwszy wtorek z sendDate (a jak brak — z sentAt/updated_at)
  --   (4) sentAt          — ostateczny fallback (gdy nie da się policzyć planu)
  --   (5) updated_at      — nigdy-null guard
  -- safe_to_timestamptz NIGDY nie rzuca → jeden zły rekord nie wywala sweep'a.
  with stale as (
    select s.legacy_id
      from legacy_sends s
     where s.status = 'sent'
       and coalesce(
             public.safe_to_timestamptz(s.data->>'mailingSentAt'),
             public.safe_to_timestamptz(s.data->>'emailSentAt'),
             public.first_tuesday_on_or_after(coalesce(
               public.safe_to_timestamptz(s.data->>'sendDate')::date,
               public.safe_to_timestamptz(s.data->>'sentAt')::date,
               s.updated_at::date
             ))::timestamptz,
             public.safe_to_timestamptz(s.data->>'sentAt'),
             s.updated_at
           ) < v_cutoff
  )
  update legacy_sends s
     set status = 'unread_expired',
         data = coalesce(s.data, '{}'::jsonb)
                || jsonb_build_object(
                     'status', 'unread_expired',
                     'expiredAt', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                   ),
         updated_at = v_now
   where s.legacy_id in (select legacy_id from stale);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_legacy_sends_14d() from public;
grant execute on function public.expire_legacy_sends_14d() to authenticated;

commit;

-- ===================================================================
-- ROLLBACK (jeśli potrzebny po aplikacji):
--   1) odtworzyć funkcję z body migracji 014 (kotwica = sentAt),
--   2) drop function if exists public.first_tuesday_on_or_after(date);
--   Brak nieodwracalnych zmian — żadnych dropów kolumn/danych.
--
-- SMOKE TEST po aplikacji (sandbox / kontrolnie):
--   - select public.first_tuesday_on_or_after('2026-06-07'); → 2026-07-07
--   - DRY-RUN zapytanie 1: extra_would_expire = 0 (lub akceptacja listy EXTRA)
--   - select public.expire_legacy_sends_14d(); ręcznie; drugie wywołanie = 0
--   - rekord mailingSentAt 20 dni temu (sent, bez odczytu) → unread_expired + zwrot
--   - rekord mailingSentAt 5 dni temu → zostaje sent
--   - rekord bez stempli, sendDate w przyszłości → zostaje sent (mailing nieaktywny)
-- ===================================================================
