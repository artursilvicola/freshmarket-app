# Marketing → Aktywacja PreConnect — faza 1 (do sprawdzenia przez Codexa)

Gałąź `feat/marketing-activation` od `main` d61d7e0 (04.11.2026). Zlecenie Artura (4.11): lista kandydatów z rzeczywistym saldem, rezerwacjami, terminami ważności, wykluczeniami i podglądem PL/EN; rejestr wiadomości z niezmienną treścią, ochroną przed duplikatami i odzyskiwaniem po przerwaniu; moduł za domyślnie wyłączoną flagą; migracje addytywne uruchomione tylko w izolowanym środowisku (PGlite). **Produkcja nietknięta: migracja NIE wykonana, nic nie wdrożone, żaden prawdziwy mail nie wyszedł** (poczta w testach = atrapa).

Plan i review: `preconnect-knowledge/docs/PLAN_MARKETING_PRECONNECT_DO_REVIEW_CLAUDE.md`, `.../REVIEW_CLAUDE_PLAN_MARKETING_PRECONNECT_2026-11-04.md` (§8 = decyzje Artura).

## 1. Co jest w gałęzi

| Warstwa | Plik | Rola |
|---|---|---|
| SQL | `supabase/migrations/20261104120000_marketing_activation.sql` | 4 tabele (`marketing_campaigns`, `marketing_messages`, `marketing_suppressions`, `marketing_email_events`), RLS (odczyt admin, zapis service_role), 4 RPC `security definer` tylko dla service_role: `marketing_claim_messages` (dzierżawa + odzyskanie + needs_review + blokada bez zgody + suppresja), `marketing_record_result` (accepted/rejected/uncertain, dopinanie czekających zdarzeń), `marketing_ingest_email_event` (dedup po svix-id, bounce/complaint → suppresja), `marketing_suppress_email` (wypis) |
| SQL smoke | `scripts/marketing-sql-smoke.mjs` | cały łańcuch migracji + 23 sprawdzenia RPC/uprawnień na PGlite |
| Backend | `netlify/functions/_shared/marketing-auth.js` | admin JWT → profil role=admin, active≠false (jak send-retailer-batch) |
| | `_shared/marketing-candidates.js` | CZYSTA segmentacja: saldo 1:1 z `summarizeCreditPools`, rezerwacje 1:1 z `describeCreditUsage`, segmenty, wykluczenia z powodami, ostrzeżenia, dopasowanie do potrzeb kupców |
| | `_shared/marketing-data.js` | odczyt wierszy (companies, profiles, packages, legacy_sends, legacy_offers, suppresje, wysyłki z 30 dni) |
| | `_shared/marketing-templates.js` | 2 szablony PL/EN (`start_with_credits`, `return_active`): temat, HTML, tekst; dane z odczytu, data mailingu, termin ważności, wypis, reply-to |
| | `_shared/marketing-dates.js` | pierwszy wtorek miesiąca (jak „Najbliższe okno wysyłki”), format dat |
| | `_shared/marketing-mailer.js` | transport Resend: `Idempotency-Key` = klucz wiersza, tag `kind=marketing`, `List-Unsubscribe` + one-click, klasyfikacja accepted/rejected/uncertain, timeout 15 s; token wypisu HMAC |
| | `_shared/marketing-events.js` | rozpoznanie tagu + ingest marketingowy |
| | `marketing-candidates.js` | POST: kandydaci + podsumowanie + snapshot_at |
| | `marketing-preview.js` | POST: render dla jednej firmy z aktualnych danych (link wypisu zastępczy) |
| | `marketing-campaign.js` | list / create / get / approve (świeży odczyt → zamrożone wiersze z hashem, kluczem, snapshotem, źródłem zgody; 422 gdy brak zgody lub niekwalifikujący) / close |
| | `marketing-send.js` | batch z rejestru (claim → wysyłka zamrożonej treści → wynik; kontrola hasha; budżet czasu 20 s; wiersze po budżecie zostają claimed do odzyskania) + test na alias (osobny wiersz is_test). **Bez `MARKETING_SEND_ENABLED=true` → 403 także dla testu** |
| | `marketing-unsubscribe.js` | GET strona potwierdzenia / POST wypis / one-click (RFC 8058); bez logowania; adres z wiersza, nie z URL |
| | `resend-webhook.js` (zmiana) | router po tagu PRZED `ingest_legacy_send_email_event`; brak RPC → 200 ignored |
| | `_shared/function-env.js` (zmiana) | `marketingSendEnabled`, `marketingUnsubscribeSecret` |
| Front | `src/config/features.js` | `ADMIN_MARKETING_ACTIVATION = false` |
| | `src/lib/db.js` | `marketingCall(fn, body)` |
| | `src/components/admin/MarketingActivation.jsx` | ekran: kampanie, formularz (szablon, potrzeby kupców, reply-to), kandydaci z filtrami, źródło zgody per adresat / zbiorczo, podgląd PL/EN, zatwierdzenie, test, wysyłka z rejestru, stany |
| | `src/legacy/PreconnectFM.jsx` | pozycja „Marketing” w Operacyjnych (tylko za flagą), strona `a-marketing` |
| | `src/i18n/pl|en/legacy.json` | `admin.marketing.*`, `shell.sidebar.admin_marketing` |
| Testy | `tests/marketing-candidates.test.js` (13), `marketing-templates.test.js` (8), `marketing-send.test.js` (11), `marketing-webhook.test.js` (6), `marketing-unsubscribe.test.js` (5), `marketing.integrated.test.js` (PGlite), `src/components/admin/MarketingActivation.test.jsx` (2) | |

## 2. Zasady, które kod wymusza

1. **Marketing nie rozlicza kredytów.** Żadna funkcja marketingowa nie woła `mark_legacy_send_seen` / `charge_legacy_send_first_seen` ani nie pisze do `legacy_sends`, `legacy_send_messages`, `legacy_send_email_events`, `packages`, `wallet_tx`. Test `marketing-send.test.js` sprawdza, że każde RPC z wysyłki zaczyna się od `marketing_`; `marketing-webhook.test.js` — że zdarzenie z tagiem nie dotyka ingest legacy; smoke SQL — że rejestry legacy są puste po całym przebiegu.
2. **Rejestr i niezmienna treść.** Zatwierdzenie zapisuje wiersz z `subject/html/text_body` i `payload_hash`; wysyłka liczy hash ponownie i przy różnicy odrzuca bez maila. Unikalne `(campaign_id, profile_id)` dla wysyłek nietestowych + unikalny `idempotency_key` (`marketing:{campaign}:{profile}`).
3. **Odzyskiwanie po przerwaniu (nie tylko blokada).** `marketing_claim_messages`: `pending` → `claimed` z `lease_until` (900 s), `FOR UPDATE SKIP LOCKED`. Gdy funkcja padnie w połowie (timeout Netlify, awaria), wiersz zostaje `claimed`; po wygaśnięciu dzierżawy następne wywołanie zajmuje go ponownie (`attempts`+1) i wysyła TĘ SAMĄ treść pod TYM SAMYM kluczem — Resend w oknie 24 h oddaje tę samą wiadomość. Po `first_claim_at + 23 h` wiersz NIE jest ponawiany → `needs_review` (ręczna decyzja). Wynik `uncertain` (timeout/5xx/429/409) nie zmienia stanu: dzierżawa odzyska. Błąd zapisu wyniku po akceptacji poczty = `uncertain`, nie „sukces”.
4. **Zgoda.** `consent_source` wpisuje administrator (per adresat lub zbiorczo); nie jest przypisywana automatycznie do regulaminu 1.0. Brak źródła: approve → 422; claim → `blocked_no_consent`. UI też zatrzymuje.
5. **Wypis i blokady.** `marketing_suppressions` (lower/trim) z powodem unsubscribe/bounce/complaint/manual; claim sprawdza tuż przed wysyłką; webhook bounce/complaint zapisuje. Link wypisu = HMAC(sekret, id wiadomości), bez logowania, strona nie pokazuje adresu. Bez `MARKETING_UNSUBSCRIBE_SECRET` nie da się zatwierdzić ani wysłać.
6. **Poczta wyłączona domyślnie.** `MARKETING_SEND_ENABLED` ≠ "true" → batch i test zwracają 403. Flaga frontu `ADMIN_MARKETING_ACTIVATION=false` chowa menu i stronę.

## 3. Jak sprawdzić (polecenia)

```bash
# jednostkowe + komponent (bez bazy, poczta = atrapa)
npx vitest run tests/marketing-candidates.test.js tests/marketing-templates.test.js tests/marketing-send.test.js tests/marketing-webhook.test.js tests/marketing-unsubscribe.test.js src/components/admin/MarketingActivation.test.jsx
# regresja istniejących ścieżek poczty
npx vitest run tests/resend-webhook.test.js tests/send-retailer-batch.test.js tests/supplier-read-notify-claim.test.js
# migracja + RPC + uprawnienia na prawdziwym Postgresie (PGlite)
PGLITE_PATH="C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/tmp/review-pg-runtime-2026-10-13/node_modules/@electric-sql/pglite/dist/index.js" node scripts/marketing-sql-smoke.mjs
PGLITE_PATH=... npx vitest run tests/marketing.integrated.test.js tests/email-open-history.integrated.test.js
# całość + build
npx vitest run && npm run build
```

Wyniki Claude (04.11): cały zestaw 98 plików / wszystkie testy zielone (2 pominięte = integracyjne bez PGLITE_PATH w zwykłym przebiegu), smoke SQL „WSZYSTKO OK” (23/23), build OK, `git diff --check` czysty.

**Ręcznie (po zgodzie, na dev):** flaga `ADMIN_MARKETING_ACTIVATION=true` lokalnie + migracja na bazie testowej + `MARKETING_UNSUBSCRIBE_SECRET` w env dev; `MARKETING_SEND_ENABLED` NIE ustawiać → przycisk testowy ma zwrócić 403 `send_disabled`. Ścieżka: utwórz kampanię → „Sprawdź aktualny stan” → zaznacz → źródło zgody → podgląd PL/EN → Zatwierdź → wiersze `pending` w rejestrze → „Test” → 403 (poczta wyłączona).

## 4. Czego świadomie NIE ma w fazie 1

Kolejka z workerem/wstrzymywaniem (zastąpiona dzierżawą i wznowieniem), edytor szablonów w UI (szablony w kodzie), snapshoty z porównywaniem różnic (zmiana = nowa kampania), raport wskaźnika „nowa propozycja w 14 dni” (następna faza — dane są: `legacy_sends.created_at` per firma po `sent_at`), click tracking, grupa kontrolna w UI, segment „kup pakiet”, automatyczne szkice miesięczne, nagłówek `Precedence: bulk`.

## 5. Do decyzji / uwagi dla reviewera

1. Wartość `consent_source` jest wolnym tekstem — czy ma być słownikiem (np. `terms_1.0`, `lista_oksana_2026-11`)?
2. Test na alias wymaga tej samej flagi co prawdziwa wysyłka (decyzja Artura 4.11). Na dev/prod bez flagi przycisk zwraca 403 — zamierzone.
3. `recent_campaign` liczy 30 dni od `sent_at` wiadomości `accepted`; wiadomości testowe nie liczą się.
4. Kandydaci liczeni w jednym odczycie całych tabel (`legacy_sends` z `data`) — przy obecnych rozmiarach OK; przy wzroście przenieść do widoku SQL.
5. Router webhooka ufa tagowi z ładunku Resend (podpis Svix sprawdzony wcześniej). Zdarzenie bez tagu = legacy, jak dotąd.
6. Szablon nie używa imienia operatora (tylko nazwa firmy) — mniej danych osobowych w treści; do decyzji.
7. Wdrożenie (po osobnej zgodzie): migracja → deploy → `MARKETING_UNSUBSCRIBE_SECRET` → flip flagi frontu → pilotaż z `MARKETING_SEND_ENABLED=true` tylko na czas wysyłki. Rollback: Publish poprzedniego deployu; tabele zostają (bez wpływu na resztę), endpoint wypisu działa dopóki funkcja istnieje w opublikowanym deployu — przy cofnięciu kodu wypisy przestają działać, dlatego nie wysyłać przed stabilizacją.

## 6. Poprawki po review Codexa (1a6549d → runda 2, 04.11 po południu)

Sześć uwag, wszystkie zasadne, wszystkie poprawione i pokryte testami:

| # | Uwaga | Poprawka | Test |
|---|---|---|---|
| 1 P1 | Test na alias kopiował HTML i nagłówek wypisu z wiersza prawdziwego adresata — kliknięcie „wypisz" przez pracownika wykluczyłoby dostawcę | `marketing-send.js`: test renderuje WŁASNĄ treść dla własnego id wiersza (własny link i `List-Unsubscribe`); snapshot wiadomości ma `company_name` i `template_key`. `marketing-unsubscribe.js`: wypis z wiersza `is_test` niczego nie zapisuje | `marketing-send.test.js` (test na alias: link/nagłówek wskazują id wiersza testowego, nie m1), `marketing-unsubscribe.test.js` (wiersz testowy → brak zapisu) |
| 2 P1 | Wypis w trakcie partii nie zatrzymywał maili z już pobranej listy | nowe RPC `marketing_precheck_message` (FOR UPDATE: stan claimed, zgoda, brak suppresji; przy odrzuceniu oznacza wiersz) wołane TUŻ PRZED każdym POST do Resend; błąd precheck = pominięcie (wiersz zostaje claimed do odzyskania) | smoke SQL 6c; `marketing-send.test.js` (wypis w trakcie partii → 1 mail zamiast 2; awaria precheck → 0 maili) |
| 3 P1 | Każdy błąd zapisu zdarzenia marketingowego dawał 200 → utrata odbić/skarg przy chwilowej awarii | `marketing-events.js` rozróżnia brak funkcji (PGRST202 / „could not find the function") od błędu przejściowego; `resend-webhook.js`: brak funkcji → 200 `marketing_module_missing`, przejściowy → 500 (Svix ponowi); nadal zero wywołań ścieżki legacy | `marketing-webhook.test.js` (transient → 500; missing → 200) |
| 4 P1 | SQL szukał adresata w `payload.to`, a webhook zapisuje `payload.data.to`; odbicie sprzed powiązania nie wykluczało adresu | migracja: `coalesce(payload #>> '{data,to,0}', …)`; `marketing_record_result(accepted)` przed dopięciem czekających zdarzeń zapisuje suppresję z odbić/skarg sprzed powiązania | smoke SQL 6b (bounce z `data.to` przed powiązaniem → suppresja; skarga przed powiązaniem → `complaint` przy accepted) |
| 5 P2 | Dwustopniowy zapis wiadomości („(rendering)" → treść) zostawiał wiersz w połowie przy awarii | `marketing-campaign.js`: id losowane przed zapisem (`randomUUID`), link wypisu w treści, JEDEN insert kompletnej wiadomości; błąd lookupu istniejącego wiersza nie jest ignorowany | `marketing-campaign.test.js` (nowy: kompletny insert z hashem i linkiem dla tego id; brak zgody → 422; istniejący → pominięty; błąd insertu → brak wiersza „(rendering)") |
| 6 P2 | Błąd końcowego odczytu („co zostało") traktowany jak pusta lista → kampania fałszywie `sent` | błąd → odpowiedź z `remaining: null`, `done: false`, `warning`; kampania zostaje `sending`; błąd zamknięcia też raportowany | `marketing-send.test.js` (failLeft → status `sending`) |

Dodatkowo: wiadomości `is_test` wyłączone z claim (`is_test = false` w claim); precheck dla testu = ok. Smoke SQL: 31 kontroli (było 23). Testy marketingu: 71 (było 45).

## 7. Poprawki po review Codexa, runda 3 (abae69f → runda 3, 04.11 wieczór)

| # | Uwaga | Poprawka | Test |
|---|---|---|---|
| 1 P1 | Wypis w trakcie żądania do Resend: poczta przyjęła, a SQL odrzucał zapis wyniku (`not_claimed`, wiersz już `suppressed`) → brak `resend_message_id` i `sent_at`; funkcja ignorowała `ok:false` | `marketing_record_result`: dla wiersza `suppressed` bez id Resend wynik `accepted` zapisuje id + `sent_at` (+ `sent_before_unsubscribe` w `last_error`), stan zostaje `suppressed` (żadnych kolejnych maili); inne wyniki na `suppressed` nic nie zmieniają, powtórka nie nadpisuje id. `marketing-send.js`: `ok:false` z bazy = `uncertain` z powodem, nie „sukces" | smoke SQL 6d; `marketing-send.test.js` (wypis w locie → id i sent_at zapisane, stan suppressed; odmowa zapisu → uncertain `record_refused:not_claimed`) |
| 2 P1 | `precheck` nie sprawdzał statusu kampanii — zamknięta kampania dopuszczała zajętą wcześniej partię | `marketing_precheck_message` czyta status kampanii; inny niż `sending`/`approved` → `campaign_not_active`, wiersz wraca do `pending` bez dzierżawy (widoczny, nie wyśle się także po ponownym zajęciu) | smoke SQL 6e (zajęcie → zamknięcie → precheck odrzuca → ponowne zajęcie też odrzuca) |
| 3 P2 | Treść upraszczała rozliczanie („pobierany dopiero wtedy, gdy kupiec otworzy propozycję") i obiecywała wysyłkę („zatwierdzone … trafią do mailingu") | Oba szablony PL i EN: „Kredyt rozliczamy po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca." oraz „Przygotuj propozycję przed najbliższym mailingiem do kupców {data}. Do wysyłki kwalifikujemy propozycje zgodnie z ich aktualnym statusem." (EN odpowiednio) | `marketing-templates.test.js` (nowe zdania obecne w PL/EN dla obu szablonów, stare nieobecne) |

Smoke SQL: 40 kontroli (było 31). Testy marketingu: 74 (było 71); cała suita 834/834, build OK.

## 8. Poprawka po review Codexa, runda 4 (1272662)

| # | Uwaga | Poprawka | Test |
|---|---|---|---|
| 1 P2 | Ścieżka „przyjęta po wypisie" kończyła się `return` przed dopięciem czekających zdarzeń — webhook `email.delivered` sprzed zapisu odpowiedzi Resend zostawał `pending` bez `message_id` | `marketing_record_result`: w gałęzi `suppressed` + `accepted` po zapisaniu id i `sent_at` dopina zdarzenia `pending` dla tego id Resend (status `processed`, `message_id`), zwraca `linked_events`; wypis i ochrona przed nadpisaniem id bez zmian | smoke SQL 6d2 (zajęcie → wypis → delivered przed zapisem → accepted: zdarzenie processed z message_id, stan suppressed, id zapisane, powtórka nie nadpisuje, wypis zachowany); skrypt Codexa `1FMK2026/tmp/review-marketing-1272662.mjs` przechodzi |

Sprostowanie do rundy 3 (za Codexem): zamknięta kampania nadal pozwala SQL-owi *zająć* wiadomość (`claim` nie sprawdza statusu kampanii); blokuje dopiero `precheck` tuż przed wysyłką — i to sprawdza test. Smoke SQL: 47 kontroli.

## 9. Odbiór ekranu w przeglądarce — gdzie i co jest potrzebne (stan 04.11 wieczór)

Fakty, które wyznaczają ścieżkę:
- Aplikacja na `localhost:5173` używa **produkcyjnej** bazy Supabase (jedyny projekt B2B); lokalny `.env` nie ma klucza service_role, więc funkcje Netlify (`marketing-*`) nie uruchomią się lokalnie.
- Netlify buduje wyłącznie `main` — gałąź `feat/marketing-activation` nie ma deployu podglądowego.
- Funkcje marketingowe wymagają tabel `marketing_*` z migracji `20261104120000`; bez nich lista kampanii i zatwierdzanie zwracają błąd (odczyt kandydatów czyta także `marketing_suppressions`).

Dwie możliwe ścieżki (decyzja Artura):

**A. Deploy gałęzi na Netlify (zalecane do odbioru bez dotykania main).**
1. Netlify → Site configuration → Build & deploy → Branches and deploy contexts: dodać `feat/marketing-activation` do branch deploys (Artur, w panelu Netlify). Adres: `feat-marketing-activation--<site>.netlify.app`, te same zmienne env co produkcja.
2. Migracja `supabase/migrations/20261104120000_marketing_activation.sql` na produkcyjnym Supabase (Artur, SQL Editor, jak dotąd): addytywna, 4 puste tabele, odczyt tylko admin, zapis tylko service_role; nic nie zmienia w istniejących tabelach ani w rozliczeniach.
3. Zmienna `MARKETING_UNSUBSCRIBE_SECRET` w Netlify (losowy ciąg ≥ 32 znaki; dla kontekstu branch deploy albo wszystkich kontekstów). **`MARKETING_SEND_ENABLED` NIE ustawiać.**
4. Claude: commit na gałęzi z `ADMIN_MARKETING_ACTIVATION = true` (tylko gałąź; main nietknięty), kontrola w przeglądarce na adresie gałęzi na koncie administratora Artura: lista kampanii, utworzenie, kandydaci (salda = Finanse/Rozliczenia dla 3 firm), podgląd PL/EN, zatwierdzenie z wpisanym źródłem zgody, rejestr `pending`, przycisk testu → 403 `send_disabled`, zamknięcie kampanii.
5. Po odbiorze: kampania testowa zamknięta/usunięta, flaga z powrotem `false` przed scaleniem do main.

**B. Scalenie do main za flagą `false`.** Moduł niewidoczny dla użytkowników; funkcje wdrożone, ale nieużywane; migracja jak w A.2; odbiór wymaga chwilowego `true` na main — mniej bezpieczne niż A.

W obu ścieżkach: żaden mail nie wyjdzie bez `MARKETING_SEND_ENABLED=true`, a prawdziwy test na adres zespołu to osobna zgoda (Codex, 4.11).

## 10. Odbiór na IZOLOWANYM środowisku testowym (decyzja Codexa/Artura 04.11 wieczór) — co jest gotowe, czego brakuje

Zasada: migracja i dane odbiorowe wyłącznie na osobnej bazie testowej; preview z testowymi kluczami; `MARKETING_SEND_ENABLED` wyłączone; bez produkcyjnego klucza Resend; osobny sekret wypisu; moduł widoczny tylko w buildzie testowym; main i produkcyjny Supabase nietknięte.

**Przeszkoda (stan maszyny Artura, 04.11):** nie ma Dockera ani Supabase CLI (lokalny stack Supabase niemożliwy bez instalacji), a jedyny projekt Supabase B2B to produkcja. Potrzebny jest **osobny projekt Supabase do testów** (darmowy plan wystarczy) — zakłada go Artur w panelu Supabase (np. `fm-b2b-test`, region EU). Claude nie ma dostępu do panelu Supabase.

**Gotowe w gałęzi (bez bazy nie da się tego uruchomić, ale wszystko jest przygotowane):**
- `.env.test.example` — lista zmiennych projektu TESTOWEGO (URL, anon, service_role, connection string, sekret testowy, fikcyjny klucz Resend, `VITE_ADMIN_MARKETING_ACTIVATION=true`). Kopiuje się do `.env.test` (w `.gitignore`).
- `scripts/marketing-test-env.mjs` — stawia środowisko na bazie testowej: 72 migracje → `seed.sql` (sieci, 3 firmy bazowe) → `e2e_create_test_accounts.sql` (admin/supplier/buyer testowi) → `supabase/tests/marketing_acceptance_seed.sql`. **Bezpieczniki:** odmawia, gdy adres zawiera ref produkcyjny lub gdy w bazie są firmy spoza seedów.
- `supabase/tests/marketing_acceptance_seed.sql` — 9 fikcyjnych firm pokrywających segmenty i wykluczenia (start z kredytami + kredyty wygasające za 20 dni; powrót z wysyłkami bez odczytów i z rezerwacją; ES z operatorem EN i rezerwacją; „tylko czeka"; bez ważnych kredytów; oczekująca na zatwierdzenie; dwóch operatorów; adres w suppresji; konto ZZZ TEST), 10 operatorów `@example.test`, pakiety, wysyłki, jedna suppresja. Idempotentny.
- `scripts/dev-test.mjs` — uruchamia `netlify dev --offline` (Vite + funkcje) ze zmiennymi z `.env.test`; wymaga kompletu zmiennych (inaczej odmawia, żeby nie dociągnąć produkcji z `.env`/ustawień strony), usuwa `MARKETING_SEND_ENABLED`.
- `src/config/features.js`: `ADMIN_MARKETING_ACTIVATION` = `import.meta.env.VITE_ADMIN_MARKETING_ACTIVATION === "true"` — w buildzie produkcyjnym zmiennej nie ma → moduł niewidoczny; w buildzie testowym widoczny.

**Procedura po założeniu projektu testowego (Artur → Claude):**
1. Artur: nowy projekt Supabase; w Project Settings → API i Database odczytać URL, anon key, service_role key, hasło/connection string; wpisać do `.env.test` (lokalnie, plik niewersjonowany). Nie podawać w rozmowie.
2. Claude: `node scripts/marketing-test-env.mjs` (migracje + seedy + kontrola), potem `node scripts/dev-test.mjs`, logowanie na `http://localhost:8888` kontem `codex.admin@freshmarket.test` (z pliku e2e), odbiór: kampanie, kandydaci (salda vs Finanse/Rozliczenia dla 3 firm), podgląd PL/EN, zatwierdzenie ze źródłem zgody, rejestr, test → 403 `send_disabled`, zamknięcie kampanii, trwałość po odświeżeniu; zrzuty i wynik do tego dokumentu.
3. Po odbiorze projekt testowy można zostawić (0 danych produkcyjnych) albo usunąć.

### 10a. Poprawki skryptów po review Codexa (397b195)

| # | Uwaga | Poprawka | Test |
|---|---|---|---|
| 1 P1 | `dev-test.mjs` dziedziczył całe `process.env` i sprawdzał klucze dopiero w połączonym środowisku; fikcyjny klucz Resend niewymuszony; samo usunięcie `MARKETING_SEND_ENABLED` to słaba blokada | nowy czysty moduł `scripts/lib/test-env.mjs`: `validateTestEnv` sprawdza WYŁĄCZNIE wartości z `.env.test` (komplet 9 zmiennych, ten sam ref projektu dla frontu/backendu/connection string, równe klucze anon, ref produkcyjny odrzucany w każdej zmiennej, `RESEND_API_KEY` tylko z prefiksem `re_test_`, `MARKETING_SEND_ENABLED=true` odrzucane, sekret ≥ 24 znaki, `B2B_APP_URL` = localhost); `buildChildEnv` przekazuje potomnemu tylko minimalną bazę systemową + `.env.test`, jawnie `MARKETING_SEND_ENABLED=false`, pusty `NETLIFY_AUTH_TOKEN`, bez `RESEND_WEBHOOK_SECRET` — nic z Supabase/Resend/Netlify rodzica nie przechodzi | `tests/marketing-test-env.test.js` (8): brak klucza w pliku odrzucony mimo obecności w procesie, ref produkcyjny, rozjazd projektów, prawdziwy klucz Resend, flaga wysyłki, izolacja potomnego (brak PROD-KEY/ref/tokenu w env) |
| 2 P2 | „already exists" pomijało cały plik migracji/seedu — konflikt na początku pliku nie dowodzi wykonania reszty | rejestr `public._test_env_migrations`: plik wykonywany raz, wpis tylko po pełnym sukcesie; KAŻDY błąd zatrzymuje skrypt z nazwą pliku (bez dopasowywania tekstu błędu); pierwsze uruchomienie wymaga pustej bazy (jest `public.companies` bez rejestru → odmowa); seedy: każdy błąd = STOP; kontrola stanu końcowego (9 firm TEST, 10 operatorów, tabele marketingowe, liczba wpisów rejestru = liczba plików) | próby ręczne: bez `.env.test` → kod 2; ref produkcyjny → kod 3; rozjazd projektów + prawdziwy klucz → kod 3 (oba skrypty) |

### 10b. Poprawki skryptu przygotowania bazy po review Codexa (0a0865a)

| # | Uwaga | Poprawka | Test |
|---|---|---|---|
| 1 P1 | `exitCode = 1; return;` zwracał `undefined` → `process.exit(undefined)` = sukces mimo błędu | logika w `scripts/lib/test-env-runner.mjs` (`prepareTestDatabase` z wstrzykiwanym klientem) zwraca JAWNIE 0 / 1 / 3; wrapper `marketing-test-env.mjs` kończy `process.exit(code)`, a nieoczekiwany wyjątek → 1 | `tests/marketing-test-env-runner.test.js` (atrapa klienta): błąd SQL → 1; błąd seedu → 1; rozjazd stanu → 1; niepusta baza bez rejestru → 3; awaria samego ROLLBACK nie maskuje 1 |
| 2 P2 | SQL pliku i wpis do rejestru w osobnych zapytaniach — awaria między nimi = migracja bez wpisu, ponowienie wykonałoby ją drugi raz | każdy plik: `BEGIN` → SQL (własne `begin;`/`commit;` usunięte z pliku) → `INSERT` do rejestru → `COMMIT`; każdy błąd → `ROLLBACK` całości (SQL też wycofany); pliki z rejestru pomijane. `ALTER TYPE … ADD VALUE` (052) jest osobnym plikiem/transakcją, 053 kolejną — zgodne z PG ≥ 12 | ten sam plik testów: sekwencja BEGIN→SQL→INSERT→COMMIT; awaria MIĘDZY SQL a wpisem → `rollback`, brak `commit`, kod 1; zarejestrowane pominięte. **Prawdziwy SQL**: `tests/marketing-test-env.integrated.test.js` (PGlite) — 71 migracji w transakcjach, 3 seedy, stan końcowy, drugi przebieg bez nowych wpisów |

Uwaga do skryptu odtwarzającego Codexa (`review-test-env-0a0865a.mjs`): wycinał on `async function main()` ze starego pliku i wstrzykiwał atrapę — po refaktorze logika jest w module z wstrzykiwanym klientem, więc ten sam scenariusz jest teraz zwykłym testem jednostkowym (`błąd SQL migracji → … JAWNY kod 1`).

### 10c. Przebieg odbioru 04.11 wieczór — ZATRZYMANY na haśle bazy testowej (nic nie wykonano)

Projekt testowy: `rruszzdffclfhbtfeznb` (region eu-west-1). Artur przygotował `.env.test` i wyszedł; Claude działał sam.

| Krok | Wynik |
|---|---|
| Walidacja `.env.test` (`validateTestEnv`) | OK: jeden ref dla VITE/SUPABASE/DB, ref produkcji odrzucany, `RESEND_API_KEY` = `re_test_…`, `MARKETING_SEND_ENABLED` ≠ true, sekret wypisu 32 znaki, URL aplikacji = localhost |
| Klucze anon / service_role wobec REST projektu testowego | uwierzytelniają się (odpowiedź `PGRST205` = tabela nie istnieje, a nie 401) → **baza pusta, bez `public.companies` i bez tabel `marketing_*`** |
| `node scripts/marketing-test-env.mjs` | **STOP, kod 1**: `password authentication failed for user "postgres"` (28P01) — przed jakąkolwiek migracją, rejestr `_test_env_migrations` nie powstał |
| Diagnoza (bez wypisywania sekretu) | host = pooler sesyjny `aws-0-eu-west-1`, user `postgres.<ref>`, DB `postgres` — poprawne (pooler znajduje tenanta; inne regiony „tenant not found”). Hasło: 14 znaków, bez `%`, `#`, `?`, `/`, `@`, cudzysłowów i spacji, nie obcinane przez parser URL. To samo hasło odrzucone na :5432, :6543 i po zdekodowaniu. Host bezpośredni `db.<ref>.supabase.co` nie rozwiązuje się (IPv6 bez dodatku IPv4) — pooler jest właściwą drogą. |
| Wniosek | **hasło w `TEST_DATABASE_URL` nie jest hasłem bazy tego projektu** (najpewniej hasło konta/dashboardu albo hasło sprzed resetu). Do zrobienia przez Artura: Supabase → projekt testowy → Project Settings → Database → *Reset database password*, nowe hasło (najlepiej same litery i cyfry) wkleić w `.env.test` w miejsce starego; reszta URL bez zmian. Potem ponownie `node scripts/marketing-test-env.mjs`. |
| Produkcja | nietknięta (skrypt odrzuca ref produkcji; żadne polecenie nie poszło do `sklyfuvzjikkqerxtulo`). Wysyłka maili: wyłączona. |

**Ciąg dalszy 04.11 ~17:30 (po resecie hasła bazy):**

| Krok | Wynik |
|---|---|
| `node scripts/marketing-test-env.mjs` | **OK, kod 0**: połączono (PostgreSQL 17, ref `rruszzdffclfhbtfeznb`), rejestr utworzony na pustej bazie, **71 migracji** w transakcjach, 3 seedy; stan = oczekiwany (`test_companies 9, test_operators 10, admins 1, packages 9, suppressions 1, marketing_tables true, migrations_registered 71`) |
| Podgląd `fm-b2b-test` (`netlify dev --offline`, port 8888) | start OK; `.env` ignorowany dla `VITE_SUPABASE_*` (proces ma pierwszeństwo), funkcje `marketing-*` załadowane. Uwaga: `netlify dev` dociąga z lokalnego `.env` zmienne `PAYU_*` — moduł Marketing ich nie używa, nie wywoływano funkcji PayU |
| Logowanie `codex.admin@freshmarket.test` | OK, pozycja „Marketing” w menu (flaga testowa), ekran „Marketing → Aktywacja PreConnect” renderuje się (formularz nowej kampanii, lista kampanii) |
| `marketing-campaign` (lista) | **403 `profile_not_found`** mimo że profil admina istnieje w bazie (sprawdzone przez `pg`: 13 profili, 1 admin, trigger `on_auth_user_created` aktywny) |
| Przyczyna | w `.env.test` pod `SUPABASE_SERVICE_ROLE_KEY` wklejono **klucz anon** (identyczny z `SUPABASE_ANON_KEY`, rola JWT `anon`) → klient „service” podlega RLS i nie widzi profili. Walidator tego nie wykrywał. |
| Poprawka | `validateTestEnv`: odmowa gdy `SUPABASE_SERVICE_ROLE_KEY` = anon, gdy JWT ma rolę ≠ `service_role`, oraz gdy pod anon trafi JWT `service_role` (klucze `sb_secret_…` bez JWT przechodzą); helper `jwtRole`; test 9/9 (`tests/marketing-test-env.test.js`). Na aktualnym `.env.test` `dev-test.mjs` i `marketing-test-env.mjs` teraz odmawiają z czytelnym komunikatem. |
| Do zrobienia przez Artura | Supabase → projekt testowy → Project Settings → API → **service_role** (legacy JWT secret) → wkleić do `.env.test` jako `SUPABASE_SERVICE_ROLE_KEY`. Baza jest już przygotowana — ponowny `marketing-test-env.mjs` nic nie powtórzy (rejestr), wystarczy `preview_start fm-b2b-test`. |

### 10d. ODBIÓR UI WYKONANY 05.11 ~08:05–08:25 na bazie testowej `rruszzdffclfhbtfeznb` (pełny przebieg)

Warunki: `.env.test` z poprawnym `service_role` (walidator OK, rola JWT `service_role`), `netlify dev --offline` na porcie 8888, konto `codex.admin@freshmarket.test`, `MARKETING_SEND_ENABLED` wyłączone, Resend `re_test_…`. Produkcja i `main` nietknięte. Zrzuty: `docs/production/odbior-marketing-2026-11-05/01…06.jpg`.

| Krok §9 | Wynik | Dowód |
|---|---|---|
| Lista kampanii | OK — pusta na starcie („Brak kampanii”), potem 1 i 2 pozycje ze statusem, szablonem i licznikiem wiadomości | `marketing-campaign` list → 200 |
| Utworzenie kampanii | OK — „ODBIÓR test 05.11 — pierwsza propozycja”, szablon start, kategorie owoce/warzywa, słowa jabłka/pomidory, reply-to; wiersz w `marketing_campaigns` (draft) | create → 200; SQL |
| Kandydaci | OK — 12 firm (9 seed + 3 z seed.sql), **3 kwalifikują się** (Garcia EN powrót+rezerwacja, Kowalski start + „kredyty wygasają <30 dni”, Nowak powrót 13 = 3 bezpł./10 kup., 3 wysyłki/1 odczyt); segmenty start 4 / powrót 2 / tylko czeka 1 / bez kredytów 5; wykluczenia nakładające się (nieaktywne 4, PreConnect wył. 4, brak kredytów 5, brak operatora 2, tylko oczekiwanie 1, wypis 1, konto testowe 1, kilku operatorów 1); „pokaż wykluczone” pokazuje każdą firmę z powodami | 01-kandydaci.jpg |
| Salda vs baza | **1:1 z `company_capacity`** dla wszystkich 9 firm TEST (qty_remaining, pule free/paid, `Ważne do` = najbliższy termin puli: Nowak 2027-01-03 mimo paid do 2027-08-31); rezerwacje z `legacy_sends` (Garcia approved=1, „Wszystko w toku” 5/5) | SQL |
| Podgląd PL/EN | OK — Kowalski PL: „Masz 5 kredytów PreConnect — najbliższy mailing do kupców 1 grudnia 2026”, termin 24 listopada 2026, zdania po review r2; EN: „You have 5 credits in PreConnect — next buyer mailing on 1 December 2026”; link wypisu w podglądzie = atrapa `m=PODGLAD` | 02/03-podglad-*.jpg, `marketing-preview` → 200 ×2 |
| Zatwierdzenie bez źródła zgody | OK — UI zatrzymuje („Każdy adresat musi mieć wpisane źródło zgody…”), serwer nie wołany | brak żądania approve |
| Zatwierdzenie ze źródłem zgody | OK — zbiorcze źródło „regulamin B2B 1.0 §9 + deklaracja Artura 04.11 (odbiór testowy)”, confirm „Zamrozić treść i listę 3 adresatów?…”, approve → `approved: 3, skipped: [], problems: []`; kampania `approved`, `approved_by` = admin | approve → 200; SQL |
| Rejestr | OK — 3 wiersze `pending`, 0 prób, tematy per język (Garcia EN „4 credits”, Nowak PL „13 kredytów”), **3 unikalne klucze idempotencji i 3 hashe**, snapshot z `company_name`/`template_key`/`credits_remaining`, `is_test=false` | 04-rejestr-po-zatwierdzeniu.jpg; SQL |
| Przycisk Test (adres `artur.stasiak+mktest@…`) | OK — **403 `send_disabled`** („MARKETING_SEND_ENABLED nie jest ustawione na true — wysyłka (także testowa) wyłączona…”), toast z tą treścią widoczny u góry ekranu; **żaden mail nie wyszedł** | `marketing-send` → 403 ×3 |
| „Wyślij z rejestru” | OK — confirm „Wysłać 3 oczekujących wiadomości? Każda idzie raz, pod stałym kluczem.” → **403 `send_disabled`**; rejestr bez zmian (pending, 0 prób, brak claim/lease), 0 zdarzeń webhooka | `marketing-send` → 403; SQL |
| Zamknięcie kampanii | OK przez funkcję (`action: close` → 200) i — po poprawce niżej — **przyciskiem w UI** (druga kampania „zamknięcie z UI (powrót)”: confirm → `closed`, przycisk znika) | 06-zamkniecie-z-ui.jpg |
| Trwałość po odświeżeniu | OK — po przeładowaniu strony lista pokazuje „zamknięta · 3 wiad.”, otwarcie kampanii pokazuje kandydatów i rejestr; w kampanii zamkniętej brak „Zaznacz/Zatwierdź/Wyślij” | 05-kampania-zamknieta-po-odswiezeniu.jpg |

**Poprawka po odbiorze (do review Codexa):** §9 pkt 4 obiecywał „zamknięcie kampanii” w UI, a komponent nie miał przycisku (akcja istniała tylko w `marketing-campaign.js`). Dodano `mk-close` „Zamknij kampanię” (widoczny gdy status ≠ closed, `window.confirm` z nazwą kampanii, `action: close`, odświeżenie listy i kampanii) + klucze i18n PL/EN `close_campaign` / `close_confirm` / `closed_toast` + test komponentu (anulowany confirm nie woła serwera; potwierdzony woła `close` z `campaign_id`). Pełny zestaw po zmianie: **102 pliki, 867 zaliczonych, 1 pominięty** (z PGlite).

**Obserwacje do decyzji (nie blokują fazy 1):**
1. Szablon treści = `campaign.template_key` dla wszystkich zatwierdzonych (podgląd i wysyłka spójne), a segment wiersza (`row.template_key`) jest tylko informacją. W kampanii „powrót” kwalifikuje się także firma „start z kredytami” (Kowalski) i dostałaby treść „powrót”. Administrator musi filtrować po segmencie przed „Zaznacz widoczne”. Propozycja na fazę 2: ostrzeżenie lub blokada przy niezgodności segment ≠ szablon kampanii.
2. Przyciski „Test” w rejestrze są widoczne także w kampanii zamkniętej (wysyłka testowa z zamkniętej kampanii nadal wymaga flagi; `marketing_precheck_message` dotyczy wierszy prawdziwych). Do rozważenia: ukryć Test po zamknięciu.
3. `netlify dev --offline` dociąga z lokalnego `.env` zmienne `PAYU_*` (produkcyjne) do procesu podglądu — moduł Marketing ich nie używa i funkcje PayU nie były wołane, ale `buildChildEnv` mógłby je jawnie odciąć (`PAYU_*`), żeby podgląd testowy nie miał żadnego sekretu produkcji.
4. Toast błędu renderuje się u góry strony; przy przewiniętej tabeli (szerokiej) komunikat `send_disabled` bywa poza ekranem — kosmetyka.
5. W przeglądarce nie było błędów konsoli z funkcji `marketing-*` (wszystkie 200/403 zgodnie z oczekiwaniem).

**Stan bazy testowej po odbiorze:** 2 kampanie `closed`, 3 wiadomości `pending` (nigdy nie wysłane), 0 zdarzeń. Można zostawić do kolejnych prób albo wyczyścić `delete from marketing_messages; delete from marketing_campaigns;` (tylko baza testowa).

### 10e. Izolacja podglądu od plików `.env*` repo (review Codexa 05.11 rano) — WYKONANE

**Problem:** `netlify dev` uruchamiany w katalogu repo wczytuje domyślne `.env`, `.env.local`, `.env.development(.local)` (log z 04.11: „Injected .env file env vars: PAYU_*” — negatywna próba kontrolna), a Vite czyta te same pliki z katalogu projektu. Czyste środowisko procesu potomnego tego nie blokowało.

**Rozwiązanie (bez zmian i bez usuwania plików `.env*`; produkcyjne `netlify.toml`, `vite.config.js`, `.env` nietknięte):**
- `scripts/lib/preview-isolation.mjs` → `preparePreviewDir()`: katalog `.preview-test/` (git-ignored, własny `.gitignore` `*`) z **własnym `netlify.toml`** (`[dev] framework="#custom"`, `command="node ../scripts/vite-test.mjs"`, `targetPort=5173`, `port=8888`, `envFiles=[".env.preview-none"]` — plik celowo nieistniejący, więc CLI nie wczytuje żadnego `.env*`; `functions` = ścieżka ABSOLUTNA do `.preview-test/functions`, bo `@netlify/config` liczy ścieżki od korzenia repo, nie od CWD), **atrapami funkcji** re-eksportującymi prawdziwe handlery z `netlify/functions/` (29/29: `export { handler }` albo `export { default }` dla funkcji v2; bundler podąża za importami do `_shared/` i `src/`), funkcją diagnostyczną `preview-env-check` (tylko w podglądzie; zwraca obecność/klasy zmiennych, nigdy wartości) i **pustym `vite-env/`**.
- `scripts/vite-test.mjs`: Vite programowo z `configFile = vite.config.js` repo, `envDir = .preview-test/vite-env` (pusty, odmowa startu gdy leży tam jakiś `.env*`), `open=false`, port 5173 → `VITE_*` wyłącznie z procesu, czyli z `.env.test`.
- `scripts/dev-test.mjs`: walidacja `.env.test` → `preparePreviewDir` → `netlify dev --offline --port 8888 --no-open` z **CWD = `.preview-test/`**.
- `.gitignore`: `.preview-test/`, `.env.development.local` (kanarek testu).

**Testy:**
- `tests/marketing-preview-isolation.test.js` (4): atrapy per styl eksportu (CJS pomijany z ostrzeżeniem), toml z nieistniejącym `envFiles` i `#custom`, ścieżka atrapy rozwiązuje się do prawdziwego pliku, pusty envDir, drugi przebieg usuwa podrzucone `.env*`, pliki env repo nietknięte, funkcja diagnostyczna bez wartości.
- `tests/marketing-preview-isolation.integrated.test.js` (gated `FM_PREVIEW_ISOLATION_TEST=1`, prawdziwy start): kładzie tymczasowy `.env.development.local` z **kanarkiem** `FM_ISOLATION_CANARY` + `VITE_FM_ISOLATION_CANARY` (odmowa, gdy plik istnieje; usuwany w `finally`), startuje `scripts/dev-test.mjs`, po pełnym starcie: `preview-env-check` → `canary_present=false`, `vite_canary_present=false`, `payu_keys=0`, `supabase_ref`/`vite_supabase_ref` = ref testowy, `service_role_present=true`, `marketing_send_enabled="false"`, `resend_key_prefix="re_test_"`, `netlify_auth_token_present=false`; frontend: wstrzyknięta linia `import.meta.env = {…}` w `/src/config/features.js` zawiera ref testowy i `VITE_ADMIN_MARKETING_ACTIVATION:"true"`, a NIE zawiera kanarka, `PAYU_`, `SERVICE_ROLE` ani ref produkcji; log bez „.env file”. **Przebieg 05.11 ~08:48: PASS (39 s)**, kanarek usunięty, porty zwolnione.
- Pełny zestaw po zmianach: patrz niżej.

**Ręczna próba 05.11 ~08:44 (przed testem):** 30 funkcji załadowanych z `.preview-test/functions` (w tym 4 v2 z ostrzeżeniem CLI o CommonJS — odpowiadają poprawnie: `staff-login` → własny błąd braku `STAFF_PIN_PEPPER`, `fm-queue-snapshot` → 405 na POST), `marketing-campaign` bez tokenu → 401, log bez „Injected/Ignored .env file”.

**Pełny zestaw po zmianach (05.11 ~08:50):** 103 pliki zaliczone, 1 pominięty (test zintegrowany bez flagi), **871 testów zaliczonych, 2 pominięte**.

### 10f. Poprawka testu izolacji po review Codexa (P2: test mógł zaliczyć cudzy, wcześniej uruchomiony podgląd)

**Zmiany:**
- `scripts/dev-test.mjs`: parametry `FM_PREVIEW_PORT` / `FM_PREVIEW_VITE_PORT` / `FM_PREVIEW_DIR` (nazwa musi zaczynać się od `.preview-test`) / `FM_PREVIEW_RUN_ID` (domyślnie losowy UUID). **Zajęty port = odmowa z kodem 4**, skrypt nigdy nie zatrzymuje cudzego podglądu. Identyfikator przebiegu trafia do procesu funkcji (`FM_PREVIEW_RUN_ID`) i do frontendu (`VITE_FM_PREVIEW_RUN_ID`, tylko podgląd testowy).
- `scripts/lib/preview-isolation.mjs`: `preview-env-check` zwraca `run_id`; nowy `isPortFree(port)` — próba POŁĄCZENIA na 127.0.0.1 i ::1 (sukces = zajęty) oraz próba nasłuchu na 127.0.0.1/0.0.0.0/::1/:: (błąd = zajęty), bo Windows pozwala nasłuchiwać na 0.0.0.0 obok cudzego nasłuchu na 127.0.0.1.
- `scripts/vite-test.mjs`: `cacheDir` per katalog podglądu (drugi podgląd nie przebudowuje `node_modules/.vite` działającego).
- `.gitignore`: `.preview-test*/`.
- Test zintegrowany: WŁASNE porty 18888/15173 i katalog `.preview-test-canary` (może biec obok prezentacji), **odmowa gdy port zajęty** (bez zabijania), losowy `runId` nadany przez test i porównany w odpowiedzi funkcji (`run_id`) oraz w `import.meta.env` frontendu (`VITE_FM_PREVIEW_RUN_ID`), **zakończenie procesu przed gotowością = błąd z ogonem logu**, log musi zawierać katalog i run_id tego przebiegu, proces żyje w chwili asercji.
- Testy jednostkowe (6): + `run_id` w diagnostyce, `isPortFree` (zajęty → false bez zabijania, zwolniony → true), katalog o innej nazwie z własnymi portami nie dotyka domyślnego.

**Przebiegi 05.11 ~09:20 przy DZIAŁAJĄCEJ prezentacji na 8888:**
- test z kanarkiem na 18888/15173: **PASS (73 s)**, run_id zgodny w funkcji i froncie, kanarek nieobecny, PAYU 0, ref testowy; po teście porty testu wolne, kanarek usunięty, prezentacja na 8888 nadal odpowiada.
- próba kontrolna: `node scripts/dev-test.mjs` na domyślnych portach → `ODMOWA: port 8888 (netlify dev) jest zajęty…`, kod 4, prezentacja nietknięta.
- pełny zestaw:  Test Files 103 passed | 1 skipped (104); Tests 873 passed | 2 skipped (875);
- Uwaga: podgląd prezentacyjny na 8888 wystartował PRZED tą zmianą (bez `run_id`); po restarcie będzie go zwracał. Katalog `.preview-test-canary/` zostaje (git-ignored).
