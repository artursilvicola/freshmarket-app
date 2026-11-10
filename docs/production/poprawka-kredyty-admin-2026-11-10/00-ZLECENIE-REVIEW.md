# Poprawka: wyświetlanie kredytów w panelu admina (10.11.2026)

Gałąź `fix/admin-credits-display` (od `main` = `f4179e7` + 2 commity tylko z dokumentacją: `5018b43`, `b86ddc4`). **NIEWDROŻONA.** Bez migracji, bez zmian w bazie, bez zmian w funkcjach Netlify — tylko widok panelu admina.

## Problem (zgłoszenie Artura, karta El Roda na produkcji)

Dane w bazie (sprawdzone 10.11): El Roda ma 3 przyznania bezpłatne (5 + 1 + 1 = 7, ważne do 31.12.2026), `qty_used` = 3; 5 wysyłek: 3 odczytane, 2 wygasłe bez odczytu (kredyt wrócił). Zakupów 0.

| Na ekranie przed poprawką | Pokazywało | Błąd |
|---|---|---|
| Pasek „Wykorzystanie kredytów” | 71% (5/7) | liczył **wysyłki** (także 2 zwrócone), nie zużyte kredyty; sprzeczne z kafelkiem „Pozostało 4” |
| Licznik w nagłówku karty | 5/7 „wysyłek” | wysyłki zestawione z liczbą kredytów |
| Nagłówek „Standard – 5 kredytów · 2026-12-31” | nazwa jednego planu | firma ma 3 przyznania, razem 7 |
| Kafelek „KUPIONE” | 7 | to wszystkie kredyty (bezpłatne + kupione); kupionych 0 |

## Zmiana

* `src/lib/admin-credit-usage.js` — `adminCreditUsage(lim)`: zużyte = `lim.used` (`qty_used` z `company_capacity`), wszystkie = `lim.max` (`qty_total`), procent, pozostało. Odporna na brak danych i zero.
* `src/legacy/PreconnectFM.jsx` — trzy miejsca liczące dotąd wysyłki (`filter(!rejected/refunded/queued).length`) używają `adminCreditUsage`: karta firmy (lista 2.0), szczegóły firmy (drawer), starsza lista. Nagłówek karty: `Kredyty: {{max}} · ważne do {{expiry}}` zamiast nazwy planu; licznik `{{used}}/{{max}} kredytów wykorzystanych`.
* `src/i18n/{pl,en}/legacy.json` — `credits_settle.bought`: „Kupione” → „Wszystkie” / “Bought” → “All” (ten sam klucz w karcie firmy, zbiorczym rozliczeniu Pipeline i zakładce Rozliczenia — wszędzie ta liczba to `qty_total`, czyli także kredyty bezpłatne); podpowiedź wyjaśnia „Wszystkie”; nowe `list_credits_total_format`, `list_used_unit` = „kredytów wykorzystanych” / “credits used”.
* Bez zmian: kafelki Wykorzystane / Pozostało / Zwroty / Czeka na odczyt (były poprawne), podział „bezpłatne N · data / kupione N”, pole edycji „Pakiet” (to wybór planu przy edycji, nie suma kredytów).

## Kontrole (10.11)

* `tests/admin-credit-usage.test.js` 5/5: El Roda 3/7 = 43% (nie 5/7 = 71%), zero i braki danych, brak dawnego liczenia wysyłek w źródle, 3 użycia funkcji, etykiety PL/EN.
* Pełny zestaw: 122 pliki OK, 2 pominięte; **1267 testów OK**, 3 pominięte (wymagają uruchomionego podglądu). `vite build` OK.
* Podgląd na bazie testowej (`zrzut-test-karta-firmy.jpg`): „Kredyty: 15 · ważne do 2027-09-05”, „2/15 kredytów wykorzystanych”, pasek 13% (2/15), kafelki Wszystkie 15 / Wykorzystane 2 / Pozostało 13 / Zwroty 1 / Czeka na odczyt 1 — spójne. Przed poprawką ta karta liczyła 3 wysyłki (3/15).

## Zapytanie do recenzenta (do wklejenia)

> Sprawdź gałąź `fix/admin-credits-display` w repozytorium Fresh Market 2026 (`git diff origin/main..fix/admin-credits-display -- . ':(exclude)docs'`). To poprawka tylko widoku panelu admina: pasek „Wykorzystanie kredytów”, licznik i nagłówek karty firmy liczyły wysyłki (także zwrócone za brak odczytu) zamiast zużytych kredytów, a kafelek „Kupione” pokazywał wszystkie kredyty razem z bezpłatnymi. Teraz źródłem jest `adminCreditUsage(lim)` (`lim.used` = `qty_used`, `lim.max` = `qty_total` z widoku `company_capacity`), a etykieta to „Wszystkie”. Sprawdź: (1) czy `lim.used`/`lim.max` w każdym z trzech miejsc pochodzą z `company_capacity` i znaczą to, co opisuje podpowiedź; (2) czy zmiana etykiety „Kupione” → „Wszystkie” jest poprawna także w zbiorczym rozliczeniu Pipeline i w zakładce Rozliczenia; (3) czy żadne inne miejsce w panelu admina nie liczy jeszcze wysyłek jako zużytych kredytów; (4) czy usunięcie nazwy planu z nagłówka karty nie ukrywa informacji potrzebnej adminowi; (5) wpływ na panel dostawcy i kupca (ma być żaden). Kontrola przypadku z produkcji: El Roda — 7 kredytów bezpłatnych, `qty_used` 3, wysyłki 3 odczytane + 2 wygasłe → oczekiwane 3/7 (43%), Wszystkie 7, Wykorzystane 3, Pozostało 4, Zwroty 2. Odpowiedz: GO / GO z uwagami / NO-GO, ustalenia od najpoważniejszych (plik:linia, problem, poprawka). Bez uwag stylistycznych.

## Wdrożenie (po review i „wdrażaj”)

1. Fast-forward `main` do gałęzi i push → build Netlify (kod frontu; bez migracji i bez zmian env).
2. Kontrola na produkcji: karta El Roda → „Kredyty: 7 · ważne do 2026-12-31”, „3/7 kredytów wykorzystanych”, pasek 43%, kafelek „Wszystkie 7”.
3. Kontrola, że wysyłka marketingowa nadal jest włączona (od 9.11): `marketing-send` z nieistniejącą kampanią → 404 `campaign_not_found` (nic nie wysyła).
4. Wycofanie: Netlify → poprzedni deploy (`6af1e887`, `f4179e7` z włączoną wysyłką) → Publish.
