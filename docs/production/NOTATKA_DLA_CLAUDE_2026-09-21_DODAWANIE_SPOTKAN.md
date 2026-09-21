# Dodanie brakującego spotkania w Korektach

Gałąź: `feat/fm-manual-meeting-add`, baza `c144cca`. Przygotowane i sprawdzone lokalnie, bez wdrożenia i bez zmian planu produkcyjnego.

## Oczekiwane działanie

Artur chce zwiększyć liczbę spotkań firmy, np. z czterech do pięciu, wpisując ją w puste miejsce konkretnej sieci. Nie chodzi o przeniesienie jednego z czterech istniejących spotkań.

1. Kliknięcie `+` w pustej komórce otwiera wybór firmy. Jeśli administrator wcześniej oglądał firmę, jest wstępnie wybrana.
2. Wyszukiwarka i lista pokazują firmę oraz jej aktualną liczbę spotkań / limit. Niedostępne firmy można wskazać, aby zobaczyć powód blokady; przycisk kontynuacji jest wtedy wyłączony.
3. „Sprawdź i dodaj” otwiera osobne potwierdzenie: pełna nazwa firmy, sieć, numer, licznik 4 → 5, limit. Dopiero „Potwierdzam zmianę” zapisuje operację.
4. Brak punktu wyjścia albo zatwierdzony plan uruchamia dotychczasowy jawny krok inicjalizacji/odblokowania; potem następuje wybór firmy i osobne potwierdzenie dodania.
5. W aktywnym trybie przestawiania puste miejsce nadal jest celem przeniesienia. Nie otwiera wtedy dodawania.

Historia zapisuje `add`, autora, czas, pełne nazwy z bazy, miejsce, liczbę przed/po i limit. Cofnięcie ostatniej zmiany usuwa to dodanie przez przywrócenie pełnego poprzedniego snapshotu i pozostawia historię.

## Zapis i ograniczenia

Nowa akcja `add` w istniejącym `fm_commit_correction`, w transakcji draft + historia. Blokada rewizji, idempotencja request_id, tylko admin, tylko faza 3, tylko odblokowany szkic. Dwie równoległe operacje na tej samej rewizji: jedna przyjęta, druga konflikt.

Baza niezależnie od frontu sprawdza:

- miejsce istniejącej sieci w szkicu jest puste, firma aktywna i dopuszczona do FM; sieć aktywna i FM;
- kanoniczny identyfikator firmy, brak drugiego spotkania tej samej pary;
- limit zakupiony 5 × liczba pakietów (1–5), ewentualnie niższy uzgodniony limit szkicu;
- różnica numerów od innych spotkań firmy wynosi co najmniej 2;
- brak jawnej odmowy kupca w `fm_resps` (tej nowej akcji nie można wymusić checkboxem);
- pojemność obliczona z aktualnych grup i aktywnych stanowisk najnowszej daty. Brak konfiguracji = 60 jak w algorytmie. Konfiguracja istniejąca, ale bez aktywnych stanowisk = 0, zapis odrzucony. Pole `cs.cap` przesłane przez klienta nie zwiększa limitu.

Wolna komórka oznacza miejsce w numeracji kolejki, nie gwarancję wolnej pojemności i nie konkretną godzinę zegarową. Dopuszczamy ręczne dodanie bez wcześniejszej preferencji dostawcy, jeśli nie ma odmowy kupca. Firma nieobecna dotąd w szkicu może dostać pierwsze spotkanie.

Zmieniane są tylko `fm_correction_drafts` i `fm_correction_history`; `cq` dostaje jedną nową komórkę. Pochodne `res.m`, `nums`, `cs` są odbudowane, dotychczasowe numery i punktacja pozostają. Brak zapisów do `company_target_retailers`, `fm_resps`, `fm_decision_sources`, `fm_plan_private` i brak publikacji. `fm-algo.js`, wzajemne wybory i daty płatności nie zostały zmienione.

## Ważny krok przed wdrożeniem: cztery firmy po dziewięć

Wcześniejszy plan ustawił czterem firmom po 9 spotkań, ale ich zakupiony limit w bazie wynosi 15 (Business × 3). Sama liczba 9 w tablicy nie jest trwałym limitem. Nowa funkcja obsługuje `schedule.meeting_limits`, np. `{ "id-firmy": 9 }`. Serwer stosuje minimum limitu zakupionego i tego niższego limitu.

Przed udostępnieniem przycisku należy wpisać poniższe uzgodnione ograniczenia do **aktualnego** szkicu, zachowując wszystkie jego komórki i bieżące ręczne korekty:

| Firma | ID | Limit |
| --- | --- | --- |
| BIO KRETA / Chania | 88d6a20d-0b0f-4ae2-bc02-ceff5093b89f | 9 |
| Agrocenter | b43d6616-ae4a-4e02-8398-12989456e2b9 | 9 |
| Macondo | 765ea57d-a368-4909-b5fb-9f12bc5d1a5a | 9 |
| Orange | 69c4b9a7-a245-44ba-a392-81a46fd9cd8c | 9 |

Źródło ustaleń: `outputs/sim-final-assumptions-20260921/change-bundle.json`, pole `premiumLimits`, oraz notatka z wcześniejszego zapisu `outputs/apply-fm-combined-20260921/NOTATKA_DLA_CLAUDE_PO_ZAPISIE.md` w głównym katalogu 1FMK2026. Nie kopiować archiwalnej tablicy z tych plików na produkcję.

Technicznie: pobrać aktualny draft i rewizję, zrobić backup, sklonować jego `schedule`, scalić tylko `meeting_limits`, sprawdzić pełną zgodność reszty JSON i wykonać istniejący RPC `rebuild` z CAS tej rewizji jako zalogowany admin (bez ponownego uruchamiania algorytmu). To jeden audytowany wpis; jeśli limity już są identyczne, pominąć zapis. Przy konflikcie ponownie pobrać szkic. Przy zatwierdzonym planie nie odblokowywać go po cichu. Ten krok nie został wykonany w ramach przygotowania poprawki.

Pełna późniejsza „Przebudowa z preferencji” zastępuje cały szkic, więc wraz z pozostałymi specjalnymi ustaleniami trzeba zachować/przygotować również `meeting_limits`. To nie jest nowa reguła algorytmu automatycznego. Cofnięcie operacji, która wprowadziła limity, także przywróci poprzedni snapshot.

## Weryfikacja

- Vitest: 399/399, 53 pliki, w tym 17 nowych testów dodatku. Rzeczywisty panel + rzeczywiste słowniki PL: wybór, 4 → 5, anulowanie, Escape, potwierdzenie, podwójne kliknięcie, konflikt, odblokowanie i inicjalizacja, zachowanie ruchu na puste miejsce.
- `npm run build`: OK, znane ostrzeżenie o rozmiarze chunków.
- `node scripts/fm-corrections-sql-test.mjs`: wszystkie migracje od pustej lokalnej bazy, nowa dwa razy, stare i nowe przypadki SQL z ROLLBACK; dwa niezależne połączenia wykonujące równoległe dodania. PASS.
- SQL: 4 → 5, pozycje innych spotkań identyczne, undo pełnego JSON, live capacity zamiast fałszywego `cs.cap`, firma 0 → 1, niższy limit 9, aliasy ID, odmowa kupca, inactive/zero stations, role, brak zmian wejść i zatwierdzonego planu.
- Lokalne `supabase db advisors`: brak zgłoszenia dotyczącego zmienionej funkcji. Są wcześniejsze ostrzeżenia innych funkcji/extensions i wcześniejsze `proforma_counters` bez RLS; nie naprawiano ich w tej gałęzi. To nie jest wynik „cała baza bez ostrzeżeń”. Log w `outputs/fm-manual-add-sql-advisors.log` głównego workspace.
- Lokalny podgląd w przeglądarce: okno wyboru i informacja 4 → 5 czytelne, bez połączenia z produkcją.

## Wdrożenie

1. Sprawdzić bieżące main i pracę drugiego agenta; scalić zachowując nowe zmiany. Backup bieżącego szkicu/historii/wejść/planu, punkt powrotu frontu.
2. Migracja `20260921105735_fm_correction_add.sql` w SQL Editorze; sprawdzić sumę i definicję RPC. Migracja nie zmienia danych spotkań.
3. Utrwalić powyższe uzgodnione limity w aktualnym szkicu. Sprawdzić, że reszta JSON jest identyczna.
4. Front. Sprawdzić version.json i podgląd wyboru, anulować bez zapisu. Test zapisu tylko na encjach testowych / odtworzeniu bazy, nie dopisywać przypadkowego spotkania prawdziwej firmie.
5. Porównać wejścia i plan zatwierdzony; muszą pozostać identyczne. Sprawdzić aktualne ręczne korekty po odświeżeniu.

Rollback: zachować migrację, historię i szkic. Starszy front nie zna wpisów `add`, więc może źle dobrać kandydata „Cofnij ostatnią zmianę” i dostać konflikt; przy rollbacku wstrzymać korekty albo wdrożyć front z ukrytym dodawaniem, zachowując obsługę historii add/undo. Nie przywracać starego CHECK, nie usuwać historii. Ta gałąź nie została wdrożona.
