# Incydent mailowy 2026-06-10 — błędne przypomnienie z równoległego systemu

> **Status:** ZAMKNIĘTY (wysyłka zatrzymana). · **Klasyfikacja skutku:** brak realnych odbiorców (1 mail na konto testowe).
> **Ten dokument NIE zmienia kodu, flag, danych ani migracji — to wyłącznie opis i audyt po incydencie.**
> **Powiązane:** [PRODUCTION_HANDOVER.md](PRODUCTION_HANDOVER.md) (sekcja I — Ryzyka) · [SUPABASE_MAIL_CRON_AUDIT.sql](SUPABASE_MAIL_CRON_AUDIT.sql)

---

## 0. Streszczenie (TL;DR)

10 czerwca 2026 do skrzynki kupca trafił błędny mail **„Przypomnienie: propozycja od Dostawca
wygasa za 2 dni"** — z niewypełnionymi placeholderami („Dostawca" zamiast nazwy firmy).

- **Źródło NIE jest w repo `b2b.freshmarket.eu`** ani w GMass/Mailchimp.
- Źródłem jest **równoległy system `freshmarketb2b`**: funkcja bazodanowa Postgres
  `public.fm_14d_reminder_job()` uruchamiana przez **cron pg_cron `fm-14d-reminder`** (codziennie
  09:00 UTC), wysyłająca maile przez **Supabase Edge Function `send-email`**.
- **Zatrzymano:** `select cron.unschedule('fm-14d-reminder');` → `true` (job usunięty z harmonogramu).
- **Zasięg:** **1 mail** do konta testowego **`auchan@kjow.pl`**. **Zero realnych sieci.**
- **Sprostowanie:** **niepotrzebne** (odbiorca testowy).
- **Repo b2b / feature flagi / deploy aplikacji / `ACCOUNT_HARD_DELETE`** — **nietknięte** podczas
  diagnozy i zatrzymania. Działania ograniczone do read-only SQL + jednego `cron.unschedule`.

---

## 1. Źródło incydentu

Maila NIE wygenerował kod produkcyjnej aplikacji `b2b.freshmarket.eu` (to repo) — który maile
transakcyjne wysyła przez **Netlify Functions + Resend, from `newsletter@freshmarket.eu`**.

Maila wygenerował **drugi, równoległy system** współdzielący ten sam projekt Supabase
`sklyfuvzjikkqerxtulo`, którego logika żyje w **funkcjach bazy danych**, a nie w gicie tego repo.
Łańcuch wysyłki:

```
pg_cron job  fm-14d-reminder   (schedule: 0 9 * * *  = 09:00 UTC = 11:00 PL)
   └─ SELECT public.fm_14d_reminder_job()          -- funkcja DB (SECURITY DEFINER)
        └─ net.http_post( …/functions/v1/send-email , { template: 'pipeline-14d-reminder', … } )
             └─ Supabase Edge Function  send-email  -- szablon pipeline-14d-reminder
                  └─ mail „Przypomnienie: propozycja od {supplierName} wygasa za {daysLeft} dni"
```

Korelacja czasowa potwierdza źródło: harmonogram `0 9 * * *` = **09:00 UTC = 11:00 czasu PL**,
co odpowiada godzinie otrzymania maila.

Materiał źródłowy tego systemu leży (jako pliki NIE-commitowane) w katalogu roboczym repo:
- `b2b-email-system-DONE.md` (data 2026-05-11) — opis: 9 szablonów Edge Function `send-email`,
  3 triggery DB, cron `fm-14d-reminder` „codziennie o 09:00 UTC".
- `b2b-supabase-email-deploy/01-edge-function-send-email.ts` (wariant SMTP / nodemailer)
- `b2b-supabase-email-deploy/02-edge-function-send-email-RESEND.ts` (wariant Resend HTTP API)

> Szablon `pipeline-14d-reminder` w Edge Function renderuje dosłownie:
> `subject: "Przypomnienie: propozycja od ${supplierName} wygasa za ${daysLeft} dni"`,
> czyli przyjmuje wartość `supplierName` przekazaną w payloadzie — nie weryfikuje, czy nie jest
> to literał-zaślepka.

---

## 2. Przyczyna placeholderów „Dostawca / Oferta"

W funkcji `public.fm_14d_reminder_job()` nazwy są czytane z pola JSONB `legacy_sends.data`:

```sql
supplier_name := COALESCE(send_rec.data->>'supplierName',
                          send_rec.data->>'supplierCompany', 'Dostawca');
offer_name    := COALESCE(send_rec.data->>'offerName',
                          send_rec.data->>'product',         'Oferta');
```

Pola `supplierName`/`supplierCompany` oraz `offerName`/`product` **nie istnieją** w `legacy_sends.data`
dla tych rekordów → `COALESCE` schodzi do **literalnego fallbacku `'Dostawca'` / `'Oferta'`**.
Ta wartość trafia do payloadu Edge Function i renderuje się dosłownie w treści maila
(„propozycja od **Dostawca**").

**Poprawnie** nazwy należałoby rozwiązać przez **JOIN** do tabel `companies` / `legacy_offers`
(po `supplier_legacy_id` / `offer_legacy_id`) — dokładnie tak, jak robi to **działający i
poprawny** trigger `public.fm_notify_send_email()` (powiadomienie „Nowa propozycja do moderacji"
kierowane do admina). Reminder zbudowano z błędnym założeniem o kształcie danych.

> Ten sam dług opisuje `b2b-email-system-DONE.md` w „Co zostało do zrobienia":
> *„Mapowanie `legacy_sends.supplier_legacy_id` → … (obecnie pomijane bo seed data nie ma tego linka)"*.

---

## 3. Co zostało zatrzymane

| Akcja | Komenda | Wynik |
|---|---|---|
| Wyłączenie crona | `select cron.unschedule('fm-14d-reminder');` | `true` |
| Weryfikacja | `select * from cron.job where jobname='fm-14d-reminder';` | **0 wierszy** (job nie istnieje) |

→ **Codzienna wysyłka 09:00 UTC zatrzymana.** Żaden kolejny mail „propozycja wygasa za N dni"
z tego źródła już nie wyjdzie, dopóki ktoś świadomie nie przywróci joba.

> Uwaga techniczna: bezpośredni `UPDATE cron.job SET active=false` zwraca `42501 permission denied
> for table job` — tabelę pg_cron zmienia się **wyłącznie** przez API `cron.*` (`schedule`/`unschedule`/`alter_job`).

**Czego NIE zatrzymano (świadomie — działa poprawnie):** trigger `public.fm_notify_send_email()`
wysyła powiadomienia o moderacji **do admina** (rozwiązuje nazwy przez JOIN, treść prawidłowa) —
to nie jest źródło incydentu i pozostaje aktywny.

---

## 4. Do kogo poszedł mail (zasięg)

Funkcja kieruje mail do **wszystkich aktywnych kupców sieci**, której propozycja `status='sent'`
ma 11–14 dni:

```sql
SELECT email, name FROM profiles
WHERE retailer_id = send_rec.retailer_id AND role = 'buyer' AND active = true;
```

Audyt read-only (2026-06-10) wykazał:

| Pytanie | Zapytanie | Wynik |
|---|---|---|
| Ile wysłań dostało przypomnienie (`reminder_sent=true`) | `count(*) … where (data->>'reminder_sent')::bool` | **1** |
| Do kogo trafił ten jeden mail | JOIN `legacy_sends` × `profiles` (sieć 104) | **`auchan@kjow.pl`** (Katarzyna Wrobel, Auchan Polska, retailer_id 104) |

`auchan@kjow.pl` to **konto testowe** (domena `@kjow.pl`). Matematyka się zgadza: send z
`2026-05-29` + 14 dni = `2026-06-12`; dnia `2026-06-10` zostają **2 dni** → „wygasa za 2 dni".

**Wniosek: incydent objął wyłącznie jedno konto testowe. Zero realnych sieci handlowych.**

---

## 5. Dlaczego nie trzeba sprostowania

- Jedyny odbiorca to konto testowe `@kjow.pl` (wewnętrzne, nie należy do realnej sieci handlowej).
- Żaden realny kontrahent nie otrzymał błędnej treści.
- Wysyłka jest zatrzymana, więc nie ma ryzyka kolejnych egzemplarzy.

→ **Sprostowanie / przeprosiny do kontrahentów: NIEPOTRZEBNE.**

---

## 6. Ryzyka, które pozostają (otwarte)

1. **Równoległy system „duch".** `freshmarketb2b` (Edge Function `send-email` + triggery DB +
   pg_cron) potrafi wysyłać maile **niezależnie od kodu w tym repo**. Przy diagnozie maili NIE
   wystarczy przeszukać repo b2b — trzeba sprawdzać też `cron.job` i funkcje `public.fm_*`
   w Supabase. (Audyt: [SUPABASE_MAIL_CRON_AUDIT.sql](SUPABASE_MAIL_CRON_AUDIT.sql).)
2. **Realne adresy w puli odbiorców.** Wśród aktywnych kont `role='buyer'` są **2 adresy
   nie-testowe**: `spiker.artur@gmail.com` (sieć 100) i `rohlik@freshmarket.eu` (sieć 122).
   Gdyby job kiedyś wrócił bez naprawy, a ich sieć miała kwalifikującą się propozycję — dostałyby
   zepsuty mail. Dziś job jest OFF, więc to ryzyko tylko na przyszłość.
3. **Inne automaty tego samego systemu.** Wg `b2b-email-system-DONE.md` istnieją też triggery
   `fm_trigger_profiles_email`, `fm_trigger_legacy_sends_email`, `fm_trigger_fm_resps_email`
   oraz inne szablony (welcome, pipeline-proposal itd.). One **nie były** przedmiotem tego
   incydentu, ale należą do tej samej, nienadzorowanej z gita warstwy — wymagają osobnego przeglądu.
4. **Niejasny adres FROM / tryb.** Notatki wdrożeniowe wspominają tryb testowy
   (`onboarding@resend.dev` + `TEST_REDIRECT`) oraz docelowo `kontakt@/hello@freshmarket.eu`.
   Realnie zaobserwowany FROM incydentu to `hello@freshmarket.eu` — czyli konfiguracja
   wdrożona różni się od notatek. Stan FROM/redirect Edge Function wymaga weryfikacji.
5. **Zahardkodowany token w funkcjach DB.** `fm_14d_reminder_job` i `fm_notify_send_email`
   mają w nagłówku `Authorization: Bearer …` wklejony **klucz `anon`** (rola `anon` — publiczny,
   nie service-role). Nie jest to wyciek krytyczny, ale token siedzi w kodzie funkcji —
   warto przenieść do sekretu.

### Warunki ewentualnego re-enable (wszystkie muszą być spełnione)
1. Naprawa nazw: rozwiązywanie dostawcy/oferty przez **JOIN** (jak `fm_notify_send_email`),
   bez literalnych fallbacków w treści.
2. Świadoma decyzja o **filtrze odbiorców** + usunięcie/oznaczenie realnych adresów
   (`spiker.artur@gmail.com`, `rohlik@freshmarket.eu`) jako nie-produkcyjnych.
3. **Test na sandboxie** (kopia bazy), nie od razu prod.
4. Dopiero potem świadome przywrócenie:
   `select cron.schedule('fm-14d-reminder','0 9 * * *','SELECT public.fm_14d_reminder_job()');`

> **Naprawa należy do systemu `freshmarketb2b` (funkcje DB / Edge Function), NIE do repo b2b.**

---

## 7. Co NIE było ruszane

Podczas całej diagnozy i zatrzymania obowiązywała dyscyplina read-only + minimalna interwencja:

- ❌ **Kod aplikacji `b2b.freshmarket.eu`** — bez zmian.
- ❌ **Feature flagi** (`src/config/features.js`) — bez zmian.
- ❌ **Deploy aplikacji b2b** — nie wykonywany.
- ❌ **`ACCOUNT_HARD_DELETE`** — pozostaje **OFF**, nietknięty.
- ❌ **Dane** (`UPDATE`/`DELETE`/migracje) — żadnych zmian danych.
- ✅ Jedyna operacja zmieniająca stan: `cron.unschedule('fm-14d-reminder')` (zatrzymanie wysyłki).
  Cała reszta — wyłącznie `SELECT` / `pg_get_functiondef`.

---

## 8. Działania następcze (do decyzji właściciela — nic nie wykonywać automatycznie)

1. **Decyzja strategiczna:** który system jest oficjalną produkcją — `b2b.freshmarket.eu` (to repo,
   Netlify+Resend, `newsletter@`) czy `freshmarketb2b` (Edge+pg_cron, `hello@`)? Dwa systemy na
   jednym projekcie Supabase to źródło „duchów".
2. **Jeśli b2b ma być jedyną produkcją:** wyłączyć/zdemontować równoległy system (triggery DB,
   pozostałe crony, Edge Function) po przeglądzie, żeby nic nie wysyłało spod radaru.
3. **Jeśli system mailowy ma zostać:** naprawić `fm_14d_reminder_job` (JOIN-y + filtr odbiorców),
   przejrzeć wszystkie triggery/szablony, ustabilizować FROM, przenieść token do sekretu —
   i dopiero wtedy re-enable crona po teście sandboxowym.
4. Wpis utrwalony w pamięci projektu oraz w [PRODUCTION_HANDOVER.md](PRODUCTION_HANDOVER.md)
   (sekcja I — Ryzyka).
