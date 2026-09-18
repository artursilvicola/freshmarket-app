# Notatka dla Claude — opisy PL/EN zapisane ze starej karty

Data: 18.09.2026

Gałąź: `fix/company-description-stale-client`

## Diagnoza produkcji

Zrzut Anny z 17.09, godz. 21:55 pokazuje stary formularz z dwoma polami opisu.
Aktualny formularz ma cztery pola (PL krótki/pełny oraz EN krótki/pełny). Przełącznik
PL/EN na zrzucie zmienił tylko język interfejsu starego bundla, nie kolumny opisu.

Odczyt produkcji i porównanie z `opisy-po.json` potwierdziły dokładnie trzy zmiany:

- Tenuta Chiaramonte — 21:47:14: angielski pełny opis w `description`, EN puste;
- Oranfresh — 21:50:37: angielski pełny opis w `description`, EN puste;
- Fungi Team — 21:53:20: angielski skrót i pełny opis w polach PL, EN puste.

Pozostałe 12 z 15 sprawdzonych firm jest zgodne z kopią. FruitMarket jest zgodny;
zrzut przedstawiał formularz edycji, nie podgląd kupca.

## Naprawa danych — wykonana 18.09, 09:18

Przygotowane lokalnie poza repo:

- `C:\Users\Artur\FreshMarket-Backups\opisy-stale-client-2026-09-18\przed-naprawa.json`
- `C:\Users\Artur\FreshMarket-Backups\opisy-stale-client-2026-09-18\naprawa-opisow-3.sql`

Pierwsza próba transakcji zatrzymała się bez zmian, ponieważ Supabase SQL Editor zmienił
LF na CRLF wewnątrz literałów. Zabezpieczenie zadziałało prawidłowo. Po ponownym odczycie
potwierdzono, że rekordy nie zmieniły się. Naprawę wykonano następnie przez zalogowaną
sesję administratora: każdy PATCH miał warunek `id + updated_at` i wymagał dokładnie
jednego zwróconego wiersza; po każdym zapisie powstał wpis `company_desc_stale_client_repair`.

Kontrola po zapisie:

- Tenuta: PL przywrócony z kopii, bieżący tekst przeniesiony do `description_en`;
- Oranfresh: PL przywrócony z kopii, bieżący tekst przeniesiony do `description_en`;
- Fungi Team: oba pola PL przywrócone, oba bieżące teksty przeniesione do EN;
- 3/3 wpisy audytu, ponowny pełny odczyt czterech pól zgodny;
- kopia po: `C:\Users\Artur\FreshMarket-Backups\opisy-stale-client-2026-09-18\po-naprawie.json`.

Nie zmieniono kategorii, produktów, pakietów, płatności, wyborów ani odpowiedzi B2B.

## Hotfix aplikacji

1. `NewVersionBanner` został zamontowany globalnie w `App.jsx`. Komponent już istniał
   i miał testy ochrony niezapisanej pracy, ale po hotfixie 055 pozostawał wyłączony.
   Porównuje build z `/version.json`, sprawdza po 30 s, co 5 min oraz po powrocie do
   karty. Przed przeładowaniem czeka na zapisy; przy niezapisanym szkicu pyta użytkownika.
2. Migracja `20260918070934_company_description_audit.sql` dodaje serwerowy trigger
   dla czterech pól opisu. Zapisuje `auth.uid()`, czas, firmę oraz pełne wartości
   przed/po. Akcja `security_company_description_changed` jest zastrzeżona przez
   politykę 055, funkcja triggera ma przypięty `search_path` i odebrane EXECUTE klientom.
   Błąd audytu wycofuje zmianę opisu.

## Zakres review

- upewnić się, że globalny pasek nie zasłania nagłówków i działa na loginie/panelach;
- uruchomić istniejące testy `NewVersionBanner` i `FmReloadPending`;
- uruchomić `scripts/company-description-audit-sql-test.mjs` na izolowanym lokalnym PG;
- sprawdzić idempotencję migracji, brak audytu przy no-op, brak możliwości podrobienia
  wpisu i rollback zmiany przy błędzie audytu;
- przed produkcją: świeży odczyt trzech firm, transakcja naprawcza, kontrola pełnych pól,
  następnie migracja i frontend. Dane trzech firm są już naprawione, więc nie uruchamiać
  skryptu naprawczego ponownie. Nie wysyłać maili ani nie zmieniać fazy/planów.

## Wyniki lokalne

- pełny Vitest: 228/228;
- test SQL triggera na osobnej lokalnej bazie: 6/6;
- build Vite: OK (wyłącznie istniejące ostrzeżenie o dużych chunkach);
- produkcja nie ma jeszcze migracji triggera ani zamontowanego paska — czekają na review.
