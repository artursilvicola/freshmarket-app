# Pakiet do review — rozdzielenie instrukcji PreConnect i Spotkań B2B (30.10.2026, wersja 2)

Gałąź **`feat/instructions-split`** od `origin/main` = `988d095`. Commity: `d7d3828` (wersja 1), `4de6c5f` (docs v1), **wersja 2 = ostatni commit gałęzi** (poprawki po ocenie raportu).
**Nic nie wdrożono, nic nie scalono do `main`.** Dane produkcyjne: na czas zrzutów ekranu **tymczasowo zmieniono aktywność kont testowych** (firma ZZZ TEST Dostawca: wstrzymana → aktywna → wstrzymana; sieć ZZZ TEST 2 pozostała nieaktywna), **następnie przywrócono poprzedni stan**. Każda zmiana statusu firmy wysłała automatyczny e-mail na alias testowy `+dostawca`. Poza tym żadnych zmian danych.

## 0. Co zmieniło się w wersji 2 (odpowiedź na ocenę raportu)

| uwaga | co zrobiono |
|---|---|
| 1. Edycja instrukcji ≠ aktywna konfiguracja spotkań | Rok instrukcji B2B to **stała treści** `B2B_INSTRUCTION_EDITION_YEAR = 2027` (`src/content/instructions/index.js`). Moduł czytający rok z `fm_settings.event_date` **usunięty**; etykiety aktywnej edycji w menu („Fresh Market 2026", „Spotkania FM 2026") **wróciły do dotychczasowych literałów**. Dat, faz i planów 2026 nie dotykamy. Instrukcje B2B mają na górze notę: „Instrukcja dotyczy edycji 2027. Terminy i zasady tej edycji ogłasza organizator — nie wynikają z dat widocznych dziś w module spotkań." Niepotwierdzone zasady są wyłącznie w ramce dla administratora. Test pilnuje, że moduł `fm-edition` nie istnieje. |
| 2. Połączona instrukcja 2026 poza PreConnect | Wyjęta z instrukcji PreConnect (także ze zwiniętej sekcji). Jest **osobna strona „Archiwum instrukcji 2026"** z własnym adresem (`/…/instrukcja/archiwum-2026`), ostrzeżeniem „nie opisuje bieżącej edycji", przyciskiem wydruku i powrotem; odnośnik do niej tylko w stopce instrukcji PreConnect. Treść w bazie nietknięta. Test pilnuje, że instrukcja PreConnect nie renderuje żadnego HTML z bazy. |
| 3. Branding → Instrukcje | Sekcja nazywa się teraz **„Archiwum instrukcji 2026 (treść HTML)"**, z opisem: to pole nie jest bieżącą instrukcją, widać je tylko pod „Archiwum instrukcji 2026"; bieżące instrukcje to pliki `src/content/instructions/*.js` (zmiana = kod + wdrożenie). Podgląd w Brandingu podpisany tak samo. |
| 4. Administrator w przeglądarce | **Wykonane** (po Twoim zalogowaniu; sesja z Twojej karty produkcyjnej przeniesiona do karty `localhost` w tej samej przeglądarce, bez hasła): oba wejścia w menu („Instrukcja administratora PreConnect" w Operacyjnych, „Instrukcja administratora spotkań B2B 2027" pod FM) otwierają właściwe dokumenty; przełącznik Administrator / Dostawca / Kupiec zmienia dokument i adres (`?rola=dostawca|kupiec`), wersje uczestników bez ramki pytań; PL→EN zmienia tytuły, etykiety menu i przycisk, EN→PL wraca; bezpośrednie adresy po przeładowaniu (`/admin/instrukcja/spotkania-b2b?rola=dostawca`, `/admin/instrukcja/archiwum-2026?rola=kupiec` z HTML kupca z bazy); podgląd konta ZZZ TEST Dostawca → „Instrukcja PreConnect" i „Instrukcja spotkań B2B" pokazują wersje dostawcy bez przełącznika; powrót na konto admina; Branding pokazuje nową nazwę i opis sekcji. Dodatkowo 12 PDF administratora (3 wersje × 2 dokumenty × PL/EN) wygenerowanych i obejrzanych — bez menu, bez ucięć. |
| 5. Rzeczywisty wydruk do PDF | Zrobiony: 12 plików PDF (dostawca i kupiec × PreConnect, Spotkania B2B, Archiwum 2026 × PL/EN) wygenerowanych **prawdziwym silnikiem druku Chrome** (`scripts/instructions-pdf.mjs`, CDP `Page.printToPDF`), obejrzanych strona po stronie: bez menu i paska panelu, bez uciętych tekstów i zrzutów, rozdziały nierozrywane. Mechanizm wydruku przepisany: zamiast `visibility`+`position:absolute` (ucina wielostronicowy druk) — chowanie reszty strony na czas druku (`print-isolation.js`), tryb `?print=1`, zrzuty ładowane od razu. Przycisk nazywa się **„Drukuj / zapisz jako PDF"**, podpowiedź mówi o oknie drukowania. Administrator: 12 PDF (Administrator / Dostawca / Kupiec × PreConnect, B2B × PL/EN) wygenerowanych tym samym skryptem po Twoim zalogowaniu i obejrzanych. Razem 24 PDF w `C:\Users\Artur\AppData\Local\Temp\pdf\`. |
| 6. Zrzuty | Przejrzane. Adresy testowe `artur.stasiak+…` **zamaskowane** (`kupiec@przyklad.pl` / `dostawca@przyklad.pl`) na trzech zrzutach, gdzie występowały (profil kupca, Firmy, historia mailingu). Linków logowania i PIN-ów brak (test treści). Zrzut listy sieci u dostawcy zostaje z podpisem: „zrzut z 2026 … bieżąca lista sieci PreConnect, nie lista uczestników wydarzenia". |
| Podział mailingu wg kategorii | Poza zakresem; instrukcja kupca opisuje stan dzisiejszy, bez obietnic. Z listy pytań usunięte. |

## 0a. Decyzja Artura (30.10, wieczór): zasady 2026 = podstawa instrukcji B2B 2027

Przyjęte dla dostawcy, kupca i administratora. Zasady pakietów (5 sieci głównych na pakiet Business, rezerwowe bez limitu), wyboru sieci (⭐/👍, Potwierdź wybór), odpowiedzi kupców (Chcę / Daj szansę / Nie chcę, brak odpowiedzi = Daj szansę), pierwszeństwa (data opłaty, Premium przy remisie), przydziału i korzystania z planu są opisane **jako obowiązujące**, bez oznaczania ich jako niepotwierdzonych. Dane konkretnej edycji (terminy, lista sieci, kupcy, miejsce) **nie są przenoszone z 2026**: w instrukcjach stoi „informacja zostanie podana przez organizatora". Nota na górze instrukcji B2B: „Instrukcja dotyczy edycji Fresh Market 2027. Szczegóły organizacyjne i terminy będą aktualizowane przed wydarzeniem." Ramka administratora nazywa się teraz „Do ustalenia przez organizatora" i zawiera wyłącznie dane edycji (data i miejsce, terminy faz, lista sieci, tryb włączania B2B z rejestracji, ręczny wybór dla powracających) — pytanie o zasady pakietów usunięte. Archiwum 2026 bez zmian; konfiguracja, daty i plany w działającym module nietknięte.

**PDF po tej zmianie (30.10, ~17:50)**: wszystkie 24 pliki wygenerowane ponownie z aktualnej gałęzi tym samym skryptem (`scripts/instructions-pdf.mjs`, Chrome CDP) — 10 plików Spotkań B2B (dostawca, kupiec, administrator × wersje × PL/EN) oraz, ponieważ poprawka druku poniżej jest globalna, także 8 plików PreConnect/Archiwum uczestników i 6 PreConnect administratora. Sesje: konta testowe (+dostawca, +kupiec) przez magic link oraz Twoja sesja administratora z karty `localhost`. Kontrola skryptem (PyMuPDF) na każdym pliku: nowa nota i „informacja zostanie podana przez organizatora” obecne w 10 plikach B2B, stare brzmienia nieobecne, brak menu panelu, żaden blok tekstu ani zrzut nie dotyka krawędzi strony; arkusze miniatur wszystkich stron obejrzane — rozdziały w całości, bez ucięć. **Jedna poprawka**: w PDF kupca (Spotkania B2B, PL i EN) po dodaniu kroku z terminami pojawiła się **pusta czwarta strona** — same dolne odstępy (padding sekcji archiwum + padding kontenera) wypychały nową stronę, gdy treść kończyła się tuż przy dole. Poprawione w `InstructionPage.css` (druk: ostatnia sekcja i kontener bez dolnych odstępów); po poprawce kupiec = 3 strony, a archiwum EN dostawcy, które wcześniej też kończyło się pustą stroną (6), ma 5 stron. Liczby stron pozostałych plików bez zmian. Pliki: `C:\Users\Artur\AppData\Local\Temp\pdf3\` (poza repozytorium; stary komplet w `...\Temp\pdf\`).

## 0b. Review Codexa gałęzi do e01f8ff (30.10, ~18:00) — dwa P2 w treści, poprawione

Codex: 775 testów zaliczonych, 14 pominiętych, `git diff --check` czysty; builda i PDF-ów nie sprawdzał niezależnie.

1. **PreConnect — odczyt już przy wejściu na listę.** Potwierdzone w kodzie: panel kupca przy otwarciu listy propozycji (Propozycje asortymentowe i Zapisane) wysyła wszystkie propozycje w stanie „wysłana/otwarta” do funkcji `mark-buyer-preconnect-seen` (kanał `app_list`), która oznacza je jako odczytane i pobiera kredyt — bez otwierania szczegółów. Instrukcje mówiły o „otwarciu szczegółów propozycji”. Poprawione w PL i EN: kupiec (rozdział „Powiadomienia e-mail i status odczytu”), dostawca (przegląd, intro „Kredyty”, intro „Odczyty kupców”, „Najczęstsze sytuacje”), administrator (przegląd, cykl kredytu). **Mechanizm rozliczeń bez zmian** — tylko opis.
2. **Spotkania B2B — sprzeczna zasada akceptacji.** „Spotkanie wymaga akceptacji kupca” zastąpione brzmieniem z review (PL): „Wybór sieci jest zgłoszeniem, nie gwarancją spotkania. Akceptacja kupca daje pierwszeństwo. „Daj szansę” oraz brak odpowiedzi pozwalają na przydział w miarę dostępnych miejsc; odmowa wyklucza automatyczny przydział.” EN odpowiednio. Instrukcje kupca i administratora już wcześniej opisywały to zgodnie (brak odpowiedzi = „Daj szansę”, odmowa wyklucza, akceptacja = pierwszeństwo) — bez zmian.

Po poprawkach: testy instrukcji 28/28, build OK, `git diff --check` czysty. **PDF-y zmienionych instrukcji wygenerowane ponownie** (14 plików: PreConnect dostawca/kupiec/administrator × wersje × PL/EN oraz Spotkania B2B dostawcy w panelu dostawcy i w podglądzie administratora × PL/EN) i sprawdzone skryptem: nowe brzmienia obecne, stare nieobecne, bez ucięć, liczby stron bez zmian względem kompletu z §0a; arkusze miniatur obejrzane. Komplet 24 nadal w `C:\Users\Artur\AppData\Local\Temp\pdf3\`. Zakres nierozszerzony: rozliczenia i algorytm spotkań nietknięte. Nadal bez wdrożenia.

## 1. Co jest

Sześć instrukcji w aplikacji (treść w repozytorium, PL i EN), każda z własnym adresem, spisem treści, ponumerowanymi krokami, zrzutami z kont testowych i przyciskiem „Drukuj / zapisz jako PDF"; plus osobna strona archiwum.

| dokument | rola | adres |
|---|---|---|
| PreConnect | dostawca | `/dostawca/instrukcja/preconnect` |
| Spotkania B2B 2027 | dostawca | `/dostawca/instrukcja/spotkania-b2b` |
| PreConnect | kupiec | `/kupiec/instrukcja/preconnect` |
| Spotkania B2B 2027 | kupiec | `/kupiec/instrukcja/spotkania-b2b` |
| PreConnect — administrator | admin | `/admin/instrukcja/preconnect` (`?rola=dostawca` / `?rola=kupiec` = wersja uczestnika) |
| Spotkania B2B 2027 — administrator | admin | `/admin/instrukcja/spotkania-b2b` (j.w.) |
| Archiwum instrukcji 2026 (HTML z Brandingu) | każda | `/…/instrukcja/archiwum-2026` (admin: `?rola=`) |

`?print=1` na dowolnym z tych adresów = strona bez menu, do wydruku.

## 2. Menu

- **Dostawca i kupiec**, sekcja PRECONNECT: „Instrukcja" → **„Instrukcja PreConnect"**. Sekcja FRESH MARKET 2026 (etykieta bez zmian), pod spotkaniami: **„Instrukcja spotkań B2B"** — działa zawsze, także przy kłódce; nie odblokowuje spotkań.
- **Admin**: „Instrukcja administratora PreConnect" (Operacyjne, pod Wiadomościami), „Instrukcja administratora spotkań B2B 2027" (pod „FM Spotkania B2B"). Przełącznik **Administrator / Dostawca / Kupiec** na stronie — bez logowania jako uczestnik, bez zmiany profilu.
- **Podgląd konta** (▼): instrukcje odpowiadają podglądanej roli; przełącznika wtedy nie ma.
- Stary klucz `instructions` → instrukcja PreConnect właściwa dla panelu. Język = ustawienie PL/EN użytkownika.

## 3. Treść

Tylko rzeczywiste działanie aplikacji (teksty interfejsu, kod modułów, dokumenty w `docs/`). Zasady B2B = zasady z 2026 opisane jako obowiązujące (§0a). Dane edycji 2027, których jeszcze nie ma w aplikacji, są w ramce „Do ustalenia przez organizatora" — **tylko w wersji administratora** (test); uczestnicy czytają „informacja zostanie podana przez organizatora". Pliki: `src/content/instructions/*.js`.

## 4. Testy i build

| zestaw | wynik |
|---|---|
| `tests/instructions-routes.test.js` — adresy (w tym archiwum), parametr roli, stary klucz, rok edycji = stała, brak modułu `fm-edition` | 9/9 |
| `src/components/instructions/InstructionPage.test.jsx` — komplet 12 dokumentów, PL↔EN, brak pytań/PIN-ów/linków u uczestników, archiwum 2026 w treści, nota o edycji, odnośnik do archiwum zamiast HTML, strona archiwum, izolacja wydruku, zrzuty istnieją | 28/28 |
| całość (`npx vitest run`, z PGlite) | 788/788 (+1 jawnie pominięty) |
| `npm run build`, `git diff --check` | OK |

**Kontrola w przeglądarce** (serwer dev, konta testowe przez magic link): dostawca i kupiec — menu, kłódka, instrukcja spotkań mimo kłódki, bezpośrednie adresy po przeładowaniu, Wstecz, PL→EN, 375 px bez poziomego przewijania, strona archiwum z HTML z bazy i powrotem, `?print=1` bez menu. **Administrator — sprawdzony** (punkt 4 wyżej). Po kontroli treść dwóch instrukcji administratora poprawiona o zmiany z wersji 2 (opis sekcji Brandingu jako archiwum; rok instrukcji niezależny od konfiguracji wydarzenia; pytanie o podział mailingu usunięte).

**Wydruk**: aktualny komplet 24 PDF w `C:\Users\Artur\AppData\Local\Temp\pdf3\` (poza repozytorium; wygenerowany po zmianie z §0a, obejrzane wszystkie strony). Uwaga z archiwum: w pierwszym przebiegu wersja PL dostawcy w Brandingu była pusta („Brak zapisanej treści archiwalnej"); przy przebiegu ~17:50 ma już treść w bazie („PreConnect — instrukcja dla dostawcy”, ok. 8,5 tys. znaków, 5 stron PDF) — nie zmieniałem tego pola, treść pochodzi z `fm_settings.ui_content`. Wersja EN dostawcy i obie wersje kupca mają treść.

## 5. Zrzuty ekranu

`public/instrukcje/` — 14 plików z kont testowych (ZZZ TEST Dostawca, Test Kupiec, sieć ZZZ TEST 2) i z panelu admina ograniczonego do encji testowych; adresy testowe zamaskowane; bez PIN-ów i linków logowania. Brak zrzutów listy propozycji u kupca z treścią (sieć testowa nieaktywna → lista pusta) i ekranów spotkań (moduł zamknięty).

## 6. Do potwierdzenia przed publikacją

1. **Edycja 2027 w instrukcji**: stała `B2B_INSTRUCTION_EDITION_YEAR = 2027` — potwierdź, że instrukcja B2B ma już dziś mówić o 2027 (moduł w aplikacji nadal pokazuje 2026).
2. Konfiguracja wydarzenia 2027 (data, miejsce, otwarcie i zamknięcie wyborów, publikacja planu) — osobna decyzja, nie dotykana w tej zmianie; do czasu wpisania uczestnicy czytają „informacja zostanie podana przez organizatora".
3. ~~Zasady pakietów i pierwszeństwo wg daty opłaty bez zmian w 2027?~~ **Rozstrzygnięte 30.10**: zasady z 2026 są podstawą (§0a).
4. Rejestracja na freshmarket.eu a automatyczne włączanie Spotkań B2B w panelu.
5. Lista sieci 2027 i kupców.
6. Ręczny wybór sieci dla firm powracających (gałąź z 2026).
7. Pole „Archiwum instrukcji 2026 (treść HTML)" w Brandingu: zostawić (zalecane, treść w bazie nienaruszona) czy kiedyś wyczyścić.
8. ~~Uwaga do PDF-ów z §4~~ **Zrobione 30.10 ~17:50**: komplet 24 PDF wygenerowany ponownie z aktualnej wersji i sprawdzony (§0a), w tym poprawka pustej strony w druku.

## 7. Wdrożenie (po zgodzie) i wycofanie

Bez migracji, bez zmian danych. Deploy = push gałęzi na `main` (fast-forward od `988d095`), kontrola `/version.json`, wejście na konto testowe dostawcy i kupca oraz na własne konto admina. Wycofanie: Netlify „Publish deploy" poprzedniej wersji (`988d095`); HTML w Brandingu nieruszony, stara „Instrukcja" wraca bez zmian.
