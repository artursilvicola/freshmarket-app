# Fresh Market 2026 — Kampania Stoisk v2.0
## Import do Google Ads Editor — instrukcja krok po kroku

---

## Co jest w tym folderze

| Plik | Co zawiera | Liczba wierszy |
|---|---|---|
| `01_Campaigns.csv` | 3 kampanie (Search PL, Search EN, Brand) | 3 |
| `02_Ad_Groups.csv` | 5 grup reklam (po 2 per Search PL/EN + 1 Brand) | 5 |
| `03_Keywords.csv` | 29 słów kluczowych (Exact + Phrase) | 29 |
| `04_Negative_Keywords.csv` | 26 negatywów × 3 kampanie = 78 | 78 |
| `05_Responsive_Search_Ads.csv` | 5 reklam RSA (15 headlines + 4 descriptions każda, z pinowaniem) | 5 |
| `06_Sitelinks.csv` | 15 sitelinków (EN + PL + Brand) | 15 |
| `07_Callouts.csv` | 18 callouts (EN + PL + Brand) | 18 |
| `08_Structured_Snippets.csv` | 5 structured snippets | 5 |

**Wszystkie kampanie, grupy, słowa kluczowe i reklamy są w statusie „Paused" (Wstrzymane).** Nic nie ruszy po imporcie — dopiero gdy ręcznie je włączysz w panelu po weryfikacji.

---

## Przygotowanie — pobranie i instalacja Google Ads Editor

1. Pobierz program: https://ads.google.com/intl/pl_pl/home/tools/ads-editor/
2. Zainstaluj na Windows/Mac.
3. Uruchom, zaloguj się mailem `freshmarket@freshmarket.eu` (bo to ten mail ma dostęp administratora do konta 895-780-5133).
4. Wybierz konto **895-780-5133** i kliknij „Pobierz" — zaczyta wszystkie istniejące kampanie z panelu.

---

## Import — kolejność obowiązkowa

Google Ads Editor wymaga, żeby importować zasoby **w tej kolejności**, bo każdy następny zależy od poprzedniego (nie można dodać grupy reklam bez kampanii, słów kluczowych bez grupy, itd.):

### Krok 1: Kampanie
1. W Ads Editor przejdź do **Plik → Importuj → Z pliku...** (albo Ctrl+I).
2. Wskaż plik `01_Campaigns.csv`.
3. W oknie podglądu zaznacz „Make these changes" i potwierdź.
4. Sprawdź w drzewku po lewej — powinny pojawić się 3 nowe kampanie wstrzymane.

### Krok 2: Grupy reklam
- Importuj `02_Ad_Groups.csv` tą samą metodą.

### Krok 3: Słowa kluczowe (pozytywne)
- Importuj `03_Keywords.csv`.

### Krok 4: Słowa kluczowe wykluczające
- Importuj `04_Negative_Keywords.csv`.
- Zastosowane na poziomie kampanii (nie grupy).

### Krok 5: Reklamy RSA
- Importuj `05_Responsive_Search_Ads.csv`.
- **Ważne:** w tym pliku nagłówki H1, H2, H3 mają pinowanie na pozycje 1, 2, 3. Opisy D1, D2 pinowane na pozycje 1, 2. To świadoma decyzja, żeby nagłówek „Fresh Market 2026" zawsze był pierwszy.

### Krok 6: Rozszerzenia
- Importuj kolejno: `06_Sitelinks.csv`, `07_Callouts.csv`, `08_Structured_Snippets.csv`.

### Krok 7: Publikacja do panelu
1. Kliknij **Opublikuj** (przycisk w prawym górnym rogu) lub Ctrl+P.
2. Ads Editor pokaże listę zmian do wysłania — sprawdź czy wszystko się zgadza.
3. Potwierdź — zmiany pójdą do panelu Google Ads.

---

## Co sprawdzić PO imporcie (zanim cokolwiek włączysz)

- [ ] Kampanie widoczne w panelu, status: Wstrzymana
- [ ] Budżet: Search PL 8 zł/dzień, Search EN 7 zł/dzień, Brand 3 zł/dzień
- [ ] Geotargetowanie działa: Search PL → Polska; Search EN → Europa
- [ ] Język: Search PL → polski; Search EN → angielski; Brand → oba
- [ ] Wszystkie słowa kluczowe załadowane z poprawnym match type
- [ ] RSA: pełne 15 nagłówków + 4 opisy, pinowanie działa (sprawdź w preview)
- [ ] Sitelinki, callouts, snippets przypisane do właściwych kampanii
- [ ] Negative list wgrana do wszystkich 3 kampanii
- [ ] Final URL poprawne:
  - Search PL → https://freshmarket.eu/pl/exhibitors
  - Search EN → https://freshmarket.eu/exhibitors
  - Brand → https://freshmarket.eu/exhibitors
- [ ] Sitelinki prowadzą do stron, które istnieją (sprawdź `/venue`, `/exhibitors-hub`, `/contact`)

---

## Zanim włączysz kampanie

1. **Podepnij kartę** firmową w ustawieniach konta 895-780-5133 (**Płatności → Metody płatności**). Bez ważnej karty Google odmówi uruchomienia.
2. **Dodaj zdjęcia** do grup reklam przez panel Google Ads (CSV tego nie obsługuje — trzeba ręcznie w panelu):
   - `Kopia 0186_R6M29996_happymoon.pl_www.jpg` — skala strefy wystawców
   - `Kopia 0179_R6M29977_happymoon.pl_www.jpg` — ruch i expo
   - `Kopia 0173_R6M29947_happymoon.pl_www.jpg` — stoisko z brandingiem
   - `Kopia 0168_R6M29932_happymoon.pl_www.jpg` — ekspozycja produktu
   - `Kopia 0126_R6M29752_happymoon.pl_www.jpg` — kontakt przy stoisku
3. **Dodaj logo** Fresh Market (PNG, tło transparentne, min. 128×128 px) jako asset konta.
4. **Ustaw conversion tracking** dla formularza rezerwacji stoiska — zdarzenie `stand_form_submit` (osobne od rejestracji B2B).
5. **Uruchom kampanie pojedynczo** — nie wszystkie naraz. Najpierw Search PL, obserwuj 3-5 dni, potem Search EN, potem Brand.

---

## Polskie znaki — UWAGA

Pliki CSV **nie zawierają polskich diakrytyków** (ą, ę, ś, ć, ź, ż, ł, ó, ń) — wszystkie zostały zastąpione odpowiednikami bez ogonków, żeby uniknąć problemów z kodowaniem w Google Ads Editor.

**Po imporcie musisz ręcznie dodać polskie znaki** w tych miejscach:

### Nagłówki reklam PL (Search PL → High Intent PL i Mid Intent PL):
- „Wystaw sie" → „Wystaw się"
- „Zarezerwuj stoisko 2026" — OK, bez zmian
- „wrzesnia" → „września"
- „Pokaz marke branzy" → „Pokaż markę branży"
- „na zywo" → „na żywo"
- „Dotrzyj do branzy" → „Dotrzyj do branży"
- „Stoisko dostepne" → „Stoisko dostępne"
- „glownej" → „głównej"
- „caly dzien" → „cały dzień"
- „jeden dzien" → „jeden dzień"

### Opisy PL:
- „Branza fresh" → „Branża fresh"
- „uslugi" → „usługi"
- „Wystaw sie" → „Wystaw się"
- „wczesniejsza rezerwacja" → „wcześniejsza rezerwacja"
- „lepsza lokalizacje" → „lepszą lokalizację"
- „uczestnikow" → „uczestników"
- „caly dzien" → „cały dzień"

### Słowa kluczowe PL:
- „wystaw sie" → „wystaw się"
- „owocow" → „owoców"
- „targow" → „targów"
- „branzowe" → „branżowe"
- „branza" → „branża"
- „produktow" → „produktów"
- „spozywcza" → „spożywcza"

Najszybciej: w Google Ads Editor → **Edytuj → Znajdź i zamień** (Ctrl+H).

---

## Remarketing — OSOBNO, PÓŹNIEJ

Kampania **Stands — Remarketing** NIE jest w tym imporcie, bo wymaga najpierw:
1. Instalacji tagu remarketingowego na stronie (Google Tag Manager).
2. Zebrania listy odbiorców „odwiedzający `/exhibitors` i `/venue`" — minimum 100 użytkowników zanim można ją użyć.
3. Wykluczenia konwertowanych (zdarzenie `stand_form_submit`).

Uruchamiamy ją po 2-3 tygodniach od startu Search, gdy zbierzemy ruch.

---

## Pytania lub problemy

Jeśli przy imporcie coś się sypie (Google Ads Editor pokaże błąd):
1. Zanotuj treść błędu i który plik importowałeś.
2. Otwórz plik w Excelu — sprawdź, czy polskie znaki są dobrze widoczne (powinny być odpowiedniki łacińskie — wybraliśmy tę wersję celowo).
3. Napisz mi, co wyrzuca, dopracujemy plik i ponowimy.

---

**Dokument planu kampanii (pełna specyfikacja):**
`Plan_kampanii_Wystawcy_FM2026.docx` (folder nadrzędny)
