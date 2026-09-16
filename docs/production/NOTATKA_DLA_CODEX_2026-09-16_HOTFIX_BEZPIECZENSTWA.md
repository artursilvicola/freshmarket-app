# Hotfix bezpieczeństwa B2B — wersja 5 po czwartym review Codexa (16.09.2026)

**Status: NIE ZASTOSOWANE na produkcji.** Gałąź `fix/security-hotfix-2026-09-16` (z `origin/main` 467cbe4).
Historia: v1 7d90826 (4×P1) → v2 c8842c8 (3×P1 + 2×P2) → v3 79b4b24 (3×P1) → v4 78e9dc9 (review `REVIEW_HOTFIX_055_78e9dc9.md`: 1×P1 + 1×P2) → **v5 = ten commit**.
Wszystko przetestowane od zera na oddzielnej bazie (embedded Postgres 17.10, `--shim`): migracje 001–055, `--reapply 054,055`, test kolejek 053 (T0–T16), test 055 (T0–T8), test równoległych zapisów (8 scenariuszy); vitest 189/189 + regresje Codexa v3 i v4 uruchomione na tej gałęzi (PASS); build OK.
Nic tu nie wysyła maili, nie publikuje planu, nie zmienia wyborów uczestników, nie zmienia fazy, terminu ani flag uczestników na produkcji.

## 00000. Odpowiedź na review f504f09 (v8) — zakres pilnego wdrożenia bez dodatków

Za rekomendacją Codexa pilne 055 idzie **bez** opcjonalnego paska i **bez** produkcyjnych prób zapisu:

| Ustalenie | Poprawka v8 | Dowód |
|---|---|---|
| **P1 sondy: błąd składni, zapisy po nieudanym preflight, próba aktywacji firmy testowej, `retailer_id: 1`** | `--writes` **usunięty** (flaga kończy skrypt z komunikatem). Skrypt jest wyłącznie odczytowy: anon / dostawca testowy / kupiec testowy / admin — w tym twarde kontrole „dostawca nie widzi `buyer_*` ani `retailer_contacts`”, `fm_my_schedule = null` dla kont testowych, `audit_log` niewidoczny dla nie-admina; błąd transportu / brak obiektu = FAIL. Próby zapisu (odmowy udziału, właściciela, RLS, storage, przywracanie kolumn) pozostają dowiedzione w izolacji: SQL 055 T4/T6/T7, równoległość 1–8 | `node --check` OK; kod skryptu |
| **P2 pasek przeładowywał po nieudanym ostatnim zapisie** | rejestr pending-work w PageSupplierFM zgłasza także `savedRev ≠ editRev` (nieudany / niepotwierdzony ostatni zapis) → pasek po odczekaniu pyta, „Anuluj” zostawia szkic; **pasek nie jest zamontowany w App** w tym wdrożeniu (komponent, `version.json` i testy zostają do osobnego review/deployu) | `FmReloadPending.test.jsx` (scenariusz Codexa f504f09: obie próby padają → 0 przeładowań, pytanie, szkic zostaje, po udanym zapisie przeładowanie); test Codexa `ReviewV7FailedSaveReload` na tej gałęzi: PASS |
| **P2 wpisy audytowe do podrobienia** (`audit_insert_authenticated`: dowolny `user_id`/akcja) | polityka zastąpiona `audit_insert_own_client`: klient (`logAction`: confirm/create/undo) wstawia tylko **własne** zdarzenia (`user_id = auth.uid()`) o akcjach **spoza** puli serwerowej (`fm_targets_*`, `fm_resp_*`, `security_*`, `fm_inputs_*`); zdarzenia serwerowe wstawiają wyłącznie RPC/triggery security definer i SQL Editor; odczyt nadal tylko admin | SQL T9: podrobiony `fm_targets_saved` z `user_id` admina → RLS; podrobiony `fm_resp_update` → RLS; własne `fm_targets_saved` → RLS; cudzy `user_id` przy zwykłej akcji → RLS; własny `confirm` → zapisany; dostawca nie czyta audit_log; zdarzenia z RPC/triggerów nadal są |

Nadal obowiązuje: wpis audytowy **nie jest samodzielnym dowodem** — każdą różnicę w porównaniu kopii przed/po wyjaśniamy rekord po rekordzie; snapshot pozostaje źródłem prawdy.

## 0000. Odpowiedź na review c3c1e66 (v7)

| Ustalenie | Poprawka | Dowód |
|---|---|---|
| **P1 sondy `--writes` celowały w przypadkową cudzą firmę / pierwszą sieć** | `fm-permission-probe.mjs` przepisany: `--writes` wymaga trzech jawnych rekordów testowych (`FM_PROBE_FIXTURE_COMPANY_ID` = własna zawieszona firma testowa, `FM_PROBE_FIXTURE_FOREIGN_COMPANY_ID` = **druga** zawieszona firma testowa jako „cudza”, `FM_PROBE_FIXTURE_RETAILER_ID` = nieaktywna sieć testowa); preflight sprawdza tożsamość konta i flagi każdego rekordu (`suspended`, `fm_b2b_enabled=false`, `active=false`, `fm26_active=false`, „TEST” w nazwie) i **przerywa przed pierwszym zapisem**; zero `neq().limit(1)`; żadnej pustej listy — próby niosą pełny zestaw; pierwszy nieoczekiwany sukces = STOP dalszych zapisów; stan wyborów obu firm testowych i odpowiedzi pary testowej porównany **wiersz po wierszu** przed/po | kod skryptu; tryb domyślny nadal bez żadnego zapisu |
| **P2 brak testów odmów udziału; dowolny błąd = sukces** | dodane: RPC dla **własnej** zawieszonej firmy → wymagane `42501 fm_inputs_forbidden` z hintem `company_*`; RPC dla cudzej firmy testowej → wymagane `brak uprawnień`; odpowiedź kupca testowego (`fm_resps` INSERT, sieć testowa → firma testowa) → wymagane `fm_inputs_forbidden` z hintem `buyer_/retailer_`; RPC przez kupca → `brak uprawnień`; `fm_my_schedule()` na kontach testowych musi być **null**. Klasyfikacja błędów: transport, brak RPC, „nie ma firmy” = FAIL, nie sukces | kod skryptu (`isForbidden`/`isOwnership`/`isDenied`) |
| **P2 „Odśwież teraz” gubił kliknięcie w kolejce** | rejestr `pending-work.js`: PageSupplierFM zgłasza zapisy w toku/kolejce, PageCompany i „Mój profil” zgłaszają niezapisany formularz; przycisk czeka (`waitForIdle`, do 15 s, „Czekam na zapis…”), a gdy nadal coś jest niezapisane — pyta (`confirm`), „Anuluj” = bez przeładowania | `FmReloadPending.test.jsx` (scenariusz Codexa: A w toku, B w kolejce → klik → bez przeładowania; po zapisie [A,B] przeładowanie), `NewVersionBanner.test.jsx` (czeka na zapis; niezapisany formularz → pytanie; anuluj), `pending-work.test.js`. Test Codexa `ReviewV6ReloadPending` na tej gałęzi: PASS |
| dowód porównawczy: sam licznik nie identyfikuje zmiany | `audit_log fm_targets_saved.meta.items` = pełna zapisana lista (sieć, priorytet); nowy trigger `fm_resps_audit` (`fm_resp_insert/update/delete`: kto, para sieć:dostawca, decyzja przed/po) — `fm_resps` nie ma `updated_at` | SQL T6 (asercje na `items` i na wpis odpowiedzi kupca) |

Nadal: żadnych aktywnych podmiotów testowych na produkcji; flagi kupców bez zmian; świeża kopia + porównanie przed/po + osobna zgoda na 055.

## 000. Stan po wdrożeniu 054 i plan testów bez podmiotów widocznych dla uczestników (v6)

**054 wdrożone 16.09 17:46** (runbook §19): kopie DPAPI przed/po (Codex zweryfikował niezależnie: 0 różnic w 17 tabelach, 785 wyborów / 156 odpowiedzi zachowane), anon → 401 na `consent_audit`/`v_admin_*`, DELETE przez widok → 401, admin czyta jak dotąd, dostawca widzi tylko własny wiersz `consent_audit`. **Otwarte**: dostawca nadal widzi `retailers.buyer_*` (44 sieci) — zamyka 055; kontrola prawdziwego panelu drugiej aplikacji — Artur.

**Testy produkcyjne bez widocznych podmiotów testowych** (uwaga Codexa: sieć/firma testowa widoczna choćby chwilowo = ryzyko cudzego wyboru i późniejszego sprzątania w cudzych danych):
- **Ścieżki zapisu z sukcesem** (RPC dostawcy, odpowiedź kupca, blokady, zamknięcie fazy) są dowiedzione **wyłącznie w izolacji**: migracje od zera, testy SQL 053/055, 8 scenariuszy równoległości, regresje UI. Na produkcji nie tworzymy żadnej firmy `fm_b2b_enabled` ani sieci `fm26_active` — nawet na minuty.
- **Konta testowe na produkcji = tylko odczyt + zapisy, które MAJĄ być odrzucone**: firma testowa `account_status='suspended'`, `fm_b2b_enabled=false` (niewidoczna dla kupców przez RLS `companies_select_all_authenticated`, poza `fmSuppliers` i algorytmem) z kontem dostawcy testowego; sieć testowa `active=false`, `fm26_active=false` (niewidoczna na liście sieci, poza planem) z kontem kupca testowego. Sondy `fm-permission-probe.mjs`: odczyty potwierdzają izolację (zero kontaktów kupców, zero cudzych decyzji, zero planu), `--writes` potwierdza odmowy (`fm_inputs_forbidden`, RLS storage, przywracanie kolumn administracyjnych). Żaden z tych podmiotów nie może wejść do wyborów ani do planu, bo nie spełnia warunków udziału.
- **Sukces prawdziwych zapisów po deployu** obserwujemy bez testów: RPC `fm_set_company_targets` zapisuje `audit_log` (`fm_targets_saved`: kto, firma, liczba sieci, czas) — po wdrożeniu admin widzi w SQL pierwsze zapisy uczestników (`select action, entity_id, meta, created_at from audit_log where action='fm_targets_saved' order by created_at desc`), a odpowiedzi kupców po `fm_resps.created_at`. Te same wpisy tłumaczą różnice w porównaniu kopii przed/po.
- Smoke test w przeglądarce: konto testowe dostawcy (zawieszone) ma zobaczyć ekran „konto zawieszone” / brak dostępu do FM, nie listę sieci; admin — panel sieci z kontaktami awaryjnymi, „Dane wejściowe”, `fm_my_schedule` = całość.

**Okno wdrożenia 055 + front i odświeżenie kart**:
1. Świeży snapshot (narzędzie Codexa) + `before.json`; lista kupców do włączenia (decyzja Artura) wykonana **przed** 055 albo po — osobno, konto po koncie.
2. 055 w SQL Editorze → `fm_backup_inputs('po-055-…')`.
3. Deploy frontu natychmiast po 055 (tag `prod-rollback-…`). Nowy front ma **`NewVersionBanner`**: co 5 min i przy powrocie do karty porównuje `/version.json` z identyfikatorem builda i pokazuje pasek „Dostępna nowa wersja — odśwież teraz”. To nie jest egzekwowanie (nim jest baza: stary bundle nie zapisze wyborów, nic nie skasuje), ale skraca czas, w którym uczestnik klika w starej wersji. Uwaga: pasek zadziała dopiero od tego deployu — dziś otwarte karty go nie mają; w oknie wdrożenia stare karty nie zapiszą nowych wyborów do przeładowania (w konsoli błąd RLS), odpowiedzi kupców zapisują się jak dotąd.
4. `after.json` + `fm-inputs-compare` (różnice tylko wyjaśnione wpisami `fm_targets_saved` / nowymi `fm_resps`), sondy na kontach testowych (jak wyżej), kontrola „dostawca nie widzi kontaktów kupców” (`retailers.buyer_*` = null, `retailer_contacts` = 0 wierszy dla dostawcy).
5. Proponowana pora: wieczór (po 20:00) albo wcześnie rano — najmniej otwartych kart; bez maili.

## 00. Odpowiedź na review 78e9dc9 (v5)

| Ustalenie | Poprawka | Dowód |
|---|---|---|
| **P1 zamknięcie fazy nie czekało na odpowiedź kupca w toku** (blokada `FOR SHARE` na `fm_settings` była tylko w RPC dostawcy) | jedna funkcja `fm_inputs_lock_for_write()` (security definer, bo `FOR SHARE` wymaga prawa UPDATE): własny profil, własna sieć (kupiec) i `fm_settings` **FOR SHARE** do końca transakcji — wywoływana w triggerze `fm_inputs_phase_lock` (ścieżka kupca: INSERT/UPDATE/DELETE na `fm_resps`, oraz każdy bezpośredni zapis wejść) **przed** kontrolami udziału i fazy, i w RPC dostawcy po blokadzie firmy. Kolejność blokad bez cykli: `companies → profiles → retailers → fm_settings`. Skutek: `UPDATE fm_settings` admina (faza/termin) czeka na wszystkie odpowiedzi i wybory w toku; zapis rozpoczęty po zmianie widzi nową fazę. Wyjątek admina pozostaje jawny: sesja admina przechodzi kontrolę fazy, ale też bierze blokady | `scripts/fm-targets-concurrency-test.mjs` (8): odpowiedź kupca w otwartej transakcji → zmiana fazy **czeka**; po commicie odpowiedź widoczna, dopiero potem faza zamknięta; nowa zmiana odpowiedzi po zamknięciu → `fm_inputs_locked`, decyzja nietknięta. SQL 055 T6: po INSERT kupca `pg_locks` pokazuje RowShareLock na `fm_settings` i `retailers` |
| **P2 stary banner błędu blokował „Potwierdź wybór” po udanym ponowieniu** | zapis **ostatniej rewizji** czyści `targetsSaveError` (starsze odpowiedzi nie dochodzą do tego miejsca, więc nie skasują nowszego błędu) | `FmTargetsPendingSave.test.jsx`: A w toku, B–E w kolejce, A pada → banner; zapis [A–E] udany → 0 bannerów, potwierdzenie odblokowane; osobny test: starsza odpowiedź nie kasuje nowszego błędu. Test Codexa `ReviewV4RetryFeedback` uruchomiony na tej gałęzi: **PASS** |

## 0. Odpowiedź na review 79b4b24 (v4)

| Ustalenie | Poprawka | Dowód |
|---|---|---|
| **P1/1 starsza odpowiedź serwera cofała nowsze kliknięcia** (A → B → ack[A] cofa B → C liczone od [A] → B ginie) | rewizje edycji w `PageSupplierFM`: każde kliknięcie = `editRev++`, payload niesie `rev`; odpowiedź na rewizję starszą niż bieżąca **nie dotyka UI** (stan bazy stosowany tylko dla ostatniej rewizji); „Potwierdź wybór” po `flush()` sprawdza `savedRev === editRev`, inaczej błąd; `createSerialSaver` po błędzie **nie gubi** nowszego stanu z kolejki (idzie do zapisu jako następny) | `src/legacy/FmTargetsPendingSave.test.jsx` (harness jak `ReviewV3PendingSave.test.jsx` Codexa): scenariusz Codexa → ostatni payload i UI = A,B,C; dopasowanie UI do bazy tylko dla ostatniej rewizji; błąd → banner + potwierdzenie zablokowane → kolejne kliknięcie zapisuje aktualny stan; kliknięcie w trakcie nieudanego zapisu nie ginie; potwierdzenie czeka na zapis ostatniej rewizji. Test Codexa uruchomiony na tej gałęzi: **PASS** |
| **P1/2 kontrole fazy/udziału przed blokadą były nieaktualne po oczekiwaniu** | kolejność w RPC: najpierw blokady — wiersz firmy `FOR UPDATE`, własny profil `FOR SHARE`, `fm_settings` `FOR SHARE` — potem kontrole właściciela, udziału i fazy/terminu na aktualnym stanie; `fm_inputs_are_locked()` używa `clock_timestamp()` (czas bieżący, nie początek transakcji). `FOR SHARE` na `fm_settings` daje koordynację zamknięcia: **zmiana fazy przez admina czeka na zapisy w toku**, a zapis rozpoczęty po zmianie widzi nową fazę — algorytm nie startuje na wejściach, które mogą się jeszcze zmienić | `scripts/fm-targets-concurrency-test.mjs` (5) zapis czeka na blokadę firmy, admin zamyka fazę, zwolnienie → `fm_inputs_locked`, lista nietknięta; (6) niezatwierdzone `fm_b2b_enabled=false` w czasie oczekiwania → `fm_inputs_forbidden`; (7) `update fm_settings` admina blokuje się do commitu zapisu w toku, zapis zaliczony w całości, kolejny → `fm_inputs_locked` |
| **P1/3 stara karta admina (podgląd dostawcy) mogła skasować wybory** (`ctr_admin_all`) | `ctr_admin_all` → `ctr_admin_read` (SELECT): **wszystkie sesje przeglądarkowe, także admin, zapisują wybory tylko przez RPC** (`fm_set_company_targets` pozwala adminowi na każdą firmę); SQL Editor / service role bez zmian | SQL 055 T0 (żadnej polityki zapisu na `company_target_retailers`), T6: admin-JWT bezpośredni DELETE = 0 wierszy, INSERT = RLS, RPC działa |

Decyzja o kupcach: wariant **(a) tylko dla osób z potwierdzonym udziałem** — lista 11 kont do przejrzenia przez Artura, włączenie flagi pojedynczo z wpisem audit (nie masowo); nic z tego nie jest w tej gałęzi.

| Plik | Co | Kiedy |
|---|---|---|
| `supabase/migrations/054_views_lockdown.sql` | **pilne, małe**: widoki → `security_invoker`, zero zapisu przez widoki, anon bez `consent_audit`/`v_admin_*` | od razu po zgodzie Artura (Codex: rekomenduje osobno) |
| `supabase/migrations/055_security_hotfix.sql` | reszta (kontakty, plan, polityki 002, triggery, storage, atomowy zapis wyborów, blokada fazy/terminu, kopia wejść, legacy_sends) | po review Codexa v3, osobna zgoda, z kopią przed i porównaniem po |

---

## 1. Odpowiedź na review c8842c8

| Ustalenie | Poprawka w v3 | Dowód |
|---|---|---|
| **P1/1 błąd RPC uruchamiał DELETE + INSERT** (`/fm_set_company_targets/` w treści błędu walidacji) | ścieżka zapasowa **usunięta w całości**. `setCompanyTargetRetailers` = tylko RPC; każdy błąd idzie dalej; brak funkcji (PGRST202) = czytelny komunikat „zapis chwilowo niedostępny, wybory bezpieczne”, zero zapytań do tabeli. Dodatkowo w bazie: dostawca ma na `company_target_retailers` **tylko SELECT** (`ctr_supplier_own` → `ctr_supplier_read`), więc stary bundle robiący DELETE + INSERT: DELETE nie trafia w żaden wiersz (RLS), INSERT odrzucony — nic nie ginie | vitest `fm-targets-save.test.js` (błąd walidacji / uprawnień / faza / forbidden / sieć / brak RPC → `from()` nigdy nie wywołane); SQL 055 T6 „stary klient: DELETE bez efektu, INSERT row-level security, lista nietknięta” (faza otwarta i zamknięta) |
| **P1/2 równoległe zapisy = suma list** | `perform 1 from companies where id = … for update` przed walidacją i zapisem — zapisy tej samej firmy szeregowane; reguła jawna: **wygrywa ostatni zatwierdzony zapis w całości**, nigdy suma. RPC zwraca listę faktycznie zapisaną, a UI (PageSupplierFM) **dopasowuje lokalny stan do niej** po każdym zapisie; „Potwierdź wybór” dopiero po `flush()` | `scripts/fm-targets-concurrency-test.mjs` (2 połączenia, rola authenticated + claims): pusta lista, istniejąca [A,B], nakładające się — w bazie dokładnie jedna z list (B), drugi zapis czeka na commit pierwszego (~480 ms), zamknięcie fazy między zapisami → `fm_inputs_locked`, lista A nietknięta; SQL T6: `pg_locks` RowShareLock na `companies` po RPC |
| **P1/3 nieaktywne konto / zawieszona firma zapisują** | `fm_inputs_write_check()` (jedna reguła dla RPC **i** triggerów na `company_target_retailers`/`fm_resps`): profil aktywny (także admin); dostawca — firma `account_status = active` i `fm_b2b_enabled`; kupiec — własna flaga `profiles.fm26_active` + sieć `active` i `fm26_active`. Odmowa = `fm_inputs_forbidden` (42501, hint z kodem powodu). Odebranie aktywności **nie kasuje** zapisanych wyborów | SQL T6: sup3 (profil nieaktywny), sup4 (firma suspended), co1 z `fm_b2b_enabled=false` → forbidden i 0 zmian; nieaktywny admin → forbidden; kupiec nieaktywny / bez flagi → INSERT i UPDATE `fm_resps` forbidden, odpowiedź nietknięta |
| **P2/4 porównywarka fałszywie potwierdzała** | logika w `src/lib/fm-inputs-compare.js`: brak sekcji / zły format / brak klucza / brak kolumny / zduplikowany klucz = **błąd (exit 2)**, nie „pusta tabela”; porównywane także `fm_resps.meta` (`supplier_legacy_id`, `chain_id`), `note`, `legacy_fm_id`/`legacy_supplier_id`, `legacy_chain_id`, `fm_prefs`, `fm_wishlists`, `fm_late_resps`, `company_hidden_retailers`; eksport rozszerzony o te tabele i kolumny | vitest `fm-inputs-compare.test.js`: dwa `{}` = błąd; zmiana `meta.supplier_legacy_id` = różnica; usunięty/zmieniony wybór wskazany po kluczu; duplikat/brak klucza/brak kolumny = błędy; kolejność kluczy w meta bez znaczenia |
| **P2/5 kupiec bez własnej flagi FM dostawał plan** | `fm_my_schedule()` wymaga `profiles.fm26_active` (ta sama reguła co w `fm_inputs_write_check`) | SQL T5: dwóch kupców tej samej sieci — bez flagi `null`, z flagą plan wraca |

**Skutek reguły udziału na produkcji (do sprawdzenia przed 055):** kupcy z `profiles.fm26_active = false` w sieciach FM-aktywnych stracą możliwość odpowiadania i odczytu planu, dopóki admin nie włączy im flagi (Polomarket z audytu). Zapytanie kontrolne:
`select p.id, r.name from profiles p join retailers r on r.id = p.retailer_id where p.role='buyer' and p.active and p.fm26_active = false and r.fm26_active;` — wynik z 16.09 w §4.

Rollback (§5) przepisany: bez usuwania RPC i bez wyłączania triggerów ochronnych.

---

## 2. Dokładny SQL

**054** — `alter view … set (security_invoker = true)` (`consent_audit`, `company_capacity`, `v_admin_registrations`, `v_admin_stats`), `revoke insert, update, delete, truncate, references, trigger … from anon, authenticated` (+ `articles_with_facts`), `revoke select … from anon` (`consent_audit`, `v_admin_*`), wpis audit. Zapytania kontrolne na końcu pliku. Legalny odczyt: admin B2B bez zmian (test 055 T2); panel drugiej aplikacji — jeśli loguje się jako admin, bez zmian; jeśli używał klucza anon, przestaje czytać `v_admin_*` (to jest ta luka) — do sprawdzenia na właściwym środowisku po wykonaniu.

**055** — sekcje: 2 kontakty (`retailer_contacts`, `retailer_contacts_merge` z `coalesce`, mosty before-update/after-insert, `admin_set_retailer_contact`, zerowanie kolumn); 3 plan (`fm_plan_private`, trigger `fm_settings_route_schedule`, `fm_current_phase`, `fm_my_schedule` z kontrolą aktywności i flagi kupca); 3b kopia `fm_queue_open_day` z `LEFT JOIN fm_plan_private`; 4 drop 8 polityk z 002; 5 `fm_is_privileged_session`, `profiles_guard_protected` (self-INSERT = supplier bez firmy/sieci), `companies_guard_protected`; 6 storage per folder; 7 `selection_deadline`, `fm_inputs_are_locked`, `fm_is_server_session`, `fm_inputs_write_check`, trigger `fm_inputs_phase_lock` (forbidden/locked), polityka `ctr_supplier_read` (SELECT only), RPC `fm_set_company_targets` (blokada firmy, walidacja, cała lista), `fm_inputs_snapshots` + `fm_backup_inputs`; 8 `legacy_sends`; 9 audit. Idempotentna (`--reapply` sprawdzone).

---

## 3. Zakres kodu

| Plik | Zmiana |
|---|---|
| `src/lib/db.js` | `setCompanyTargetRetailers` **tylko RPC** (bez ścieżki zapasowej; PGRST202 → `errors.db.fm_targets_rpc_missing`); `getRetailers` z `retailer_contacts` (fallback bez osadzenia); `getFmSchedule` → `fm_my_schedule` (fallback); `saveFmSchedule` → `fm_plan_private` (fallback); `toRetailerDbRow` bez `buyer_*` |
| `src/lib/serial-save.js` (+test) | szeregowanie kliknięć w jednej instancji, `flush()` |
| `src/lib/fm-inputs-compare.js` (+test), `scripts/fm-inputs-compare.mjs`, `scripts/fm-inputs-export.sql` | porównanie przed/po (strict) |
| `src/lib/fm-targets-save.test.js` | wrapper RPC: żaden błąd nie dotyka tabeli |
| `src/lib/retailer-contacts.js`, `src/lib/fm-input-lock.js` (+testy) | helpery |
| `src/legacy/PreconnectFM.jsx` | PageSupplierFM: saver + dopasowanie stanu do listy z bazy + widoczny błąd + potwierdzenie po zapisie; usunięty zbiorczy resave `fmResps`; kontakt awaryjny z `retailerContact`; `hasRetailerEmailMarker` z `resendBuyerCount` |
| `netlify/functions/send-retailer-batch.js`, `fm-plan-data.js` | liczba adresatów; plan z `fm_plan_private` |
| `src/i18n/{pl,en}/legacy.json` | `errors.db.fm_inputs_locked`, `errors.db.fm_targets_rpc_missing`, `fm.supplier.targets_save_failed` |
| `scripts/fm-queue-sql-test.mjs` | `--test 053,055`, `--reapply 054,055` |
| `scripts/fm-permission-probe.mjs` | sondy prawdziwych kont: domyślnie bez zapisów; `--writes` tylko konta testowe (PNG, kontrola przed/po, klucz po kluczu, `v_admin_*`, bezpośredni DELETE/INSERT wyborów bez efektu) |
| `scripts/fm-targets-concurrency-test.mjs` | równoległe zapisy (baza testowa) |
| `supabase/tests/053_fm_queue_test.sql` | edycja planu w `fm_plan_private` |
| `supabase/tests/055_security_hotfix_test.sql` | T0–T8 rozszerzone (patrz §1) |

---

## 4. Procedura wdrożenia (po zgodzie Artura, każdy krok osobno)

Warunek nadrzędny: **hotfix nie może zmienić ani usunąć żadnego wyboru dostawcy ani decyzji kupca.** Każdą różnicę wyjaśnić; nigdy nie nadpisywać nowszych decyzji starym snapshotem.

0. **Kopie**: Codex zrobił zaszyfrowaną kopię wyborów, odpowiedzi, mapowań i potwierdzeń ze stanu **16.09 15:53:32** (`C:\Users\Artur\FreshMarket-Backups\FM-B2B-20260916-155332`, DPAPI, poza repo/OneDrive, zweryfikowana SHA-256). Zostaje jako niezmienny punkt odniesienia. **Bezpośrednio przed 055** — świeży snapshot tym samym narzędziem (`export-readonly.sql` + `fm-secure-snapshot.ps1`; po 055 rozszerzyć eksport o `fm_plan_private`), plus `scripts/fm-inputs-export.sql` → `before.json` (poza repo).
1. **Kontrola reguły udziału** — stan produkcji 16.09 (tylko odczyt): **11 z 41** aktywnych kupców w sieciach FM ma `profiles.fm26_active = false`: E.Leclerc (108), Polomarket (113), ATB Market (118), TOPAZ (121), Fantastico (129), Dobronom (135, wszystkie 6 kont). Aplikacja nigdy nie używała tej flagi do blokowania (gating jest po sieci), więc dziś ci kupcy normalnie odpowiadają; po 055 z regułą Codexa (P1/3, P2/5) straciliby zapis odpowiedzi i plan. **Decyzja Artura przed 055** — jedna z dwóch, jawnie:
   **Decyzja Artura i Codexa: wariant (a), ale konto po koncie** — flagę włącza się WYŁĄCZNIE osobom z potwierdzonym udziałem w FM (sama przynależność do sieci nie dowodzi udziału; część kont może korzystać tylko z PreConnect). Procedura: Artur dostaje listę 11 kont (sieć + e-mail konta), zaznacza potwierdzonych, admin włącza flagę **pojedynczo** (`update profiles set fm26_active = true where id = '<konkretne id>'`) z wpisem w `audit_log` na każde konto. **Żadnego masowego `update` dla wszystkich 11.** Konta niepotwierdzone zostają bez flagi (nie odpowiadają, nie widzą planu; ich dotychczasowe decyzje nie są kasowane).
   (b) — odrzucone: reguła produktu pozostaje ścisła (flaga osoby = przełącznik udziału).
   Dodatkowo: ProChile (`fm_b2b_enabled = false`, 5 zapisanych wyborów) po 055 nie zmieni wyborów — wybory zostają (decyzja o ProChile z audytu nadal otwarta).
2. **054**: SQL Editor → cały plik → Run. Kontrola: zapytania z końca pliku + `node scripts/fm-permission-probe.mjs` (sekcja anon; bez kont) + admin w aplikacji („Dane wejściowe”, pojemności) + panel drugiej aplikacji.
3. **055**: krótkie okno przy małym ruchu. SQL Editor → cały plik → Run (jedna transakcja; ~50 ms lokalnie). Nie owijać zewnętrznym `begin`. Zaraz po: `select fm_backup_inputs('po-055-<data>')`.
4. **Porównanie**: `scripts/fm-inputs-export.sql` → `after.json`; `node scripts/fm-inputs-compare.mjs before.json after.json` → exit 0 = zgodne; 1 = różnice (każdą wyjaśnić: zmiana uczestnika w oknie — widoczna jako DODANY/ZMIENIONY z identyfikatorami — czy skutek migracji); 2 = eksport wadliwy. Nieoczekiwana różnica = STOP: bez przeliczania, publikowania, maili.
5. **Deploy frontu** zaraz po 055 (tag `prod-rollback-…`, `merge --ff-only`, push). Stary bundle po 055 (otwarte karty uczestników): zapis wyborów nie następuje (DELETE 0 wierszy, INSERT odrzucony — dane nietknięte, w konsoli błąd), odpowiedzi kupców zapisują się jak dotąd (per wiersz przez triggery), admin nie widzi kontaktu awaryjnego 3 sieci ani planu (plan dziś pusty) — po odświeżeniu strony wszystko działa. Admini Ctrl+F5. Uczestnikom można wysłać zwykłą informację „odśwież stronę” — bez maili automatycznych z systemu.
6. **Sondy** na kontach testowych (nie klientów): `node scripts/fm-permission-probe.mjs` → potem `--writes`. Potrzebne: konto testowe dostawcy z firmą testową (`fm_b2b_enabled`, `active`) i konto testowe kupca (`fm26_active`) w sieci testowej `fm26_active`; hasła tylko w `FM_PROBE_*`.
7. **Ręcznie na kontach testowych**: dostawca — ⭐/👍 (RPC), „Potwierdź wybór”, „Mój profil”, profil firmy z logo; kupiec — odpowiedź; admin — kontakt awaryjny (FRAC, SPAR/GK Specjał, Nasz Sklep), „Dane wejściowe”, zapis szkicu planu → `fm_plan_private`. **Bez zmiany fazy i terminu na produkcji** — zamknięcie fazy przetestowane na oddzielnej bazie (055 T6, test równoległości (4)).

---

## 5. Wycofanie — bez ponownego otwierania luk i bez ryzyka utraty wyborów

Nie usuwać RPC zapisu, nie wyłączać triggerów ochronnych, nie przywracać `buyer_*` do `retailers`, planu do `fm_settings.schedule` ani polityk `*_authenticated` storage. W razie awarii konkretnej funkcji:
- **zapis wyborów nie działa** → zostawić jak jest (uczestnik widzi komunikat, dane bezpieczne), naprawić `fm_set_company_targets` poprawką SQL (`create or replace`) i ponownie przetestować na bazie testowej; ewentualnie tymczasowo `update fm_settings set selection_deadline = now()` = świadome, jawne zamrożenie zapisów z komunikatem (decyzja Artura);
- **plan nie wyświetla się** → poprawić `fm_my_schedule` (`create or replace`); do tego czasu nikt poza adminem nic nie widzi — to bezpieczny kierunek;
- **kontakty** → dane są w `retailer_contacts`, admin czyta je przez osadzenie; naprawiać most/RPC, nie kolumny;
- **front**: tag `prod-rollback-…` jak zwykle; stary bundle współpracuje z nową bazą bez utraty danych (patrz §4.5).
Każde działanie naprawcze: wpis w `audit_log`, bez maili, bez zmiany fazy.

---

## 6. Otwarte decyzje dla Artura

1. Zgoda na **054** (teraz, osobno).
2. Review Codexa v3 → zgoda na **055** + decyzja o kupcach bez flagi FM (§4.1) i o `selection_deadline`.
3. Konta testowe dostawcy i kupca do sond (§4.6).
4. `participant_profiles_authenticated_read using (true)` — właściciel drugiej aplikacji (tabela dziś pusta).
5. Przed przeliczeniem (osobno): Fozzy (rozpoznawanie istniejących wyborów, bez zmiany decyzji), migracja 049 + daty wpłat (po dodaniu `fm_payment_date` dopisać ją do kolumn chronionych w `companies_guard_protected`), świeży `fm_backup_inputs`.
