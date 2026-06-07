# Faza 2 — RPC `expire_legacy_sends_14d` na kotwicy daty mailingu (PLAN)

> **Status: PLAN do review. Nie implementować, nie aplikować migracji, nie wykonywać SQL.**
> Faza 1 (UI + `mailingSentAt`) jest na prod za `PRECONNECT_MAILING_DATE_LOGIC=true`.
> Faza 2 domyka silnik zwrotów, żeby UI i realny zwrot kredytu się nie rozjeżdżały.

## Cel
`expire_legacy_sends_14d` ma liczyć 14 dni od **daty mailingu** (`mailingSentAt` /
`emailSentAt` / planowany pierwszy wtorek), a nie od `sentAt` (moment moderacji /
„wyślij zatwierdzone", który może być PRZED realną wysyłką e-maila).

## ⚠️ Korekta po review (krytyczna)
Pierwsza wersja planu proponowała **globalny backfill `mailingSentAt = sentAt`
dla wszystkich `status='sent'`** — **ODRZUCONE**. Złamałoby to Fazę 1: rekordy
„Zaplanowane do mailingu" (status `sent`, ale e-mail jeszcze NIE poszedł)
zostałyby oznaczone jakby mailing już się odbył → powrót do starego błędu
(liczenie 14 dni od momentu pojawienia się w panelu, nie od wysyłki).
Backfill jest dozwolony **tylko bezpieczny** (z `emailSentAt`, patrz pkt 4).

---

## 1. Obecne RPC i gdzie liczy `sentAt`
Plik: `supabase/migrations/014_safe_expire_sends.sql`
(`public.expire_legacy_sends_14d()`, SECURITY DEFINER, wołane przy hydracji przez
każdego zalogowanego usera — `db.js: expireLegacySends14d`).

Kotwica dnia 0 (obecna):
```sql
where s.status = 'sent'
  and coalesce(
        public.safe_to_timestamptz(s.data->>'sentAt'),  -- ← KOTWICA = sentAt
        s.updated_at                                     -- fallback
      ) < now() - interval '14 days'
```
`legacy_sends` nie ma kolumn czasowych — `sentAt`/`emailSentAt`/`mailingSentAt`/
`sendDate` żyją w `data` JSONB. Akcja: promocja `status='sent' → 'unread_expired'`
(+ `data.expiredAt`). Zwrot kredytu jest osobno (`refundUnreadExpiredLegacySends`),
ale jest WYZWALANY przez ten status → **więcej expiry = więcej zwrotów**.

---

## 2. Nowa kotwica RPC — mirror frontu
Front (`sendMailingDate` w `PreconnectFM.jsx`) liczy:
`mailingSentAt → emailSentAt → first_tuesday_on_or_after(sendDate)`.
RPC ma to **mirrorować**, z dwoma SQL-owymi ostatecznymi fallbackami (bo SQL
potrzebuje wartości non-null):
```sql
mailing_anchor =
  coalesce(
    safe_to_timestamptz(s.data->>'mailingSentAt'),                 -- (1) realna data mailingu (Faza 1+)
    safe_to_timestamptz(s.data->>'emailSentAt'),                   -- (2) realna wysyłka e-maila (mailing-basket, też pre-Faza 1)
    first_tuesday_on_or_after( coalesce(                           -- (3) planowany pierwszy wtorek
        safe_to_timestamptz(s.data->>'sendDate')::date,
        safe_to_timestamptz(s.data->>'sentAt')::date,
        s.updated_at::date
    ) )::timestamptz,
    safe_to_timestamptz(s.data->>'sentAt'),                        -- (4) ostateczny fallback (gdy brak sendDate)
    s.updated_at                                                   -- (5) nigdy-null guard
  )
```
Promuj do `unread_expired` tylko gdy `mailing_anchor < now() - interval '14 days'`.

**Guard „mailing nieaktywny" jest automatyczny:** rekord, którego data mailingu
jest w przyszłości (np. `sendDate` przyszłe, brak `emailSentAt`/`mailingSentAt`),
ma `mailing_anchor > now()` → nigdy `< cutoff` → **NIE wygasa**. To dokładnie
odpowiada statusowi „Zaplanowane do mailingu" z Fazy 1 (zegar 14 dni jeszcze nie
wystartował). Dlatego globalny backfill `sentAt` jest niepotrzebny i szkodliwy.

Nowy helper SQL (immutable, mirror frontowego `firstTuesdayOnOrAfter`):
```sql
create or replace function public.first_tuesday_on_or_after(p_date date)
returns date language sql immutable as $$
  with m as (select date_trunc('month', p_date)::date as m1)
  select case
    when p_date <= (m1 + ((2 - extract(dow from m1)::int + 7) % 7))::date
      then (m1 + ((2 - extract(dow from m1)::int + 7) % 7))::date
    else (with nm as (select (date_trunc('month', p_date) + interval '1 month')::date as m1)
          select (nm.m1 + ((2 - extract(dow from nm.m1)::int + 7) % 7))::date from nm)
  end from m;
$$;
-- extract(dow): 0=niedziela, 2=wtorek. offset = (2 - dow + 7) % 7 (jak w JS).
```

---

## 3. Fallback, gdy `mailingSentAt` nie istnieje
Kolejność (pkt 2): (1) `mailingSentAt` → (2) `emailSentAt` → (3) planowany
pierwszy wtorek z `sendDate` (a jak brak — z `sentAt`/`updated_at`) → (4) `sentAt`
→ (5) `updated_at`. **`sentAt` NIE jest preferowaną kotwicą** — to tylko ostateczny
guard, gdy nie da się policzyć planowanej daty (brak `sendDate`).

---

## 4. Jak traktować historyczne rekordy (BEZ globalnego backfillu)
- **NIE** robimy `mailingSentAt = sentAt` masowo (łamie Fazę 1 — patrz korekta wyżej).
- Rekordy realnie wysłane e-mailem mają już `emailSentAt` (stempel z
  `handleEmailSent`, istniał też przed Fazą 1) → kotwica (2) je obsłuży poprawnie
  bez żadnego backfillu.
- Rekordy `sent` bez `emailSentAt` i bez `mailingSentAt` = **niewysłane jeszcze**
  (lub legacy). Dla nich kotwica = planowany pierwszy wtorek z `sendDate`:
  jeśli planowana data w przyszłości → NIE wygasają (zgodnie z „Zaplanowane");
  jeśli w przeszłości → mogą wygasnąć — te przypadki muszą trafić na listę ryzyka
  (pkt 5/6) do ręcznego review.
- **Backfill tylko bezpieczny** (idempotentny, normalizuje pole kanoniczne):
```sql
-- mailingSentAt = emailSentAt TYLKO gdy mamy realny emailSentAt i brak mailingSentAt.
update legacy_sends s
   set data = coalesce(s.data,'{}'::jsonb) || jsonb_build_object('mailingSentAt', s.data->>'emailSentAt'),
       updated_at = now()
 where s.status = 'sent'
   and (s.data->>'mailingSentAt') is null
   and (s.data->>'emailSentAt') is not null;
```
  (Ten backfill nie zmienia werdyktu — kotwica i tak czyta `emailSentAt` w (2);
  jedynie ujednolica dane. Można go pominąć — jest opcjonalny.)

---

## 5. Jak uniknąć masowego błędnego zwrotu — DRY-RUN z dwiema liczbami
**Przed** podmianą funkcji policz oba kierunki różnicy vs stara kotwica (`sentAt`):
```sql
with calc as (
  select s.legacy_id,
    (coalesce(safe_to_timestamptz(s.data->>'sentAt'), s.updated_at) < now()-interval '14 days') as old_exp,
    (coalesce(
       safe_to_timestamptz(s.data->>'mailingSentAt'),
       safe_to_timestamptz(s.data->>'emailSentAt'),
       first_tuesday_on_or_after(coalesce(safe_to_timestamptz(s.data->>'sendDate')::date,
                                          safe_to_timestamptz(s.data->>'sentAt')::date,
                                          s.updated_at::date))::timestamptz,
       safe_to_timestamptz(s.data->>'sentAt'), s.updated_at) < now()-interval '14 days') as new_exp
    from legacy_sends s where s.status='sent'
)
select count(*) filter (where new_exp and not old_exp) as extra_would_expire,        -- MUSI = 0 lub ręczna akceptacja
       count(*) filter (where old_exp and not new_exp) as rescued_would_not_expire,  -- może >0, OCZEKIWANE
       count(*) as total_sent
  from calc;
```
- **`extra_would_expire`** — nowa logika wygasiłaby coś, czego stara NIE: musi być
  **0**, albo **ręcznie zaakceptowane** po obejrzeniu listy ryzyka (pkt 6).
- **`rescued_would_not_expire`** — stara logika by wygasiła, ale nowa jeszcze nie
  (mailing zaplanowany później / e-mail nie poszedł): **może być >0 i jest
  oczekiwane** (to właśnie poprawka), ale **lista rekordów musi być pokazana do review**.

Dodatkowe warstwy: cała migracja w **transakcji**; **pierwszy sweep ręcznie** w
SQL editorze po migracji (kontrola pierwszej fali); idempotencja (drugi przebieg = 0).

---

## 6. Lista rekordów ryzyka (do review przed aplikacją)
```sql
with calc as (
  select s.*,
    coalesce(safe_to_timestamptz(s.data->>'sentAt'), s.updated_at) as old_anchor,
    coalesce(
      safe_to_timestamptz(s.data->>'mailingSentAt'),
      safe_to_timestamptz(s.data->>'emailSentAt'),
      first_tuesday_on_or_after(coalesce(safe_to_timestamptz(s.data->>'sendDate')::date,
                                         safe_to_timestamptz(s.data->>'sentAt')::date,
                                         s.updated_at::date))::timestamptz,
      safe_to_timestamptz(s.data->>'sentAt'), s.updated_at) as proposed_anchor
  from legacy_sends s where s.status='sent'
)
select c.name as company, r.name as retailer,
       s.data->>'sendDate'     as send_date,
       s.data->>'sentAt'       as sent_at,
       s.data->>'emailSentAt'  as email_sent_at,
       s.data->>'mailingSentAt' as mailing_sent_at,
       calc.proposed_anchor, calc.old_anchor, s.status,
       case
         when (calc.proposed_anchor < now()-interval '14 days') and not (calc.old_anchor < now()-interval '14 days') then 'EXTRA (ryzyko)'
         when not (calc.proposed_anchor < now()-interval '14 days') and (calc.old_anchor < now()-interval '14 days') then 'RESCUED (oczekiwane)'
       end as bucket
  from calc
  join legacy_sends s on s.legacy_id = calc.legacy_id
  left join companies c on c.legacy_supplier_id = s.supplier_legacy_id
  left join retailers r on r.id = s.retailer_id
 where (calc.proposed_anchor < now()-interval '14 days') <> (calc.old_anchor < now()-interval '14 days')
 order by bucket, send_date;
```
Kolumny: `company, retailer, sendDate, sentAt, emailSentAt, mailingSentAt,
proposed_anchor, old_anchor, status` (+ `bucket` EXTRA/RESCUED). EXTRA → musi być
puste albo ręcznie zaakceptowane; RESCUED → przeglądamy, jest OK.

---

## 7. SQL migracji (DO REVIEW — NIE APLIKOWAĆ)
Proponowany plik: `supabase/migrations/044_expire_on_mailing_date.sql`
```sql
begin;

-- 1) Helper: pierwszy wtorek miesiąca >= daty (mirror frontu).
create or replace function public.first_tuesday_on_or_after(p_date date)
returns date language sql immutable as $$
  with m as (select date_trunc('month', p_date)::date as m1)
  select case
    when p_date <= (m1 + ((2 - extract(dow from m1)::int + 7) % 7))::date
      then (m1 + ((2 - extract(dow from m1)::int + 7) % 7))::date
    else (with nm as (select (date_trunc('month', p_date) + interval '1 month')::date as m1)
          select (nm.m1 + ((2 - extract(dow from nm.m1)::int + 7) % 7))::date from nm)
  end from m;
$$;

-- 2) (OPCJONALNY) bezpieczny backfill: mailingSentAt = emailSentAt, NIGDY = sentAt.
update legacy_sends s
   set data = coalesce(s.data,'{}'::jsonb) || jsonb_build_object('mailingSentAt', s.data->>'emailSentAt'),
       updated_at = now()
 where s.status='sent' and (s.data->>'mailingSentAt') is null and (s.data->>'emailSentAt') is not null;

-- 3) Podmiana funkcji — kotwica = data mailingu (mirror frontu).
drop function if exists public.expire_legacy_sends_14d();
create function public.expire_legacy_sends_14d()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - interval '14 days';
begin
  if auth.uid() is null then
    raise exception 'expire_legacy_sends_14d: must be authenticated';
  end if;
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
               s.updated_at::date))::timestamptz,
             public.safe_to_timestamptz(s.data->>'sentAt'),
             s.updated_at
           ) < v_cutoff
  )
  update legacy_sends s
     set status = 'unread_expired',
         data = coalesce(s.data,'{}'::jsonb)
                || jsonb_build_object('status','unread_expired',
                     'expiredAt', to_char(v_now at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         updated_at = v_now
   where s.legacy_id in (select legacy_id from stale);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_legacy_sends_14d() from public;
grant execute on function public.expire_legacy_sends_14d() to authenticated;

commit;
```
Wykonać DRY-RUN (pkt 5) + listę ryzyka (pkt 6) **przed** tym plikiem; aplikować
tylko gdy `extra_would_expire = 0` **lub** lista EXTRA ręcznie zaakceptowana.

---

## 8. Rollback
- Migracja w transakcji → błąd = `rollback` automatyczny.
- Po fakcie: odtworzyć funkcję z **body z `014`** (kotwica `sentAt`) i
  `drop function if exists public.first_tuesday_on_or_after(date);`.
- Bezpieczny backfill `mailingSentAt = emailSentAt` jest addytywny i **nieszkodliwy**
  (stara funkcja go ignoruje; wartość = realny emailSentAt, więc i tak poprawna).
  Nie usuwamy. Brak nieodwracalnych zmian (żadnych dropów kolumn/danych).

---

## 9. Smoke test po migracji (sandbox / kontrolnie na prod)
1. `select public.first_tuesday_on_or_after('2026-06-07');` → `2026-07-07`
   (+ pozostałe z `scripts/test-mailing-first-tuesday.mjs`).
2. DRY-RUN (pkt 5): `extra_would_expire = 0` (lub lista EXTRA zaakceptowana);
   `rescued_would_not_expire` — przejrzana lista (pkt 6).
3. `select public.expire_legacy_sends_14d();` ręcznie → licznik = realne expiry;
   **drugie wywołanie = 0** (idempotencja).
4. Rekord z `emailSentAt`/`mailingSentAt` 20 dni temu, `sent`, bez odczytu →
   `unread_expired` + zwrot kredytu w Rozliczeniach.
5. Rekord z `mailingSentAt` 5 dni temu → zostaje `sent`.
6. Rekord BEZ `emailSentAt`/`mailingSentAt`, `sendDate` w przyszłości (planowany
   wtorek > dziś) → zostaje `sent` (mailing nieaktywny, „Zaplanowane do mailingu").
7. Krzyżowo: licznik zwrotów w „Rozliczenia → rozliczenie kredytów PreConnect"
   zgadza się z liczbą `unread_expired`; UI dostawcy spójne z werdyktem RPC.
8. Po potwierdzeniu — usunąć ręczny krok, sweep działa przy hydracji.

---

## Zależności / kolejność
1. Review tego planu → 2. DRY-RUN + lista ryzyka (read-only, w SQL editorze) →
3. Akceptacja `extra_would_expire` → 4. Aplikacja `044_*` ręcznie w transakcji →
5. Ręczny pierwszy sweep + smoke test. Domyślnie migracja = aktywacja (logika
serwerowa, idempotentna); bez nowej flagi, chyba że wolisz bramkę env.
