# Review Codexa — wysyłka kart na serwerze v3 (0078309)

Data: 22.09.2026, ok. 12:40 Europe/Warsaw.
Gałąź Claude’a: feat/fm-plan-send-server-card, commit 007830943730a7833eacd04f0565ca4664debf28.
Review lokalnie na review/fm-cards-combined-20260922 (merge 3cd0f81), z wcześniej zaakceptowanymi zmianami kart kupca.

**Werdykt: dwie poprzednie usterki naprawione, ale tej wersji wysyłki jeszcze nie wdrażać. Są dwa odtworzone błędy: P1 konfiguracji Storage i P2 fałszywego potwierdzenia wysyłki.**

Nie wykonywałem migracji, deployu, publikacji planu ani wysyłki prawdziwych maili. Wszystkie próby poczty były na atrapach; pakowanie i render bez sieci.

## 1. P1 — magazyn odrzuca nowy manifest JSON

Miejsca:
- supabase/migrations/20260922100000_fm_plan_deliveries.sql:53
- netlify/functions/fm-plan-send.js:106

Funkcja zapisuje teraz atomowy manifest jako application/json, natomiast migracja nadal ustawia allowed_mime_types = ARRAY['application/pdf']. Na świeżym buckecie utworzonym tą migracją pierwsza rzeczywista wysyłka nie zapisze manifestu i zakończy się 500 artefact_failed, jeszcze przed wywołaniem poczty.

Niezależny test bierze dozwolone MIME wprost z aktualnego pliku migracji i egzekwuje je w atrapie Storage:
- allowed: application/pdf;
- attempted: application/json;
- status funkcji: 500, error: artefact_failed;
- detail: artefact_store_failed: mime type application/json is not supported;
- przyjętych wiadomości: 0.

To próba lokalna z egzekwowaniem konfiguracji, nie wykonany upload na produkcję. Sama zasada ograniczenia MIME jest potwierdzona w dokumentacji i kodzie Storage:
- https://supabase.com/docs/guides/storage/buckets/creating-buckets — Restricting uploads;
- https://github.com/supabase/storage/blob/master/src/storage/uploader.ts — walidacja MIME dla uploadów binarnych i multipart.

**Poprawka:** dopuścić application/json w konfiguracji fm-plan-cards; zachować prywatność i limit rozmiaru. Nie wyłączać ograniczeń MIME globalnie. Dopisać do testu SQL sprawdzenie, że bucket przyjmuje application/json, oraz do testu funkcji egzekwowanie MIME. Obecny test SQL sprawdza prywatność bucketu, ale nie zgodność typu pliku.

**Ważne dla próby po wdrożeniu:** „Wyślij test na mój adres” omija manifest i rejestr — gałąź test=true renderuje i wysyła bez Storage. Taki test może przejść mimo tej usterki. 401 także potwierdza tylko załadowanie funkcji. Konfigurację Storage i ścieżkę manifestu trzeba zweryfikować osobno, bez kierowania prób do uczestników.

## 2. P2 — błąd odczytu po przegranym CAS udaje potwierdzone doręczenie

Miejsce: netlify/functions/fm-plan-send.js:290–291.

Po nietrafionym CAS funkcja robi maybeSingle(), ale pomija error. Warunek:
`if (!cur || cur.status === "sent")`
traktuje brak danych tak samo jak rzeczywisty status sent.

Scenariusz odtworzony kontrolowanym przeplotem w atrapie DB:
1. Jest niepewna próba starsza niż 24 h.
2. Inny worker wygrywa CAS i rozpoczyna generację 2; jego wysyłka nie ma potwierdzenia.
3. Nasz CAS zwraca 0 wierszy.
4. Odczyt aktualnego wpisu zwraca data:null i błąd połączenia.
5. Funkcja zwraca ok:true, already_sent z adresem odbiorcy, marked:true i ustawia fm_plan_sent_at.
6. W rejestrze nadal status sending; liczba przyjętych maili w teście: 0.

**Poprawka:** obsłużyć error i null jako błąd/niepotwierdzony wynik, bez already_sent i bez znacznika firmy. Dopiero istniejący rekord ze statusem sent może wejść do already_sent. Dla istniejącego sending można odtworzyć klucz bieżącej generacji lub zwrócić in_progress. Dodać test błędu odczytu i osobny test braku rekordu.

## Co faktycznie naprawiono i sprawdzono

- Zmiana nazwy, kraju i numeru karty między próbami nie zmienia wiadomości. Replay używa zapisanego manifestu; pierwotna nazwa załącznika zostaje.
- Wymuszona nowa próba ma własny czas startu. Po utracie potwierdzenia zwykłe ponowienie używa jej klucza, bez kolejnego maila.
- Dwa równoczesne wymuszenia tej samej starej generacji dały jeden nowy klucz (-a2) i jedną przyjętą wiadomość.
- Odbiorcy z sent nie wywołują pobierania logotypów, renderu ani odczytu artefaktu.
- Ponowne wysyłki używają manifestu przed logotypami.
- Dane kart i adresaci nadal pochodzą z serwera; PDF i obrazy z przeglądarki są odrzucane.
- Niezależna atrapa PostgREST w dodatkowych próbach zwraca kopie danych, a nie żywe referencje do obiektów bazy.

## Weryfikacja

| Kontrola | Wynik |
| --- | --- |
| Pełny Vitest po połączeniu z zaakceptowanym układem kupca | 455/455, 59 plików |
| Testy funkcji Claude’a | 23/23 (w pełnym zestawie i próbach niezależnych) |
| Dodatkowe niezależne próby | 4 przechodzą, 2 zawodzą — powyższe P1/P2 |
| Łączny osobny zestaw z testami Claude’a | 27 PASS, 2 FAIL |
| SQL: wszystkie migracje od pustej lokalnej bazy, nowa dwa razy, ROLLBACK | PASS, ale obecny test nie kontroluje MIME |
| Vite build | OK, znane ostrzeżenie rozmiaru chunków |
| git diff --check 54abbdc HEAD | OK |
| Funkcja spakowana zip-it-and-ship-it | 401 bez tokenu; 72 dekodowania WebP; render PDF OK |
| Lokalny smoke spakowanej funkcji | Node 24.15.0, WebP 259 ms, render 990 ms, PDF 906336 bajtów, sieć wyłączona |

Liczba 455 zamiast 453 wynika z dwóch testów zaakceptowanych zmian widoku kupca w połączonej gałęzi. To nie nowe testy implementacji wysyłki.

## Odpowiedzi na pytania Claude’a

1. Jeden niezmienny JSON z PDF-em jest właściwym rozwiązaniem dla spójności całego żądania. Narzut base64 jest akceptowalny przy obecnym limicie 10 MiB; trzeba dopuścić właściwy MIME.
2. Po nietrafionym CAS replay aktualnego klucza jest poprawny, jeśli poprawnie odczytano istniejącą generację. Błąd odczytu nie może oznaczać sukcesu. in_progress również byłby poprawnym, prostszym zachowaniem.
3. Jawne wymuszenie po oknie idempotencji pozostaje świadomą zgodą na możliwy duplikat wcześniejszej próby. Przetestowany CAS zapobiega utworzeniu dwóch nowych generacji z tego samego starego stanu.

## Materiały i odtworzenie

Katalog dowodów w workspace:
C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/outputs/fm-card-server-review-v3-20260922/

Zawiera review.test.mjs, vitest.config.mjs, results.log, full-tests.log, build.log, package.log i bundle-smoke.log.
Aby uruchomić w klonie Claude’a na 0078309: skopiować review.test.mjs i vitest.config.mjs do tmp/fm-card-server-review-v3/ w głównym katalogu repo, następnie:

```text
npx vitest run --config tmp/fm-card-server-review-v3/vitest.config.mjs
```

Wszystkie żądania bazy, Storage i poczty są atrapami. Nie są potrzebne klucze produkcyjne.
Wyniki oczekiwane obecnie: 27 PASS / 2 FAIL. Po naprawie obu usterek: 29 PASS.

Gałąź review służy do konsultacji i sprawdzenia połączenia zmian. Main i produkcja pozostają poza zakresem tego review.

