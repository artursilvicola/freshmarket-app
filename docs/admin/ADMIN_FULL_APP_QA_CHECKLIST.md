# Fresh Market B2B — pełny test aplikacji dla administratora

**Wersja dokumentu:** 2026-05-29  
**Dla kogo:** administrator Fresh Market, osoba nietechniczna  
**Cel:** sprawdzić, czy aplikacja działa od początku do końca: rejestracja, firmy, kupcy, dostawcy, propozycje, wiadomości, maile, płatności i Spotkania B2B.

---

## Jak używać tej checklisty

- Testuj najlepiej na kontach testowych, a nie na prawdziwych klientach.
- Przy każdym punkcie zaznacz checkbox, jeśli działa poprawnie.
- Jeśli coś nie działa, nie naprawiaj samodzielnie. Zrób screenshot i zapisz:
  - gdzie jesteś w aplikacji,
  - co kliknięto,
  - co miało się stać,
  - co stało się naprawdę,
  - nazwę firmy / sieci / użytkownika, którego dotyczy problem.
- Jeśli testujesz płatność, rób to tylko na środowisku testowym albo za zgodą osoby odpowiedzialnej za PayU.

**Tester:** ___________________________  
**Data testu:** _______________________  
**Adres aplikacji:** https://b2b.freshmarket.eu  
**Wynik końcowy:** ☐ OK do publikacji ☐ OK z drobnymi uwagami ☐ Nie publikować

---

## 1. Przygotowanie do testu

- [ ] Mam dostęp do konta administratora.
- [ ] Mam dostęp do przynajmniej jednego konta dostawcy.
- [ ] Mam dostęp do przynajmniej jednego konta kupca sieci handlowej.
- [ ] Mam dostęp do skrzynki mailowej, na którą przychodzą testowe wiadomości.
- [ ] Wiem, których firm i sieci mogę używać do testów.
- [ ] Mam przygotowany przykładowy plik logo firmy, najlepiej PNG lub JPG.
- [ ] Mam przygotowane przykładowe dane: telefon, e-mail, opis firmy, certyfikat, propozycję asortymentową.

Uwagi:

________________________________________________________________________________

---

## 2. Logowanie, wylogowanie i język

- [ ] Wchodzę na https://b2b.freshmarket.eu.
- [ ] Ekran logowania otwiera się poprawnie.
- [ ] Mogę zalogować się jako administrator.
- [ ] Po zalogowaniu widzę panel administratora.
- [ ] Przycisk zmiany języka PL/EN działa.
- [ ] Po zmianie na EN główne elementy panelu są po angielsku.
- [ ] Po zmianie z powrotem na PL główne elementy panelu są po polsku.
- [ ] Wylogowanie działa.
- [ ] Po wylogowaniu nie widzę danych panelu.
- [ ] Logowanie ponowne działa bez błędu.

Uwagi:

________________________________________________________________________________

---

## 3. Panel administratora — ogólna nawigacja

- [ ] W menu po lewej stronie widzę: Dashboard, Pipeline, Sieci, Firmy, Wiadomości, FM Spotkania, Branding, Administratorzy.
- [ ] Każda pozycja menu otwiera właściwy ekran.
- [ ] Liczniki przy pozycjach menu wyglądają sensownie, np. liczba firm do zatwierdzenia.
- [ ] Panel nie pokazuje pustej białej strony.
- [ ] Strona nie zawiesza się podczas przewijania list.
- [ ] W górnym pasku widzę swoje konto administratora.
- [ ] Przełącznik kont testowych działa, jeśli jest widoczny.

Uwagi:

________________________________________________________________________________

---

## 4. Firmy w panelu administratora

### 4.1 Lista firm

- [ ] Otwieram **Firmy**.
- [ ] Widzę listę firm.
- [ ] Widzę zakładki: Aktywne, Do zatwierdzenia, Wstrzymane, Odrzucone, Wszystkie.
- [ ] Firmy aktywne są w zakładce Aktywne.
- [ ] Firmy czekające na decyzję są w zakładce Do zatwierdzenia.
- [ ] Firmy wstrzymane są w zakładce Wstrzymane.
- [ ] Firmy odrzucone są w zakładce Odrzucone.
- [ ] Nie ma zakładki Zarchiwizowane, jeśli archiwizacja nie została jeszcze wdrożona.
- [ ] W wierszu firmy widzę nazwę firmy.
- [ ] W wierszu firmy widzę status firmy.
- [ ] W wierszu firmy widzę kraj i miasto, jeśli są podane.
- [ ] W wierszu firmy widzę osobę kontaktową, jeśli jest podana.
- [ ] W wierszu firmy widzę e-mail, jeśli jest podany.
- [ ] W wierszu firmy widzę telefon, jeśli jest podany.
- [ ] Kliknięcie ikony kopiowania e-maila kopiuje e-mail.
- [ ] Kliknięcie ikony kopiowania telefonu kopiuje telefon.
- [ ] Kliknięcie e-maila otwiera program pocztowy.
- [ ] Kliknięcie telefonu działa jako link telefoniczny, szczególnie na telefonie.

### 4.2 Szczegóły firmy

- [ ] Klikam **Szczegóły** przy wybranej firmie.
- [ ] Otwiera się podgląd profilu firmy.
- [ ] W podglądzie widzę logo firmy, jeśli firma je dodała.
- [ ] W podglądzie widzę nazwę firmy.
- [ ] W podglądzie widzę kraj i miasto.
- [ ] W podglądzie widzę opis firmy.
- [ ] W podglądzie widzę certyfikaty, jeśli są dodane.
- [ ] W podglądzie widzę kontakty firmy.
- [ ] W podglądzie widzę aktywne propozycje asortymentowe, jeśli istnieją.
- [ ] Zamknięcie podglądu działa.

### 4.3 Status firmy

- [ ] Rozwijam wiersz firmy strzałką.
- [ ] Mogę zatwierdzić firmę oczekującą.
- [ ] Po zatwierdzeniu firma trafia do Aktywnych.
- [ ] Mogę wstrzymać firmę aktywną.
- [ ] Po wstrzymaniu firma trafia do Wstrzymanych.
- [ ] Mogę odrzucić firmę oczekującą lub testową.
- [ ] Po odrzuceniu firma trafia do Odrzuconych.
- [ ] Po zmianie statusu widzę komunikat potwierdzający.
- [ ] Firma wstrzymana nie wygląda jak aktywna.

Uwagi:

________________________________________________________________________________

---

## 5. Sieci handlowe i kupcy

- [ ] Otwieram **Sieci**.
- [ ] Widzę listę sieci handlowych.
- [ ] Mogę otworzyć szczegóły sieci.
- [ ] Widzę nazwę sieci.
- [ ] Widzę kraj sieci.
- [ ] Widzę datę następnej wysyłki, jeśli jest ustawiona.
- [ ] Widzę listę kupców przypisanych do sieci.
- [ ] Kupiec ma imię i nazwisko.
- [ ] Kupiec ma e-mail.
- [ ] Kupiec ma telefon, jeśli jest podany.
- [ ] Kupiec ma zaznaczone kategorie, za które odpowiada: owoce, warzywa, kwiaty.
- [ ] Kupiec aktywny jest oznaczony jako aktywny.
- [ ] Kupiec nieaktywny jest oznaczony jako nieaktywny.
- [ ] Mogę dodać nowego kupca testowego.
- [ ] Mogę zapisać zmiany w kupcu.
- [ ] Mogę oznaczyć kupca jako aktywnego lub nieaktywnego.
- [ ] Kupiec z aktywnym e-mailem powinien być dostępny do wysyłki propozycji.

Uwagi:

________________________________________________________________________________

---

## 6. Rejestracja dostawcy i zatwierdzanie konta

- [ ] Otwieram publiczną rejestrację dostawcy.
- [ ] Formularz rejestracji dostawcy wyświetla się poprawnie.
- [ ] Mogę wypełnić nazwę firmy.
- [ ] Mogę wypełnić dane osoby kontaktowej.
- [ ] Mogę wypełnić e-mail.
- [ ] Mogę wypełnić telefon.
- [ ] Mogę zaakceptować wymagane zgody.
- [ ] Po wysłaniu formularza widzę informację, że rejestracja została przyjęta.
- [ ] Administrator widzi nową firmę w zakładce Do zatwierdzenia.
- [ ] Administrator może zatwierdzić nową firmę.
- [ ] Po zatwierdzeniu dostawca otrzymuje właściwego maila.
- [ ] Dostawca może zalogować się do panelu.

Uwagi:

________________________________________________________________________________

---

## 7. Panel dostawcy — profil firmy

- [ ] Loguję się jako dostawca.
- [ ] Widzę panel dostawcy.
- [ ] Otwieram **Twoja firma**.
- [ ] Mogę dodać lub zmienić logo firmy.
- [ ] Po zapisie logo jest widoczne w profilu firmy.
- [ ] Mogę uzupełnić dane podstawowe firmy.
- [ ] Mogę uzupełnić opis firmy.
- [ ] Mogę wybrać typ firmy, np. producent, eksporter, importer.
- [ ] Mogę wybrać kategorie, np. owoce, warzywa, kwiaty.
- [ ] Mogę dodać kontakty do osób w firmie.
- [ ] Mogę zapisać profil firmy.
- [ ] Po zapisie widzę komunikat sukcesu.

### 7.1 Widoczność profilu firmy dla sieci handlowych

- [ ] W profilu firmy widzę sekcję **Widoczność profilu w katalogu kupców**.
- [ ] Domyślnie profil jest widoczny dla wszystkich aktywnych sieci.
- [ ] Widzę listę aktywnych sieci handlowych.
- [ ] Mogę zaznaczyć sieć, przed którą chcę ukryć profil.
- [ ] Mogę odznaczyć sieć i ponownie pokazać jej profil.
- [ ] Klikam **Zapisz widoczność**.
- [ ] Po zapisie widzę komunikat sukcesu.
- [ ] Po zalogowaniu jako kupiec ukrytej sieci profil tej firmy nie powinien być widoczny w katalogu.
- [ ] Po zalogowaniu jako kupiec innej sieci profil tej firmy powinien być widoczny.

Uwagi:

________________________________________________________________________________

---

## 8. Panel dostawcy — propozycje asortymentowe

- [ ] Otwieram **Moje propozycje**.
- [ ] Mogę dodać nową propozycję asortymentową.
- [ ] Formularz ma kilka kroków i można przejść przez nie po kolei.
- [ ] Mogę wpisać nazwę produktu.
- [ ] Mogę wpisać kraj pochodzenia.
- [ ] Mogę wpisać wolumen.
- [ ] Mogę wpisać minimalne zamówienie.
- [ ] Mogę dodać opis.
- [ ] Mogę dodać zdjęcia produktu.
- [ ] Mogę dodać certyfikaty lub informacje jakościowe.
- [ ] Mogę zapisać propozycję jako szkic.
- [ ] Mogę opublikować propozycję.
- [ ] Po publikacji propozycja pojawia się na liście.
- [ ] Logo dostawcy i nazwa firmy są widoczne poprawnie przy propozycji.
- [ ] Mogę edytować propozycję.
- [ ] Mogę skopiować propozycję.
- [ ] Mogę wysłać propozycję do wybranej sieci, jeśli konto i pakiet na to pozwalają.

Uwagi:

________________________________________________________________________________

---

## 9. Panel dostawcy — finanse i pakiety

- [ ] Otwieram **Finanse**.
- [ ] Widzę saldo.
- [ ] Widzę aktywny pakiet, jeśli dostawca go ma.
- [ ] Widzę liczbę wykorzystanych wysyłek.
- [ ] Widzę historię transakcji, jeśli istnieje.
- [ ] Otwieram zakładkę pakietów.
- [ ] Widzę dostępne pakiety.
- [ ] Mogę rozpocząć zakup pakietu.
- [ ] Otwiera się okno płatności lub przekierowanie do PayU.
- [ ] Po powrocie z płatności aplikacja pokazuje właściwy status.
- [ ] Jeśli płatność nie jest testowa, nie finalizuję jej bez zgody.

Uwagi:

________________________________________________________________________________

---

## 10. Panel kupca — katalog dostawców

- [ ] Loguję się jako kupiec sieci handlowej.
- [ ] Widzę panel kupca.
- [ ] Otwieram **Dostawcy**.
- [ ] Widzę katalog dostawców.
- [ ] Widzę logo dostawcy, jeśli dostawca ma dodane logo.
- [ ] Widzę nazwę dostawcy.
- [ ] Widzę kraj i miasto dostawcy, jeśli są podane.
- [ ] Widzę typ firmy i kategorie.
- [ ] Widzę liczbę aktywnych propozycji.
- [ ] Mogę wyszukać dostawcę po nazwie.
- [ ] Mogę filtrować po kraju.
- [ ] Mogę filtrować po kategorii.
- [ ] Kliknięcie **Zobacz profil** otwiera profil dostawcy.
- [ ] Profil dostawcy pokazuje logo, opis, certyfikaty i kontakty.
- [ ] Kupiec nie widzi firm wstrzymanych lub odrzuconych.
- [ ] Kupiec nie widzi firmy, która ukryła profil przed jego siecią.

Uwagi:

________________________________________________________________________________

---

## 11. Panel kupca — propozycje asortymentowe

- [ ] Otwieram **Propozycje asortymentowe**.
- [ ] Widzę propozycje wysłane do mojej sieci.
- [ ] Widzę logo dostawcy przy propozycji, jeśli dostawca ma logo.
- [ ] Widzę nazwę dostawcy.
- [ ] Widzę nazwę produktu.
- [ ] Widzę kraj pochodzenia.
- [ ] Widzę wolumen i podstawowe dane handlowe.
- [ ] Mogę otworzyć szczegóły propozycji.
- [ ] W szczegółach propozycji widzę dane dostawcy.
- [ ] W szczegółach propozycji widzę zdjęcia produktu, jeśli są dodane.
- [ ] Mogę zapisać propozycję jako interesującą lub zapisaną.
- [ ] Przyciski kontaktowe, np. prośba o próbki lub pytanie o cenę, otwierają wiadomość e-mail.

Uwagi:

________________________________________________________________________________

---

## 12. Pipeline administratora — moderacja i wysyłka do kupców

- [ ] Otwieram **Pipeline**.
- [ ] Widzę propozycje oczekujące na moderację.
- [ ] Mogę zatwierdzić propozycję.
- [ ] Mogę odrzucić propozycję.
- [ ] Po zatwierdzeniu propozycja trafia do odpowiedniej kolejki.
- [ ] Przy sieci handlowej widzę liczbę zatwierdzonych propozycji do wysyłki.
- [ ] Klikam wysyłkę maila do kupców sieci.
- [ ] Jeśli sieć ma aktywnych kupców z e-mailami, system nie powinien pokazywać błędu o braku aktywnych e-maili.
- [ ] Mail testowy do kupca dochodzi na skrzynkę.
- [ ] Mail zawiera właściwe propozycje.
- [ ] Po wysyłce propozycje są oznaczone jako wysłane.
- [ ] Dostawca widzi informację, że propozycja została wysłana.

Uwagi:

________________________________________________________________________________

---

## 13. Wiadomości i czat

### 13.1 Dostawca pisze do administratora

- [ ] Loguję się jako dostawca.
- [ ] Otwieram dymek czatu.
- [ ] Wpisuję wiadomość testową.
- [ ] Klikam wyślij.
- [ ] Wiadomość pojawia się w czacie dostawcy.
- [ ] Loguję się jako administrator.
- [ ] Otwieram **Wiadomości**.
- [ ] Widzę wiadomość od właściwej firmy.
- [ ] Widzę nazwę firmy, nie sam numer lub przypadkowy identyfikator.

### 13.2 Administrator odpowiada dostawcy

- [ ] Jako administrator wybieram wątek firmy.
- [ ] Wpisuję odpowiedź.
- [ ] Klikam **Wyślij**.
- [ ] Wiadomość pojawia się w rozmowie.
- [ ] Po zalogowaniu jako dostawca widzę odpowiedź administratora w dymku czatu.
- [ ] Jeśli firma nie ma przypisanego konta użytkownika, system pokazuje zrozumiały błąd.

### 13.3 Administrator otwiera czat z listy firm

- [ ] Otwieram **Firmy**.
- [ ] Klikam **Wiadomości** przy wybranej firmie.
- [ ] Aplikacja przechodzi do ekranu Wiadomości.
- [ ] Wybrany jest wątek tej firmy.
- [ ] Mogę napisać wiadomość do osoby obsługującej konto firmy.

Uwagi:

________________________________________________________________________________

---

## 14. Fresh Market 2026 — spotkania B2B

### 14.1 Dostawca

- [ ] Loguję się jako dostawca.
- [ ] Otwieram część Fresh Market 2026 / Spotkania FM.
- [ ] Widzę informację o aktualnym etapie.
- [ ] Mogę wskazać sieci główne oznaczone gwiazdką.
- [ ] System pozwala wskazać maksymalnie 5 sieci głównych w ramach jednego pakietu.
- [ ] Mogę wskazać sieci rezerwowe.
- [ ] Mogę zapisać wybory.
- [ ] Po zapisie widzę potwierdzenie.

### 14.2 Kupiec

- [ ] Loguję się jako kupiec.
- [ ] Otwieram część Fresh Market 2026.
- [ ] Widzę dostawców dostępnych do wyboru.
- [ ] Mogę oznaczyć dostawcę jako interesującego.
- [ ] Mogę usunąć dostawcę z zainteresowań.
- [ ] Mogę zapisać wybory.
- [ ] W odpowiednim etapie widzę plan lub listę spotkań, jeśli została opublikowana.

### 14.3 Administrator

- [ ] Loguję się jako administrator.
- [ ] Otwieram **FM Spotkania**.
- [ ] Widzę zakładki: Zarządzanie, Dane, Plan, Korekty.
- [ ] Mogę sprawdzić gotowość dostawców i sieci.
- [ ] Mogę uruchomić algorytm, jeśli warunki są spełnione.
- [ ] Widzę wygenerowany plan.
- [ ] Mogę wejść w korekty planu.
- [ ] Mogę sprawdzić, czy plan spotkań jest opublikowany.

Uwagi:

________________________________________________________________________________

---

## 15. Maile systemowe

- [ ] Mail po rejestracji dostawcy dochodzi.
- [ ] Mail po zatwierdzeniu konta dochodzi.
- [ ] Mail resetu hasła dochodzi.
- [ ] Mail resetu hasła jest po polsku i angielsku.
- [ ] Mail do kupca z propozycjami dochodzi.
- [ ] Mail do kupca zawiera właściwą nazwę sieci.
- [ ] Mail do kupca zawiera właściwe propozycje.
- [ ] Mail do kupca ma działające przyciski lub linki.
- [ ] Mail do dostawcy po odczycie propozycji przez kupca dochodzi, jeśli ta funkcja jest aktywna.
- [ ] Maile nie trafiają masowo do spamu.

Uwagi:

________________________________________________________________________________

---

## 16. Regulamin, polityka prywatności i stopka

- [ ] Otwieram Regulamin po polsku.
- [ ] Regulamin ładuje się poprawnie.
- [ ] W § 7 widzę zapis, że dostawca w ramach jednego pakietu może wskazać maksymalnie 5 sieci głównych oraz dowolną liczbę sieci rezerwowych.
- [ ] Regulamin zawiera informację, że sieci widzą profile firm, o ile dostawca nie ukrył profilu przed daną siecią.
- [ ] Otwieram Privacy Policy / Politykę Prywatności.
- [ ] Dokument ładuje się poprawnie.
- [ ] Linki w stopce działają.
- [ ] Stopka jest poprawna w panelu dostawcy.
- [ ] Stopka jest poprawna w panelu kupca.
- [ ] Stopka jest poprawna w panelu administratora.

Uwagi:

________________________________________________________________________________

---

## 17. Test po angielsku

- [ ] Zmieniam język na EN jako administrator.
- [ ] Główne ekrany administratora są po angielsku.
- [ ] Zmieniam język na EN jako dostawca.
- [ ] Główne ekrany dostawcy są po angielsku.
- [ ] Zmieniam język na EN jako kupiec.
- [ ] Główne ekrany kupca są po angielsku.
- [ ] Katalog dostawców po EN nadal pokazuje logo dostawców.
- [ ] Wiadomości po EN nadal działają.
- [ ] Formularz propozycji po EN nadal działa.
- [ ] Nie widzę w głównych miejscach mieszanki PL/EN, poza nazwami własnymi firm, miast, produktów i certyfikatów.

Uwagi:

________________________________________________________________________________

---

## 18. Test końcowy bezpieczeństwa biznesowego

- [ ] Kupiec jednej sieci nie widzi danych innej sieci jako własnych.
- [ ] Kupiec widzi tylko propozycje wysłane do jego sieci.
- [ ] Dostawca nie widzi panelu administratora.
- [ ] Kupiec nie widzi panelu administratora.
- [ ] Firma wstrzymana nie zachowuje się jak aktywna.
- [ ] Firma ukryta przed wybraną siecią nie pojawia się tej sieci w katalogu.
- [ ] Administrator nadal może zobaczyć firmy niezależnie od statusu.
- [ ] Administrator widzi dane kontaktowe osoby obsługującej konto firmy.
- [ ] Administrator może skontaktować się z dostawcą przez wiadomości.

Uwagi:

________________________________________________________________________________

---

## 19. Lista błędów znalezionych podczas testu

| Nr | Gdzie w aplikacji? | Co kliknięto? | Co miało się stać? | Co stało się naprawdę? | Screenshot? | Priorytet |
|---|---|---|---|---|---|---|
| 1 | | | | | ☐ | ☐ pilne ☐ średnie ☐ drobne |
| 2 | | | | | ☐ | ☐ pilne ☐ średnie ☐ drobne |
| 3 | | | | | ☐ | ☐ pilne ☐ średnie ☐ drobne |
| 4 | | | | | ☐ | ☐ pilne ☐ średnie ☐ drobne |
| 5 | | | | | ☐ | ☐ pilne ☐ średnie ☐ drobne |

---

## 20. Decyzja po teście

- [ ] Wszystkie krytyczne funkcje działają.
- [ ] Rejestracja dostawcy działa.
- [ ] Zatwierdzanie firm działa.
- [ ] Katalog kupca działa.
- [ ] Logo dostawców są widoczne u kupca.
- [ ] Ukrywanie profilu przed wybraną siecią działa.
- [ ] Wysyłka propozycji do kupców działa.
- [ ] Wiadomości admin ↔ dostawca działają.
- [ ] Spotkania FM 2026 działają na poziomie podstawowego scenariusza.
- [ ] Maile dochodzą.
- [ ] Nie ma błędów blokujących publikację.

**Decyzja:**  
☐ Publikować  
☐ Publikować po poprawieniu drobnych rzeczy  
☐ Nie publikować — są błędy blokujące

**Podpis osoby testującej:** ___________________________

