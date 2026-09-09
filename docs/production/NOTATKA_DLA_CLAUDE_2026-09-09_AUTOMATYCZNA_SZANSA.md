# Brak odpowiedzi kupca = automatyczna szansa

Decyzja Artura z 9.09.2026. Gałąź `codex/fm-default-chance`, baza `48dd1b4` (aktualne `origin/main` przy rozpoczęciu pracy).

## Zasada biznesowa

- Dostawca wybrał sieć jako główną lub zapasową, kupiec nie odpowiedział: para dostaje dokładnie tę samą rangę co jawne „Daj szansę”.
- Wszystkie akceptacje kupca mają pierwszeństwo w przydziale miejsc i numeracji przed szansami. W ramach rodzaju odpowiedzi zachowano kolejność: główna, zapasowa, jednostronny wybór kupca; dalej data płatności i dotychczasowe rozstrzyganie remisów.
- Dotyczy to także akceptacji jednostronnej kupca: jej wynik punktowy zmieniono z 2000 na 4500, przed szansami 4000/3000/1000. To świadoma zmiana wcześniejszej zasady „mutual zawsze przed jednostronnym”, wynikająca z wymagania akceptacje przed szansami.
- Jawne odmowy (`remove`, `rejected`), wykluczenia dostawcy, Standard i `fmB2bEnabled=false` nadal wykluczają przydział.
- Brak wyboru sieci przez dostawcę **i** brak decyzji kupca nie tworzą spotkania. Jawne wybory jednostronne kupca pozostają obsługiwane.
- Nieznane statusy nie są traktowane jako szansa. Brak odpowiedzi oznacza `undefined`, `null` lub pusty tekst, nie błąd odczytu.
- Limity pakietów, pojemność stanowisk i minimalne odstępy między spotkaniami pozostają. Szansa to kandydatura, nie gwarancja miejsca przy pełnej kolejce.

## Implementacja

`src/lib/fm-algo.js`: wspólny helper `isAutomaticChance`, brak mutacji wejścia, dwa etapy przydziału (akceptacje, potem szanse), numer szansy większy od ostatniej akceptacji w tej samej sieci. Samo sortowanie punktów nie zapewniało tych reguł: round-robin mógł zabrać miejsce akceptacji, a numerowanie od 1 mogło wstawić szansę w lukę przed akceptacją.

Panel kupca: opis PL/EN, osobny licznik i etykieta „Daj szansę — automatycznie”. Panel admina: osobny licznik i grupa automatycznych szans, odmowy nie są już grupowane razem z brakiem decyzji. Nie zapisujemy fikcyjnych kliknięć ani rekordów `chance` w `fm_resps`; surowe decyzje kupców pozostają nietknięte. „Sieci odpowiedziały” nadal liczy rzeczywiste odpowiedzi, nie automat.

Korekty pokazują wiersze do ostatniego zajętego numeru, nie tylko do liczby spotkań. Usunięto także dawny limit podglądu do 45. numeru. Dzięki temu luki w numeracji nie ukrywają końca listy.

## Ochrona przed fałszywą szansą przy awarii

Dotychczas `getFmResps` zwracał pustą tablicę także przy błędzie. Po zmianie byłoby to niebezpieczne: nieodczytana odmowa wyglądałaby jak milczenie.

- `getFmResps` i `getAllCompanyTargetRetailers` propagują błąd i pobierają wszystkie strony (po 500, dokładny licznik, stabilne sortowanie, timeout zapytania 10 s).
- Niekompletny wynik, pusta strona przed końcem lub zmiana liczby rekordów między stronami odrzuca cały odczyt.
- Starszy odczyt nie zastępuje nowszego dzięki wspólnemu numerowi żądania. Dwie listy wejściowe są przyjmowane razem, także gdy poprawny wynik jest pusty.
- Przy braku pełnego odczytu nowego planu nie można przeliczyć, zatwierdzić ani opublikować. Jest komunikat PL/EN. Istniejący zapisany plan oraz konfiguracja dnia wydarzenia nie są kasowane.
- To nie jest transakcyjny snapshot wielu stron: zmiany tych samych rekordów bez zmiany ich liczby w trakcie odczytu nadal są możliwe. Końcowy plan należy liczyć po zamknięciu wyborów i świeżym odczycie danych.

Nie zmieniono schematu, RLS, ról, sekretów, danych uczestników ani uprawnień. Zgodnie ze skillem Supabase zweryfikowano obsługę `data/error/count`; testy odczytu używają atrap, bez połączeń i zapisów do produkcji. Dokumentacja referencyjna: https://supabase.com/docs/reference/javascript/select.

## Testy

Wynik końcowy 9.09.2026: `npm test` **84/84**, `npm run build` **OK**, `git diff --check` **OK**. Build zgłasza dotychczasowe ostrzeżenie o dużych chunkach. Kontrola paczki: brak nazw firm testowych i `react-test-renderer`. Nie zmieniano zależności.

- `src/lib/fm-default-chance.test.js`: 14 przypadków, w tym 20 zgłoszeń i zero odpowiedzi, równoważność jawnej/domniemanej szansy, brak niezamawianych par, odmowy, priorytet przy ograniczonej pojemności, round-robin, luki, płatności i większy mieszany plan.
- `src/lib/fm-input-read.test.js`: 10 przypadków, w tym odmowa za 1000. rekordem, niższy limit serwera, błędy/niekompletne strony i zmiana licznika.
- `src/legacy/FmDefaultChance.test.jsx`: 6 testów prawdziwych komponentów z atrapami warstwy zewnętrznej: oznaczenia bez zapisu, rozdzielenie odmów, blokady przeliczenia/publikacji, odblokowanie po odczycie, tłumaczenia i numer 81 za luką.
- Zmieniono dwa wcześniejsze oczekiwania w `fm-algo.test.js`, ponieważ testowały poprzednie zasady biznesowe. Nie usunięto testów regresyjnych obsługi.

## Wdrożenie — osobny krok

Ta praca nie obejmuje merge do `main`, deployu produkcyjnego ani przeliczenia/publikacji planu wydarzenia. Migracja nie jest potrzebna. Sam deploy kodu nie zastępuje zapisanego planu.

Po zgodzie na wdrożenie:

1. Review gałęzi, pełne testy i build, merge/deploy standardową ścieżką.
2. Zamknąć wybory, odświeżyć dane i sprawdzić brak błędu odczytu.
3. Admin: Spotkania B2B → Korekty → przelicz od nowa; przed zatwierdzeniem sprawdzić wyniki. Nie nadpisywać opublikowanego planu lub żywych kolejek bez osobnej decyzji.
4. Na przykładzie testowym: 2 akceptacje, 1 jawna szansa, 1 brak odpowiedzi, 1 odmowa. Wynik: akceptacje najpierw, potem obie szanse, odmowa poza planem. Powtórzyć dla całkowicie milczącej sieci i pełnej pojemności.
5. Sprawdzić PL/EN oraz test błędu odczytu w przeglądarce. Klikania na zalogowanej produkcji ani testu hostowanego tej zmiany nie wykonywano.

Starszy PDF instrukcji nie został w tym zadaniu ponownie edytowany. Przy publikacji nowej instrukcji dopisać tę zasadę jako zmianę z 9.09.2026, nie jako historyczne kliknięcia kupców.
