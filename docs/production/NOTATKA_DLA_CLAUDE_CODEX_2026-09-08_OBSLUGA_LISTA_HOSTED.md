# Lista spotkań obsługi — rzeczywisty test logowania, RLS i Realtime

8 września 2026. Gałąź: `codex/staff-state-ordering`, kontynuacja `5b0ece4`.

## Wynik dla Artura / Claude’a

Brakujący test integracyjny został wykonany. Trzy kolejne pełne przebiegi zakończyły się powodzeniem; dwa ostatnie mają po **25/25 kontroli** i sprawdzają odbiór oczekiwanej wersji przed upływem 15 sekund. Obsługa loguje się prawdziwym kodem i PIN-em, widzi właściwe firmy i statusy, nie może pobrać cudzej listy spotkań, a dwie niezależne sesje otrzymują zmiany Realtime.

Nie wdrażałem aplikacji, nie zmieniałem `main`, produkcji, migracji, RLS ani konfiguracji Realtime. Nie utworzyłem płatnej gałęzi i nie zmieniałem sekretów Netlify. W tej turze zmieniony jest tylko skrypt testowy i dokumentacja; kod aplikacji pozostaje z `5b0ece4`.

Nie ukrywam wcześniejszych wyników: pierwszy przebieg wykrył błędne oczekiwanie w moim teście, drugi nie potwierdził oczekiwanej zmiany Realtime w 15 sekund. Przyczyny tego drugiego wyniku nie udało się ustalić. Trzy kolejne udane przebiegi potwierdzają działającą ścieżkę, nie dowodzą stuprocentowej niezawodności sieci/platformy. Awaryjne odświeżanie co 10 sekund i ostrzeżenie o nieaktualnych danych pozostają wymagane.

## Dokładne środowisko i zakres

- Supabase: **Freshmarket B2B Queue Tests**, ref `uowpixwtewrmmvkyooec`, `eu-west-1`, Nano. Jest to istniejący osobny projekt testowy, nie produkcja ani nowa płatna gałąź.
- Netlify: `https://6a9e92afd955ba9762082ec1--freshmarketb2b.netlify.app`, zweryfikowany kontekst `deploy-preview`, stan `ready`.
- Logowanie przez faktyczne funkcje `admin-staff` i `staff-login` tego podglądu; następnie rzeczywiste Auth, PostgREST/RLS i Realtime.
- Data kont i kolejek: **2026-09-08**, czyli bieżący dzień w `Europe/Warsaw`, z `test_mode=true`. Bez obchodzenia blokady daty i bez importu planu uczestników.
- Każdy przebieg tworzył odrębnego tymczasowego admina, dwóch operatorów, fikcyjną sieć, dwie grupy (przypisana / nieprzypisana), trzy stanowiska i trzech fikcyjnych dostawców.
- Klucze pobrałem z zalogowanego dashboardu wyłącznie projektu testowego. Trafiły do pamięci lokalnego procesu przez jednorazowe wejście na loopback. Nie zostały zapisane w repo, pliku z konfiguracją, argumentach polecenia ani wynikach testów.

**Granica testu:** podgląd Netlify jest wcześniejszym deployem i nie został przeze mnie zaktualizowany do nowego UI listy. Sprawdziłem faktyczne API, role, zapytanie listy i transport Realtime z prawdziwymi sesjami, nie klikanie nowego UI na hostowanym tablecie. Aktualny `Operator` ma osobne testy komponentowe; próba fizycznych tabletów i Wi-Fi obiektu nadal jest potrzebna. Ten test nie jest powtórką obciążenia 20× ani próbą 300 telefonów.

## Historia przebiegów — wszystkie zachowane

Godziny poniżej są w UTC (w Polsce +2 godziny).

| Przebieg | Początek UTC | Wynik | Uwagi |
| --- | --- | --- | --- |
| `LIST-TEST-A1D589B7` | 10:05:31 | Nie zaliczony | Błąd asercji skryptu: wymagałem `FM_FORBIDDEN`, podczas gdy prawidłowo zalogowany staff bez przypisania dostaje `FM_NOT_ASSIGNED`. |
| `LIST-TEST-C649354A` | 10:06:49 | Nie zaliczony | Obie sesje `SUBSCRIBED`, ale oczekiwana wersja Realtime nie została potwierdzona w limicie 15 s. Ówczesny skrypt nie zapisywał liczby zdarzeń przy błędzie. Przyczyna niepotwierdzona. |
| `LIST-TEST-0B693F23` | 10:09:12 | OK | Wszystkie kontrole, obie sesje otrzymały wersje 1, 2, 3; prawidłowe listy po rozpoczęciu. |
| `LIST-TEST-2FA1442A` | 10:11:01 | OK, 25/25 | Ścisła kontrola limitu przed dalszymi odczytami. Po 3 zdarzenia na sesję; oczekiwanie po odpowiedzi start RPC: 336 ms. |
| `LIST-TEST-F6F34407` | 10:11:12 | OK, 25/25 | Niezależne nowe konta i dane. Po 3 zdarzenia na sesję; oczekiwanie po odpowiedzi start RPC: 426 ms. |

336/426 ms to czas oczekiwania testu **po odpowiedzi RPC**, nie pełny czas od dotknięcia przycisku na tablecie.

Surowe wyniki bez sekretów są w `docs/production/evidence/2026-09-08-staff-list/`: `01-assertion-mismatch.json`, `02-realtime-deadline-failed.json`, `03-pass.json`, `04-pass.json`, `05-pass.json`.

## Co dokładnie potwierdzają udane przebiegi

1. Dwa konta obsługi powstają przez prawdziwy endpoint `admin-staff`; następnie logują się osobno kodem i PIN-em przez `staff-login`. Zwrócone tokeny należą do właściwych użytkowników i projektu testowego.
2. Zapytanie używane przez listę — `fm_queue_meetings.select('*, companies(name)').eq('queue_group_id', ...)` — zwraca obu operatorom właściwe pełne nazwy firm i statusy zaplanowane.
3. Nieprzypisana grupa zwraca pustą listę. Próba bez filtra grupy także nie ujawnia cudzych spotkań. Prywatne RPC cudzej grupy zwraca dokładnie `42501 / FM_NOT_ASSIGNED`, bez danych.
4. `my_stations` pokazuje tylko dwa stanowiska przypisanej grupy. Anonimowy klient nie może pobrać list spotkań. Publiczny snapshot zawiera stanowiska, lecz nie nazwy dostawców.
5. Dwa odrębne klienty Realtime, każdy z własnym prawdziwym tokenem staff, subskrybują zmiany. Operator 1 otwiera stanowisko, wywołuje numer 1 i rozpoczyna spotkanie przez RPC. Obie sesje dostają wersje 1, 2, 3.
6. Po operacji listy obu kont pokazują tę samą właściwą firmę, `in_progress`, poprawne stanowisko oraz godziny wywołania i rozpoczęcia; drugi dostawca nadal jest `planned`.

Ograniczenie prywatności: sprawdzany jest dostęp do **kolejek i spotkań**, nie całego katalogu firm aplikacji. Istniejąca polityka katalogu `companies` jest szersza i nie została w tej poprawce zmieniona.

## Korekty mojego skryptu, bez zmiany aplikacji/bazy

- Prawidłowa asercja nieprzypisanego stanowiska: dokładnie `FM_NOT_ASSIGNED`, kod `42501`, `data === null`. Odczytałem implementację `fm_queue_assert_operator` także w projekcie testowym; reguły nie zostały poluzowane.
- Jawne potwierdzenie `in_progress` w wyniku `start`.
- Diagnostyka zdarzeń i oczekiwanego stanowiska/wersji zapisywana także przy błędzie.
- Wynik odbioru Realtime utrwalany przed późniejszymi zapytaniami, aby nie uznać spóźnionego zdarzenia za spełnienie limitu 15 s.
- Jawne wylogowanie tymczasowego admina podczas sprzątania; unieważnienie sesji obsługi pozostaje.
- Osobny JSON każdego przebiegu w `out/staff-list-hosted-results/`, oprócz bieżącego `out/staff-list-hosted-result.json`.

Po zmianach: `npm test` **54/54**. Skrypt nie trafia do paczki przeglądarkowej.

## Sprzątanie potwierdzone w bazie

Po wszystkich pięciu przebiegach odczyt kontrolny potwierdził:

- `fm_staff`, `fm_queue_groups`, `fm_stations`, `fm_queue_meetings`, `fm_queue_assignments`, `fm_queue_settings`: po **0** rekordów;
- firmy, sieci, profile i konta Auth z prefiksem `LIST-TEST-`: po **0**;
- audyt pozostawiony celowo: **12** wpisów operacji kolejki i **10** prób logowania testowego.

Usunięto wyłącznie tymczasowe dane testu po zapisanych identyfikatorach; fikcyjne dane można odtworzyć skryptem. Nie kasowano dzienników append-only ani danych biznesowych. Brak nowych kosztów utworzenia gałęzi testowej.

## Co przekazać Claude’owi

Pobierz aktualizację gałęzi `codex/staff-state-ordering` i włącz korektę skryptu oraz raporty do `feat/staff-meeting-list`. Bloker „brak dostępu do testowych kluczy / brak testu rzeczywistych kont” jest zamknięty. Nie trzeba ponownie prosić Artura o klucze w czacie.

Nie pomijaj wcześniejszego niezaliczonego przebiegu Realtime w podsumowaniu. Pozostaw odświeżanie awaryjne 10 s i ostrzeżenie po 25 s; podczas próby generalnej sprawdź odcięcie Realtime, utratę łącza i powrót do karty na realnych tabletach. W razie powtarzalnych opóźnień zbierz logi Realtime i czasy zdarzeń, bez przypisywania przyczyny planowi Nano bez dowodów.

Można wrócić do Artura po decyzję o wdrożeniu poprawki listy. **Nie traktuj tej notatki jako zgody na merge do `main` ani deploy produkcyjny.** Po zgodzie: integracja, testy/build, deploy bez migracji, kontrola rzeczywistego UI oraz aktualizacja instrukcji PDF właściwymi ekranami. Próba na fizycznych tabletach pozostaje osobnym warunkiem gotowości wydarzenia.

Użyte instrukcje: Supabase (testy prawdziwych tokenów, RLS i Realtime; brak ekspozycji service role) oraz Netlify CLI and Deployment (wyłącznie zweryfikowany kontekst Deploy Preview).
