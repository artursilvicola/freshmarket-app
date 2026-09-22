# Informacja o spotkaniach B2B — implementacja po konsultacji, 22.09.2026

Gałąź: `feat/fm-published-notice-20260922`, baza `fff7ea830deb7e05c0c1789a684d4be7bef68d45` (main i produkcja sprawdzone przed wdrożeniem). Zakres obejmuje interfejs, wspólny renderer PDF i numer kontaktowy w podpowiedziach czatu. Nie wymaga migracji.

## Decyzje Artura po uwagach Claude’a

1. Zachować zaakceptowany tekst o pierwszeństwie, także kolejność Premium/sponsoring przed rejestracją/płatnością. Artur odpowiedział „Zostaw dotychczasowy tekst”. Rozbieżność wskazana przez Claude’a nie została poprawiona redakcyjnie ani w algorytmie; nie przedstawiamy tego jako zmiany zasad matchingu.
2. Kupiec otrzymuje osobny wariant: kilka stanowisk, kolejność, zmiany, brak gwarancji i pomoc. Bez części o płatnościach, Premium, kredytach PreConnect i deklaracji Biedronki.
3. Oksana Kozłowska: +48 509 086 949, oksana@freshmarket.eu, pomoc po polsku. Jagoda Knadel: +48 603 811 818, jagoda.knadel@freshmarket.eu, tel./WhatsApp, pomoc po angielsku.
4. Wydruk ma jedną parę QR przy instrukcjach, bez powtórzenia sekcji „Śledź kolejność spotkań” na końcowej stronie. W aplikacji są zwykłe linki do aplikacji i tablic.

## Zachowanie

- `MeetingDisclaimer` wstawiony pod numerami w `PageSupplierFM` i pod finalnymi spotkaniami `PageBuyerFM`. Warunek dokładnie jak dla numerów: `planPublished`. Dotyczy też podglądu konta przez admina. Nie pojawia się przed publikacją, w podglądzie algorytmu fazy 3, tablicach ani panelu obsługi.
- Język interfejsu z `i18n.language`, PL/EN. Język kart PDF nadal według kraju odbiorcy, jak dotychczas. Nie używamy nieaktualnej preferencji profilu.
- Jedno źródło tekstów w `src/lib/fm-plan/notice-content.js`, wspólny dobór wariantu w `notice.js`, osobne prezentacje React i pdfmake. Parser obsługuje tylko statyczne wyróżnienie `<b>`; nie wstawia HTML do DOM.
- Informacja o darmowych dodatkowych kredytach obejmuje firmy zapisane do Biedronki lub Mega Image. Deklaracja przeczytania propozycji dotyczy wyłącznie Biedronki.
- PDF zachowuje tabelę, numery, wejścia Gate, instrukcje dotarcia, około 10 minut, kolejność zamiast godzin, procedurę po przegapieniu numeru, nagłówki, stopki, podział długich list i znak wodny symulacji. Wiersze nie są dzielone między strony.
- QR są wektorowe, generowane lokalnie przez pdfmake, jednakowej wersji i rozmiaru modułu, z marginesem 4 modułów. Instrukcje i QR tworzą jeden blok, więc QR nie zostają same na oddzielnej stronie.
- Końcowa informacja ma własną stronę; kontakty tylko raz. Dla długich planów liczba stron może wzrosnąć; nie przycinamy tekstów i nie zmniejszamy ich automatycznie.
- Wspólny `layout.js` obejmuje podgląd PDF w panelu, indywidualne PDF, zbiorcze PDF do drukarni, ZIP, CLI i renderer załączników. Już wcześniej pobrane lub wysłane PDF wymagają ponownego wygenerowania.
- Poprawiono 14 wystąpień telefonu Oksany: 5 PL, 5 EN, 2 lokalne podpowiedzi czatu i 2 w podpowiedzi AI Netlify. Telefon Jagody pozostaje jej telefonem.

## Weryfikacja

- Pełny Vitest: 430/430, 58 plików; 21 nowych testów. Po końcowych poprawkach odstępów i QR ponowiono wszystkie 8 testów renderera PDF.
- `npm run build`: OK; tylko dotychczasowe ostrzeżenie o dużych chunkach. `git diff --check`: OK.
- Integracja: dostawca/kupiec, admin preview, publikacja/brak publikacji, fazy 2/3/4, brak wywołań setterów planu/wejść, przełączanie PL/EN, kontakty i wyłączenie treści dostawcy u kupca.
- Produkcyjny pdfmake: 8 kart syntetycznych PL/EN — dostawca 5, 9, 17 spotkań i sieć 72. Pełny tekst sprawdzony pypdf; rendery stron obejrzane. Wyniki: 5 = 2 strony, 9 = 3, 17 = 4, sieć 72 = 14. Próbki 9/17/72 celowo zawierają bardzo długie nazwy/opisy; to test skrajnego układu, nie pomiar kart aktualnych uczestników.
- CLI na wyłącznie syntetycznych danych: 2 dostawców, 2 sieci, 4 pary; indywidualne karty, zbiorcze DRUK, Excel i ZIP utworzone. Nie pobierano planu ani danych produkcji do próby, nie wysyłano maili.
- Przeglądarka: rzeczywisty komponent React w izolowanym lokalnym podglądzie; desktop PL dostawca oraz telefon 390 px EN kupiec, brak poziomego przepełnienia. Osobny prototyp HTML/PDF zaakceptowany wcześniej został odświeżony bez powtórzonego QR.

## Wdrożenie i powrót

Przed wdrożeniem ponownie sprawdzić origin/main i produkcyjne `/version.json`; wdrażać fast-forward, bez nadpisywania równoległych prac. Powrót przez Netlify „Publish deploy” poprzedniej wersji lub revert tej zmiany w Git. Poprzedni gotowy deploy: `6ab14c1198895b00087fb48e`, commit `fff7ea8`.

Nie uruchamiać algorytmu, nie zatwierdzać/publikować planu, nie zmieniać fazy, wejść, szkicu ani kredytów. Komunikat pojawi się uczestnikom po zwykłej publikacji numerów przez Artura. Ta implementacja jest tylko informacyjna; nie przyznaje zapowiedzianych kredytów automatycznie.

Wynik wdrożenia, finalny commit i punkt powrotu zostaną dopisane do kopii notatki w `1FMK2026/outputs/NOTATKA_DLA_CLAUDE_2026-09-22_DISCLAIMER_FAZA4_WDROZENIE.md`.
