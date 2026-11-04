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
