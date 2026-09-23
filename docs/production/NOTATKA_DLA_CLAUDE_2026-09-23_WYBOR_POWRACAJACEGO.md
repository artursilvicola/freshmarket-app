# Do drugiej opinii: ręczny wybór powracającej firmy

Data: 23.09.2026. Autor: Codex. Event: 24.09.2026.

## Stan przekazania

Gotowa implementacja na gałęzi `feat/fm-staff-returnee-choice`, przygotowanej z `origin/main` = `823c6450b442774a29a87507b78f0d30dbc91658`. Ostatni fetch podczas weryfikacji nadal wskazywał ten sam main. Poprawka NIE jest wdrożona. Nie było zmian produkcyjnej bazy, operacji na rzeczywistych kolejkach ani wysyłki maili.

Proszę o niezależne review kodu, ponowienie testów oraz ocenę gotowości do użycia 24 września. Wyniki lokalne są pozytywne; nie zastępują próby na dwóch rzeczywistych tabletach i kontroli konfiguracji dnia wydarzenia.

## Potrzeba Artura i Oli

Dotychczas interfejs proponował najniższy numer wśród uprawnionych powracających. Ola potrzebuje samodzielnie wskazać firmę, którą obsługa chce zaprosić. Artur wymaga, aby pozostali nadal czekali oraz żeby starszy numer powracającego NIGDY nie został ponownie wywołany na publicznej tablicy.

Ta zmiana nie dotyczy cofania numerów ani przebudowy matchingu. Wykorzystuje istniejącą operację `fm_queue_serve_returnee`, która już przyjmuje konkretny identyfikator spotkania. Nie ma nowej migracji, zmiany RLS ani nowego RPC.

## Jak działa interfejs

1. W sekcji „Powracający (obsługa poza tablicą)” każda firma, która zakończyła wymagane oczekiwanie (`ready=true`), ma zielony przycisk **„Obsłuż tę firmę”**. Firma nadal oczekująca na zakończenie spotkania blokującego ma tylko opis oczekiwania, bez możliwości wcześniejszego wejścia.
2. Przycisk jest aktywny przy otwartym, wolnym stanowisku, działającym połączeniu i braku operacji w toku. Nie przerywa ani wywołanego, ani rozpoczętego spotkania, ani obsługi innego powracającego. Podczas zajętości widnieje instrukcja zakończenia bieżącego spotkania.
3. Kliknięcie otwiera potwierdzenie: nazwa sieci, stanowisko, numer i pełna nazwa wybranej firmy, informacja „Tylko dla obsługi” oraz **„Potwierdź — obsłuż firmę (N)”** / „Anuluj”. Sam wybór lub anulowanie nie zapisują niczego.
4. Jeżeli gotowych firm jest więcej, w potwierdzeniu można zmienić wybór z listy. Pełna nazwa wybranej firmy jest dodatkowo pokazana pod listą; długi tekst w samym polu wyboru może być skrócony przez przeglądarkę.
5. Dopiero potwierdzenie wysyła konkretny identyfikator spotkania. Przykład: czekają 2 i 7; operator wybiera 7, firma 2 zostaje na liście. System nie zastępuje wybranego 7 numerem 2, nawet gdy zapis 7 zostanie odrzucony.
6. Dotychczasowy duży przycisk „Obsłuż powracającego (N)” również otwiera potwierdzenie; najniższy uprawniony numer jest tylko propozycją, którą można zmienić.
7. Pozostaje przypomnienie przy „Wywołaj następny” oraz „Zakończ i wywołaj następny”. Teraz również w nim można wybrać inną firmę. Przy kończeniu bieżącego spotkania lista obejmuje gotowych powracających oraz tych, dla których właśnie kończone spotkanie jest ostatnim warunkiem oczekiwania. Osoba czekająca na inne, niezakończone spotkanie nie jest oferowana.
8. W przypomnieniu operator nadal może świadomie wybrać zwykłą kolejkę. W potwierdzeniu otwartym bezpośrednio z wiersza firmy są tylko obsługa wybranej firmy i anulowanie — bez przypadkowej alternatywy wywołania następnego.
9. Po obsłudze używa się dotychczasowego „Zakończ powracającego”. Nie ma automatycznego rozpoczęcia kolejnej oczekującej firmy.

Wszystkie nowe teksty istnieją po polsku i angielsku.

## Zabezpieczenia i ograniczenia

### Tożsamość wyboru i nieaktualny ekran

Potwierdzenie zapamiętuje identyfikator stanowiska, generację wyboru sieci, wersję stanowiska i grupy, bieżące spotkanie oraz konkretną wybraną firmę. Przed wysłaniem zapis sprawdza aktualność tego zestawu, tryb `open`, brak innego powracającego oraz uprawnienie wybranej firmy do wejścia.

Zmiana stanowiska usuwa okno. Odpowiedź dotycząca wcześniejszej sieci nie steruje nowym ekranem. Zmiana stanu przez innego operatora blokuje stare potwierdzenie; operator zamyka je i wybiera ponownie. Brak gotowości wybranej osoby także blokuje zapis, nawet jeśli wersja nie zmieniła się w atrapie testowej. Po błędzie `serve_returnee` odświeżany jest stan, również przy `FM_BAD_STATUS` — np. po przejęciu firmy przez inne stanowisko.

### Ponowienia i podwójne kliknięcia

Istniejąca blokada operacji odrzuca drugi szybki klik. Automatyczne ponowienie po błędzie sieci zachowuje ten sam identyfikator firmy, stanowisko, oczekiwaną wersję i klucz idempotencji. Nie tworzy nowego wyboru na podstawie aktualnie najniższego numeru.

Ścieżka „Zakończ i obsłuż powracającego” pozostaje dwiema istniejącymi operacjami: zakończenie bez wywołania następnego, następnie obsługa wybranego powracającego. Każdy krok ma własny stały klucz. Drugi krok sprawdza odpowiedź serwera po zakończeniu. Jeśli zakończenie się uda, a obsługa powracającego nie, bieżące spotkanie pozostaje zakończone; system odświeża stan i NIE wywołuje sam kolejnego numeru. Operator sprawdza sytuację i wybiera ponownie.

### Kontrole bazy (istniejące)

`fm_queue_serve_returnee` sprawdza uprawnienia operatora do grupy, wersję i tryb stanowiska, jego wolność, przynależność wybranej firmy do tej samej grupy, status `returned_waiting` oraz spełnienie bariery oczekiwania. Blokuje wiersz stanowiska i wybranego spotkania. Zapis jest rejestrowany w `fm_queue_log` jako `serve_returnee` z operatorem, stanowiskiem, spotkaniem, numerem i kluczem idempotencji. Drugi operator nie może ponownie rozpocząć firmy, która już jest obsługiwana.

### Publiczna tablica

Kod `/tablice` oraz publicznego snapshotu nie został zmieniony. Obsługa powracającego nie zmienia `last_called_nr`, nie wywołuje jego dawnego numeru i nie wykonuje `call_next`. Istniejący snapshot ukrywa numer prywatnie obsługiwanego powracającego (`current_nr=null`, prywatna zajętość stanowiska). „Bez zmian” oznacza zachowanie dotychczasowej semantyki — status stanowiska może odzwierciedlać zajętość, ale wcześniejszy numer nie wraca na ekran.

## Zakres plików

| Plik | Zmiana |
|---|---|
| `src/staff/StaffPanel.jsx` | Przycisk przy gotowej firmie, wybór w potwierdzeniu i przypomnieniu, kontrola aktualności, odświeżenie po błędzie obsługi |
| `src/staff/staffI18n.js` | Pięć nowych kluczy PL/EN |
| `src/staff/StaffPanel.returnees.test.jsx` | 16 nowych przypadków; razem 32 testy przypomnienia i wyboru |
| `supabase/tests/053_fm_queue_test.sql` | T5b: wybór wyższego numeru, pozostali czekają, inny desk, idempotencja, historia i snapshot publiczny |

Nie zmieniono konfiguracji operatorów, PIN-ów, dat kolejek, importu planu, Gate, numerów, maili, planu zatwierdzonego ani wejść matchingu.

## Wykonana weryfikacja

| Kontrola | Wynik |
|---|---|
| Pełny `npm test` | **515/515, 63 pliki** |
| `npm run build` | **OK**; dotychczasowe ostrzeżenie o wielkości chunków |
| `git diff --check` | **OK** |
| Pusta lokalna baza PostgreSQL 17, shim i wszystkie migracje z repo (także datowane) | **OK** |
| `053_fm_queue_test.sql`, T0–T16, w tym nowe T5b | **PASS**, transakcja testowa z ROLLBACK |
| `055_security_hotfix_test.sql`, T0–T9 | **PASS** |
| Chrome, rzeczywisty komponent Operator, fikcyjne dane bez produkcyjnego API | **OK**, widoki 1024×768 i 768×1024 |

Testy frontu obejmują wyższy wybrany numer, anulowanie, wybór w przypomnieniu, zakaz wejścia przed czasem, zajęte stanowisko, przerwę/free entry/zamknięcie, utratę gotowości, zmianę sieci, stare potwierdzenie, przejęcie firmy przez inny desk, podwójny klik, utratę odpowiedzi, tryb offline i wersję angielską. Istniejące przypadki obejmują również błąd zakończenia, błąd drugiego kroku i zmianę sieci podczas kończenia.

T5b rzeczywiście wykonuje RPC na lokalnym Postgresie: powracający 1 i 3 czekają po zakończeniu bariery 4, wybierany jest 3. Numer 1 zostaje, `last_called_nr=4`, publiczne dane nie zawierają starego numeru ani nazwy firmy 3. Drugi desk nie może rozpocząć już zajętej firmy, a ponowienie tego samego klucza daje jeden wpis historii. To próba dwóch stanowisk w kolejności; nie należy jej przedstawiać jako testu równoczesnych transakcji na dwóch tabletach.

W podglądzie Chrome wybrano 7 zamiast gotowego 2. Po potwierdzeniu 7 był obsługiwany prywatnie, 2 nadal czekał, 9 nadal miał barierę, następny publiczny numer pozostał 13, a ostatnio wywołany 12. Widok wykorzystał prawdziwy komponent z atrapą API; nie był produkcyjną próbą bazy przez przeglądarkę.

### Odtworzenie testów przez Claude'a

Pobierz gałąź i porównaj ją z bazą `823c645`. Uruchom `npm ci`, `npm test`, `npm run build`, `git diff --check 823c645 HEAD`. Na izolowanej bazie z pełnym zestawem migracji uruchom `053_fm_queue_test.sql` i `055_security_hotfix_test.sql`, np. istniejącym runnerem `node scripts/fm-queue-sql-test.mjs --only-test --test 053,055` z `DATABASE_URL` wskazującym WYŁĄCZNIE lokalną bazę testową. Sam runner bez `--only-test` stosuje migracje numerowane; do wiernego powtórzenia mojego testu uwzględnij też migracje datowane. Nie uruchamiaj testów na produkcji.

## Prośba o drugą opinię

1. Czy każda droga obsługi powracającego wymaga potwierdzenia wybranej firmy i nie umożliwia przypadkowego podmienienia jej na inną? Sprawdź też zmianę wyboru w dialogu i zakończenie bieżącego spotkania.
2. Czy przy spóźnionej odpowiedzi, utracie łącza, przełączeniu stanowiska oraz dwóch operatorach istnieje ścieżka do złej firmy, podwójnej obsługi lub niezamierzonego `call_next`? Oceń blokady RPC i ponowienia niezależnie od atrap frontu.
3. Czy publiczne numery pozostają niezmienione podczas obsługi powracającego i rosną przy powrocie do normalnej kolejki? Sprawdź rzeczywisty snapshot i duży ekran/telefon, nie tylko panel operatora.
4. Czy przyciski, pełna nazwa firmy i potwierdzenie są czytelne na faktycznych tabletach obsługi? Czy przypomnienie wystarczająco wyjaśnia, dlaczego kolejna firma nadal czeka?
5. Proszę o konkretny werdykt **gotowe / blokada / uwagi nieblokujące**, ze wskazaniem sprawdzonych wersji i niewykonanych prób. Gotowość funkcji oddziel od gotowości całego dnia 24.09.

## Próba odbiorowa na dwóch tabletach

Wykonać na osobnym dniu testowym i kontach testowych, z tym samym przypisaniem sieci co planowana obsługa. Nie resetować ani nie importować ponownie dnia 24.09 w celu tej próby.

1. Przygotować dwóch uprawnionych powracających, np. 2 i 7, oraz jednego jeszcze oczekującego. Otworzyć wolne stanowisko.
2. Wybrać 7, anulować: nic się nie zmienia. Ponownie wybrać 7 i potwierdzić: tylko 7 jest obsługiwany, 2 pozostaje, osoba oczekująca nie uzyskuje wcześniejszego dostępu.
3. Równocześnie na drugim tablecie spróbować obsłużyć tę samą firmę w tej samej grupie. Oczekiwany wynik: jedna przyjęta operacja, drugi operator widzi aktualny stan lub odmowę; nigdy dwie aktywne obsługi tej firmy.
4. Sprawdzić `/tablice?date=DATA_TESTOWA` na dużym ekranie i telefonie: 7 nie wraca publicznie. Po zakończeniu powracającego i wywołaniu kolejnego zwykłego spotkania numer idzie dalej.
5. Powtórzyć z normalnym spotkaniem w toku: lista nie pozwala go przerwać; „Zakończ i wywołaj następny” umożliwia świadomy wybór powracającego. Pozostali nadal czekają.
6. Otworzyć dialog, zmienić stan z drugiego urządzenia: stare potwierdzenie ma zostać odrzucone. Przełączenie sieci nie może pozostawić dialogu poprzedniej sieci.
7. Wyłączyć i przywrócić Wi-Fi oraz wrócić do karty po uśpieniu. Oczekiwane: odświeżenie stanu, brak wywołania innej firmy zamiast wybranej. Przy niepewnym wyniku najpierw sprawdzić aktualny stan i log.
8. Sprawdzić historię: wybrany numer i firma, właściwe stanowisko/operator, pojedyncze zdarzenie przy podwójnym dotknięciu lub ponowieniu.

## Gotowość całego dnia 24 września — do sprawdzenia osobno

- Ważność dostępów operatorów na **24.09.2026** i właściwe przydziały stanowisk. PIN-y testowe z 22.09 nie są dowodem gotowości kont eventowych.
- Zatwierdzony plan i jego zgodność z importem dnia 24.09: liczby par oraz numery w grupach, nie tylko łączny licznik. Nie przeliczać matchingu podczas odbioru tej poprawki.
- Gate 1/2, aktywne sieci, brak Biedronki i Mega Image na tablicach, właściwa liczba stanowisk Dino/Auchan — aktualny odczyt, zamiast polegania na historycznych ustaleniach.
- Ten sam dzień i właściwy filtr na tabletach, telefonach i ekranach. Łącze, ładowanie, uśpienie ekranów, odświeżanie po powrocie do aplikacji.
- Próba zwykłej kolejki, przerwy, „Wolne wejście”, nieobecności i powrotu, zakończenia dnia. Nie wolno cofać publicznych numerów.
- Osobnym nierozwiązanym zadaniem pozostaje zauważony w panelu eksportu kart błąd `pageCount is not defined` (także brak helpera `mergeBlobs` w źródle). Ta gałąź go nie poprawia i nie stanowi potwierdzenia gotowości przygotowania/wysyłki kart. Nie wysyłać żadnych maili bez osobnego zatwierdzenia Artura.

Ta notatka nie potwierdza tych punktów produkcyjnych: w obecnej pracy wykonano testy funkcji wyboru powracającego, bez zmiany ustawień eventu.

## Proponowane wdrożenie po review

1. Sprawdzić aktualny main i ewentualne równoległe zmiany Claude'a. Po integracji zmian produkcyjnych powtórzyć odpowiednie testy. Utworzyć punkt powrotu do poprzedniego deployu.
2. Wdrożyć wyłącznie front. Nie ma migracji, importu planu ani przebudowy kolejek.
3. Odświeżyć panel obsługi na tabletach przy wolnych stanowiskach; zweryfikować wersję i wykonać powyższą próbę na dniu testowym.
4. W razie problemu wrócić do poprzedniego frontu. Dane i historia pozostają zgodne; wcześniejszy panel nadal potrafi obsługiwać powracających, ale wybór dowolnej firmy z listy zniknie.

Do czasu niezależnego review i próby urządzeń: **implementacja gotowa do odbioru, nie jest to zapewnienie, że wszystkie elementy eventu zostały już sprawdzone**.
