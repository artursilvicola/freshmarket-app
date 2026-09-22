# Karta kupca: miejsce na notatki i usunięcie sekcji dostawcy

Gałąź: `fix/fm-buyer-print-cleanup`, baza `54abbdc`.
Zmiana przygotowana na prośbę Artura z 22.09.2026. **Bez wdrożenia, bez wysyłki maili i bez zmian w bazie.**

## Zakres uzgodniony z Arturem

- Z wydruku kupca usunięto dolny blok „Śledź kolejność spotkań”, linki/etykiety Fresh Market B2B i aktualnej kolejności wraz z obydwoma QR, a także całą dodatkową sekcję „Ważne informacje dotyczące spotkań B2B”. Usunięcie dotyczy PL i EN.
- Przy każdym dostawcy dodano kolumnę **Notatki / Notes**, około 5 cm szerokości, z trzema liniami. Miejsce rezerwowane jest również przy krótkich nazwach i pustych opisach. Wiersze nadal nie dzielą się między strony.
- Dotychczasowy kontakt (osoba i telefon) przeniesiono pod opis dostawcy w tej samej komórce. Nie rozszerzono zakresu danych osobowych drukowanych na karcie.
- Nad tabelą dodano informację: dane kontaktowe dostawców, z którymi kupiec ma spotkania, w tym telefony i e-maile, są dostępne po zalogowaniu w **b2b.freshmarket.eu**; można do nich wrócić po spotkaniach. Adres ma zwykły link, bez QR i bez dodatkowego bloku o kolejce. To późniejsze, jawne życzenie Artura dotyczące kontaktów.
- Zachowano informacje o dniu spotkań przeznaczone dla kupca, pomoc Oksany/Jagody z poprawnymi numerami oraz logotypy sponsorów. Końcowy blok organizacyjny utrzymywany jest razem, żeby nie urywać listy informacji między stronami.
- Pierwszy commit `df5a7d6` dotyczył wyłącznie karty do druku kupca. Późniejsze rozszerzenie o ekran kupca opisuje sekcja v2 poniżej. Wydruk i komunikat dostawcy pozostają bez zmian.

## Kod i współpraca z poprawką bezpieczeństwa

Zmiana obejmuje `src/lib/fm-plan/layout.js`, `notice-pdf.js`, `i18n.js` i istniejące testy `notice-layout.test.js`. Dane wejściowe, model par, adresaci, matching i endpointy wysyłki nie są zmieniane.

`meetingContactsBlock()` i `meetingSponsorsBlock()` są wydzielone ze wspólnych bloków, żeby zachować kontakty i sponsorów na karcie kupca bez ponownego dodawania QR lub całego disclaimera. Dotychczasowa karta dostawcy składa się z tego samego zestawu elementów co przed zmianą.

Przy pobieraniu repo zauważono gałąź Claude’a `feat/fm-plan-send-server-card` na `90345c0`. Niniejszy commit należy dołączyć do finalnej wersji ze wspólnym rendererem, zamiast wdrażać stary renderer z gałęzi bezpieczeństwa. Ta notatka nie jest review ani zgodą na wdrożenie `90345c0`. Po połączeniu zmian należy uruchomić również nowe testy backendu wysyłki.

## Weryfikacja

- Vitest: **432/432**, 58 plików.
- Build: OK, znane ostrzeżenie o dużych chunkach.
- `git diff --check`: OK.
- Render i kontrola wizualna kart przykładowych kupca PL/EN: **2 strony** na kartę, brak QR i dodatkowego disclaimera, miejsce na notatki przy każdym z 5 spotkań.
- Próby długich nazw/opisów: 5 spotkań i 72 spotkania w PL i EN. Skrajny wariant 72 długich opisów ma 16 stron; większa liczba stron wynika z miejsca na odręczne notatki. To przykład syntetyczny, nie pomiar obecnego planu Auchan.
- Karty dostawcy 5/9/17 spotkań przechodzą dotychczasowe kontrole, w tym dokładnie jedną parę QR i pełną treść dostawcy.
- Ekstrakcja tekstu finalnych przykładów: obecna informacja o telefonach i e-mailach, oba kontakty organizatorów po jednym razie; brak `/tablice` i tytułu usuniętego disclaimera.

## Podgląd dla Artura

`http://127.0.0.1:5196/` → **Kupiec → Karta do druku**, PL/EN.

Pliki w `outputs/fm-phase4-preview-20260922/pdf/buyer-pl.pdf` i `buyer-en.pdf` w głównym workspace `1FMK2026`. Przykładowe firmy, numery i wejścia; znak wodny symulacji; nie są to karty do rozsyłania uczestnikom. Podgląd nie łączy się z bazą.

## v2 — bez nazwy pakietu i bez disclaimera w aplikacji kupca

Kolejna prośba Artura z 22.09.2026, na tej samej gałęzi, po `df5a7d6`:

- W wierszu dostawcy na karcie kupca `PL · Polska · Business` zmieniono na `PL · Polska` (w EN: `PL · Poland`). Renderer nie wyświetla tam żadnej nazwy pakietu. Dane pakietu i matching pozostają niezmienione.
- W aplikacji kupca usunięto cały wskazany blok: tytuł „Ważne informacje dotyczące spotkań B2B”, wprowadzenie, informacje o stanowiskach, zmianach i braku gwarancji spotkania oraz sekcję śledzenia kolejności z dwoma linkami. Dotyczy PL, EN i podglądu admina.
- W tym miejscu pozostawiono wyłącznie kartę pomocy Oksany/Jagody. Nadal pojawia się dopiero przy `planPublished`, tak jak dotychczasowy komunikat. W aplikacji dostawcy pozostaje pełny komunikat.
- `MeetingDisclaimer` dla `audience="buyer"` zwraca teraz wyłącznie wspólny blok kontaktów, z osobną etykietą dostępności i identyfikatorem `fm-meeting-help`. Dla dostawcy układ i treść się nie zmieniają.
- Przykładowe PDF-y PL/EN i podgląd aplikacji na porcie 5196 zostały odświeżone. Każda przykładowa karta kupca ma nadal 2 strony, z notatkami i informacją o kontaktach dostawców w aplikacji.

Weryfikacja v2: **432/432 testy Vitest (58 plików), build OK, diff --check OK**. Istniejące testy sprawdzają brak pakietu na karcie kupca, brak sekcji informacyjnych/linków kolejki w jego widoku, zachowanie kontaktów PL/EN oraz brak wstawki przed publikacją. Obejrzano wszystkie 4 strony przykładowych PDF-ów kupca i oba języki podglądu aplikacji.

Nadal **bez wdrożenia, migracji, zmian planu i wysyłki maili**. Do wspólnego wydania z poprawką wysyłki należy wziąć oba commity z tej gałęzi, nie tylko pierwszy `df5a7d6`.
