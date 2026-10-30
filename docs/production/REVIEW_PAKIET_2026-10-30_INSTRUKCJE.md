# Pakiet do review — rozdzielenie instrukcji PreConnect i Spotkań B2B (30.10.2026)

Gałąź **`feat/instructions-split`** od `origin/main` = `988d095`. Commit zmiany: **`d7d3828`** (ten dokument — osobny commit).
**Nic nie wdrożono, nic nie scalono do `main`, żadnych zmian danych produkcyjnych.** Wdrożenie dopiero po osobnej zgodzie Artura.

## 1. Co było, co jest

**Było:** jedna pozycja „Instrukcja" w menu dostawcy i kupca, pokazująca HTML wpisany przez organizatora w Branding → Instrukcje. Treść w bazie (per rola PL/EN) to jeden połączony dokument „CZĘŚĆ I — Spotkania B2B 2026 / CZĘŚĆ II — PreConnect" z terminami 2026. Admin nie miał żadnej instrukcji.

**Jest:** sześć instrukcji w aplikacji (treść w repozytorium, PL i EN), każda z własnym adresem, spisem treści, ponumerowanymi krokami, zrzutami z kont testowych i przyciskiem „Pobierz PDF / drukuj".

| dokument | rola | adres |
|---|---|---|
| PreConnect | dostawca | `/dostawca/instrukcja/preconnect` |
| Spotkania B2B | dostawca | `/dostawca/instrukcja/spotkania-b2b` |
| PreConnect | kupiec | `/kupiec/instrukcja/preconnect` |
| Spotkania B2B | kupiec | `/kupiec/instrukcja/spotkania-b2b` |
| PreConnect — administrator | admin | `/admin/instrukcja/preconnect` (`?rola=dostawca` / `?rola=kupiec` = wersja uczestnika) |
| Spotkania B2B — administrator | admin | `/admin/instrukcja/spotkania-b2b` (j.w.) |

## 2. Menu

- **Dostawca i kupiec**, sekcja PRECONNECT: „Instrukcja" → **„Instrukcja PreConnect"** (otwiera od razu dokument PreConnect dla tej roli).
- Sekcja FRESH MARKET {rok}, bezpośrednio pod spotkaniami: **„Instrukcja spotkań B2B"** — działa zawsze, także gdy spotkania mają kłódkę (faza zamknięta lub firma bez włączonych Spotkań B2B). Nie odblokowuje spotkań.
- **Admin**: „Instrukcja administratora PreConnect" w grupie Operacyjne (pod Wiadomościami), „Instrukcja administratora spotkań B2B {rok}" pod „FM Spotkania B2B". Na stronie przełącznik **Administrator / Dostawca / Kupiec** — admin czyta dokładnie tę wersję, którą widzi uczestnik, bez logowania jako uczestnik i bez zmiany jego profilu.
- **Podgląd konta** (przełącznik kont ▼): instrukcje odpowiadają podglądanej roli; przełącznika wersji wtedy nie ma (celowo).
- **Stary klucz** `instructions` (gdyby gdzieś został link) → instrukcja PreConnect właściwa dla panelu.
- Wersja językowa = ustawienie PL/EN użytkownika (nazwy pozycji menu, przyciski, treść).

## 3. Treść — na czym oparta

Tylko rzeczywiste działanie aplikacji: teksty interfejsu (`src/i18n`), kod modułów (PreconnectFM, FM, kredyty, webhook) i dokumenty w `docs/` (kompendia 2026). **Nie wymyślono terminów, limitów ani funkcji.** Rzeczy niepotwierdzone dla edycji {rok} są w sekcji „Do potwierdzenia przez organizatora" — **widocznej wyłącznie w wersji administratora** (test pilnuje, że uczestnik ich nie dostaje).

Zakres (jak w zleceniu): dostawca PreConnect — profil i kontakty handlowe, propozycje, wybór sieci, wysyłki, kredyty, odczyty, kontakt z kupcem; kupiec PreConnect — przeglądanie, kategorie, powiadomienia, kontakt z dostawcą; dostawca B2B — pakiety, wybór sieci, preferencje, przydział, plan, dzień wydarzenia; kupiec B2B — odpowiedzi, preferencje, stanowiska, plan.

Pliki: `src/content/instructions/*.js` (6 plików × PL/EN), rejestr `index.js`.

## 4. Strona i wygląd

`src/components/instructions/InstructionPage.jsx` + `.css`: nagłówek (tytuł, rola, data aktualizacji), przyciski „Pobierz PDF / drukuj" (okno drukowania → „Zapisz jako PDF") i „Kopiuj link", spis treści (2 kolumny, na telefonie 1), rozdziały z numerowanymi krokami, ramki „Uwaga", zrzuty, zwijane „Archiwum: edycja 2026", ramka pytań (admin). CSS `@media print` chowa menu i pasek panelu. Sprawdzone na 375 px (brak poziomego przewijania), tablet/desktop w panelu.

**HTML z Brandingu** nie zniknął: jest na końcu instrukcji PreConnect uczestnika jako zwinięta sekcja „Dotychczasowa treść „Instrukcja" z Brandingu (archiwum)". Nie pokazujemy go na górze, bo to właśnie on jest połączoną instrukcją. Decyzja do podjęcia: wyczyścić pole w Brandingu (wtedy sekcja znika) albo wpisać tam krótką informację organizatora.

## 5. Edycja wydarzenia i archiwum 2026

- Rok edycji w etykietach menu („Fresh Market {rok}", „Spotkania FM {rok}") i w tytułach instrukcji B2B wynika z **istniejącej konfiguracji**: `fm_settings.event_date` (`src/lib/fm-edition.js`). Dziś data wydarzenia w bazie = 2026 → etykiety i tytuły pokazują **2026**, dokładnie jak dotąd. Nic nie podmieniono globalnie; daty, faza, harmonogram, plany i historia spotkań nietknięte.
- Gdy organizator wpisze datę wydarzenia 2027 w konfiguracji FM, menu i tytuły przełączą się na 2027 bez zmian w kodzie. **Osobna decyzja:** konfiguracja 2027 nie jest gotowa (data wydarzenia, data otwarcia wyborów, termin zamknięcia) — patrz lista pytań w §8.
- Pozostałe wystąpienia „2026" w aplikacji (ekran blokady, bloki na Dashboardzie, teksty faz, kompendia) zostają — są wypisane jako pytanie do organizatora w instrukcji administratora.
- Materiały 2026 w instrukcjach B2B: sekcja „Archiwum: edycja 2026" (harmonogram, zasady, miejsce) z adnotacją, że terminy {rok} ogłasza organizator.

## 6. Testy i build

| zestaw | wynik |
|---|---|
| `tests/instructions-routes.test.js` — adresy, parametr roli (uczestnik nie może podejrzeć wersji admina), stary klucz, rok edycji | 9/9 |
| `src/components/instructions/InstructionPage.test.jsx` — komplet 12 dokumentów, zgodność PL↔EN (te same rozdziały i liczba kroków), brak pytań/PIN-ów/linków logowania u uczestników, archiwum 2026, rok w tytułach, przełącznik admina, drukowanie, HTML z Brandingu tylko w PreConnect uczestnika, istnienie każdego zrzutu | 22/22 |
| całość (`npx vitest run`, z PGlite) | 782/782 (+1 jawnie pominięty) |
| `npm run build`, `git diff --check` | OK |

**Kontrola w przeglądarce (serwer dev, konta testowe):** kupiec — menu z obiema pozycjami, kłódka na spotkaniach, instrukcja spotkań otwiera się mimo kłódki, bezpośredni adres `/kupiec/instrukcja/preconnect` otwiera dokument po przeładowaniu, podświetlenie w menu, przycisk Wstecz wraca do poprzedniej instrukcji / panelu, PL→EN zmienia treść i etykiety, widok 375 px bez poziomego przewijania; dostawca — to samo, dokumenty dostawcy. **Nie sprawdzono w przeglądarce:** widok administratora (wymaga Twojego logowania na `localhost:5173` — serwer dev jest uruchomiony; adres `/admin/instrukcja/preconnect`) i wydruk do PDF (tylko CSS + przycisk; okna drukowania nie da się zautomatyzować).

## 7. Zrzuty ekranu

`public/instrukcje/` — 13 plików z kont testowych (ZZZ TEST Dostawca, Test Kupiec, sieć ZZZ TEST 2) i z panelu admina ograniczonego do encji testowych; bez PIN-ów, linków logowania i danych uczestników. Jedyny wyjątek: `preconnect-dostawca-wysylki.jpg` pokazuje publiczną listę sieci handlowych (nazwy sieci, bez osób) — jeśli to za dużo, usuń plik i wpis `figure` w rozdziale „wysylka"; test wskaże brakujący plik.
Nie udało się zrobić zrzutu listy propozycji u kupca z treścią (sieć testowa nieaktywna → lista pusta) ani ekranów spotkań (moduł zamknięty) — rozdziały te są bez zrzutów.

Po zrzutach firma testowa została ponownie **wstrzymana**, sieć testowa jest **nieaktywna** (stan sprzed próby).

## 8. Do potwierdzenia przed publikacją

1. **Konfiguracja edycji 2027**: data i miejsce wydarzenia (od tego zależy rok w menu i tytułach), data otwarcia wyborów, termin zamknięcia, publikacja planu. Dziś w bazie 2026.
2. Czy zasada pakietów (5 sieci głównych na pakiet Business, rezerwowe bez limitu) i pierwszeństwo wg daty opłaty obowiązują bez zmian w 2027.
3. Czy rejestracja na freshmarket.eu ma automatycznie włączać Spotkania B2B i pakiety w panelu, czy nadal ręcznie.
4. Lista sieci 2027 i ich kupców do oznaczenia w Sieciach przed otwarciem wyborów.
5. Czy użyć ręcznego wyboru sieci dla firm powracających (gałąź z 2026, niewdrożona).
6. Pole „Instrukcje" w Brandingu: wyczyścić czy zostawić jako krótką informację organizatora (dziś: długa połączona instrukcja 2026, pokazywana jako zwinięte archiwum).
7. Mailing PreConnect: jedna treść dla wszystkich kupców sieci czy podział według kategorii (dziś wszyscy dostają wszystko) — instrukcja kupca opisuje stan dzisiejszy.
8. Zrzut `preconnect-dostawca-wysylki.jpg` (publiczne nazwy sieci) — zostawić czy usunąć.

## 9. Wdrożenie (po zgodzie) i wycofanie

Bez migracji, bez zmian danych. Deploy = push gałęzi na `main` (fast-forward od `988d095`), kontrola `/version.json`, potem wejście na konto testowe dostawcy i kupca oraz na własne konto admina. Wycofanie: Netlify „Publish deploy" poprzedniej wersji (`988d095`). Stary HTML w Brandingu nie jest ruszany, więc po wycofaniu stara „Instrukcja" wraca bez zmian.
