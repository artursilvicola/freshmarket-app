# P3 Phase B — Account lifecycle migration plan

**Branch:** `feat/p3-account-lifecycle-migration-plan`  
**Status:** plan dokumentacyjny — bez plików SQL, bez migracji, bez zmian w aplikacji, bez dotykania danych.  
**Baza:** Phase A audit z `feat/p3-account-lifecycle-audit`.

Ten dokument przekłada audit Phase A na konkretny plan migracji. To nadal nie jest implementacja. Celem jest uzgodnienie kształtu danych, RLS, rollbacku i testów zanim powstaną realne pliki SQL.

---

## 0. Korekta do Phase A

Phase A wskazała, że `profiles.active` oraz `retailers.active` nie istnieją. Po ponownym sprawdzeniu migracji to wymaga korekty:

- `016_buyer_admin_managed_retailers.sql` dodaje `profiles.active boolean default true`.
- `016_buyer_admin_managed_retailers.sql` dodaje `retailers.active boolean default true`.
- `companies` nie ma `active`, ale ma `account_status`, `preconnect_enabled`, `fm_b2b_enabled`.

Wniosek dla Phase B: **nie dodajemy ponownie `profiles.active` ani `retailers.active`**. Używamy ich jako istniejących flag dostępu, a dokładamy brakujące metadane archiwizacji i GDPR.

---

## 1. Zasady projektowe

1. **Archive first, delete later.** Domyślna operacja w panelu admina to archiwizacja, nie trwałe usunięcie.
2. **Hard-delete tylko super-admin.** Trwałe usunięcie wymaga osobnego endpointu, karencji i checklisty.
3. **GDPR anonymization osobno.** Wniosek RODO nie jest tym samym co archiwizacja biznesowa.
4. **Historia finansowa zostaje.** PayU, wallet, pakiety, wysyłki, FM meetings i audit nie mogą znikać kaskadowo.
5. **RLS musi bronić także bez UI.** Samo ukrycie przycisków w aplikacji nie wystarcza.
6. **Nullable-first.** Migracje dodają nullable kolumny i indeksy, robią backfill, dopiero potem ewentualnie dokładają `not null`.
7. **Storage nie ma FK.** Pliki w bucketach wymagają osobnego sweep joba, nie można ufać kaskadzie DB.

---

## 2. Proponowane migracje

### 037_account_lifecycle_core

Cel: dodać metadane archiwizacji i centralny audit log zdarzeń lifecycle.

#### Tabele i kolumny

`profiles`:
- `active boolean` — istnieje; w migracji tylko backfill i ewentualny `set default true`.
- `archived_at timestamptz null`
- `archived_by uuid null references profiles(id) on delete set null`
- `archive_reason text null`
- `archive_note text null`

`companies`:
- `archived_at timestamptz null`
- `archived_by uuid null references profiles(id) on delete set null`
- `archive_reason text null`
- `archive_note text null`

`retailers`:
- `active boolean` — istnieje; w migracji tylko backfill i ewentualny `set default true`.
- `archived_at timestamptz null`
- `archived_by uuid null references profiles(id) on delete set null`
- `archive_reason text null`
- `archive_note text null`

Nowa tabela `account_lifecycle_events`:
- `id uuid primary key default gen_random_uuid()`
- `entity_type text not null` — `profile`, `company`, `retailer`, `auth_user`, `gdpr_request`
- `entity_id text not null` — text, bo `retailers.id` jest integer, a reszta zwykle UUID
- `action text not null` — `archive`, `restore`, `suspend`, `reactivate`, `hard_delete_requested`, `hard_delete_completed`, `gdpr_requested`, `gdpr_completed`
- `actor_profile_id uuid null references profiles(id) on delete set null`
- `target_profile_id uuid null references profiles(id) on delete set null`
- `target_company_id uuid null references companies(id) on delete set null`
- `target_retailer_id integer null references retailers(id) on delete set null`
- `reason text null`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

#### Indeksy

- `idx_profiles_active_role` on `profiles(active, role)`
- `idx_profiles_archived_at` on `profiles(archived_at)` where `archived_at is not null`
- `idx_companies_archived_at` on `companies(archived_at)` where `archived_at is not null`
- `idx_companies_account_status_archived` on `companies(account_status, archived_at)`
- `idx_retailers_active_archived` on `retailers(active, archived_at)`
- `idx_lifecycle_events_entity` on `account_lifecycle_events(entity_type, entity_id, created_at desc)`
- `idx_lifecycle_events_actor` on `account_lifecycle_events(actor_profile_id, created_at desc)`
- `idx_lifecycle_events_target_profile` on `account_lifecycle_events(target_profile_id, created_at desc)`

#### Constrainty

- `profiles.archive_reason` max length przez check, np. `char_length(archive_reason) <= 500`
- analogicznie dla `companies` i `retailers`
- `account_lifecycle_events.entity_type` check na znany zestaw typów
- `account_lifecycle_events.action` check na znany zestaw akcji

Nie dodawać jeszcze `not null` na `archived_by` ani `archive_reason`, bo backfill i import historycznych stanów mogą nie mieć aktora.

#### Backfill

- `update profiles set active = true where active is null`
- `update retailers set active = true where active is null`
- `companies.archived_at = null` dla wszystkich istniejących firm
- `retailers.archived_at = null`
- `profiles.archived_at = null`

Opcjonalny audit seed:
- dla firm ze `account_status in ('rejected','suspended')` nie ustawiamy automatycznie `archived_at`; to nie to samo co archiwizacja.

#### RLS

`account_lifecycle_events`:
- admin/super-admin: select all
- service role: insert
- authenticated admin: insert przez endpoint albo RPC, nie bezpośrednio z klienta
- zwykły użytkownik: brak bezpośredniego select w Phase C, chyba że dodamy osobny widok "moja historia konta"

`profiles`, `companies`, `retailers`:
- Phase C powinna zweryfikować helpery RLS (`is_admin`, `current_company_id`, `current_retailer_id`).
- Docelowo helpery dla zwykłych użytkowników powinny traktować `profiles.active=false` albo `profiles.archived_at is not null` jako brak dostępu.
- Admin/super-admin nadal widzi archived, ale listy UI domyślnie filtrują archived.

Minimalny bezpieczny kierunek:
- zachować obecne policy names, ale zaktualizować ich warunki przez helpery zamiast przepisywać wszystkie ręcznie.
- przed SQL konieczny osobny diff RLS policies z `pg_policies`.

#### Rollback

Przed użyciem produkcyjnym:
- można dropnąć nowe kolumny i tabelę eventów.

Po pierwszym użyciu:
- nie dropować `account_lifecycle_events`; rollback powinien polegać na ignorowaniu nowych pól w aplikacji.
- przy rollbacku archiwizacji można ustawić `active=true`, `archived_at=null`, ale eventy zostają jako historia.

#### Test queries

- policz aktywne profile bez archiwum:
  `select role, count(*) from profiles where active is true and archived_at is null group by role;`
- sprawdź firmy archived:
  `select account_status, archived_at is not null as archived, count(*) from companies group by 1,2;`
- sprawdź eventy bez aktora:
  `select action, count(*) from account_lifecycle_events where actor_profile_id is null group by action;`
- RLS smoke:
  supplier aktywny widzi własną firmę; supplier archived nie widzi danych biznesowych albo dostaje ekran archived; admin widzi oba.

---

### 038_delete_safety_constraints

Cel: przygotować bazę pod późniejszy hard-delete bez utraty historii finansowej i handlowej.

Ta migracja nie usuwa danych. Zmienia tylko relacje, które dziś mogłyby kasować zbyt dużo lub blokować kontrolowany cleanup.

#### Tabele i FK do sprawdzenia / zmiany

`payu_orders`:
- obecnie `company_id uuid not null references companies(id) on delete cascade`
- plan:
  - `company_id uuid null`
  - FK `on delete set null`
  - dodać snapshoty:
    - `company_name_snapshot text null`
    - `company_nip_snapshot text null`
    - `company_email_snapshot text null`
  - backfill snapshotów z `companies` przed zmianą FK

`packages`:
- obecnie `company_id references companies(id) on delete cascade`
- plan:
  - rozważyć `on delete set null`, bo pakiet jest częścią historii rozliczeniowej
  - dodać `company_name_snapshot text null`

`wallet_tx`:
- obecnie `company_id references companies(id) on delete cascade`
- plan:
  - `on delete set null`
  - snapshot `company_name_snapshot`
  - ledger nie powinien znikać przy hard-delete

`offers`:
- obecnie `supplier_company_id references companies(id) on delete cascade`
- plan ostrożny:
  - dla zwykłego archive nic nie zmieniać
  - dla hard-delete przed fizycznym delete wymagać anonimizacji lub archiwizacji ofert
  - nie zmieniać FK w 038 bez decyzji produktowej, bo oferty zawierają UGC i zdjęcia

`sends`:
- `retailer_id integer references retailers(id)`
- `supplier_company_id uuid references companies(id)`
- plan:
  - dodać snapshoty:
    - `supplier_name_snapshot text null`
    - `retailer_name_snapshot text null`
    - `offer_title_snapshot text null`
  - rozważyć FK `on delete set null` dla `supplier_company_id` i `retailer_id`
  - przed zmianą zrobić test, czy aplikacja nie zakłada non-null w historii

`legacy_sends` / `legacy_offers`:
- brak klasycznych FK do supplier/company; używają stringów (`supplier_legacy_id`, `retailer_id`)
- plan:
  - nie zmieniać FK
  - dodać cleanup/anonimizację w endpointach Phase D
  - ewentualnie dodać indeksy po `supplier_legacy_id`, jeśli hard-delete będzie robił lookup

`fm_messages`:
- już ma `from_user_id` / `to_user_id` z `on delete set null` w nowszych migracjach
- plan:
  - zachować
  - GDPR anonimizuje treść tylko po osobnej decyzji prawnej, bo chat może być dowodem ustaleń

#### Indeksy

- `idx_payu_orders_company_created` on `payu_orders(company_id, created_at desc)`
- `idx_wallet_tx_company_created` on `wallet_tx(company_id, created_at desc)`
- `idx_packages_company_created` on `packages(company_id, created_at desc)`
- `idx_sends_supplier_company` on `sends(supplier_company_id)`
- `idx_sends_retailer` on `sends(retailer_id)`
- `idx_legacy_sends_supplier_legacy` on `legacy_sends(supplier_legacy_id)`
- `idx_legacy_offers_supplier_legacy` on `legacy_offers(supplier_legacy_id)`

#### Backfill

Przed zmianą FK:
- `payu_orders.company_name_snapshot` z `companies.name`
- `payu_orders.company_nip_snapshot` z `companies.nip`
- `wallet_tx.company_name_snapshot`
- `packages.company_name_snapshot`
- `sends.supplier_name_snapshot`, `sends.retailer_name_snapshot`, `sends.offer_title_snapshot`

Backfill musi być idempotentny:
- tylko `where snapshot is null`
- batchowalny, jeśli tabela urośnie

#### RLS

- Zmiana FK na nullable oznacza, że admin nadal musi widzieć historyczne rekordy z `company_id is null`.
- Supplier nie powinien widzieć rekordów po hard-delete/anonimizacji, chyba że to jego własny eksport danych.
- Policy dla `payu_orders`, `wallet_tx`, `packages` powinny mieć gałąź admin oraz gałąź owner przez `company_id`; dla `company_id is null` tylko admin/service.

#### Rollback

Pełny rollback FK może być niemożliwy po hard-delete, bo `company_id` może już być null.

Bezpieczny rollback przed użyciem hard-delete:
- przywrócić FK cascade/restrict tylko jeśli `company_id is not null` dla wszystkich rekordów.

Po użyciu:
- nie wracać do cascade.
- rollback aplikacyjny: ukryć hard-delete UI i endpointy.

#### Test queries

- `select count(*) from payu_orders where company_id is null and company_name_snapshot is null;` powinno być 0 po hard-delete testowym.
- `select count(*) from wallet_tx where company_id is null and company_name_snapshot is null;` powinno być 0.
- hard-delete test na sandbox:
  1. utwórz firmę testową
  2. dodaj PayU order, wallet tx, package, send
  3. usuń firmę
  4. historia finansowa nadal istnieje i admin ją widzi

---

### 039_gdpr_requests

Cel: osobny, audytowalny flow dla wniosków RODO: eksport danych, anonimizacja, usunięcie danych tam gdzie prawnie możliwe.

#### Nowa tabela `gdpr_requests`

Kolumny:
- `id uuid primary key default gen_random_uuid()`
- `request_type text not null` — `export`, `anonymize`, `delete`, `rectify`
- `status text not null default 'submitted'` — `submitted`, `triage`, `approved`, `rejected`, `in_progress`, `completed`, `cancelled`
- `requester_profile_id uuid null references profiles(id) on delete set null`
- `target_profile_id uuid null references profiles(id) on delete set null`
- `target_company_id uuid null references companies(id) on delete set null`
- `target_retailer_id integer null references retailers(id) on delete set null`
- `requester_email text null`
- `subject_email_snapshot text null`
- `legal_basis text null`
- `scope jsonb not null default '{}'::jsonb`
- `decision_note text null`
- `rejection_reason text null`
- `approved_by uuid null references profiles(id) on delete set null`
- `completed_by uuid null references profiles(id) on delete set null`
- `requested_at timestamptz not null default now()`
- `approved_at timestamptz null`
- `completed_at timestamptz null`
- `due_at timestamptz null`
- `result_summary jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

#### Dodatkowe kolumny GDPR na encjach

`profiles`:
- `gdpr_anonymized_at timestamptz null`
- `gdpr_anonymized_by uuid null references profiles(id) on delete set null`
- `gdpr_delete_requested_at timestamptz null`

`companies`:
- `gdpr_anonymized_at timestamptz null`
- `gdpr_anonymized_by uuid null references profiles(id) on delete set null`

`retailers`:
- raczej bez pełnej anonimizacji, bo sieć handlowa to podmiot biznesowy, ale buyer profiles mogą być anonimizowane.

#### Indeksy

- `idx_gdpr_requests_status_due` on `gdpr_requests(status, due_at)`
- `idx_gdpr_requests_requester` on `gdpr_requests(requester_profile_id, requested_at desc)`
- `idx_gdpr_requests_target_profile` on `gdpr_requests(target_profile_id, requested_at desc)`
- `idx_gdpr_requests_target_company` on `gdpr_requests(target_company_id, requested_at desc)`
- `idx_profiles_gdpr_anonymized_at` where `gdpr_anonymized_at is not null`
- `idx_companies_gdpr_anonymized_at` where `gdpr_anonymized_at is not null`

#### Constrainty

- `request_type` check na znane typy
- `status` check na znane statusy
- co najmniej jeden target: profile/company/retailer/email snapshot
- `completed_at is not null` tylko gdy status `completed` — może być constraint albo kontrola endpointu

#### RLS

`gdpr_requests`:
- użytkownik może utworzyć własny request (`requester_profile_id = auth.uid()`)
- użytkownik może czytać własne requesty
- admin/super-admin może czytać i aktualizować wszystkie
- service role może wykonywać anonimizację i pisać `result_summary`

Nie dawać zwykłemu użytkownikowi możliwości bezpośredniego update statusu.

#### Backfill

Brak backfillu requestów.

Opcjonalnie:
- dla już zarchiwizowanych kont, jeśli powstaną przed 039, nie tworzyć automatycznych GDPR requestów.

#### Rollback

Przed użyciem:
- drop table i kolumny.

Po użyciu:
- nie dropować `gdpr_requests`; to rejestr prawny.
- rollback aplikacyjny: ukryć UI i endpointy, tabela zostaje read-only.

#### Test queries

- user widzi tylko swoje requesty
- admin widzi wszystkie
- request `completed` ma `completed_at`
- nie da się utworzyć requestu bez targetu
- anonimizacja testowa nie kasuje `payu_orders`

---

## 3. Soft archive vs hard delete vs GDPR

### Soft archive

Domyślna operacja dla admina.

Supplier:
- `profiles.active=false`
- `profiles.archived_at=now()`
- `companies.archived_at=now()`
- `companies.account_status='suspended'` albo osobny status UI "archived" wyliczany z `archived_at`
- Supabase Auth: `banned_until='2099-12-31'` przez backend endpoint
- PreConnect/FM flags wyłączone: `preconnect_enabled=false`, `fm_b2b_enabled=false`

Buyer:
- `profiles.active=false`
- `profiles.archived_at=now()`
- opcjonalnie buyer zostaje przy `retailer_id`, żeby historia była czytelna
- Auth ban analogicznie

Retailer:
- `retailers.active=false`
- `retailers.archived_at=now()`
- buyer profiles tej sieci nie muszą być automatycznie archiwizowane; to decyzja UI z checklistą

Admin:
- zwykły admin może zostać zdezaktywowany tylko przez super-admina
- super-admin nie może zarchiwizować siebie, jeśli jest ostatnim super-adminem

### Hard delete

Tylko super-admin. Wymagania:
- konto było soft-archived minimum 90 dni
- brak otwartych PayU orders (`created`, `pending`)
- brak aktywnych FM meetings w bieżącej edycji
- potwierdzenie tekstowe, np. wpisanie emaila lub nazwy firmy
- trzy checkboxy: finanse, historia handlowa, storage
- endpoint service role z audit event przed i po operacji

Hard-delete nie powinien być pierwszą wersją P3. Najpierw archive/restore.

### GDPR anonymization

Osobny flow:
- nie usuwa historii finansowej wymaganej prawnie
- pseudonimizuje PII: imię, nazwisko, telefon, email kontaktowy, notatki osobowe
- zachowuje strukturę transakcji, wysyłek, spotkań i audit trail
- generuje `gdpr_requests.result_summary`

---

## 4. UI i domyślne filtry

Admin UI:
- listy domyślnie pokazują tylko active/not archived
- filtr: `Aktywne`, `Zarchiwizowane`, `Wszystkie`
- badge `Archived`
- przycisk `Archive` z modalem skutków
- przycisk `Restore` dla archived
- hard-delete tylko super-admin i tylko w widoku archived

Supplier/buyer po archiwizacji:
- najlepiej brak logowania przez ban w Auth
- jeśli sesja jeszcze żyje, aplikacja powinna pokazać prosty ekran `Konto zarchiwizowane / Account archived`

---

## 5. Kolejność wdrożenia po Phase B

1. **Phase C1:** realny SQL `037_account_lifecycle_core`, sandbox dry-run, review.
2. **Phase C2:** realny SQL `038_delete_safety_constraints`, sandbox dry-run z testowym hard-delete.
3. **Phase C3:** realny SQL `039_gdpr_requests`, sandbox dry-run.
4. **Phase D:** backend endpoints:
   - archive profile/company/retailer
   - restore
   - request hard-delete
   - gdpr request create/update
5. **Phase E:** admin UI archive/restore.
6. **Phase F:** user-facing GDPR self-service.
7. **Phase G:** storage cleanup scheduled function.
8. **Phase H:** legal docs/procedury.

---

## 6. Decyzje do potwierdzenia przed SQL

1. Czy `companies.account_status='suspended'` ma oznaczać archived, czy archived jest zawsze osobnym `archived_at`?
2. Czy archiwizacja retailera automatycznie archiwizuje buyer profiles?
3. Czy archived supplier może widzieć read-only historię po zalogowaniu, czy blokujemy login całkowicie?
4. Jaki okres karencji dla hard-delete: 30, 90 czy 180 dni?
5. Kto zatwierdza GDPR request: admin czy tylko super-admin?
6. Czy anonimizujemy treść czatu, czy zostawiamy jako historię ustaleń biznesowych?
7. Czy storage sweep ma kasować pliki natychmiast po hard-delete, czy po osobnej karencji?

---

## 7. Rekomendacja Codex

Rekomendowany MVP P3:

1. Wdrożyć tylko **archive/restore** dla supplier, buyer i admin.
2. Hard-delete zostawić za feature flagą i nie udostępniać w UI do czasu przetestowania 038.
3. GDPR request table wdrożyć wcześniej niż anonimizację, żeby rejestrować wnioski od początku.
4. Nie usuwać fizycznie firm z historią PayU/wysyłek w pierwszej wersji.
5. Storage cleanup robić dopiero po potwierdzonym hard-delete/anonymization flow.

To minimalizuje ryzyko utraty danych i pozwala szybko rozwiązać bieżącą potrzebę: "konto ma zniknąć z aktywnego użycia".
