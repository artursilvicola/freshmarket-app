# Poprawka EN wartości pól oferty PreConnect — raport do review

Data: 26.09.2026. Autor: Codex. Gałąź: `fix/offer-enum-labels-en`, baza: `origin/main` 1a79c7b.
Status: zaimplementowane i przetestowane lokalnie; BEZ wdrożenia, wysyłania maili i zmian danych produkcyjnych.

## Wynik weryfikacji raportu Claude’a

Przyczyna potwierdzona: formularz zapisuje polskie wartości opcji, a podglądy wyświetlały je bez mapowania. Poprawka zachowuje dotychczasowe wartości i warunki formularza. Filtr Bulk/Cartons rzeczywiście nie pasował do Luz/Karton.
Raport wylicza 17 grup; technicznie słownik obejmuje 21 pól, licząc pięć pól Tak/Nie osobno. Poniedziałek formularz zapisuje jako `Pon`, nie `Pn`; helper obsługuje obie wersje, formularz nadal zapisuje `Pon`.

## Zmiany

- `src/lib/offer-enums.js`: jeden słownik wartości i kluczy istniejących tłumaczeń PL/EN, helper etykiet oraz opcje formularza. Nieznane wartości pozostają widoczne, brak wartości nie tworzy etykiety, obsługiwane są stare wartości boolean.
- Formularz korzysta ze wspólnego słownika dla list select, radio, dni i formatów opakowania. Wartości zapisów oraz kolejność opcji pozostają takie same.
- Szczegóły kupca, lista kupca, lista dostawcy, wybór oferty do wysyłki, podglądy pełny/skrócony, podgląd firmy i wartości w podglądzie maila admina: etykiety w języku interfejsu.
- `Luz / Karton / Siatka` → `Bulk / Carton / Net`; `Do uzgodnienia` → `To be agreed`; analogicznie inne pola zdefiniowane w słowniku.
- Filtr opakowań używa wartości `Luz` i `Karton`, lecz prezentuje przetłumaczone etykiety. Filtrowanie nadal porównuje dane zapisane, a nie ich tłumaczenia.
- Renderer maila korzysta z tego samego helpera i istniejącego słownika EN dla opakowania i jednostki wolumenu. Zachowano escaping HTML. Wpis własny opakowania nie jest tłumaczony jako standardowa opcja.
- Kopia oferty otrzymuje sufiks `(Copy)` w EN, `(Kopia)` w PL.
- Bez migracji, bez zmiany API, RLS, mechanizmu wysyłki, odbiorców i danych ofert. Nie uruchomiono żadnej wysyłki.

## Testy

- Pełny Vitest: **528/528**, 67 plików.
- Nowe testy: **10**, obejmują wszystkie klucze PL/EN, zachowanie wartości i fallback, booleany, Pon/Pn, pełny i skrócony podgląd EN, podgląd PL, rzeczywisty widok kupca z rozwiniętymi sekcjami, filtr Bulk wybierający ofertę z Luz, render maila PL/EN i escaping wpisu własnego.
- Build Vite: PASS, standardowe ostrzeżenie o dużych chunkach.
- Pakowanie zmienionego renderera maila esbuild dla Node: PASS (wspólny moduł oraz import JSON bundlują się poprawnie).
- `git diff --check`: PASS.
- Testy używały fikcyjnych zmiennych Supabase; brak zapisu do produkcji. Nie wykonano przeglądarkowego testu produkcji ani wysyłki maila testowego. To kontrola do wykonania po wdrożeniu.

## Dalsze podobne problemy i granice poprawki

1. **Teksty dowolne**, np. `moq/minOrder = "1 Paleta"`, opis opakowania, termin dostawy i podkategoria. Są poza słownikiem opcji; na zrzucie widać właśnie `1 Paleta`. Automatyczna zamiana słów w treści użytkownika byłaby niewiarygodna. W osobnej zmianie warto rozdzielić minimum zamówienia na liczbę i jednostkę oraz rozszerzyć kontrolowane tłumaczenie tekstów z zachowaniem oryginału. Ta poprawka nie gwarantuje, że całe treści ofert będą EN.
2. **Starsze jednostki wolumenu**, obecne w danych demonstracyjnych, np. `T/mies.`, `T/tyg.`, `szt/tyg.`. Nie są opcjami bieżącego formularza i pozostają jako nieznane wartości. Przed rozszerzeniem aliasów należy zinwentaryzować rzeczywiste dane, nie zgadywać jednostek.
3. **Admin**: `ACCOUNT_STATUS_LABELS` zawiera polskie statusy; podgląd maila nadal zawiera polskie nagłówki i wstęp. W tej zmianie przetłumaczono wartości oferty, nie przebudowano całego podglądu na renderer finalnego maila. Zalecane współdzielenie finalnego renderera, by podgląd nie różnił się od wysyłki.
4. **Moduł dnia wydarzenia**: są polskie teksty admina/obsługi; osobny zakres. Publiczne tablice mają świadomie dwujęzyczne napisy — nie usuwać PL z takiego układu.
5. **Sezon na zrzucie**: `2026-11 – 2026-06` ma datę końcową wcześniejszą od początkowej. To błąd danych/walidacji, nie tłumaczenia. Nie poprawiano dat bez potwierdzenia właściwego sezonu.
6. Przeszukanie pozostałych plików src i funkcji nie wykazało kolejnego renderera tych enumów poza zmienionym monolitem i mailem. Moderacja AI używa surowych danych w prompcie — pozostawiono. Brak dowodu, że każdy tekst w całej aplikacji jest przetłumaczony; audyt jest ukierunkowany na podobny wzorzec i zgłoszone powierzchnie.

## Punkty do drugiej opinii

- Czy wszystkie gałęzie podglądu używają helpera bez zmieniania wartości zapisów?
- Czy zapis formularza zachowuje polskie literały, a filtr opakowań porównuje je poprawnie?
- Czy customPackaging oraz pozostałe teksty własne są zachowane i mail je escapuje?
- Czy akceptujemy osobny zakres dla MOQ / historycznych jednostek / sezonu i twardych tekstów admina?

## Po akceptacji i wdrożeniu

Zmiana frontu oraz renderera funkcji wysyłki, bez migracji. Najpierw upewnić się, że main nie zmienił się i uwzględnić ewentualne nowsze zmiany innych osób. Sprawdzić ofertę ze zrzutu u kupca EN, przełączyć PL, sprawdzić filtr Bulk i pełny/skrócony podgląd dostawcy/admina. Zweryfikować render maila bez wysyłki; prawdziwy mail testowy wyłącznie po osobnym poleceniu użytkownika.
