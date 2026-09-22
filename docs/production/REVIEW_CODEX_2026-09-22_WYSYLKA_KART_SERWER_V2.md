# Review Codexa: wysyłka kart — 55e8c42, v2

Data: 22.09.2026. Dla Artura i Claude’a.

**Werdykt: ochrona przed podłożeniem karty z przeglądarki poprawiona. Przed wdrożeniem trzeba jeszcze naprawić dwa błędy ponawiania wysyłki opisane poniżej.** Oba zostały odtworzone lokalnie; nie są tylko przypuszczeniem z lektury kodu. Nie wdrażałem, nie wysyłałem prawdziwych maili i nie zmieniałem produkcyjnej bazy.

Sprawdzony commit Claude’a: `55e8c42174ab387a201653a74d40b48bb952f34f` na `feat/fm-plan-send-server-card`. Lokalnie scalony bez konfliktów do `review/fm-cards-combined-20260922`, merge `037236b`. Ta gałąź zawiera też zaakceptowane zmiany karty kupca: miejsce na notatki, informację o kontaktach, usunięcie pakietu i niechcianego komunikatu/QR. Main nie został zmieniony.

## P2/1 — utrwalony PDF nie utrwala całego żądania do Resend

Miejsce: `netlify/functions/fm-plan-send.js:219–223`, użycie w linii 272.

`filename`, `subject` i `html` są budowane ponownie z aktualnego modelu i danych firmy. W buckecie utrwalone są wyłącznie bajty PDF. Zmiana nazwy firmy, języka lub numeru karty nie musi zmieniać `fm_plan_private.updated_at`. Ponowienie używa wtedy starego klucza idempotencji, ale innego żądania. Resend zwraca 409 `invalid_idempotent_request`.

Odtworzenie na prawdziwym rendererze i atrapach bazy/Resend:

1. Serwer pocztowy przyjmuje kartę A. Zapis statusu `sent` dla pierwszego adresata kończy się błędem — prawidłowo otrzymujemy `unconfirmed`.
2. Zmieniam wyłącznie nazwę firmy `Alfa Fruits` na `Alfa Fruits Updated`; plan i jego wersja pozostają te same.
3. Ponawiam wysyłkę. SHA-256 PDF jest identyczne, lecz nazwa załącznika zmienia się z `001-Alfa-Fruits-pl.pdf` na `001-Alfa-Fruits-Updated-pl.pdf`; zmienia się też treść maila.
4. Wynik: `ok=false`, `idempotency_conflict`. Poprzednie przyjęcie maila nie zostaje uzgodnione z rejestrem.

**Naprawa:** przed pierwszym wywołaniem poczty atomowo utrwalić komplet żądania dla danej próby: załącznik i jego nazwę, temat, HTML, nadawcę, reply-to, odbiorcę, tagi. Kolejne próby odtwarzają tę samą treść wraz z tym samym kluczem. Wystarczy manifest obok PDF oraz dane próby, nie trzeba dublować PDF w tabeli. Rozstrzygnięcie równoczesnego tworzenia musi wybierać jeden wspólny manifest i PDF.

Warto dodać regresje dla zmiany nazwy, języka oraz numeracji kart. Również wdrożenie nowej wersji szablonu maila nie może zmieniać treści rozpoczętej próby. Dokumentacja Resend wymaga tego samego payloadu dla tego samego klucza: https://resend.com/docs/dashboard/emails/idempotency-keys.

## P2/2 — wymuszone ponowienie nie ma własnego czasu rozpoczęcia i atomowej rezerwacji

Miejsce: `netlify/functions/fm-plan-send.js:255–262`; potwierdzenie w linii 284.

Ścieżka `force` tworzy nowy klucz z `Date.now()`, ale zostawia stary `created_at`. Następne żądanie nadal traktuje nową próbę jako starszą niż 24 godziny. Ponadto aktualizacja jest wyłącznie po `id`, bez kontroli poprzedniego klucza/generacji próby.

Odtworzone dwa przypadki:

- **Awaria potwierdzenia nowej wymuszonej próby:** stary nierozstrzygnięty wpis ma 25 godzin. Wymuszona wysyłka zostaje przyjęta, lecz zapis `sent` się nie udaje. Zwykłe ponowienie natychmiast zwraca `stale_unconfirmed`, choć nowy klucz ma kilka sekund. Następne wymuszenie tworzy jeszcze inny klucz i drugą wiadomość. Atrapa Resend z prawdziwą semantyką porównania klucza i payloadu zarejestrowała dwa maile do tego samego adresata.
- **Dwa równoczesne wymuszenia:** dwa wywołania dotyczące tego samego starego wpisu nadają różne klucze, oba wysyłają i oba zwracają sukces. W odtworzeniu: dwa zaakceptowane maile.

**Naprawa:** osobna generacja próby i `attempt_started_at`, nowy klucz nadawany atomowo przez CAS lub RPC z blokadą. Jeden stary stan może rozpocząć tylko jedną nową próbę. Drugie wywołanie odczytuje wybraną już próbę i odtwarza jej klucz/payload. Potwierdzenie wyniku także warunkować identyfikatorem/generacją próby, żeby starsze żądanie nie potwierdziło nowszego. Okno 24 godzin liczyć od rozpoczęcia bieżącej próby, zachowując historię poprzedniej. Samo przestawienie `created_at` nie rozwiązuje równoczesności.

Ostrzeżenie o możliwym duplikacie przy świadomym rozpoczęciu nowej próby po 24 godzinach jest zasadne. Nie zastępuje ochrony przed ponownym utworzeniem tej samej nowej próby.

## Co przeszło niezależną kontrolę

| Kontrola | Wynik |
|---|---|
| Pełny Vitest na gałęzi po scaleniu | 450/450, 59 plików; o 2 testy więcej niż 448 Claude’a z powodu zmian widoku kupca |
| Oryginalne testy funkcji wysyłki | 18/18 |
| Dodatkowe próby review | 3 FAIL, 1 PASS; razem z bazowymi 19 PASS / 3 FAIL |
| Build i `git diff --check 54abbdc HEAD` | OK; zwykłe ostrzeżenie o rozmiarze chunków |
| SQL na lokalnym PG od pustej bazy | Wszystkie migracje, nowa dwukrotnie, test RLS/UNIQUE/bucketu, ROLLBACK — PASS |
| Pakowanie przez Netlify zip-it-and-ship-it | PASS, z zewnętrznymi `pdfmake` i `@jsquash/webp` |
| Uruchomienie spakowanej funkcji | 401 bez tokenu; rzeczywiste dekodowanie WebP i render PDF — PASS |
| Przeglądarka przesyła PDF lub `logos` | 400, zero wywołań poczty |
| Obcy host logotypu | Brak żądania do obcego hosta; logo pominięte |
| Zwykła awaria potwierdzenia, bez zmiany danych, w ciągu 24 h | `unconfirmed`, brak fałszywego sukcesu; ponowienie odtwarza mail bez duplikatu |

Próby dodatkowe używają prawdziwego pdfmake oraz atrap Supabase/Storage/Resend; adresy mają domenę `.invalid`. Atrapa porównuje całe żądanie i klucz, a nie tylko liczbę wywołań. Żadne żądanie pocztowe nie wychodzi do sieci. Nie zmieniałem kodu wdrażanej funkcji w celu odtworzenia błędów.

## Odpowiedzi na pozostałe punkty konsultacji

**Logotypy i dostęp do kart:** pobieranie przez serwer z adresów w bazie, wymagany HTTPS i dokładny własny origin Storage, zakaz redirectów — kierunek poprawny. Nie znalazłem ponownie ścieżki przekazania dowolnych bajtów PDF/logotypu w żądaniu wysyłki. Odczyt produkcyjnych `storage.objects` policies wykazał ograniczenia do konkretnych dotychczasowych bucketów. Żadna obecna polityka nie otwiera nowego `fm-plan-cards`. Migracja ustawia go jako prywatny, a zapis/odczyt w funkcji używa service role. To ocena aktualnych polityk, nie gwarancja wobec przyszłego dodania ogólnej polityki Storage.

**Czas dla 72 dostawców:** spakowana funkcja, Node 24.15.0 na tym komputerze, sieć wyłączona: 72 dekodowania lokalnej próbki WebP ok. 205 ms, render karty 72 spotkań ok. 990 ms, PDF 906 336 B. To smoke i pomiar CPU na małej próbce, nie pomiar Lambda ani pobierania prawdziwych logotypów. Pakiet działa mimo ostrzeżenia esbuild o nieobecnym `import.meta` — ścieżka `require` rozwiązuje WASM.

Warto przenieść odczyt istniejącego artefaktu przed pobieranie logotypów: obecnie `attachCanonicalLogos` jest wykonywane także przy powtórzeniu i nawet przy już wysłanej karcie. Dla 73 różnych adresów, współbieżności 6 i timeoutu 4 s, sam przypadek opóźnionych odczytów może zająć do około 52 s. Po poprawkach i osobnej zgodzie na wdrożenie potrzebny będzie jeden test pełnej ścieżki na Lambda na adres administratora, także dla dużej karty. Samo 401 tego nie potwierdza. Uwaga wydajnościowa nie jest trzecim odtworzonym błędem.

**Stan produkcji, tylko odczyt podczas review:** `/version.json` nadal `54abbdc0942a`; `fm_plan_deliveries` nie istnieje, bucket `fm-plan-cards` nie istnieje. Zmiana Claude’a jest niewdrożona.

## Materiały do odtworzenia

W lokalnym repo `.codex-tmp/fm-published-notice-20260922`:

- `tmp/fm-card-server-review-v2/prepare.mjs` — generator zestawu (18 testów gałęzi + 4 próby review).
- `tmp/fm-card-server-review-v2/review.test.mjs`, `vitest.config.mjs`, `results.log`.
- `full-tests.log`, `build.log`, `package.log`, `bundle-smoke.log`, `bundle-render-72.pdf`.

Kopia skryptu odtworzenia i wyników: `1FMK2026/outputs/fm-card-server-review-v2-20260922/`. Uruchomić generator z katalogiem roboczym repo, następnie:

```text
node tmp/fm-card-server-review-v2/prepare.mjs
npx vitest run --config tmp/fm-card-server-review-v2/vitest.config.mjs
```

Oczekiwany wynik obecnego kodu: 3 testy czerwone odpowiadające dwóm ustaleniom powyżej. Najpierw naprawić te przypadki, ponowić review, potem migracja i wdrożenie po zgodzie Artura.
