# Pakiet do review — historia otwarć per kupiec i niezawodne rozliczanie (22.10.2026)

Gałąź **`feat/email-open-history`** od `origin/main` = `7d35f52`. Dwa commity: `d564702` (zmiana), `2b65a17` (test zintegrowany).
**Nic nie wdrożono. Żadnych zmian danych produkcyjnych. Żadnych wysyłek.**

Zlecenie: notatka Codexa z 22.10 (pięć punktów). Decyzja Artura zachowana: **otwarcie maila nadal rozlicza kredyt**.

## 1. Co się zmienia — mapa

| warstwa | plik | co |
|---|---|---|
| baza | `supabase/migrations/20261022120000_email_open_history.sql` | 3 tabele, 5 RPC, RLS, uprawnienia (addytywna, idempotentna) |
| wysyłka | `netlify/functions/send-retailer-batch.js` | `Idempotency-Key` per (sieć, zestaw, kupiec); powiązanie po akceptacji; sieroty; raport |
| webhook | `netlify/functions/resend-webhook.js` | zapisz → przetwórz → potwierdź; 5xx tylko tam, gdzie ponowienie ma sens |
| rejestr | `netlify/functions/_shared/email-events.js` (nowy) | ingest / process / record / pending |
| odczyt | `netlify/functions/_shared/legacy-send-seen.js` + `mark-buyer-preconnect-seen.js` + `notify-supplier-read.js` | atrybucja wejścia do uwierzytelnionego kupca |
| UI | `src/components/admin/RetailerMailingHistory.jsx/.css`, `src/lib/db.js`, i18n PL/EN | odbiorcy + wejścia do aplikacji, osobno |
| testy | `tests/resend-webhook.test.js` (nowy), `tests/send-retailer-batch.test.js`, `RetailerMailingHistory.test.jsx`, `scripts/email-open-history-sql-test.mjs` (nowy), `tests/email-open-history.integrated.test.js` (nowy) | |

Pełny diff: `git diff 7d35f52..2b65a17` (16 plików w zmianie + 1 test).

## 2. Punkty zlecenia → realizacja

**1. Trwałe powiązanie wiadomości z odbiorcą.** `legacy_send_messages(resend_message_id PK, retailer_id, buyer_profile_id, to_email, legacy_ids bigint[], send_key, locale, sent_at)`. Zapis przez `record_legacy_send_message` zaraz po `r.id` z Resend, per kupiec, z DOKŁADNYMI `legacy_ids` tego maila. Historycznych przypisań NIE odtwarzamy — tura 07.10 i starsze zostają bez powiązań, UI mówi to wprost („wysyłka sprzed wprowadzenia historii per kupiec").

**2. Trwały rejestr zdarzeń.** `legacy_send_email_events(event_id PK = svix-id, resend_message_id, event_type, occurred_at, received_at, payload, status, attempts, processed_at, last_error, result)`. `ingest_legacy_send_email_event` deduplikuje po svix-id; zdarzenie bez powiązania dostaje `orphan` i wraca do `pending`, gdy `record_legacy_send_message` je zapisze (zwraca `pending_events`, batch przetwarza od razu). Nic nie jest odrzucane bezpowrotnie.

**3. Niezawodność webhooka.** Kolejność: podpis + anty-replay → `ingest` → przetwarzanie → `finish`.
- zła sygnatura / brak nagłówków / stary timestamp / zły JSON → `200 ignored` (ponowienie nic nie da);
- `ingest` padł → **500** (Svix ponawia; zdarzenie nie przepada);
- duplikat svix-id w stanie `processed/orphan/ignored` → `200 duplicate`, bez przetwarzania;
- duplikat w stanie `error/pending` (= ponowienie po naszym 500) → przetwarzany ponownie;
- przejściowy błąd rozliczenia (choćby jednej propozycji) → zdarzenie `error`, **500**; ponowienie dorozlicza tylko brakujące (reszta chroniona znacznikiem);
- `email.delivered/bounced/complained/clicked/sent/delivery_delayed` → historia, `200`.
Podpis Svix i okno 10 min bez zmian. `scrubPayload` zapisuje tylko to, co potrzebne do historii.

**4. Jedno rozliczenie mimo wielu kupców.** `email.opened` woła istniejące `markLegacySendsSeen` z `channel: "email"` **wyłącznie** dla `legacy_ids` z powiązania tej wiadomości → `mark_legacy_send_seen` → `charge_legacy_send_first_seen` (idempotentne po znaczniku, FOR UPDATE). Bez drugiego mechanizmu, bez zapisu całego JSON-u. Wygasłe → `skipped`, bez wznowienia. Maile logowania i powiadomienia dostawców nie mają powiązania → `orphan`, nigdy nie rozliczają.

**5. Widok administratora.** Po rozwinięciu „Historia wysyłek" przy sieci: jedno RPC `admin_retailer_email_history` (guard `is_admin()`), tabela odbiorców (kupiec, adres z chwili wysyłki, wysłano, dostarczono, pierwsze/ostatnie otwarcie z liczbą, status błędu) i OSOBNA tabela „Wejścia do aplikacji" (kupiec, propozycja, rodzaj lista/otwarcie, pierwsze/ostatnie, razem). Brak zdarzenia → „Brak zarejestrowanego otwarcia". Nota o przybliżoności piksela.

**Bezpieczeństwo.** RLS na trzech tabelach: SELECT tylko `is_admin()`; `anon` nic; zapis wyłącznie `service_role` przez RPC (`security definer`, `search_path = public`, execute tylko `service_role`); `admin_retailer_email_history` dla `authenticated` z guardem w środku. Dostawcy niczego nie widzą. Routing po kategoriach nietknięty; powiązanie przyjmuje różne zestawy propozycji u różnych kupców.

## 3. Wyniki testów

| zestaw | wynik | jak uruchomić |
|---|---|---|
| migracja na prawdziwym Postgresie (PGlite 18.6) | **9/9** | `PGLITE_PATH=… node scripts/email-open-history-sql-test.mjs` |
| zintegrowany: prawdziwy webhook + prawdziwe RPC rozliczeń + **cały łańcuch 70 migracji** | **10/10** | `PGLITE_PATH=… npx vitest run tests/email-open-history.integrated.test.js` |
| webhook (atrapa bazy, podpis liczony naprawdę) | 11/11 | `npx vitest run tests/resend-webhook.test.js` |
| batch wysyłki (5 nowych przypadków) | 17/17 | `npx vitest run tests/send-retailer-batch.test.js` |
| komponent historii (3 nowe) | 10/10 | `npx vitest run src/components/admin/RetailerMailingHistory.test.jsx` |
| całość z PGlite | **744/744** (+1 jawnie pominięty placeholder) | `PGLITE_PATH=… npx vitest run` |
| build, `git diff --check` | OK | |

Scenariusze z zlecenia pokryte w teście zintegrowanym: dwóch kupców jednej sieci; ponowne i równoczesne otwarcia; odczyt w aplikacji przed mailem i po nim; duplikaty webhooka; awaria bazy; zdarzenie przed powiązaniem; wygasła propozycja; mail niezwiązany z propozycjami; przejściowy błąd rozliczenia z ponowieniem. Awaria zapisu po akceptacji przez Resend (brak drugiej wysyłki) — w teście jednostkowym batcha.

Czułość sprawdzona w trakcie: błąd w efekcie komponentu (anulowanie własnego żądania) złapany przez nowy test; `xmax` w PL/pgSQL i dwuznaczność ścieżek Windows złapane przez testy na prawdziwym SQL-u.

## 4. Niewykonane kontrole — wprost

1. **Batch na prawdziwym SQL-u.** Embed PostgREST `profiles!fk_profiles_retailer(...)` jest poza możliwościami cienkiego shimu; batch ma 17 testów jednostkowych z atrapą. Pełna ścieżka batch → Resend → webhook na prawdziwym SQL-u pozostaje do próby na kontach testowych.
2. **Rzeczywista wysyłka i rzeczywiste zdarzenie Resend.** Lokalnie nie do zrobienia. Wymaga aktywnej domeny śledzącej (`links.freshmarket.eu`, stan: Pending w Resend) i próby na aliasie `artur.stasiak+kupiec@freshmarket.eu`.
3. **Sweep sierot i błędów.** Zdarzenia w `orphan` są dobierane przy zapisie powiązania, zdarzenia w `error` ponawia Svix. Nie ma osobnego cyklicznego przebiegu (Netlify tu nie ma crona). Jeśli Svix wyczerpie ponowienia, zdarzenie zostaje w `error` z `last_error` — widać to w historii admina, ale nikt go automatycznie nie dokończy. Do decyzji: osobna funkcja „sweep" wołana ręcznie z panelu.
4. **Wydajność `admin_retailer_email_history`** przy dużej historii: agregacja per wiadomość w `lateral`; indeksy są; nie mierzyłem na produkcyjnej liczbie wierszy (dziś: zero, tabele puste).

## 5. Kolejność wdrożenia

1. Punkt powrotu: tag `prod-rollback-2026-10-22-open-history` = `7d35f52`. Kopia odczytowa `legacy_sends` (count + md5) jak 13.10.
2. **Migracja** `20261022120000_email_open_history.sql` w SQL Editorze (sha256 wklejki = repo). Kontrola po: 3 tabele, RLS on, 0 polityk zapisu, 5 RPC `secdef`, ACL (anon nic; authenticated tylko `admin_retailer_email_history` + SELECT przez RLS; service_role execute), `legacy_sends` md5 bez zmian.
   - Stary kod po migracji: działa bez zmian (nie zna nowych tabel).
   - Nowy kod bez migracji: webhook → `ingest_failed` → 500 (Svix ponawia, nic nie ginie); batch → `recipient_links_unrecorded` (mail idzie, historia niepełna). Nic nie rozlicza na ślepo. Mimo to kolejność: **migracja → deploy**.
3. **Deploy** `2b65a17` → `main` (fast-forward), kontrola `/version.json`, funkcje odpowiadają (`resend-webhook` bez nagłówków → `missing_svix_headers`).
4. **Próba na kontach testowych** (po aktywacji domeny śledzącej): nowa propozycja testowa → batch → w `legacy_send_messages` wiersz per kupiec; otwarcie maila → w Resend „Opened", w rejestrze `email.opened processed`, `qty_used` +1 raz; drugie otwarcie i wejście do aplikacji → zero dodatkowych pobrań, wejście w `legacy_send_app_reads`; w panelu admina obie tabele.

## 6. Plan wycofania

- **Aplikacja:** Netlify „Publish deploy" poprzedniej wersji (`7d35f52`). Stary webhook i batch nie dotykają nowych tabel; stary webhook zapisuje otwarcia jak dotąd (po `resend_message_id`/`resendMessageIds`).
- **Migracja:** NIE cofać. Addytywna; tabele mogą zostać puste. Gdyby trzeba było usunąć: `drop function` ×5, `drop table` ×3 — kolejność dowolna, bez wpływu na `legacy_sends`, `packages`, `wallet_tx`.
- **Dane:** zmiana nie modyfikuje istniejących wierszy. Rozliczenia nadal wyłącznie przez `charge_legacy_send_first_seen`.

## 7. Co wymaga decyzji

- Sweep zdarzeń w `error` po wyczerpaniu ponowień Svixa (ręczny przycisk w panelu vs. zostawić w historii).
- Czy wejścia administratora w podglądzie konta kupca mają być zapisywane jako „administrator (podgląd)" (dziś: tak, oznaczone osobno) — czy w ogóle pomijane.
