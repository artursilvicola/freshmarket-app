# Próba mail v2 na produkcji: 07.11.2026

Kampania „Próba mail v2 07.11”, #5, grupa „Do wybranych firm”. Commit 2eae91c. Zatwierdzenie i wysyłka: Artur w panelu.

## Potwierdzone
| Sprawdzenie | Wynik | Źródło |
|---|---|---|
| Rejestr | 2 wiersze, oba `accepted`, attempts 1, is_test false | SQL |
| Czas wysyłki | 07:50:48 UTC | SQL |
| Odbiorcy | dokładnie dwa adresy próbne, PL 1, EN 1 | SQL |
| Przyjęcie przez Resend | 2 identyfikatory wiadomości zapisane | SQL |
| Dotarcie | oba maile w skrzynkach Gmail | zrzuty Artura, widok na komputerze |
| Otwarcie | `email.opened` processed, po jednym na mail | webhook |
| Treść zapisana | logo `https://b2b.freshmarket.eu/…`, bez data URI, adres zdjęcia = zamrożony, ta sama wersja | SQL |
| Link CTA | prowadzi na `https://b2b.freshmarket.eu/`, GET 200 | odczyt HTML + curl |
| Logo | GET 200 image/png | curl |
| Zdjęcie | anonimowy GET 200 image/jpeg, 143 673 B | podgląd |
| Ponowienie | wysyłka tej kampanii: 409 `campaign_not_approved`, nadal 2 wiersze | wywołanie funkcji |
| Rozliczenia | 0 wpisów w `legacy_send_email_events`, 0 pakietów firm próbnych | SQL |
| Blokada po próbie | flaga false, deploy 6aeedf78, wysyłka: 403 `send_disabled` | env + wywołanie funkcji |

## Nie potwierdzono tym przebiegiem
* Gmail na telefonie: zrzuty pokazują komputer.
* Outlook: nie testowano.
* `email.delivered`: nie wpłynęło; subskrypcja tego zdarzenia pozostaje otwartym punktem (patrz 22.10). Dotarcie opiera się na skrzynkach.
* Otwarcie piksela nie dowodzi świadomego przeczytania.
* Wypis: patrz dziennik w `wdrozenie-marketing-zdjecia-2026-11-07/00-CZYTAJ.md`.

## Pozostałe grupy: podgląd bez wysyłki (07.11.2026)
Plik `podglad-grup-kredyty.html`: pięć grup, PL i EN, firma przykładowa, liczby kredytów z rozkładu na produkcji. Gmail na telefonie: Artur potwierdził, że maile są w porządku.

Błędy w domyślnych tekstach układu 2:
* PL przy 1 kredycie: „dostępne są 1 kredyt” w trzech grupach. Dziś dotyczy to 10 firm z grupy „Mają kredyty, brak propozycji”.
* PL w grupie wygasających przy kilku kredytach: „4 kredyty PreConnect … ma termin ważności”.
* EN w grupie wygasających przy 1 kredycie: „1 credit … are valid until”.
* PL w grupie „Korzystali wcześniej”: „Korzystałeś już” zwraca się do firmy formą męską.
Grupa wygasających ma dziś 0 firm. Nic z tego nie zostało wysłane ani poprawione.

## Wypis i zamknięcie (07.11.2026)
| Sprawdzenie | Wynik | Źródło |
|---|---|---|
| Gmail na telefonie | w porządku | Artur |
| Wypis | adres EN, powód unsubscribe, źródło: strona wypisu, 09:47:25 UTC, przypisany do kampanii #5 | SQL |
| Historia zgód | wpis zniesienia z 06.11 zostaje obok nowego wypisu | SQL |
| Zawieszenie kont | 2 firmy suspended, PreConnect false, operatorzy false (Run: Artur) | SQL |
| Kampania #5 | closed, 2 wiadomości | SQL |

Nie sprawdzono: wypisu jednym kliknięciem z nagłówka (przycisk Gmaila) i Outlooka. Adres PL bez wypisu, konto zawieszone.
