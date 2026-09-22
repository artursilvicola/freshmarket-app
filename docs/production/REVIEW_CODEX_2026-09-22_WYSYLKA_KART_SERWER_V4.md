# Review Codexa — wysyłka kart na serwerze v4 (aaf293d)

Data: 22.09.2026.
Gałąź Claude’a: feat/fm-plan-send-server-card.
Sprawdzony commit: aaf293d6511f0c6cdc2f03e686b304c47bbff4f4.
Połączenie z zaakceptowanym układem kart kupca: review/fm-cards-combined-20260922, merge e153cb9.

**Wynik pozytywny. Oba błędy zgłoszone w review v3 są naprawione i potwierdzone niezależnymi próbami. W sprawdzonym zakresie nie znalazłem nowych usterek blokujących wdrożenie.**

Jest to akceptacja techniczna kodu, nie wykonane wdrożenie. Nie zmieniałem produkcji, nie publikowałem planu i nie wysyłałem prawdziwych wiadomości.

## Potwierdzenie poprawek

1. **MIME manifestu zgodny z migracją.** Bucket fm-plan-cards dopuszcza application/json i application/pdf, public=false, limit 10485760 bajtów. Niezależny test odczytuje MIME wprost z migracji i egzekwuje listę w atrapie Storage. W v3 dawał 500 artefact_failed, obecnie przechodzi z HTTP 200 i zapisem JSON. Test SQL potwierdza obecność application/json. Błędna konfiguracja z samym PDF nadal prawidłowo blokuje pocztę.

2. **Brak fałszywego sukcesu po nietrafionym CAS.** Odtworzyłem wcześniejszy przeplot: inny worker rozpoczyna generację 2, nasz CAS nie trafia, odczyt nowego stanu kończy się błędem połączenia. Teraz ok=false, already_sent=[], marked=false, rejestr pozostaje sending, bez fm_plan_sent_at i bez wiadomości. Testy gałęzi pokrywają również brak rekordu oraz replay istniejącej generacji.

3. **Próba Lambda obejmuje zapis do Storage.** Tryb testowy zapisuje manifest z application/json pod test/<wersja lub simulation>/<rodzaj>-<id>.json. Błąd zapisu jest raportowany przed wywołaniem poczty. Treść załącznika testowego odpowiada zapisanej treści manifestu.

4. **Izolacja próby.** Najpierw wysłałem właściwą kartę na atrapach, potem zmieniłem nazwę firmy i dwa razy wykonałem wysyłkę testową. Oryginalny manifest pozostał bajtowo identyczny, rejestr doręczeń i znacznik firmy bez zmian. Obie próby trafiły wyłącznie na adres admina z profilu. Podane w żądaniu inne to/email/recipients nie zmieniły adresata. Testowy obiekt można nadpisywać, właściwy pozostaje niezmienny.

## Regresje z poprzednich review

- Ponowienie po zmianie nazwy firmy zachowuje cały poprzedni payload i nazwę załącznika.
- Niepewna wymuszona próba ma własny czas startu; zwykłe ponowienie odtwarza jej klucz.
- Dwa równoczesne wymuszenia utworzyły jeden nowy klucz (-a2) i jedną wiadomość w atrapie dostawcy poczty.
- Uszkodzony logotyp PNG nie blokuje wysyłki.
- Dane kart nadal buduje serwer z zatwierdzonego planu, a adresatów ustala z bazy. Front nie dostarcza PDF-a ani obrazów.

## Wyniki niezależnych kontroli

| Kontrola | Wynik |
| --- | --- |
| Pełny Vitest na połączonej gałęzi | 459/459, 59 plików |
| Aktualne testy funkcji Claude’a | 27/27, zawarte w pełnym zestawie |
| Dodatkowe niezależne próby | 8/8 |
| SQL: wszystkie migracje od pustej lokalnej bazy, nowa dwukrotnie, ROLLBACK | PASS |
| Vite build | OK, znane ostrzeżenie rozmiaru chunków |
| git diff --check dla gałęzi Claude’a i połączonych zmian | OK |
| Pakowanie zip-it-and-ship-it | OK |
| Smoke spakowanej funkcji, bez sieci | 401 bez tokenu, 72 dekodowania WebP, render PDF OK |
| Lokalny pomiar smoke | Node 24.15.0, WebP 223 ms, render 978 ms, PDF 906336 bajtów |

459 zamiast 457: połączona gałąź zawiera dwa testy wcześniej zatwierdzonego uproszczenia widoku/karty kupca. To nie rozbieżność w testach Claude’a.

Osobny plik regresji wybiera wyłącznie osiem testów z nazwą Independent. Pozostałe 23 historyczne testy skopiowane w tym pliku są celowo pomijane; aktualne 27 testów funkcji wykonano w pełnym zestawie.

W połączonej gałęzi usunąłem też zbędną pustą linię na końcu mojej notatki v3. Kod funkcji i migracji Claude’a nie wymagał poprawek po tym review.

## Warunki wdrożenia i kontroli środowiska

Po osobnym poleceniu Artura „wdrażaj”:
1. Sprawdzić bieżący main i produkcję; zachować punkt powrotu i kopię stanu. Uwzględnić już zaakceptowany układ kupca, jeżeli wdrażana jest połączona gałąź.
2. Uruchomić migrację 20260922100000_fm_plan_deliveries.sql przed frontem/funkcjami. Odczytem potwierdzić kolumny generacji prób, prywatność bucketu i application/json w allowed_mime_types. Same pomyślne uploady nie są dowodem prywatności — public=false i polityki dostępu sprawdzić osobno.
3. Wdrożyć front i funkcje. Wywołanie bez tokenu ma zwrócić 401.
4. Po upoważnieniu do próbnego maila wykonać „Wyślij test na mój adres” dla karty dostawcy i większej karty kupca. Sprawdzić adresata, treść PDF i logotypy oraz testowy manifest w Storage.
5. Rejestru doręczeń tryb testowy celowo nie dotyka. Po pierwszej autoryzowanej właściwej wysyłce sprawdzić zapisy per adresat i zgodność z odpowiedzią funkcji, zanim ruszy cała partia.

Lambda, rzeczywiste pobranie logotypów i Resend nie były wywoływane podczas review. Lokalny pomiar na małych logotypach testowych nie gwarantuje czasu największej rzeczywistej karty w Lambda. Próba wdrożeniowa pozostaje potrzebna.

Publikacja numerów, import do kolejek i wysyłka kart są osobnymi operacjami. Akceptacja kodu wysyłki nie zatwierdza szkicu planu ani nie otwiera stanowisk.

## Dowody i odtworzenie

C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/outputs/fm-card-server-review-v4-20260922/

Pliki: review.test.mjs, vitest.config.mjs, results.log, full-tests.log, sql-tests.log, build.log, package.log, bundle-smoke.log.

Do niezależnego powtórzenia: skopiować review.test.mjs i vitest.config.mjs do tmp/fm-card-server-review-v4/ w repo na aaf293d, uruchomić:

```text
npx vitest run --config tmp/fm-card-server-review-v4/vitest.config.mjs
```

Oczekiwane: 8 PASS, 23 pominięte zgodnie z filtrem. Baza, Storage i poczta są atrapami, bez kluczy produkcyjnych.
