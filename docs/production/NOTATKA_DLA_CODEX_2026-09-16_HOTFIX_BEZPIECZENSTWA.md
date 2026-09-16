# Hotfix bezpieczeństwa B2B — wersja 2 po review Codexa (16.09.2026)

**Status: NIE ZASTOSOWANE na produkcji.** Gałąź `fix/security-hotfix-2026-09-16` (z `origin/main` 467cbe4).
Poprzednia wersja (7d90826) dostała od Codexa 4 blokery P1 (`1FMK2026/outputs/b2b-audit-20260916/REVIEW_HOTFIX_054_7d90826.md`) — ta wersja je usuwa i **została przetestowana od zera na oddzielnej bazie** (embedded Postgres 17.10, `--shim`): migracje 001–055, ponowne zastosowanie 054+055, test kolejek 053 (T0–T16) i nowy test 055 (T0–T8) — wszystko ✅.
Nic tu nie wysyła maili, nie publikuje planu, nie zmienia wyborów uczestników, nie zmienia fazy produkcyjnej.

Podział na dwa pliki (zalecenie Codexa):

| Plik | Co | Kiedy |
|---|---|---|
| `supabase/migrations/054_views_lockdown.sql` | **pilne, małe**: widoki `consent_audit`, `company_capacity`, `v_admin_registrations`, `v_admin_stats` → `security_invoker`; zero praw zapisu przez widoki (także `articles_with_facts`); anon bez SELECT na `consent_audit`/`v_admin_*` | od razu po zgodzie Artura (~1 s, bez zmian w kodzie) |
| `supabase/migrations/055_security_hotfix.sql` | reszta hotfixu (kontakty, plan, polityki 002, triggery, storage, atomowy zapis wyborów, blokada fazy/terminu, kopia wejść, legacy_sends) | po review Codexa, osobna zgoda, z kopią i porównaniem wejść |

---

## 1. Odpowiedź na blokery P1 z review 7d90826

| P1 | Było | Jest teraz | Test |
|---|---|---|---|
| **Częściowa aktualizacja kontaktu kasowała pozostałe pola** | `ON CONFLICT … SET = excluded` nadpisywał nullami | most zgodności `retailer_contacts_merge()` używa `coalesce(excluded.x, istniejące.x)` — pola niewysłane (null/'') zostają; **świadome czyszczenie** tylko przez `admin_set_retailer_contact(id, name, email, phone)` (wartości dokładne, wszystkie puste = usunięcie); `toRetailerDbRow` w ogóle nie wysyła już `buyer_*` | 055 T1: zmiana samego telefonu / e-maila / nazwiska osobno, zapis nazwy sieci z pustymi `buyer_*`, pełny zapis, czyszczenie jednego pola i całego kontaktu przez RPC, odmowa dla dostawcy, ponowne zastosowanie migracji (`--reapply`) bez utraty danych |
| **Luka INSERT profilu** (konto Auth bez profilu) | guard tylko na UPDATE | self-INSERT bez admina: rola admin/staff lub `admin_level` → błąd 42501; pozostałe wartości **wymuszone**: `role='supplier'`, `company_id=null`, `retailer_id=null`, `active=true`, `fm26_active=false`, `buyer_categories='{}'`. `handle_new_user`, `admin-create-user`, `register-supplier-self` (service role / security definer) bez zmian | 055 T4: konto Auth bez profilu próbuje `INSERT … role='buyer', retailer_id=990101, company_id=co2` → dostaje profil dostawcy bez firmy/sieci, 0 dostępu do `fm_prefs`/wyborów; INSERT z rolą admin → błąd |
| **DELETE + INSERT wyborów mógł zostawić pustą listę** | dwa żądania z klienta | RPC `fm_set_company_targets(company_id, items)` (security definer, jedna transakcja): sprawdza właściciela (admin lub dostawca własnej firmy), fazę/termin, poprawność sieci, scala duplikaty; **albo cała nowa lista, albo cała stara**. Klient: `setCompanyTargetRetailers` → RPC (fallback do starej ścieżki tylko przed migracją); `createSerialSaver` szereguje szybkie kliknięcia (ostatni stan wygrywa, brak równoległych żądań); błąd zapisu widoczny na stronie (`fm.supplier.targets_save_failed` / `errors.db.fm_inputs_locked`); **„Potwierdź wybór” czeka na zakończenie zapisu i jest zablokowany przy błędzie** | 055 T6: błędna sieć w liście → stara lista w całości zostaje; cudza firma → 42501; kupiec → 42501; faza `matching` → `fm_inputs_locked` i lista nietknięta (RPC i bezpośredni DELETE/INSERT); termin `selection_deadline` w przeszłości → zablokowane, w przyszłości → działa; admin zapisuje po zamknięciu. Vitest `serial-save.test.js`: 3 szybkie kliknięcia = 2 żądania, pośredni stan pominięty; błąd trafia do `flush()` |
| **RPC planu bez kontroli aktywności/udziału** | tylko rola + przypisanie | dostawca: `profiles.active`, `companies.account_status='active'`, `fm_b2b_enabled` (jak filtr `fmSuppliers`); kupiec: `profiles.active`, `retailers.active`, `retailers.fm26_active`; wszystko nadal dopiero po publikacji | 055 T5: dostawca A/B — **dokładnie** własny klucz `res` i własne `nums`; kupiec X/Y — dokładny zbiór firm z własnym chainem, `m=[chain]`, `nums` tylko własnego chainu, bez `r`; nieaktywny profil, zawieszona firma, firma bez `fm_b2b_enabled`, sieć bez `fm26_active`, nieaktywny kupiec → `null` |

Dodatkowo z review:
- **Termin serwerowy**: `fm_settings.selection_deadline timestamptz` (null = brak). `fm_inputs_are_locked()` = faza ≠ `preferences_open` **lub** `now() > selection_deadline`. Blokada nie obiecuje nic na podstawie zegara w UI — admin ustawia termin w bazie (`update fm_settings set selection_deadline = '2026-09-22 23:59:59+02'`), a do tego czasu produkcyjna faza pozostaje nietknięta.
- **Moduł kolejek**: `fm_queue_open_day` (053) czytał plan z `fm_settings.schedule` — 055 zawiera kopię tej funkcji z jedyną zmianą: `LEFT JOIN fm_plan_private` jako źródło planu (faza/data nadal z `fm_settings`). Test 053 przechodzi w całości (T0–T16) na nowym źródle; edycje planu w teście 053 wskazują teraz `fm_plan_private`.
- **Sondy** `scripts/fm-permission-probe.mjs`: tryb domyślny = zero zapytań zmieniających (DELETE przez widok tylko pod `--writes`); upload testowy = poprawny 1-pikselowy PNG z kontrolą stanu przed/po (lista plików), a nie sam kod błędu; kupiec — każdy wpis planu sprawdzany (`m=[własny chain]`, `nums` tylko własnego chainu, bez `r`); dostawca — klucze `res`/`nums` ⊆ własne identyfikatory; sondy `v_admin_*`/`consent_audit` dla dostawcy i kupca; próby zapisu wyborów cudzej firmy i przez kupca; nic nie wypisuje kontaktów. `--writes` tylko na kontach testowych.
- **Kolejność wdrożenia** (nie jest dowolna dla wszystkich zachowań): patrz §4.
- **Rollback** nie może przywracać publicznych kontaktów/planu ani szerokich praw Storage: patrz §5.

Nieobjęte tym hotfixem (poza repo): `participant_profiles_authenticated_read using (true)` w drugiej aplikacji (tabela dziś pusta — 0 wierszy — ale polityka do zmiany u właściciela drugiej aplikacji; wspólna baza i rola `authenticated` oznaczają, że użytkownik B2B może ją czytać). `fm_settings` dla anon: `ui_content` zawiera dziś tylko `partners` (logotypy stopki), `message` = 57 znaków komunikatu publicznego — zostaje publiczne; jeśli kiedyś trafią tam treści dla ról, ograniczyć kolumnami.

---

## 2. Dokładny SQL

**`054_views_lockdown.sql`** (pilne):
```sql
alter view … set (security_invoker = true)   -- consent_audit, company_capacity, v_admin_registrations, v_admin_stats
revoke insert, update, delete, truncate, references, trigger on … from anon, authenticated  -- + articles_with_facts
revoke select on consent_audit, v_admin_registrations, v_admin_stats from anon
insert into audit_log (…'security_views_lockdown'…)
```
Skutek: anon nie czyta 24 e-maili z `consent_audit` ani rejestracji; nikt nie zapisze przez widok (dziś anon ma prawo `DELETE` przez `consent_audit` → `profiles` bez RLS); zalogowany nie-admin przez `v_admin_*` widzi tylko własne rejestracje (RLS `event_registrations`); admin czyta jak dotąd (test 055 T2). Legalny odczyt drugiej aplikacji: jeśli jej panel loguje się jako admin — bez zmian; jeśli używał klucza anon — przestanie czytać `v_admin_*` (to właśnie luka). Kontrola po zastosowaniu: zapytania na końcu pliku.

**`055_security_hotfix.sql`** — sekcje: 2 kontakty (`retailer_contacts`, `retailer_contacts_merge`, 2 triggery-mosty, `admin_set_retailer_contact`, zerowanie kolumn), 3 plan (`fm_plan_private`, trigger `fm_settings_route_schedule`, `fm_current_phase`, `fm_my_schedule`), 3b `fm_queue_open_day` z nowym źródłem, 4 drop 8 polityk z 002, 5 `fm_is_privileged_session`, `profiles_guard_protected`, `companies_guard_protected`, 6 storage per folder, 7 `selection_deadline`, `fm_inputs_are_locked`, `fm_inputs_phase_lock` (triggery na `company_target_retailers`, `fm_resps`), `fm_set_company_targets`, `fm_inputs_snapshots` + `fm_backup_inputs`, 8 `legacy_sends`, 9 `audit_log`. Pełny tekst w pliku; idempotentna (sprawdzone `--reapply`).

---

## 3. Zakres kodu (gałąź)

| Plik | Zmiana |
|---|---|
| `src/lib/db.js` | `setCompanyTargetRetailers` → RPC `fm_set_company_targets` (fallback DELETE+INSERT tylko gdy RPC nie istnieje); `getRetailers` osadza `retailer_contacts` (fallback bez osadzenia); `getFmSchedule` → RPC `fm_my_schedule` (fallback); `saveFmSchedule` → `fm_plan_private` (fallback); `toRetailerDbRow` bez `buyer_*` |
| `src/lib/serial-save.js` (+test) | szeregowanie zapisów, `flush()` |
| `src/lib/retailer-contacts.js`, `src/lib/fm-input-lock.js` (+testy) | helpery |
| `src/legacy/PreconnectFM.jsx` | PageSupplierFM: saver + widoczny błąd + potwierdzenie po zapisie; usunięty zbiorczy resave `fmResps` kupca; kontakt awaryjny z `retailerContact`; `hasRetailerEmailMarker` z `resendBuyerCount` |
| `netlify/functions/send-retailer-batch.js`, `fm-plan-data.js` | liczba adresatów zamiast e-maili; plan z `fm_plan_private` |
| `src/i18n/{pl,en}/legacy.json` | `errors.db.fm_inputs_locked`, `fm.supplier.targets_save_failed` |
| `scripts/fm-queue-sql-test.mjs` | `--test 053,055`, `--reapply 054,055` |
| `scripts/fm-permission-probe.mjs` | sondy prawdziwych kont (patrz §1) |
| `scripts/fm-inputs-export.sql`, `scripts/fm-inputs-compare.mjs` | kopia i porównanie wejść wybór po wyborze (§4) |
| `supabase/tests/053_fm_queue_test.sql` | 2 linie: edycja planu w `fm_plan_private` |
| `supabase/tests/055_security_hotfix_test.sql` | T0–T8 |

Vitest **169/169**, `vite build` OK. SQL: migracje 001–055 od zera + `--reapply 054,055` + testy 053 (T0–T16) i 055 (T0–T8) ✅ na lokalnym embedded Postgresie 17.10 (`--shim`, bez kont klientów).

---

## 4. Procedura wdrożenia (po zgodzie Artura, każdy krok osobno)

Warunek nadrzędny: **hotfix nie może zmienić ani usunąć żadnego wyboru dostawcy ani decyzji kupca.**

1. **054 (pilne)**: SQL Editor → cały plik → Run. Kontrola: zapytania z końca pliku + `node scripts/fm-permission-probe.mjs` (sekcja anon; bez kont) — `consent_audit`/`v_admin_*` zabronione dla anon, `company_capacity` = 0 wierszy; admin w aplikacji nadal widzi „Dane wejściowe” i pojemności.
2. **Kopia wejść PRZED 055**: SQL Editor → `scripts/fm-inputs-export.sql` → zapisać wynik jako `before.json` (bez danych osobowych). Dodatkowo zaraz po 055: `select fm_backup_inputs('po-055-2026-09-XX')` (snapshot w bazie, tylko admin).
3. **055**: krótkie okno (kilka minut), najlepiej gdy ruch jest mały. SQL Editor → cały plik → Run (jedna transakcja, ~40 ms lokalnie). **Nie owijać zewnętrznym `begin`** — plik ma własne `begin/commit`; próba „na sucho” na produkcji nie zastępuje testu (blokady tabel) — test był na oddzielnej bazie.
4. **Porównanie PO 055**: `scripts/fm-inputs-export.sql` → `after.json`; `node scripts/fm-inputs-compare.mjs before.json after.json` — oczekiwane: `company_target_retailers`, `fm_resps`, `companies.fm_selection_confirmed_at`, przypisania `profiles` **bez różnic** poza zmianami, które uczestnicy zrobili w oknie (widoczne jako konkretne DODANY/ZMIENIONY z identyfikatorami — każdą wyjaśnić). Jakakolwiek nieoczekiwana różnica = STOP: bez przeliczania, publikowania, maili, do wyjaśnienia. Nigdy nie przywracać starej kopii całej bazy (nadpisałaby nowsze decyzje).
5. **Deploy frontu** (`git tag prod-rollback-… ; merge --ff-only; push`) zaraz po 055 — stary bundle po 055: admin nie widzi kontaktu awaryjnego 3 sieci ani planu (plan dziś pusty), zapis wyborów idzie starą ścieżką przez triggery (nadal chroniony fazą, ale nie atomowo) → dlatego okno ma być krótkie, a admini odświeżają sesję (Ctrl+F5) po deployu.
6. **Sondy prawdziwych uprawnień** na kontach testowych (nie klientów): `node scripts/fm-permission-probe.mjs` (odczyty) → potem `--writes`. Potrzebne: konto testowe dostawcy z firmą testową (`fm_b2b_enabled`) i konto testowe kupca przypisane do sieci testowej `fm26_active` — Artur zakłada w panelu admina, hasła tylko w zmiennych `FM_PROBE_*`.
7. **Ręcznie w aplikacji na kontach testowych**: dostawca — ⭐/👍 (zapis przez RPC), „Potwierdź wybór”, zapis „Mój profil” i profilu firmy z logo; kupiec — odpowiedź na dostawcę; admin — panel sieci z kontaktem awaryjnym (FRAC, SPAR/GK Specjał, Nasz Sklep), „Dane wejściowe”, zapis szkicu planu → `fm_plan_private`, `fm_my_schedule` = całość. **Bez zmiany fazy produkcyjnej** — zamknięcie fazy przetestowane na oddzielnej bazie (055 T6).

---

## 5. Wycofanie bez ponownego otwierania luk

Domyślnie: **nie** przywracać `buyer_*` do `retailers`, planu do `fm_settings.schedule` ani polityk `*_authenticated` storage. Gdy coś nie działa:
- zapis wyborów: `drop function fm_set_company_targets(uuid, jsonb)` → klient sam wraca do starej ścieżki (DELETE+INSERT pod triggerem fazy);
- plan: `drop function fm_my_schedule()` → klient czyta `fm_settings.schedule` (null → brak planu, nic nie wycieka);
- kontakty: `getRetailers` bez osadzenia działa (fallback); dane są w `retailer_contacts`;
- blokada fazy/terminu: `alter table company_target_retailers disable trigger trg_ctr_phase_lock` (i analogicznie `fm_resps`) — tylko decyzją Artura;
- triggery ochronne: `alter table profiles disable trigger trg_profiles_guard_protected` / `companies … trg_companies_guard_protected` — tymczasowo, z wpisem w audit_log.
Front: tag `prod-rollback-…` jak zwykle; stary bundle współpracuje z nową bazą (fallbacki + mosty).

---

## 6. Otwarte decyzje dla Artura

1. Zgoda na **054** teraz.
2. Zgoda na **055** po review Codexa tej wersji (+ termin `selection_deadline`, jeśli ma obowiązywać przed zmianą fazy).
3. Konta testowe dostawcy i kupca do sond (§4.6).
4. Przekazanie właścicielowi drugiej aplikacji: `participant_profiles_authenticated_read using (true)`.
5. Przed przeliczeniem (osobno): Fozzy (rozpoznawanie istniejących wyborów, bez zmiany decyzji), migracja 049 + daty wpłat (po dodaniu `fm_payment_date` dopisać ją do listy kolumn chronionych w `companies_guard_protected`), snapshot `fm_backup_inputs`.
