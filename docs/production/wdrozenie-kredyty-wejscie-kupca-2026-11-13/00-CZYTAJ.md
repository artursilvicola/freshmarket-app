# Wdrożenie: kredyt przy wejściu kupca i ręcznym potwierdzeniu, podgląd admina nie jest odczytem

Gałąź `fix/buyer-entry-seen`, PR `artursilvicola/freshmarket-app#1` (szkic). Stan na 13.11.2026: **nic nie jest wdrożone na produkcji**, migracja jest wgrana tylko na bazę testową.

## 1. Co się zmienia (decyzje Artura 13.11.2026)

Kredyt PreConnect schodzi, gdy:

1. kupiec otworzył maila — bez zmian,
2. kupiec wszedł do aplikacji — dowolna strona panelu, nie dopiero lista propozycji,
3. administrator ręcznie potwierdził odczyt (telefon / e-mail / spotkanie) — dostawca dostaje powiadomienie, cofnięcie potwierdzenia zwraca kredyt.

Podgląd konta kupca przez administratora nie jest odczytem. Tekst regulaminu bez zmian.

## 2. Wyniki testów — wszystko poza produkcją

Środowisko: osobny projekt Supabase `rruszzdffclfhbtfeznb` (testowy) + lokalny podgląd `node scripts/dev-test.mjs`, który bierze wartości wyłącznie z `.env.test`, odrzuca projekt produkcyjny i wymaga fikcyjnego klucza poczty (`re_test_…`). Żaden mail nie wyszedł, produkcja nie była używana do sprawdzania nowego mechanizmu.

| Co | Jak | Wynik |
|---|---|---|
| Testy jednostkowe | `npm test` | 1257 zaliczonych, 40 pominiętych (integracyjne) |
| Build | `npm run build` | OK |
| Migracja na prawdziwym Postgresie | `node scripts/manual-read-confirm-sql-test.mjs` (transakcja wycofywana) | 11/11 |
| Próba end-to-end, nowy kod | `node scripts/buyer-entry-seen-trial.mjs --mode=fix` | 21/21 |
| Kontrola, stary kod przed migracją | `--mode=control` | podgląd admina pobrał 3/3 kredyty; wejście kupca na pulpit: 0; ręczne potwierdzenie (stary zapis statusu): 0 |
| Kontrola, stary kod PO migracji | `--mode=control` na bazie z wgraną migracją | identycznie jak przed migracją |
| Skrypty kontrolne pakietu | 01, 03, 05, 06 uruchomione na bazie testowej | wykonują się; 06 w transakcji wycofanej |

Próba end-to-end (21 kontroli) obejmuje:

- **podgląd admina:** 0 zgłoszeń odczytu, statusy/kredyty/odczyty bez zmian; bezpośrednie wywołanie obu funkcji z tokenem admina → 200, pusty wynik (`admin_preview`), baza bez zmian;
- **ręczne potwierdzenie w prawdziwym interfejsie** (Pipeline → Dostawcy / tracking): formularz uprzedza o kredycie; potwierdzenie → `read_manual`, kredyty 0 → 1, znacznik `chargeChannel=manual`, komunikat; cofnięcie → `sent`, kredyty 1 → 0, znacznik rozliczenia usunięty, komunikat; ponowne potwierdzenie → 0 → 1; kupiec wołający funkcję admina → 403;
- **wejście kupca na pulpit:** 1 zgłoszenie z obiema czekającymi propozycjami, obie `read` i rozliczone, dokładnie 2 kredyty, odczyt zapisany jako `buyer/app_list`; ręcznie potwierdzona propozycja nie rozlicza się drugi raz; odświeżenie strony bez drugiego pobrania; pulpit dalej pokazuje „2 nowych propozycji”.

**Zgodność migracji ze starym kodem** (który działa na produkcji do scalenia PR): migracja zawiera wyłącznie `create or replace function` ×2, `comment`, `revoke`, `grant` — żadnych zmian tabel, typów, polityk ani istniejących funkcji. Stary kod nie zawiera żadnego odwołania do nowych funkcji. Kontrola na starym kodzie dała ten sam wynik przed migracją i po niej.

**Czego testy NIE pokryły:** faktycznego doręczenia maila do dostawcy. Na środowisku testowym wysyłka kończy się odmową poczty (klucz fikcyjny), więc sprawdzone jest tylko to, że powiadomienie jest uruchamiane raz i że rozliczenie nie zależy od jego powodzenia. Treść maila pokrywają testy jednostkowe.

## 3. Podgląd Netlify (Deploy Preview) — stan faktyczny

Otwarcie PR uruchomiło automatyczny podgląd `deploy-preview-1--freshmarketb2b.netlify.app`. Sprawdzone 13.11 odczytem konfiguracji (bez wypisywania wartości sekretów):

- **baza:** kontekst `deploy-preview` wskazuje projekt Supabase `uowpixwtewrmmvkyooec` („Freshmarket B2B Queue Tests”, osobny projekt testowy z września), z własnym kluczem serwisowym — **nie produkcję**. Adres tego projektu 13.11 nie odpowiadał (nazwa się nie rozwiązuje), więc logowanie na podglądzie nie mogło zadziałać;
- **poczta:** `RESEND_API_KEY` w podglądzie ma tę samą końcówkę co produkcyjny (Netlify maskuje resztę) — należy go traktować jako **produkcyjny**. `MARKETING_SEND_ENABLED` w podglądzie nie jest ustawione (marketing wyłączony), ale to nie blokuje pozostałych maili;
- **inne klucze identyczne z produkcją:** PayU (`PAYU_ENV=production`, POS, klucze), `FM_EXPORT_TOKEN`, `RESEND_WEBHOOK_SECRET`; `OPENAI_API_KEY` z tą samą końcówką;
- **kontekst `branch-deploy`** ma konfigurację produkcyjną (produkcyjna baza). Wdrożenia gałęzi nie są dziś uruchamiane, ale gdyby je włączono, szłyby na produkcję.

Ścieżki wysyłki poczty w funkcjach (wszystkie na `RESEND_API_KEY`): `send-retailer-batch`, `send-supplier-notification`, powiadomienie dostawcy o odczycie (`_shared/supplier-read-notify`), `send-expiry-reminders`, `send-inactivity-warnings` (obie wołane automatycznie przy każdym wejściu zalogowanego użytkownika), `register-supplier-self`, `fm-plan-send`, `generate-proforma`, `marketing-send` / `marketing-campaign` (za flagą).

Wykonane 13.11:

- podgląd `6af718218971caf123529964` **usunięty** — adres podglądu, adres wdrożenia i jego funkcje odpowiadają 404; produkcja bez zmian;
- w `netlify.toml` dodane `ignore = "exit 0"` dla kontekstów `deploy-preview` i `branch-deploy` — Netlify anuluje takie buildy, zanim cokolwiek opublikuje (skutek sprawdzony po wypchnięciu — patrz dziennik na końcu);
- PR oznaczony jako **szkic**, żeby nie dało się go scalić przypadkiem.

Do zrobienia przez Artura w panelu Netlify (10 sekund, pewniejsze niż plik w repo, bo działa też dla gałęzi bez tej zmiany): Project configuration → Build & deploy → Continuous deployment → Deploy Previews → **Don't deploy pull requests**.

Podglądu Netlify nie podłączam do bazy testowej: izolowane środowisko testowe już istnieje (lokalny podgląd z `.env.test`) i na nim wykonano komplet testów. Hostowany podgląd wymagałby wpisania testowych sekretów do kontekstu `deploy-preview` i odcięcia kluczy PayU/poczty — to osobna decyzja.

## 4. Kolejność wdrożenia

Każdy krok ma warunek przejścia dalej. Wynik każdego kroku zapisz w dzienniku na końcu tego pliku.

| # | Krok | Kto | Warunek przejścia |
|---|---|---|---|
| 1 | `01-kontrola-przed-migracja.sql` na produkcji (tylko odczyt) | Artur / Codex | wiersze 1–8 = OK; zapisz wartości „informacja” (20–23) |
| 2 | Migracja: cała treść `supabase/migrations/20261113120000_manual_read_confirm.sql` jednym Run | Artur / Codex | „Success. No rows returned” |
| 3 | `03-kontrola-po-migracji.sql` (tylko odczyt) | Artur / Codex | 8/8 OK |
| 4 | Produkcja po migracji, jeszcze na starym kodzie: panel admina i Pipeline otwierają się bez błędów | Artur | brak błędów; stary kod nie używa nowych funkcji |
| 5 | PR: „Ready for review”, przegląd, scalenie do `main` | Artur / Codex | Netlify: deploy produkcyjny `ready`, commit zgodny ze scaleniem |
| 6 | `04-PROBA-PO-WDROZENIU.md` na kontach testowych + `05-kontrola-po-wdrozeniu.sql` | Artur + Claude | wszystkie oczekiwane wyniki |
| 7 | Zamknięcie: wpis w dzienniku, konta testowe z powrotem zawieszone | Artur | — |

Między krokiem 2 a 5 może minąć dowolny czas — migracja niczego nie zmienia w działaniu starego kodu.

**Uwaga operacyjna (wiersz 20 kontroli):** po wdrożeniu kodu pierwsze wejście każdego kupca rozliczy wszystkie propozycje czekające na jego sieć. To zamierzony skutek nowej reguły; liczbę znasz z kroku 1.

## 5. Wycofanie

1. Netlify → Deploys → poprzedni deploy produkcyjny `6af2db23` (main `9c8e747`) → **Publish deploy**. Nie `git push --force`.
2. Funkcje z migracji mogą zostać w bazie — stary kod ich nie woła. Usunięcie jest opcjonalne: `06-wycofanie-funkcji.sql`.
3. Rozliczenia wykonane przez nowy kod nie cofają się same. Ręczne potwierdzenie cofnij przyciskiem „Cofnij potwierdzenie” **przed** cofnięciem kodu; resztę koryguje bezpłatny kredyt od organizatora.

## 6. Pliki

- `01-kontrola-przed-migracja.sql` — warunki wstępne + liczby informacyjne (tylko odczyt)
- `supabase/migrations/20261113120000_manual_read_confirm.sql` — migracja (w repo, nie kopiowana tutaj, żeby nie było dwóch wersji)
- `03-kontrola-po-migracji.sql` — funkcje, sygnatury, uprawnienia (tylko odczyt)
- `04-PROBA-PO-WDROZENIU.md` — próba na kontach testowych po scaleniu
- `05-kontrola-po-wdrozeniu.sql` — ostatnie odczyty i rozliczenia (tylko odczyt)
- `06-wycofanie-funkcji.sql` — opcjonalne usunięcie funkcji po cofnięciu kodu

## 7. Dziennik

| Data | Krok | Wynik |
|---|---|---|
| 13.11.2026 | Testy na bazie testowej (pkt 2) | komplet zaliczony |
| 13.11.2026 | Podgląd Netlify PR #1 | usunięty, 404; PR jako szkic |
