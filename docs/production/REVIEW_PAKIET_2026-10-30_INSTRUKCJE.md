# Pakiet do review — rozdzielenie instrukcji PreConnect i Spotkań B2B (30.10.2026, wersja 2)

Gałąź **`feat/instructions-split`** od `origin/main` = `988d095`. Commity: `d7d3828` (wersja 1), `4de6c5f` (docs v1), **wersja 2 = ostatni commit gałęzi** (poprawki po ocenie raportu).
**Nic nie wdrożono, nic nie scalono do `main`.** Dane produkcyjne: na czas zrzutów ekranu **tymczasowo zmieniono aktywność kont testowych** (firma ZZZ TEST Dostawca: wstrzymana → aktywna → wstrzymana; sieć ZZZ TEST 2 pozostała nieaktywna), **następnie przywrócono poprzedni stan**. Każda zmiana statusu firmy wysłała automatyczny e-mail na alias testowy `+dostawca`. Poza tym żadnych zmian danych.

## 0. Co zmieniło się w wersji 2 (odpowiedź na ocenę raportu)

| uwaga | co zrobiono |
|---|---|
| 1. Edycja instrukcji ≠ aktywna konfiguracja spotkań | Rok instrukcji B2B to **stała treści** `B2B_INSTRUCTION_EDITION_YEAR = 2027` (`src/content/instructions/index.js`). Moduł czytający rok z `fm_settings.event_date` **usunięty**; etykiety aktywnej edycji w menu („Fresh Market 2026", „Spotkania FM 2026") **wróciły do dotychczasowych literałów**. Dat, faz i planów 2026 nie dotykamy. Instrukcje B2B mają na górze notę: „Instrukcja dotyczy edycji 2027. Terminy i zasady tej edycji ogłasza organizator — nie wynikają z dat widocznych dziś w module spotkań." Niepotwierdzone zasady są wyłącznie w ramce dla administratora. Test pilnuje, że moduł `fm-edition` nie istnieje. |
| 2. Połączona instrukcja 2026 poza PreConnect | Wyjęta z instrukcji PreConnect (także ze zwiniętej sekcji). Jest **osobna strona „Archiwum instrukcji 2026"** z własnym adresem (`/…/instrukcja/archiwum-2026`), ostrzeżeniem „nie opisuje bieżącej edycji", przyciskiem wydruku i powrotem; odnośnik do niej tylko w stopce instrukcji PreConnect. Treść w bazie nietknięta. Test pilnuje, że instrukcja PreConnect nie renderuje żadnego HTML z bazy. |
| 3. Branding → Instrukcje | Sekcja nazywa się teraz **„Archiwum instrukcji 2026 (treść HTML)"**, z opisem: to pole nie jest bieżącą instrukcją, widać je tylko pod „Archiwum instrukcji 2026"; bieżące instrukcje to pliki `src/content/instructions/*.js` (zmiana = kod + wdrożenie). Podgląd w Brandingu podpisany tak samo. |
| 4. Administrator w przeglądarce | **Nie wykonane** — wymaga zalogowania Twoim kontem admina na `localhost:5173` (jedyny admin; nie loguję się jako Ty). Serwer dev działa; po Twoim zalogowaniu sprawdzę oba wejścia, trzy role, PL/EN, adresy i podgląd uczestnika. Kod ścieżki admina jest pokryty testami jednostkowymi adresów i komponentu. |
| 5. Rzeczywisty wydruk do PDF | Zrobiony: 12 plików PDF (dostawca i kupiec × PreConnect, Spotkania B2B, Archiwum 2026 × PL/EN) wygenerowanych **prawdziwym silnikiem druku Chrome** (`scripts/instructions-pdf.mjs`, CDP `Page.printToPDF`), obejrzanych strona po stronie: bez menu i paska panelu, bez uciętych tekstów i zrzutów, rozdziały nierozrywane. Mechanizm wydruku przepisany: zamiast `visibility`+`position:absolute` (ucina wielostronicowy druk) — chowanie reszty strony na czas druku (`print-isolation.js`), tryb `?print=1`, zrzuty ładowane od razu. Przycisk nazywa się **„Drukuj / zapisz jako PDF"**, podpowiedź mówi o oknie drukowania. Administrator: 6 PDF do wygenerowania po Twoim zalogowaniu (ten sam skrypt). |
| 6. Zrzuty | Przejrzane. Adresy testowe `artur.stasiak+…` **zamaskowane** (`kupiec@przyklad.pl` / `dostawca@przyklad.pl`) na trzech zrzutach, gdzie występowały (profil kupca, Firmy, historia mailingu). Linków logowania i PIN-ów brak (test treści). Zrzut listy sieci u dostawcy zostaje z podpisem: „zrzut z 2026 … bieżąca lista sieci PreConnect, nie lista uczestników wydarzenia". |
| Podział mailingu wg kategorii | Poza zakresem; instrukcja kupca opisuje stan dzisiejszy, bez obietnic. Z listy pytań usunięte. |

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

Tylko rzeczywiste działanie aplikacji (teksty interfejsu, kod modułów, dokumenty w `docs/`). Rzeczy niepotwierdzone dla 2027 są w ramce „Do potwierdzenia przez organizatora" — **tylko w wersji administratora** (test). Pliki: `src/content/instructions/*.js`.

## 4. Testy i build

| zestaw | wynik |
|---|---|
| `tests/instructions-routes.test.js` — adresy (w tym archiwum), parametr roli, stary klucz, rok edycji = stała, brak modułu `fm-edition` | 9/9 |
| `src/components/instructions/InstructionPage.test.jsx` — komplet 12 dokumentów, PL↔EN, brak pytań/PIN-ów/linków u uczestników, archiwum 2026 w treści, nota o edycji, odnośnik do archiwum zamiast HTML, strona archiwum, izolacja wydruku, zrzuty istnieją | 28/28 |
| całość (`npx vitest run`, z PGlite) | 788/788 (+1 jawnie pominięty) |
| `npm run build`, `git diff --check` | OK |

**Kontrola w przeglądarce** (serwer dev, konta testowe przez magic link): dostawca i kupiec — menu, kłódka, instrukcja spotkań mimo kłódki, bezpośrednie adresy po przeładowaniu, Wstecz, PL→EN, 375 px bez poziomego przewijania, strona archiwum z HTML z bazy i powrotem, `?print=1` bez menu. **Administrator — czeka na Twoje logowanie** (punkt 4 wyżej).

**Wydruk**: 12 PDF w `C:\Users\Artur\AppData\Local\Temp\pdf\` (poza repozytorium), obejrzane wszystkie strony. Uwaga z archiwum: wersja PL dostawcy w Brandingu jest pusta (strona pokazuje „Brak zapisanej treści archiwalnej"), wersja EN dostawcy i obie wersje kupca mają treść.

## 5. Zrzuty ekranu

`public/instrukcje/` — 14 plików z kont testowych (ZZZ TEST Dostawca, Test Kupiec, sieć ZZZ TEST 2) i z panelu admina ograniczonego do encji testowych; adresy testowe zamaskowane; bez PIN-ów i linków logowania. Brak zrzutów listy propozycji u kupca z treścią (sieć testowa nieaktywna → lista pusta) i ekranów spotkań (moduł zamknięty).

## 6. Do potwierdzenia przed publikacją

1. **Edycja 2027 w instrukcji**: stała `B2B_INSTRUCTION_EDITION_YEAR = 2027` — potwierdź, że instrukcja B2B ma już dziś mówić o 2027 (moduł w aplikacji nadal pokazuje 2026).
2. Konfiguracja wydarzenia 2027 (data, miejsce, otwarcie i zamknięcie wyborów) — osobna decyzja, nie dotykana w tej zmianie.
3. Zasady pakietów i pierwszeństwo wg daty opłaty bez zmian w 2027?
4. Rejestracja na freshmarket.eu a automatyczne włączanie Spotkań B2B w panelu.
5. Lista sieci 2027 i kupców.
6. Ręczny wybór sieci dla firm powracających (gałąź z 2026).
7. Pole „Archiwum instrukcji 2026 (treść HTML)" w Brandingu: zostawić (zalecane, treść w bazie nienaruszona) czy kiedyś wyczyścić.

## 7. Wdrożenie (po zgodzie) i wycofanie

Bez migracji, bez zmian danych. Deploy = push gałęzi na `main` (fast-forward od `988d095`), kontrola `/version.json`, wejście na konto testowe dostawcy i kupca oraz na własne konto admina. Wycofanie: Netlify „Publish deploy" poprzedniej wersji (`988d095`); HTML w Brandingu nieruszony, stara „Instrukcja" wraca bez zmian.
