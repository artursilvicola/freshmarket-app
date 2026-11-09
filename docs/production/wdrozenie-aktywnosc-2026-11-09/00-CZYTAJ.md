# Zakładka „Aktywność” — wersja 1 (9.11.2026)

Gałąź: `feat/admin-activity`, **NIEWDROŻONA**. Sprawdzona wyłącznie na środowisku testowym (Supabase `rruszzdffclfhbtfeznb`, podgląd `fm-b2b-test`).
Zlecenie: Codex przez Artura, 9.11.2026 (8 punktów). Review: Codex (CLI, tylko odczyt), trzy rundy — opis w § 6.

## 1. Co robi

Administrator widzi dla każdego kupca i dostawcy w wybranym okresie:

* **wejścia do aplikacji** (nowy dziennik): liczbę wizyt i ostatnie zapisane wejście;
* **maile z istniejących rejestrów**: propozycje PreConnect do kupców (rejestr od 22.10.2026) i maile marketingowe (bez wiadomości testowych na adres zespołu);
* **wyświetlenia propozycji w aplikacji** (kupcy, rejestr `legacy_send_app_reads`);
* oś czasu konta, filtry (okres 7/30/90 dni lub własny, rola, wyszukiwanie, konta testowe, tylko konta ze zdarzeniem), eksport podsumowania i zdarzeń do CSV;
* datę rozpoczęcia zbierania historii oraz zastrzeżenia pomiaru.

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
| Wyświetlono propozycję | `legacy_send_app_reads` | tylko znane daty: pierwsze i ostatnie wyświetlenie |

Każde zdarzenie liczy się według **własnej daty**. Raport i oś czasu korzystają z jednej funkcji SQL. Żadne zdarzenie nie jest przedstawiane jako dowód zainteresowania zakupem. Brak zdarzenia opisujemy jako „brak zarejestrowanego wejścia/otwarcia”.

## 4. Bezpieczeństwo i dane

* **Wyłącznik w bazie** `app_activity_settings.enabled` — po migracji `false`. Dopóki nie zostanie włączony SQL-em na właściwym projekcie, nic nie jest zapisywane (także przy bezpośrednim RPC).
* Tożsamość i czas wyłącznie po stronie serwera (`auth.uid()`, `now()`); RPC nie przyjmuje argumentów. Admin i obsługa nie są zapisywani.
* Deduplikacja: blokada doradcza per konto (`pg_advisory_xact_lock`) — kilka kart i równoległe żądania dają jedną wizytę.
* Tabele: RLS (odczyt tylko admin), brak zapisu dla `anon`/`authenticated`/`service_role`. Funkcje pomocnicze bez `EXECUTE` dla ról API.
* Bez IP, user-agenta i tokenów. Konta testowe oznacza jawnie administrator (przycisk w osi czasu, audyt: kto i kiedy).
* Retencja 12 miesięcy: usuwanie przy każdej nowej wizycie, przy odczycie raportu i codziennie z `pg_cron` w bazie (zadanie `fm-app-activity-retention`, 03:17 UTC).
* Moduł **tylko czyta** rejestry maili i odczytów — nie zmienia kredytów, statusów propozycji ani informacji o odczytach widocznych dla dostawcy (test odcisku tabel).

## 5. Wyniki kontroli (9.11.2026)

* PGlite, pełny łańcuch migracji: 14/14 testów SQL (`tests/app-activity.integrated.test.js`) — wyłącznik, deduplikacja, przerwa > 30 min, admin i brak sesji, uprawnienia (RLS, EXECUTE, service_role), raport, liczenie według dat (wysyłka przed okresem, otwarcie po okresie), przerwa między odczytami, filtr kont i stronicowanie, granica okresu dla ostatniego wejścia, walidacja okresu, retencja, brak wpływu na kredyty.
* UI: 13/13 (`src/components/admin/AdminActivity.test.jsx`) — słownictwo, zastrzeżenia, wyłącznik, konta testowe, oś czasu, spóźnione odpowiedzi, niepełny własny okres, blokada eksportu, CSV.
* Pełny zestaw repo i `vite build`: wynik w § 7.
* Baza testowa:
  * migracja nałożona; zapis włączony **tylko tam**;
  * `pg_cron` 1.6.4 — zadanie próbne wykonało `purge_app_visits()` (succeeded, usunięta wizyta > 12 mies.), zostało tylko zadanie dzienne;
  * `node scripts/app-activity-concurrency-check.mjs` — tymczasowe konta, 4 równoczesne połączenia × 3 konta: kupiec 1 wizyta / 4 wejścia, dostawca 1 / 4, admin 0; sprzątanie: 0 pozostałych wizyt;
  * podgląd: wejście konta `codex.buyer@freshmarket.test` zapisane z prawdziwego klienta (2 wywołania w trybie deweloperskim → 1 wizyta), wejścia admina nie zapisane; zakładka, oś czasu i oznaczanie konta testowego działają (`zrzut-test-aktywnosc.jpg`).

## 6. Review Codexa

1. `558c8c5` — **NO-GO**, 8 ustaleń (izolacja środowiska, okres maili, odczyty między datami, harmonogram Netlify w branch deployach, spóźnione odpowiedzi, obcięty eksport, heurystyka pola sprzed dziennika, test kasujący dane).
2. `a3968c5` — **NO-GO**: 5 naprawione, 3 częściowo; nowe: eksport łączył strony z różnych chwil, niepełny własny okres zostawiał eksport starego raportu, ostatnie wejście na granicy okresu tworzyło nieistniejący czas.
3. Poprawki: eksport i oś czasu jednym wywołaniem (jedna migawka, limit 50 000, powyżej — odmowa), niepełny okres unieważnia raport, ostatnie wejście = tylko zapisany czas. Wynik trzeciej rundy — § 7.

## 7. Wdrożenie produkcyjne (po decyzji Artura) — cztery osobne kroki

Kolejność ma znaczenie. Każdy krok tylko w projekcie **`sklyfuvzjikkqerxtulo`** (sprawdź adres SQL Editora przed każdym Run).

1. **Migracja** `supabase/migrations/20261109120000_app_activity.sql` (SQL Editor, jeden Run). Zapis pozostaje wyłączony.
2. **Harmonogram retencji** `02-harmonogram-retencji.sql` (wymaga `pg_cron`; kontrola na końcu pliku).
3. **Front**: merge do `main`, deploy Netlify z `VITE_ADMIN_ACTIVITY=true` (zakładka) i `VITE_APP_ACTIVITY_LOG=true` (wywołanie zapisu z przeglądarki). Rollback frontu: Netlify → poprzedni deploy → Publish.
4. **Włączenie zapisu** `03-wlaczenie-zapisu.sql`. Od tej chwili liczy się „Historia wejść zbierana od …”.

Wyłączenie zbierania: `03-wlaczenie-zapisu.sql` z `false`. Same flagi VITE nie zatrzymują zapisu przez bezpośrednie RPC.
Po włączeniu: oznaczyć konta testowe (ZZZ TEST, aliasy `artur.stasiak+…`, konta próby marketingu) przyciskiem w osi czasu.

## 8. Otwarte

* Inne rodzaje poczty w zakładce (osobny etap).
* Subskrypcja `email.delivered` w Resend — bez niej kolumna „doręczono” pozostaje pusta (decyzja w panelu Resend).
* Dokładna historia wyświetleń propozycji wymagałaby osobnego rejestru zdarzeń (bez zmiany rejestru widocznego dostawcy).
