# Review Codexa: serwerowa wysyłka kart 90345c0

22.09.2026. Wygląd kart i widoku kupca został zaakceptowany przez Artura. Review dotyczy `feat/fm-plan-send-server-card` / `90345c0d58898c15d967dc5d049385c55eaa1adc` oraz zgodności z zaakceptowanymi poprawkami wyglądu `df5a7d6` i `8c366c4`.

**Werdykt: kierunek poprawny, ale wysyłka wymaga dwóch poprawek przed wdrożeniem.** Oba problemy odtworzono lokalnie na danych syntetycznych. Nie wysłano żadnego prawdziwego maila. Produkcja, migracje produkcyjne, faza, plan i szkic nie zostały zmienione.

## 1. [P1] Obrazy z przeglądarki nadal mogą przenieść cudzą treść

`netlify/functions/fm-plan-send.js:66–82`, użycie w handlerze: linia 206.

`attachLogos()` sprawdza format data URI, rozmiar i klucz należący do karty, ale nie sprawdza, czy bajty obrazu są logotypem odczytanym dla tej encji z bazy. Klucz `ch1` na karcie A może zawierać dowolny poprawny PNG. To poprawia izolację tekstowych wierszy planu, ale nie daje deklarowanej gwarancji, że załącznik nie zawiera cudzych informacji.

Próba: żądanie karty A (`Alfa Fruits`) z `logos.ch1` = PNG z napisem `BETA - PRIVATE / MEETING #77`. Wynik: HTTP 200, `logos_ignored=[]`, obraz z obcymi danymi widoczny w załączniku karty A. Obraz ma 600×220 pikseli i mieści się w limicie 200 KB. Błąd jest możliwy przy błędnym/zamienionym obrazie w panelu; nie jest obejściem logowania ani uprawnień przez uczestnika. Nie stwierdzono takiego zdarzenia na produkcji.

Zdanie z notatki „Obraz nie może wnieść cudzych spotkań, numerów ani nazwisk” jest nieprawdziwe: tekst można przenieść jako piksele. Limit wymiarów lub rozmiaru nie rozwiązuje tej granicy zaufania.

Zalecenie: treść obrazów używanych do wysyłki również ustala serwer na podstawie kanonicznych danych. Możliwości:

- odczyt logotypu z zatwierdzonego storage/URL z bazy i konwersja WebP po stronie zaufanego procesu (kontrolowane hosty, limity czasu/rozmiaru/wymiarów),
- wcześniej przygotowane PNG w zaufanym magazynie, przypisane do encji i wersji źródła,
- do czasu obsługi logotypów fallback z inicjałami/nazwą w mailach, bez obrazów dostarczonych przez klienta.

Nie wystarczy zmiana nazwy pola, walidacja sygnatury PNG ani dodatkowa kontrola klucza. Test regresyjny ma sprawdzać końcowy PDF, a nie tylko listę tekstowych par przekazaną do renderera.

## 2. [P2] Błąd po przyjęciu maila pozwala wysłać duplikat, a panel pokazuje sukces

`netlify/functions/fm-plan-send.js:148–161` i `:238–271`; `src/components/admin/FmPlanExport.jsx:170`.

Odtworzona sekwencja:

1. Resend przyjmuje mail do pierwszego adresata A.
2. Aktualizacja rejestru `sending → sent` zwraca błąd bazy.
3. Funkcja zwraca `ledger_warning`, ale jednocześnie `ok=true`, `marked=true`; panel ignoruje ostrzeżenie i pokazuje sukces.
4. Po upływie 15 minut retry usuwa wiersz `sending`, zakłada nową rezerwację i ponownie wysyła do tego samego adresata. Próba zarejestrowała **dwa maile zamiast jednego**.

Podobna niejednoznaczność powstaje po timeout/zerwanej odpowiedzi, kiedy dostawca poczty przyjął już wiadomość. Obecne żądanie Resend nie ma `Idempotency-Key`. Sam UNIQUE w bazie chroni równoległe rezerwacje, ale nie łączy atomowo operacji w bazie z wysłaniem maila.

Zalecenie:

- trwały klucz idempotencji dla konkretnej karty, wersji planu i adresata; używany także u dostawcy poczty,
- zachowanie identycznego żądania przy retry, w tym bajtów PDF; ponowne wygenerowanie z inną datą/identyfikatorem PDF albo zmienionymi kontaktami może zmienić payload,
- status niepewnego wyniku i jawny komunikat panelu; nie raportować pełnego sukcesu, gdy trwały zapis wyniku nie został potwierdzony,
- nie usuwać automatycznie niepewnej próby tylko na podstawie wieku; wznowienie/reconciliation musi uwzględniać gwarancje i okres ważności idempotencji dostawcy.

Resend dokumentuje 24-godzinne przechowywanie kluczy oraz `409 invalid_idempotent_request` przy tym samym kluczu i innym payloadzie: [Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys). Samo dodanie nagłówka bez rozwiązania identyczności PDF i ponowień po tym oknie nie zamyka tematu.

## Co przeszło niezależnie

- Gałęzie połączyły się bez konfliktów na **lokalnej** `review/fm-cards-combined-20260922`; merge `bc161ac` zawiera `90345c0`, `df5a7d6` i `8c366c4`. Main nie został zmieniony.
- Pełny Vitest po połączeniu: **448/448**, 59 plików; oryginalne testy Claude'a funkcji wysyłki: **16/16**.
- Dodatkowa rzeczywista próba `Promise.all` dwóch równoległych handlerów: jeden mail per adresat, PASS.
- Osobny zestaw review: **17 PASS / 3 FAIL**. Trzy czerwone asercje dokumentują dwa powyższe problemy: obcy obraz, fałszywy pełny sukces, duplikat po odzyskaniu rezerwacji. Nie należy mylić zielonego pełnego zestawu repo z zaliczeniem tych nowych przypadków.
- SQL: wszystkie migracje od pustej lokalnej bazy, nowa migracja dwukrotnie, testy RLS/UNIQUE i ROLLBACK: PASS. Baza testowa została usunięta przez runner.
- Build i `git diff --check`: OK; znane ostrzeżenie o dużych chunkach.
- Lokalne pakowanie przez zainstalowane `@netlify/zip-it-and-ship-it`, esbuild + external `pdfmake`: PASS. Sprawdzono nie tylko 401 bez tokenu, ale również **rzeczywiste wygenerowanie PDF przez spakowany `renderCardPdf`**, bez połączeń sieciowych. Lokalny Node: 24.15.0; nie jest to dowód działania w produkcyjnym Node 20/Lambda.
- Wspólny renderer uwzględnia zaakceptowane zmiany: karta kupca z notatkami, bez pakietu przy kraju, bez QR i dodatkowego disclaimera; aplikacja kupca z samą pomocą. Layout dostawcy pozostaje jak wcześniej.
- Odczyt `/version.json`: produkcja nadal `54abbdc0942a`, origin/main `54abbdc`. Bez nowego deployu.

## Odpowiedzi na pięć pytań Claude'a

1. Rejestr: RLS i GRANT-y prawidłowo ograniczają odczyt do administratorów oraz zapis do service role. Test SQL potwierdzony. Ogólny temat `is_admin()` i nieaktywnych adminów pozostaje poza tą zmianą, jak uzgodniono wcześniej.
2. Obrazy klienta: nie akceptuję deklarowanej gwarancji izolacji całego PDF przy dowolnych bajtach z przeglądarki; patrz P1.
3. 15 minut: sam czas nie jest głównym problemem. Rezerwacja może być niepewna, a nie porzucona przed wysyłką; jej usunięcie umożliwia duplikat. Patrz P2.
4. Znacznik po komplecie adresatów: założenie poprawne, ale w ścieżce `doneErr` bieżący kod oznacza komplet mimo nieudanego zapisu rejestru.
5. Numer karty zależny od aktualnej kolejności firm: nie powoduje wysyłki do obcego adresata. Jest numerem dokumentu, nie numerem spotkania. Dla zgodności podglądu, wysyłki i retry warto utrwalić go razem z payloadem; nie używać go jako identyfikatora odbiorcy.

401 po deployu potwierdzi start funkcji, ale nie wykona leniwego `getPrinter()` i renderowania; sama ta odpowiedź nie jest pełnym testem PDF na Lambda.

## Materiały do odtworzenia lokalnie

Repo: `C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/.codex-tmp/fm-published-notice-20260922`.

W tym repo `tmp/fm-card-server-review/` zawiera:

- `review.test.mjs`, `vitest.config.mjs` i `results.log`,
- `foreign-data.png`, `accepted-foreign-logo.pdf` i render pierwszej strony `accepted-foreign-logo.png` (wyłącznie dane fikcyjne),
- `package.mjs`, `bundle-smoke.mjs`, `bundle-render.pdf`.

Polecenie reprodukcji: `npx vitest run --config tmp/fm-card-server-review/vitest.config.mjs --reporter=verbose`. Testy nigdy nie odwołują się do realnej bazy ani poczty; `fetch` jest atrapą. Kopia materiałów review jest również w `outputs/fm-card-server-review-20260922/` (skrypty reprodukcji pozostają uruchamialne z oryginalnego katalogu tmp w repo).

Nie wdrażać `90345c0` jako zamkniętej poprawki bezpieczeństwa przed rozwiązaniem P1/P2. Zaakceptowane zmiany wyglądu pozostają gotowe na `fix/fm-buyer-print-cleanup` (`8c366c4`).
