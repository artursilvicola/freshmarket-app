# Próba po wdrożeniu kodu (krok 6)

Mechanizm rozliczeń został sprawdzony wcześniej na bazie testowej (00-CZYTAJ.md, pkt 2). Ta próba potwierdza tylko, że to samo działa na produkcji, i jako jedyna sprawdza **doręczenie maila do dostawcy**.

## Zasady

- Wyłącznie konta testowe: sieć testowa, firma testowa dostawcy, kupiec na aliasie z plusem (jak w próbach z 6.10 i 22.10). Żadnych prawdziwych sieci ani dostawców.
- Przed próbą: firma testowa aktywna, ma co najmniej 3 wolne kredyty; sieć testowa aktywna; 3 propozycje testowe w statusie „wysłana” do sieci testowej.
- Po każdym kroku uruchom `05-kontrola-po-wdrozeniu.sql` i porównaj z oczekiwaniem.
- Po próbie: sieć testowa nieaktywna, firma testowa zawieszona (jak dotąd).

## Kroki

| # | Działanie | Oczekiwany wynik |
|---|---|---|
| 1 | Admin: pasek kont → konto kupca testowego; obejrzyj listę propozycji | statusy bez zmian („wysłana”), kredyty bez zmian, brak wiersza `admin/…` w „odczyty_aplikacji”, dostawca bez maila |
| 2 | Admin: Pipeline → Dostawcy / tracking → firma testowa → propozycja A → „Potwierdź ręcznie” → Telefon → „Zapisz potwierdzenie” | komunikat „pobrano 1 kredyt”; A: `read_manual`, rozliczenie `charged`, kredyt_z `manual`; kredyty −1; dostawca dostaje mail „…potwierdził organizatorowi Fresh Market, że zapoznał się z Twoją propozycją” |
| 3 | Admin: przy A „Cofnij potwierdzenie” | komunikat „kredyt wrócił”; A: `sent`, rozliczenie puste; kredyty +1 |
| 4 | Admin: ponownie „Potwierdź ręcznie” przy A | A: `read_manual`, kredyty −1; drugi mail do dostawcy (po cofnięciu powiadomienie jest wysyłane od nowa) |
| 5 | Kupiec testowy: zaloguj się, zostań na pulpicie (nie otwieraj listy) | pulpit: „2 nowych propozycji…”; B i C: `read`, rozliczenie `charged`, odczyty `buyer/app_list x1`; kredyty −2; A bez zmian; jeden mail do dostawcy „…wszedł do panelu PreConnect, w którym czekają Twoje propozycje” |
| 6 | Kupiec: odśwież stronę, wejdź na listę propozycji | kredyty bez zmian, bez kolejnego maila |

Razem zeszły 3 kredyty (1 ręcznie + 2 z wejścia kupca).

## Gdy coś się nie zgadza

- „Potwierdź ręcznie” zwraca błąd → sprawdź `03-kontrola-po-migracji.sql`; bez migracji funkcja odpowiada błędem i niczego nie zapisuje.
- Kredyt zszedł przy podglądzie admina (krok 1) → wycofanie wg 00-CZYTAJ.md pkt 5 i zgłoszenie.
- Mail nie doszedł, a rozliczenie jest poprawne → to osobna sprawa poczty (Resend → Logs); rozliczenie nie zależy od maila.
