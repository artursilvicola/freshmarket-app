# Zakładka „Aktywność” — wersja 1 (9.11.2026)

Gałąź: `feat/admin-activity`, **NIEWDROŻONA**. Sprawdzona wyłącznie na środowisku testowym (Supabase `rruszzdffclfhbtfeznb`, podgląd `fm-b2b-test`).
Zlecenie: Codex przez Artura, 9.11.2026 (8 punktów). Review: Codex (CLI, tylko odczyt), trzy rundy — opis w § 6.

## 1. Co robi

Administrator widzi dla każdego kupca i dostawcy w wybranym okresie:

* **wejścia do aplikacji** (nowy dziennik): liczbę wizyt i ostatnie zapisane wejście;
* **maile z istniejących rejestrów**: propozycje PreConnect do kupców (rejestr od 22.10.2026) i maile marketingowe (bez wiadomości testowych na adres zespołu);
* **wyświetlenia propozycji w aplikacji** (kupcy, rejestr `legacy_send_app_reads`);
* oś czasu konta, filtry (okres 7/30/90 dni lub własny, rola, wyszukiwanie, konta testowe, tylko konta ze zdarzeniem), eksport podsumowania i zdarzeń do CSV;
* datę rozpoczęcia zbierania historii oraz krótkie ostrzeżenie „Pomiar jest niepełny…” z rozwijanym odnośnikiem **„Ograniczenia pomiaru”** (domyślnie zwinięty; w środku komplet 8 wyjaśnień) — wygląd zaakceptowany przez Artura 9.11, to nie jest zgoda na wdrożenie.

Inne rodzaje poczty (moderacja, powiadomienia, przypomnienia) — następny etap.

## 2. Pole „ostatnia aktywność” sprzed dziennika (pkt 1 zlecenia)

`profiles.last_active_at` (migracja 042) to jedno pole nadpisywane przy każdym wejściu, bez historii:

* aktualizuje je RPC `touch_last_active()`, wołane z przeglądarki raz po załadowaniu panelu (`src/legacy/PreconnectFM.jsx`, efekt hydracji wysyłek) — dla kupca, dostawcy **i admina**, pod flagą `ACCOUNT_LIFECYCLE` (włączona 8.06.2026);
* migracja 042 ustawiła **wszystkim istniejącym kontom tę samą datę** (`now()` w chwili wdrożenia, ok. 7.06.2026). Na produkcji ta wartość nie oznacza wejścia;
* podgląd konta przez admina działa na sesji admina, więc pole kupca/dostawcy nie jest wtedy zmieniane.

Zakładka pokazuje to pole osobno jako „dane sprzed dziennika”. Nie wnioskuje o jego pochodzeniu — podaje tylko, ile kont ma tę samą datę. Nowy dziennik nie zmienia tego pola.

## 3. Jak liczone są zdarzenia

| Zdarzenie | Źródło | Data |
|---|---|---|
| Zarejestrowane wejście | `app_visits` (nowe) | początek wizyty; wejścia < 30 min od poprzedniego scalane |
| Wysłano e-mail | `legacy_send_messages`, `marketing_messages` (accepted, nie testowe) | `sent_at` |
| Doręczono | zdarzenia Resend `email.delivered` | data zdarzenia |
| Zarejestrowane otwarcie | zdarzenia Resend `email.opened` (bez `ignored`) | data zdarzenia |
| Wyświetlono propozycję | `legacy_send_app_reads` | tylko dwie zapisane daty: pierwsze i ostatnie wyświetlenie |

Każde zdarzenie liczy się według **własnej daty**. Raport i oś czasu korzystają z jednej funkcji SQL. Żadne zdarzenie nie jest przedstawiane jako dowód zainteresowania zakupem. Brak zdarzenia opisujemy jako „brak zarejestrowanego wejścia/otwarcia”.

**Ograniczona historia wyświetleń propozycji.** Rejestr `legacy_send_app_reads` (ten sam, który zasila informacje dla dostawcy i rozliczenia) przechowuje dla każdej propozycji tylko datę pierwszego i ostatniego wyświetlenia oraz licznik zapisów. Zakładka pokazuje wyłącznie te dwie daty („Pierwsze/Ostatnie zapisane wyświetlenie propozycji”), kolumnę nazywa „Propozycje z zapisanym wyświetleniem” i nie podaje liczby wyświetleń — licznik nie jest dokładny. Wyświetleń pomiędzy dwiema datami nie widać. To samo mówią zastrzeżenia w zakładce, podpowiedź kolumny i rozdział instrukcji administratora.

## 4. Bezpieczeństwo i dane

* **Wyłącznik w bazie** `app_activity_settings.enabled` — po migracji `false`. Dopóki nie zostanie włączony SQL-em na właściwym projekcie, nic nie jest zapisywane (także przy bezpośrednim RPC). Wyłączenie jest **barierą**: `04` bierze wyłączną blokadę modułu, a każdy zapis — współdzieloną, więc `04` czeka na zapisy w toku, a po jego zakończeniu nic się nie dopisze (sprawdzone na bazie testowej na osobnych połączeniach).
* Tożsamość i czas wyłącznie po stronie serwera (`auth.uid()`, `now()`); RPC nie przyjmuje argumentów. Admin i obsługa nie są zapisywani.
* Deduplikacja: blokada doradcza per konto (`pg_advisory_xact_lock`) — kilka kart i równoległe żądania dają jedną wizytę.
* Tabele: RLS (odczyt tylko admin), brak zapisu dla `anon`/`authenticated`/`service_role`. Funkcje pomocnicze bez `EXECUTE` dla ról API.
* Bez IP, user-agenta i tokenów. Konta testowe oznacza jawnie administrator (przycisk w osi czasu, audyt: kto i kiedy).
* Retencja 12 miesięcy dotyczy **wyłącznie nowego dziennika wejść** (`app_visits`): usuwanie przy każdej nowej wizycie, przy odczycie raportu i codziennie z `pg_cron` w bazie (zadanie `fm-app-activity-retention`, 03:17 UTC). Rejestry poczty, odczytów i rozliczeń nie są usuwane — test sprawdza, że trzyletnie rekordy w nich zostają, a migracja nie zawiera innego `delete` niż na `app_visits` i (odznaczenie konta testowego) `app_activity_test_accounts`.
* Moduł **tylko czyta** rejestry maili i odczytów — nie zmienia kredytów, statusów propozycji ani informacji o odczytach widocznych dla dostawcy (test odcisku tabel).

## 5. Wyniki kontroli (9.11.2026)

* PGlite, pełny łańcuch migracji: 14/14 testów SQL (`tests/app-activity.integrated.test.js`) — wyłącznik, deduplikacja, przerwa > 30 min, admin i brak sesji, uprawnienia (RLS, EXECUTE, service_role; kupiec i dostawca bez dostępu do raportu i zdarzeń), raport, liczenie według dat (wysyłka przed okresem, otwarcie po okresie), przerwa między odczytami, filtr kont, jedna migawka zdarzeń, granica okresu dla ostatniego wejścia, walidacja okresu, retencja tylko dziennika wejść, brak wpływu na kredyty.
* UI: 16/16 (`src/components/admin/AdminActivity.test.jsx`) — własny okres jako północ czasu polskiego (dni zmiany czasu 25.10 i 29.03), odświeżenie po oznaczeniu konta zawsze z aktualnym okresem, słownictwo, „Ograniczenia pomiaru” (domyślnie zwinięte, rozwijanie/zwijanie, `aria-expanded`, komplet 8 wyjaśnień w środku), zastrzeżenia (w tym ograniczona historia wyświetleń), wyłącznik, konta testowe, oś czasu, spóźnione odpowiedzi, niepełny własny okres, blokada eksportu, **eksport zdarzeń jednym wywołaniem** (odmowa przy niepełnym lub zbyt dużym zbiorze), CSV.
* Instrukcja: 4/4 (`tests/activity-instruction.test.js`) — rozdział „Aktywność kont” tylko przy włączonej zakładce, etykiety jak w panelu.
* Pełny zestaw repo i `vite build`: wynik w `01-DLA-CODEXA.md`.
* Baza testowa:
  * migracja nałożona; zapis włączony **tylko tam**;
  * `pg_cron` 1.6.4 — zadanie próbne wykonało `purge_app_visits()` (succeeded, usunięta wizyta > 12 mies.), zostało tylko zadanie dzienne;
  * `node scripts/app-activity-concurrency-check.mjs` — tymczasowe konta, 4 równoczesne połączenia × 3 konta: kupiec 1 wizyta / 4 wejścia, dostawca 1 / 4, admin 0; sprzątanie: 0 pozostałych wizyt;
  * podgląd: wejście konta `codex.buyer@freshmarket.test` zapisane z prawdziwego klienta (2 wywołania w trybie deweloperskim → 1 wizyta), wejścia admina nie zapisane; zakładka, oś czasu i oznaczanie konta testowego działają (`zrzut-test-aktywnosc.jpg`).

## 6. Review Codexa

1. `558c8c5` — **NO-GO**, 8 ustaleń (izolacja środowiska, okres maili, odczyty między datami, harmonogram Netlify w branch deployach, spóźnione odpowiedzi, obcięty eksport, heurystyka pola sprzed dziennika, test kasujący dane).
2. `a3968c5` — **NO-GO**: 5 naprawione, 3 częściowo; nowe: eksport łączył strony z różnych chwil, niepełny własny okres zostawiał eksport starego raportu, ostatnie wejście na granicy okresu tworzyło nieistniejący czas.
3. Poprawki: eksport i oś czasu jednym wywołaniem (jedna migawka, limit 50 000, powyżej — odmowa), niepełny okres unieważnia raport, ostatnie wejście = tylko zapisany czas.
4. `1bc1a2a` — **GO z uwagami**: wszystkie 6 otwartych ustaleń zamknięte; uwaga do instrukcji (ponowienie wdrożenia, kolejność wycofania) wprowadzona w § 7; skrypt `02-harmonogram-retencji.sql` przekazany do osobnej kontroli.
5. Kontrola pakietu (02, 03, § 7) — **GO z uwagami**: wyłączenie przeniesione do `04-wylaczenie-zapisu.sql` bez zależności od pg_cron; `02` wymaga roli `postgres` i pokazuje rolę, bazę zadania oraz uprawnienia funkcji. Na bazie testowej: zadanie `postgres/postgres`, `purge_app_visits` wykonuje tylko `postgres`.

## 7. Wdrożenie produkcyjne (po decyzji Artura) — cztery osobne kroki

Szczegółowy plan z kontrolami przed wdrożeniem (`06`) i przed włączeniem zapisu (`07`), warunkami STOP i stanem wyjściowym: **`08-PLAN-WDROZENIA.md`**.

Kolejność ma znaczenie. Każdy krok tylko w projekcie **`sklyfuvzjikkqerxtulo`** (sprawdź adres SQL Editora przed każdym Run).

0. **Tylko przy ponowieniu lub wznowieniu przerwanego wdrożenia** (tabela `app_activity_settings` już istnieje): najpierw `04-wylaczenie-zapisu.sql` i sprawdzić w wyniku `enabled = false`. Migracja celowo zachowuje istniejący stan przełącznika, więc bez tego kroku zapis mógłby działać przed kontrolą retencji i frontu. Przy pierwszym wdrożeniu migracja tworzy przełącznik w stanie `false`.
1. **Migracja** `supabase/migrations/20261109120000_app_activity.sql` (SQL Editor, jeden Run). Kontrola: `select enabled from public.app_activity_settings` → `false`.
2. **Harmonogram retencji** `02-harmonogram-retencji.sql` jako `postgres` (wymaga `pg_cron`). Kontrola na końcu pliku: jedno aktywne zadanie z `username = postgres`, `database = postgres`; funkcje modułu należą do `postgres`, a `purge_app_visits` i `app_activity_event_rows` wykonuje tylko `postgres` (migracja odbiera EXECUTE rolom `PUBLIC`, `anon`, `authenticated`, `service_role`; test SQL to sprawdza).
3. **Front**: merge do `main`, deploy Netlify z `VITE_ADMIN_ACTIVITY=true` (zakładka) i `VITE_APP_ACTIVITY_LOG=true` (wywołanie zapisu z przeglądarki).
4. **Włączenie zapisu** `03-wlaczenie-zapisu.sql`. Od tej chwili liczy się „Historia wejść zbierana od …”.

**Wycofanie — zawsze w tej kolejności:** (1) `04-wylaczenie-zapisu.sql`, (2) potwierdzenie w wyniku `enabled = false`, (3) Netlify → poprzedni deploy → Publish. Harmonogram retencji zostaje, żeby zebrane dane nadal były usuwane po 12 miesiącach. Rollback samego frontu ani wyłączenie flag VITE nie zatrzymują zapisu przez bezpośrednie RPC.

5. **Kontrola po wdrożeniu** (`05-kontrola-po-wdrozeniu.sql`, tylko odczyt) — § 7a.

Po włączeniu: oznaczyć konta testowe (ZZZ TEST, aliasy `artur.stasiak+…`, konta próby marketingu) przyciskiem w osi czasu.

### 7a. Kontrola po wdrożeniu (na produkcji, konta testowe)

| # | Czynność | Oczekiwany wynik (`05-kontrola-po-wdrozeniu.sql`) |
|---|---|---|
| A | Testowy kupiec wchodzi do aplikacji (magic link) | 1 wizyta, `hit_count = 1` |
| B | Ten sam kupiec odświeża stronę (w ciągu 30 min) | nadal 1 wizyta, `hit_count = 2` |
| C | Administrator otwiera podgląd konta tego kupca | nadal 1 wizyta, `hit_count` bez zmian; 0 wizyt kont administratorów |
| D | Dostawca (konto testowe) — próba odczytu raportu | błąd „tylko administrator” (blok D w SQL; w panelu dostawcy zakładki nie ma) |
| E | Stan modułu | `enabled = true`, 1 aktywne zadanie retencji, `collecting_since` ustawione |

Wynik niezgodny z tabelą → `04-wylaczenie-zapisu.sql`, potem diagnoza.

## 8. Otwarte

* Inne rodzaje poczty w zakładce (osobny etap).
* Subskrypcja `email.delivered` w Resend — bez niej kolumna „doręczono” pozostaje pusta (decyzja w panelu Resend).
* Dokładna historia wyświetleń propozycji wymagałaby osobnego rejestru zdarzeń (bez zmiany rejestru widocznego dostawcy).
