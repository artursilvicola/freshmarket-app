# Testy aplikacji Fresh Market przed produkcją

Instrukcja krok po kroku dla admina (nie programisty). Przejdź każdy test po kolei, odhacz `[x]` jak działa. Jeśli coś nie działa — zrób screenshot i opisz w komentarzu.

**Aplikacja:** https://b2b.freshmarket.eu
**Czas:** ~3 godziny pełnego testu, można rozłożyć na 2 dni

---

## 0. Przygotowanie (15 min)

### 0.1 Sprawdź czy masz dostęp do paneli

- [ ] Panel admina aplikacji: zaloguj się na `https://b2b.freshmarket.eu/login` jako `artur@kjow.pl` → powinieneś trafić na `/admin`
- [ ] Supabase SQL Editor: https://supabase.com/dashboard/project/sklyfuvzjikkqerxtulo/sql/new (admin może potrzebować przy testach)
- [ ] Twoja skrzynka mailowa (`artur@kjow.pl`) — żeby zobaczyć maile testowe

### 0.2 Przygotuj 3 konta testowe

Otwórz `https://supabase.com/dashboard/project/sklyfuvzjikkqerxtulo/sql/new`, skopiuj zawartość pliku `supabase/tests/e2e_create_test_accounts.sql` z repo, wklej i kliknij **Run**.

Po wykonaniu masz 3 konta:

| Email | Hasło | Rola |
|---|---|---|
| `codex.admin@freshmarket.test` | `CodexAdmin2026!` | Admin |
| `codex.supplier@freshmarket.test` | `CodexSupplier2026!` | Dostawca (Food Market) |
| `codex.buyer@freshmarket.test` | `CodexBuyer2026!` | Kupiec (Biedronka) |

- [ ] Wszystkie 3 konta zalogowały się bez problemu
- [ ] Po zalogowaniu każda rola trafia na właściwy panel: admin→`/admin`, dostawca→`/dostawca`, kupiec→`/kupiec`

### 0.3 Otwórz 3 okna przeglądarki (najlepiej w trybie incognito)

To pozwoli Ci być zalogowanym jako 3 różne osoby naraz i przełączać się między nimi. Inaczej musisz cały czas się wylogowywać.

- [ ] Okno 1: jako admin
- [ ] Okno 2: jako dostawca
- [ ] Okno 3: jako kupiec

---

## 1. PreConnect (moduł całoroczny — wysyłka ofert)

PreConnect to platforma, gdzie dostawca przygotowuje **propozycję asortymentową** i wysyła ją do konkretnej sieci handlowej. Sieć (kupiec) dostaje mail i widzi ofertę w swoim panelu. Po otwarciu kredyt z pakietu dostawcy jest pobierany. Jeśli kupiec nie otworzy w 14 dni — kredyt wraca do dostawcy.

### 1.1 Rejestracja nowego dostawcy (5 min)

W oknie incognito (NIE zalogowany):

1. Wejdź na `https://b2b.freshmarket.eu/login`
2. Kliknij na dole **„Zarejestruj firmę"**
3. Wypełnij formularz testowymi danymi:
   - Email służbowy: użyj swojego maila z dopiskiem (np. `artur+test1@kjow.pl`)
   - Hasło: minimum 8 znaków
   - Nazwa firmy: „Test Dostawca 1"
   - Kraj, kontakt, NIP, telefon — dowolne
   - Zaakceptuj checkbox
4. Kliknij **„Zarejestruj firmę"**

Sprawdź:
- [ ] Po sukcesie pojawia się komunikat „Rejestracja przyjęta" i automatycznie loguje na `/dostawca`
- [ ] Na dashboardzie widzisz **pomarańczowy banner**: „Konto czeka na zatwierdzenie przez administratora"
- [ ] Sidebar po lewej ma zablokowane (kłódka 🔒) pozycje „Wysyłki" i „Finanse"
- [ ] Możesz wypełnić profil firmy, dodać logo, dodać propozycję w szkicu — ale nie możesz wysłać

### 1.2 Aktywacja konta przez admina (3 min)

Przełącz się na okno admina:

1. W sidebar **Firmy** → znajdź „Test Dostawca 1" (powinien być na górze z pomarańczowym badge „Oczekuje")
2. Rozwiń kartę firmy → kliknij **„Aktywuj konto"** (przycisk po prawej)
3. Sprawdź czy status zmienił się na „Aktywne"

Sprawdź:
- [ ] W panelu Firmy widzisz nową firmę „Test Dostawca 1" z badge „Oczekuje"
- [ ] Po kliknięciu „Aktywuj" status zmienia się na zielony „Aktywne"
- [ ] Konto dostaje dostęp do PreConnect (pole `preconnect_enabled = true`)

Wróć do okna dostawcy:
- [ ] Po odświeżeniu (F5) banner „Konto czeka" znika
- [ ] Sidebar odblokował „Wysyłki" i „Finanse"

### 1.3 Dodanie propozycji asortymentowej (10 min)

Jako dostawca (`codex.supplier@freshmarket.test` lub Twoja testowa firma):

1. Sidebar → **Moje propozycje** → **„Dodaj propozycję asortymentową"**
2. **Krok 1 (Produkt):** wypełnij wszystkie wymagane pola czerwoną gwiazdką:
   - Produkt: „Jabłka Gala premium"
   - Odmiana: „Gala"
   - Kategoria: Owoce
   - Pochodzenie: Polska
   - Typ oferty + Pozycjonowanie (wybierz dowolne)
   - Specyfikacja jakości: krótki tekst
   - Tryb sprzedaży
   - Wgraj 1-3 zdjęcia (kliknij obszar zdjęć)
3. **Krok 2 (Szczegóły):** wypełnij wymagane pola
   - Dostępność: daty od-do
   - Wolumen: 10-50 ton/mies.
   - Opakowanie, paletyzacja, logistyka — uzupełnij
   - Cena: opcjonalna
4. **Krok 3 (Prezentacja):**
   - Korzyść 1, 2, 3
   - Tytuł propozycji: „Jabłka Gala — test"
   - Wybierz CTA (próbki / cena / spotkanie)
5. Kliknij **„Opublikuj"**

Sprawdź:
- [ ] Propozycja pojawiła się na liście z badge „Opublikowana"
- [ ] Liczniki „Sieci: 0", „Przecz.: 0" (jeszcze nikt nie wysłał, nie otworzył)
- [ ] Możesz **edytować** propozycję klikając „Edytuj"
- [ ] Możesz **duplikować** klikając „Duplikuj" (powstaje kopia szkicowa)

### 1.4 Wysyłka propozycji do sieci (5 min)

Jako dostawca:
1. Sidebar → **Wysyłki**
2. Znajdź sieć (np. Biedronka) → kliknij **„Wyślij propozycję"**
3. Wybierz propozycję „Jabłka Gala — test" → potwierdź

Sprawdź:
- [ ] Status wysyłki zmienia się na „W moderacji"
- [ ] Liczba kredytów w pakiecie ZMNIEJSZYŁA się o 1 (ale rzeczywiste rozliczenie jest gdy kupiec otworzy)

### 1.5 Moderacja przez admina (3 min)

Przełącz się na okno admina:
1. Sidebar → **Pipeline** → zakładka „Do moderacji"
2. Znajdź wysyłkę → przejrzyj treść → kliknij **„Zatwierdź"**

Sprawdź:
- [ ] Wysyłka znika z „Do moderacji" i pojawia się w „Zatwierdzone"
- [ ] Dostawca widzi w swoich Wysyłkach status „Zatwierdzona"

### 1.6 Wysyłka batchowa do sieci (admin)

Jako admin:
1. Sidebar **Pipeline** → wybierz sieć (Biedronka) → kliknij **„Wyślij batch do Biedronki"**
2. Modal pokazuje podgląd maila + listę odbiorców (kupcy aktywni)
3. Kliknij **„Wyślij"**

Sprawdź:
- [ ] Pojawia się zielony badge „Wysłano" + liczba kupców
- [ ] Status wysyłki zmienia się na „Wysłane"
- [ ] **W skrzynce kupca (jeśli prawdziwy mail):** mail z `hello@freshmarket.eu`, tematem „Fresh Market PreConnect — N ofert dla [sieć]"

### 1.7 Kupiec widzi i otwiera propozycję (5 min)

Przełącz się na okno kupca:
1. Wejdź na `https://b2b.freshmarket.eu/kupiec`
2. Sidebar → **Propozycje asortymentowe**
3. Znajdź „Jabłka Gala — test" na liście
4. Kliknij na propozycję → powinna się otworzyć z pełnymi szczegółami

Sprawdź:
- [ ] Propozycja widoczna na liście kupca
- [ ] Otwarcie szczegółów oznacza wysyłkę jako „Otwarte" w pipeline admina
- [ ] **U dostawcy** pojawia się powiadomienie „Biedronka otworzyła Twoją propozycję"
- [ ] **W skrzynce dostawcy:** mail-powiadomienie „Kupiec otworzył ofertę"

### 1.8 Test mechanizmu „seen-billing" (kredyt rozliczany po otwarciu)

Już w kroku 1.7 to się stało — sprawdź potwierdzenie:

Jako dostawca:
- [ ] Sidebar **Finanse** → historia transakcji → widać wpis „Wysłano do Biedronka" (kredyt pobrany)
- [ ] Liczba pozostałych kredytów się zmniejszyła

### 1.9 Wygaśnięcie po 14 dniach + automatyczny zwrot (test ręczny w SQL)

Ten test wymaga manipulacji daty w bazie — zrób go RAZ żeby potwierdzić mechanikę:

W Supabase SQL Editor:
```sql
-- Cofnij datę wysyłki o 15 dni dla testowej wysyłki (która nie została otwarta)
UPDATE legacy_sends
SET created_at = NOW() - INTERVAL '15 days'
WHERE id = <id_testowej_wysyłki_NIE_otwartej>;

-- Uruchom funkcję wygaszania
SELECT expire_legacy_sends_14d();

-- Uruchom funkcję zwrotu kredytów
SELECT refund_unread_expired_legacy_sends();
```

Sprawdź:
- [ ] Wysyłka ma teraz status `expired`
- [ ] Dostawca dostał kredyt z powrotem (sprawdź jego balans)
- [ ] **U dostawcy** w panelu **Finanse** widać wpis „Zwrot kredytu — wysyłka wygasła nieotwarta"

### 1.10 Usuwanie propozycji przez dostawcę (1 min)

Jako dostawca:
1. **Moje propozycje** → wybierz propozycję która NIE BYŁA wysłana
2. Kliknij czerwony przycisk **„Usuń"**
3. W modalu potwierdź **„Tak, usuń"**

Sprawdź:
- [ ] Propozycja znika z listy
- [ ] Toast pokazuje „Propozycja usunięta"
- [ ] **Druga propozycja** (już wysłana) ma przycisk Usuń jako zablokowany (kłódka) z tooltipem „Nie można usunąć — propozycja wysłana"

### 1.11 Refund banner

Jako dostawca który ma zwroty (po kroku 1.9):
- [ ] Na dashboardzie widać zielony refund banner „N zwrotów kredytów (X €)"
- [ ] Kliknięcie „Zobacz" prowadzi do Finansów

---

## 2. Spotkania B2B (Fresh Market 2026)

Spotkania B2B to OSOBNY moduł od PreConnect. Działa tylko we wrześniu 2026. Dostawca **wybiera sieci**, sieć **wybiera dostawców**, **algorytm** dopasowuje pary, admin **publikuje plan**. Każdy dostaje **numer spotkania** (kolejność wywoływania w dniu eventu).

### 2.1 Sieci handlowe — które biorą udział w FM 2026 (5 min)

Jako admin:
1. Sidebar → **Sieci**
2. Dla każdej sieci która ma być w FM 2026 (np. Biedronka, Lidl, Kaufland, Selgros, Spar Polska):
   - Znajdź sieć
   - Kliknij badge **„Poza FM"** → przeskoczy na **„FM 2026"** (niebieskie tło)
   - Obok pojawi się zielone **„Zapisano"** na 2.5 s

Sprawdź:
- [ ] Toggle zmienia stan natychmiast (NIE trzeba klikać „Zapisz zmiany")
- [ ] Po odświeżeniu strony (F5) zmiana zostaje
- [ ] Sieć dostała automatycznie ID łańcucha (np. `ch28`, `ch29` — widoczne po rozwinięciu karty)

### 2.2 Włącz fazę „Preferencje" w panelu admina FM (2 min)

Jako admin:
1. Sidebar → **FM Spotkania**
2. Zakładka **Zarządzanie**
3. Włącz suwak **„schedulingOpen"** (otwarcie fazy preferencji)
4. Ustaw **currentPhase = 2** (Preferencje)

Sprawdź:
- [ ] W sidebarze suppliera i kupca pojawiła się odblokowana zakładka „Spotkania FM 2026"
- [ ] Wybór sieci dostępny dla suppliera

### 2.3 Dostawca wybiera sieci (5 min)

Jako dostawca:
1. Sidebar → **Spotkania FM 2026** → **Wybór sieci**
2. Kliknij na sieci żeby wybrać:
   - Pierwsze kliknięcie → ⭐ **GŁÓWNA** (zielony border)
   - Drugie kliknięcie tej samej sieci → 👍 **REZERWOWA** (pomarańczowy)
   - Trzecie kliknięcie → usuń wybór
3. Wybierz 5 sieci jako GŁÓWNE (np. Biedronka, Lidl, Kaufland, Selgros, Spar) + 2 sieci jako REZERWOWE (np. Carrefour, Auchan)

Sprawdź:
- [ ] Po wybraniu 5. GŁÓWNEJ kolejne kliknięcia (na innej sieci) automatycznie ustawiają jako REZERWOWA (limit 5 GŁÓWNYCH)
- [ ] Licznik na górze pokazuje „5/5 ⭐ + 2 👍"
- [ ] Wybór zapisuje się automatycznie (nie ma osobnego przycisku „Zapisz")
- [ ] Po wylogowaniu i ponownym zalogowaniu wybór zostaje

### 2.4 Kupiec odpowiada na dostawców (5 min)

Jako kupiec:
1. Sidebar → **Spotkania FM 2026** → **Dostawcy chcący spotkania**
2. Powinieneś widzieć dostawców którzy wybrali tę sieć (z badge ⭐ albo 👍 obok nazwy)
3. Dla każdego dostawcy kliknij:
   - ✅ **Chcę** (zielony)
   - 🤝 **Daj szansę** (żółty)
   - ❌ **Nie chcę** (czerwony)

Test friction modal:
1. Kliknij **„❌ Nie chcę"** na pierwszym dostawcy
2. Powinien pojawić się modal z 2 opcjami:
   - „🔁 Przenieś na koniec kolejki" (zalecane) → ustawia jako Daj szansę
   - „Nie chcę spotkania z tą firmą" → potwierdza odrzucenie

Sprawdź:
- [ ] Modal z dwoma opcjami pojawia się
- [ ] „Przenieś na koniec kolejki" zmienia status na 🤝
- [ ] Dopiero druga opcja po potwierdzeniu wpisuje twarde ❌

### 2.5 Admin uruchamia algorytm (3 min)

Jako admin:
1. Sidebar → **FM Spotkania**
2. Zakładka **Plan spotkań**
3. Sprawdź statystyki na górze (ilu dostawców gotowych, ile sieci odpowiedziało)
4. Jeśli ≥50% suppliers ma 5 ⭐ — przycisk **„Uruchom algorytm"** jest aktywny
5. Kliknij **„Uruchom algorytm"**
6. Po chwili pojawia się tabela z planem

Sprawdź:
- [ ] Pojawia się tabela dostawców z liczbą spotkań i listą sieci
- [ ] Najwyżej na liście są dostawcy Premium z najwcześniejszymi datami płatności
- [ ] Każdy dostawca ma maks. 5 spotkań
- [ ] **Test zerowych spotkań:** jeśli któraś firma ma 0 spotkań → czerwony banner na górze z listą

### 2.6 Admin sprawdza warnings (jeśli są)

Po uruchomieniu algorytmu na górze tabeli mogą pojawić się 2 bannery:

**Czerwony banner** — „N firm bez spotkań":
- [ ] Lista firm Premium które nie dostały żadnej sieci
- [ ] Możesz ręcznie dodać im spotkania w zakładce Korekty

**Pomarańczowy banner** — „N sugestii zamian ⭐/👍":
- [ ] Lista konkretnych firm gdzie sieć REZERWOWA ma lepszy numer niż GŁÓWNA
- [ ] Przykład tekstu: „Firma X: sieć GŁÓWNA Biedronka ma numer 43 (czerwona), a REZERWOWA Lidl ma numer 21 (zielona). Rozważ zamianę."

### 2.7 Ręczna korekta planu przez admina (5 min)

Jako admin:
1. Zakładka **Korekty**
2. Zobaczysz grid: dostawcy w wierszach, sieci w kolumnach, numer w komórce + kolor zone (zielony/pomarańczowy/czerwony)
3. **Klik na komórkę A → klik na komórkę B** → zamiana numerów (drag & swap)
4. Jeśli swap powstaje gdzie kupiec dał ❌ Nie chcę → pojawia się modal **„Uwaga — kupiec odrzucił"** — admin może świadomie nadpisać

Sprawdź:
- [ ] Drag & swap działa: kliknięcie A → B zamienia numery
- [ ] Modal „Uwaga — kupiec odrzucił" pojawia się przy próbie wymuszenia odrzuconego spotkania
- [ ] Spotkania nadpisane przez admina mają oznaczenie ⚠️
- [ ] Klik **„Zatwierdź plan"** zapisuje cały plan do bazy

### 2.8 Publikacja planu (1 min)

Jako admin:
1. Zakładka **Zarządzanie**
2. Włącz **„planPublished"** → status zmienia się na zielony „Opublikowany"

Sprawdź:
- [ ] Status w panelu admina pokazuje „Opublikowany"
- [ ] Dostawcy i kupcy mają nową zakładkę **„Twoje spotkania"** odblokowaną

### 2.9 Dostawca widzi swoje spotkania (2 min)

Jako dostawca:
1. Sidebar → **Spotkania FM 2026** → **Twoje spotkania**
2. Lista spotkań posortowana po numerze: nr 1, 2, 3, ...
3. Każde spotkanie: numer, sieć, status (główna/rezerwowa), kolor zone

Sprawdź:
- [ ] Lista jest widoczna i posortowana po numerze
- [ ] Pod listą jest box z opisem **„Jak działa wywoływanie spotkań w dniu eventu"**: ekran + aplikacja → Gate 1/Gate 2 → obsługa odprowadza
- [ ] **NIE MA** żadnych godzin spotkań ani numerów stolików (zgodnie z modelem kolejkowym)

### 2.10 Kupiec widzi swoje spotkania (2 min)

Jako kupiec:
1. Sidebar → **Spotkania FM 2026** → **Twoje spotkania**
2. Lista dostawców z którymi się spotka

Sprawdź:
- [ ] Lista widoczna
- [ ] Dla każdego dostawcy widać profil firmy
- [ ] Brak numerów stolików / godzin (tak ma być)

---

## 3. Cross-funkcjonalne (wszystkie role)

### 3.1 Logowanie / wylogowanie

- [ ] Logowanie hasłem działa dla wszystkich 3 ról
- [ ] „Magic link" (link logowania w mailu) — kliknij „Albo zaloguj przez magic link", wpisz mail → mail przychodzi z linkiem → klik logowanie działa
- [ ] „Zapomniałeś hasła?" — wpisz mail, dostań link resetu, ustaw nowe hasło, zaloguj się
- [ ] Wylogowanie czyści sesję (przycisk **Wyloguj** w prawym górnym lub w sidebarze)

### 3.2 Rejestracja nowego dostawcy — zwykła ścieżka

- [ ] Link „Zarejestruj firmę" na stronie logowania jest widoczny
- [ ] Formularz wymaga wszystkich pól + akceptacji
- [ ] Po sukcesie autologin + pending_review banner
- [ ] Mail powitalny przychodzi z `hello@freshmarket.eu`

### 3.3 Brand logo Fresh Market

Po wgraniu migracji `029_brand_logo.sql` w SQL Editor (osobny krok):

Jako admin:
1. Sidebar → **System** → **Branding**
2. Wgraj plik PNG z logo (≤ 1 MB, najlepiej z przezroczystym tłem)
3. F5 — logo pojawia się w:
   - [ ] Sidebar (lewy panel)
   - [ ] Nagłówek panelu (PanelTopBar)
   - [ ] Strona `/login`
   - [ ] Strona `/zarejestruj-dostawcy`
   - [ ] Strona `/zakup-ok` (po zakupie pakietu)
   - [ ] FloatingChat (prawy dolny róg)

### 3.4 Chat z administratorem

Jako dostawca:
1. Prawy dolny róg → kliknij ikonę czatu
2. Wpisz wiadomość → wyślij

Jako admin:
1. Sidebar → **Wiadomości** → widzisz wiadomość od dostawcy
2. Kliknij na wątek → odpowiedz

Sprawdź:
- [ ] Wiadomość pojawia się u admina natychmiast (lub po F5)
- [ ] Odpowiedź admina pojawia się u dostawcy natychmiast
- [ ] **„Sformułuj odpowiedź AI"** w panelu admina generuje sensowną odpowiedź na bazie kompendium PreConnect

### 3.5 Przełączanie kont przez admina

Jako admin masz unikalną możliwość „udawania" dowolnego usera w aplikacji:

1. Na samej górze (pasek nad sidebar) jest dropdown z nazwą Twojego konta + rola
2. Kliknij → wybierz dowolnego dostawcę (np. „UNICA GROUP")
3. Aplikacja pokazuje widok TEGO dostawcy
4. Wróć klikając ponownie → wybierz „Admin"

Sprawdź:
- [ ] Przełącznik widoczny tylko dla admina (nie dla dostawcy/kupca)
- [ ] Pełen widok wybranej firmy widoczny po kliknięciu
- [ ] Powrót do widoku admina działa

### 3.6 Zakup pakietu (PayU sandbox)

Jako dostawca z aktywnym kontem:
1. Sidebar → **Finanse** → **Kup pakiet**
2. Wybierz pakiet (np. Standard 10)
3. Kliknij **„Kup"** → przekierowanie na PayU sandbox
4. Na stronie PayU użyj testowej karty: `4444333322221111`, CVV `123`, data ważności dowolna w przyszłości
5. Zatwierdź → wróć na `/zakup-ok`

Sprawdź:
- [ ] Strona `/zakup-ok` pokazuje „Zamówienie w trakcie weryfikacji" (polling)
- [ ] Po ~10-15 s pokazuje sukces „Pakiet aktywowany"
- [ ] Liczba kredytów dostawcy zwiększyła się o liczbę z pakietu
- [ ] W panelu **Finanse** pojawia się nowa transakcja z PayU

---

## 4. Bezpieczeństwo i izolacja danych

### 4.1 Dostawca nie widzi cudzych ofert

Jako dostawca A:
- [ ] W „Moje propozycje" widać TYLKO swoje propozycje (nie ma czyichś)
- [ ] W URL bezpośrednio wpisz `/oferta/123` gdzie 123 to ID oferty innego dostawcy → powinien dostać 404 albo „Brak dostępu"

### 4.2 Kupiec widzi tylko swoje wysyłki

Jako kupiec Biedronki:
- [ ] W „Propozycje asortymentowe" widać TYLKO oferty wysłane do Biedronki (sieć ID 100)
- [ ] NIE widać ofert wysłanych do Lidla, Kauflandu itd.

### 4.3 Izolacja storage (zdjęcia produktów)

Po wgraniu zdjęcia produktu przez dostawcę:
- [ ] Kupiec sieci do której wysłano ofertę WIDZI zdjęcie
- [ ] Kupiec innej sieci NIE WIDZI tej oferty wcale (i jej zdjęć)
- [ ] Niezalogowany użytkownik NIE WIDZI zdjęć (otwarcie URL zdjęcia bez sesji → 401/403)

---

## 5. Maile i komunikacja

Wszystkie maile powinny wychodzić z `hello@freshmarket.eu`. Sprawdź każdy typ:

### 5.1 Welcome mail (rejestracja dostawcy)

Po wykonaniu testu 1.1:
- [ ] Mail przyszedł na podany email
- [ ] Nadawca: **`hello@freshmarket.eu`** (NIE `onboarding@resend.dev` ani inny)
- [ ] W skrzynce ODEBRANE (nie spam)
- [ ] HTML poprawny — nagłówek FRESH MARKET 2026, treść powitalna, link „Zaloguj się"

### 5.2 Mail z propozycją do kupca (test 1.6)

Po wykonaniu batchowej wysyłki do sieci:
- [ ] Mail przyszedł na adres kupca
- [ ] Nadawca: `hello@freshmarket.eu`
- [ ] Treść: lista propozycji z linkami do panelu kupca
- [ ] Linki w mailu prowadzą do `https://b2b.freshmarket.eu/...` (NIE `freshmarketb2b.netlify.app`)

### 5.3 Mail-powiadomienie do dostawcy gdy kupiec otworzy (test 1.7)

- [ ] Mail przyszedł na adres dostawcy
- [ ] Temat zawiera nazwę sieci („Biedronka otworzyła ofertę X")
- [ ] Nadawca: `hello@freshmarket.eu`

### 5.4 Reset hasła

- [ ] Mail z linkiem resetu przychodzi natychmiast
- [ ] Link działa, prowadzi na `/reset-hasla`
- [ ] Po ustawieniu nowego hasła auto-redirect na panel

### 5.5 Mail wygaśnięcia (14 dni)

Po teście 1.9 (cofnięcie daty + uruchomienie funkcji):
- [ ] Mail-przypomnienie do kupca przyszedł („Propozycja od X wygaśnie za N dni")
- [ ] Mail do dostawcy o zwrocie kredytu

---

## 6. Wydajność i edge cases

### 6.1 Lista 50+ propozycji

Jeśli na koncie dostawcy jest dużo propozycji:
- [ ] Strona „Moje propozycje" ładuje się w <2 sekundy
- [ ] Scroll płynny
- [ ] Filtry działają

### 6.2 Wiele równoczesnych wysyłek

Admin odpala batchową wysyłkę do 5 sieci naraz:
- [ ] Każda wysyłka kończy się sukcesem (lub jasno raportuje błąd)
- [ ] Kredyty pobrane proporcjonalnie u każdego dostawcy

### 6.3 Brak internetu w trakcie operacji

Wyłącz Wi-Fi w trakcie zapisywania propozycji:
- [ ] Aplikacja pokazuje błąd „Brak połączenia" zamiast się zawieszać
- [ ] Po przywróceniu internetu można ponownie wysłać formularz

### 6.4 Mobilność (telefon)

Otwórz `https://b2b.freshmarket.eu/login` na telefonie:
- [ ] Strona logowania użyteczna
- [ ] Panel dostawcy/kupca jest czytelny na małym ekranie
- [ ] (Panel admina jest desktop-only, ale przynajmniej nie wybucha)

---

## 7. Pre-launch checklist (Final Go/No-Go)

Przed włączeniem aplikacji dla prawdziwych użytkowników:

### Techniczne
- [ ] HTTPS działa na `b2b.freshmarket.eu` (zielona kłódka w przeglądarce)
- [ ] Stary URL `freshmarketb2b.netlify.app` przekierowuje na `b2b.freshmarket.eu` (301)
- [ ] Maile wychodzą z `hello@freshmarket.eu`, nie z `onboarding@resend.dev`
- [ ] Wszystkie migracje w bazie wgrane (sprawdź `supabase/migrations/` — ostatni numer)
- [ ] Brand logo wgrane przez admina

### Konta i dane testowe
- [ ] **Usuń konta testowe** `codex.*@freshmarket.test` (po teście) — uruchom:
  ```sql
  DELETE FROM auth.users WHERE email LIKE 'codex.%@freshmarket.test';
  ```
- [ ] Usuń testowych dostawców („Test Dostawca 1" itp.) z panelu Firmy
- [ ] Usuń testowe wysyłki z bazy (jeśli były z fałszywymi datami)

### Konfiguracja
- [ ] PayU jest w trybie PRODUKCYJNYM (nie sandbox) — sprawdź w Supabase secrets
- [ ] FROM_EMAIL = `hello@freshmarket.eu` w Supabase Edge Function secrets
- [ ] Resend domain `freshmarket.eu` jest Verified (zielony status)

### Zespół i wsparcie
- [ ] Mail kontaktowy w stopce maili działa (`hello@freshmarket.eu` → kto odbiera?)
- [ ] Numer telefonu kontaktowy aktualny
- [ ] Admin (Ty) jesteś dostępny przez pierwsze 7 dni po starcie

### Komunikacja
- [ ] Powiadom dostawców o nowym URL (`b2b.freshmarket.eu`) — choć stary też działa przez redirect
- [ ] Newsletter / mail do partnerów z linkiem
- [ ] Strona główna `freshmarket.eu` linkuje do `b2b.freshmarket.eu`

---

## Co robić jeśli coś nie działa

1. **Zrób screenshot** całego ekranu (nie tylko fragment) — najlepiej z URL'em w adresie
2. **Zapisz krok-po-krok co kliknąłeś** żeby błąd się powtórzył
3. **Sprawdź konsolę developera** (F12 → Console) — jeśli są czerwone linie, skopiuj treść
4. **Zgłoś przez czat** z administratorem (prawy dolny róg) albo bezpośrednio do mnie (Artur)

---

## Skrót — co najważniejsze dla MVP

Jeśli nie masz 3 godzin a chcesz potwierdzić że najważniejsze działa, przejdź minimum:

- [ ] **1.1 → 1.7** (rejestracja → wysłanie → mail → otwarcie) — 25 min
- [ ] **2.3 → 2.5 → 2.9** (wybór sieci → algorytm → spotkania widoczne) — 15 min
- [ ] **5.1 + 5.2** (welcome mail + propozycja mail) — 3 min
- [ ] **7. Pre-launch checklist** — 10 min

= ~55 min minimalnego smoke testu.
