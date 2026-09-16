# Hotfix bezpieczeństwa B2B — wersja 3 po drugim review Codexa (16.09.2026)

**Status: NIE ZASTOSOWANE na produkcji.** Gałąź `fix/security-hotfix-2026-09-16` (z `origin/main` 467cbe4).
Historia: v1 7d90826 (review: 4×P1) → v2 c8842c8 (review: 3×P1 + 2×P2, `REVIEW_HOTFIX_055_c8842c8.md`) → **v3 = ten commit**.
Wszystko przetestowane od zera na oddzielnej bazie (embedded Postgres 17.10, `--shim`): migracje 001–055, `--reapply 054,055`, test kolejek 053 (T0–T16), test 055 (T0–T8, rozszerzony), nowy test równoległych zapisów; vitest 183/183; build OK.
Nic tu nie wysyła maili, nie publikuje planu, nie zmienia wyborów uczestników, nie zmienia fazy ani terminu na produkcji.

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
1. **Kontrola reguły udziału**: zapytanie z §1 — lista kupców bez własnej flagi w sieciach FM (stan 16.09: patrz niżej). Decyzja Artura: włączyć flagę przed 055 albo świadomie zostawić (wtedy ci kupcy nie odpowiadają ani nie widzą planu).
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
