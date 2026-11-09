# Aktywność — pakiet do niezależnego review Codexa (9.11.2026)

Gałąź `feat/admin-activity`, porównanie z produkcyjnym `main` (`fa3dd0b`): `git diff fa3dd0b..feat/admin-activity`.
Produkcja **niezmieniona**: brak merge, deployu, migracji i zmian danych. Środowisko testowe: Supabase `rruszzdffclfhbtfeznb`.

## Co sprawdzić

| Obszar | Pliki |
|---|---|
| Migracja (tabele, RLS, RPC, wyłącznik, retencja, raport, zdarzenia) | `supabase/migrations/20261109120000_app_activity.sql` |
| Harmonogram retencji (pg_cron, rola `postgres`, kontrola uprawnień) | `02-harmonogram-retencji.sql` |
| Włączenie / wyłączenie zapisu | `03-wlaczenie-zapisu.sql`, `04-wylaczenie-zapisu.sql` |
| Kontrola po wdrożeniu (tylko odczyt) | `05-kontrola-po-wdrozeniu.sql`, `00-CZYTAJ.md` § 7a |
| Zapis wejścia z przeglądarki | `src/legacy/PreconnectFM.jsx` (efekt `dbRecordAppVisit`), `src/lib/db.js`, `src/config/features.js` |
| Zakładka | `src/components/admin/AdminActivity.jsx`, `src/i18n/{pl,en}/legacy.json` (`admin.activity`) |
| Instrukcja administratora | `src/content/instructions/preconnect-admin.js` (rozdział `aktywnosc`, `flag: ADMIN_ACTIVITY`), `src/content/instructions/index.js` (`withFlags`) |
| Testy | `tests/app-activity.integrated.test.js` (PGlite), `src/components/admin/AdminActivity.test.jsx` (w tym eksport), `tests/activity-instruction.test.js`, `scripts/app-activity-concurrency-check.mjs` (baza testowa) |
| Opis, wyniki, kolejność wdrożenia i wycofania | `00-CZYTAJ.md` |

## Trzy punkty z 9.11 (po raporcie)

1. **Ograniczona historia wyświetleń propozycji** — oś czasu: „Pierwsze/Ostatnie zapisane wyświetlenie propozycji w aplikacji”, bez liczby wyświetleń; kolumna „Propozycje z zapisanym wyświetleniem” z podpowiedzią; zastrzeżenie w zakładce i rozdział instrukcji mówią wprost, że rejestr nie ma pełnej historii ani dokładnej liczby. Testy UI i instrukcji.
2. **Retencja tylko dziennika wejść** — `purge_app_visits()` usuwa wyłącznie z `app_visits`. Test: trzyletnie rekordy w `legacy_send_messages`, `legacy_send_email_events`, `legacy_send_app_reads`, `packages` zostają (odcisk tabel przed i po), a migracja nie zawiera innego `delete` niż na `app_visits` i `app_activity_test_accounts` (odznaczenie konta testowego).
3. **Kontrola po wdrożeniu** — `05-kontrola-po-wdrozeniu.sql` + tabela § 7a: wejście kupca = 1 wizyta, odświeżenie = ta sama wizyta, podgląd admina nie zapisuje, dostawca dostaje „tylko administrator”. Skrypt uruchomiony na bazie testowej (kupiec e2e: 1 wizyta, `hit_count` 2; wizyty adminów 0; blok D: oczekiwany błąd).

## Zmiana wyglądu po akceptacji Artura (9.11, po południu)

Zamiast dużego żółtego bloku: krótkie ostrzeżenie + przycisk-odnośnik **„Ograniczenia pomiaru”** (`aria-expanded`, `aria-controls`), domyślnie zwinięty; po rozwinięciu te same 8 wyjaśnień co wcześniej. Test UI: domyślnie zwinięte, rozwijanie i zwijanie, komplet wyjaśnień. Akceptacja wyglądu **nie jest** zgodą na wdrożenie.

Sprawdzone w przeglądarce (podgląd testowy, konto `codex.admin@freshmarket.test`):

* komputer 1366×900 — podpisy kolumn i podpowiedzi (w tym „Propozycje z zapisanym wyświetleniem”), oś czasu kupca: „Pierwsze/Ostatnie zapisane wyświetlenie propozycji w aplikacji” bez liczby wyświetleń (tymczasowy odczyt na bazie testowej, potem usunięty), zwinięte i rozwinięte ograniczenia — `zrzut-test-aktywnosc.jpg`, `zrzut-test-aktywnosc-ograniczenia.jpg`;
* telefon poziomo 812×375 — stuknięcie rozwija 8 wyjaśnień, tabela przewija się w bok wewnątrz ramki, strona bez poziomego przewijania — `zrzut-telefon-poziomo-ograniczenia.jpg`;
* telefon pionowo 375×812 — cały panel admina (stały pasek boczny) zostawia treści ok. 107 px i pokazuje własny komunikat „Telefon pionowo może być niewygodny”; dotyczy wszystkich zakładek admina, nie tylko tej — `zrzut-telefon-pionowo.jpg`.

## Poprawki po review Codexa commitu 79fc899 (GO z uwagami, 3 × P2)

1. **Własny okres przy zmianie czasu** — `zonedMidnightISO()`: granice to północe kalendarzowe w `Europe/Warsaw` (koniec = północ dnia następnego), bez dodawania 24 h i niezależnie od strefy przeglądarki. Testy: 25.10.2026 (doba 25 h) i 29.03.2026 (doba 23 h), przejście roku, inna strefa. W przeglądarce: okres 25.10–25.10 → „25.10.2026, 00:00 – 26.10.2026, 00:00”.
2. **Oznaczenie konta testowego a zmiana okresu** — odświeżenie przez licznik `reloadTick` obsługiwany efektem z aktualnym `load`, zamiast starego domknięcia. Test: oczekujące oznaczenie → zmiana na 7 dni → zakończenie → raport za 7 dni.
3. **Wyłącznik jako bariera** — `record_app_visit()` bierze `pg_advisory_xact_lock_shared('app_activity:switch')` przed odczytem przełącznika; `03`/`04` biorą wyłączną blokadę w transakcji. Test PGlite: skrypty `03`/`04` z pakietu działają, blokada przed odczytem. Baza testowa (`scripts/app-activity-concurrency-check.mjs`, faza 2, osobne połączenia): zapis w toku przyjęty → `04` czekało ≥ 1,5 s i skończyło po jego commit → kolejne wywołanie „disabled”, 0 nowych zapisów; przełącznik przywrócony.

### Kontrola poprawek (98f30e4) — Codex: GO z uwagami

Wszystkie 3 ustalenia naprawione. Uwaga warunkowa: bariera zakłada `READ COMMITTED`. Domknięcie: `record_app_visit()` przy innym poziomie izolacji niczego nie zapisuje (`reason: "isolation"`; test PGlite z `REPEATABLE READ`). Kontrola na bazie testowej rozszerzona o wywołanie rozpoczęte **w trakcie** wyłączania (czeka za blokadą wyłączną, po wyłączeniu dostaje „disabled”).

## Poprawka po niezależnym review 3fea63a — mail wysłany przed wypisem

Ustalenie Codexa (PGlite): wiadomość marketingowa, przy której odbiorca wypisał się **w trakcie** wysyłki, ma stan `suppressed`, ale `marketing_record_result` zachowuje jej `resend_message_id` i `sent_at`, bo Resend już ją przyjął. Raport pokazywał wtedy 0 wysłanych i 1 doręczony.

Poprawka w `app_activity_event_rows`: „wysłano” = `accepted` **albo** `suppressed` z `resend_message_id` i `sent_at`. Wiadomość wykluczona przed wysyłką (`suppressed_before_send`, `suppressed_at_send` bez id Resend) nadal się nie liczy; inne stany bez potwierdzenia (`uncertain` itd.) też nie.

Regresja (`tests/app-activity.integrated.test.js`, „wypis W TRAKCIE wysyłki…”): podsumowanie (1 wysłany, 1 doręczony) i oś czasu (wysłano + doręczono) dla wypisu w trakcie; 0 zdarzeń dla wykluczonej przed wysyłką; stan `uncertain` pominięty. Test na wersji z `3fea63a` **nie przechodzi** (0 wysłanych), na poprawionej przechodzi. Pełny zestaw: 1261 testów OK, 3 pominięte; build OK. Migracja nałożona ponownie tylko na bazę testową.

## Jak uruchomić testy

```
PGLITE_PATH=<ścieżka>/node_modules/@electric-sql/pglite/dist/index.js npx vitest run
npx vitest run tests/app-activity.integrated.test.js src/components/admin/AdminActivity.test.jsx tests/activity-instruction.test.js
npm run build
node scripts/app-activity-concurrency-check.mjs        # tylko baza testowa (.env.test), tworzy i usuwa konta tymczasowe
```

Uwaga: lokalny `.env.test` (poza repo) ma `VITE_ADMIN_ACTIVITY=true` i `VITE_APP_ACTIVITY_LOG=true` dla podglądu testowego; vitest go wczytuje, dlatego test instrukcji podaje flagę jawnie.

## Wyniki Claude (9.11, ok. 12:00)

* Pełny zestaw (po poprawkach do 79fc899 i 98f30e4): **121 plików OK, 2 pominięte; 1260 testów OK, 3 pominięte** (pominięte wymagają uruchomionego podglądu — bez związku z modułem). `vite build` OK.
* Moduł: SQL 14/14, UI 16/16, instrukcja 4/4.
* Baza testowa: migracja nałożona (ponownie — idempotentna, stan wyłącznika zachowany); `02` — zadanie `postgres/postgres`, `purge_app_visits` wykonuje tylko `postgres`; dwa przebiegi pg_cron `succeeded`; `04` → `enabled=false`, `03` → `enabled=true`; kontrola równoległości: 4 połączenia × 3 konta tymczasowe → kupiec 1/4, dostawca 1/4, admin 0, sprzątanie 0.

## Czego Claude nie sprawdził

* Niczego na produkcji (zgodnie z poleceniem).
* Prawdziwego telefonu (tylko emulacja rozmiaru w przeglądarce podglądu).
