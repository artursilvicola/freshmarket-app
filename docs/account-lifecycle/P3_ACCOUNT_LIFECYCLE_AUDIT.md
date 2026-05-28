# P3 Phase A — Account Lifecycle Audit

**Branch:** `feat/p3-account-lifecycle-audit`
**Status:** Audit/design only — bez migracji, bez kodu, bez usuwania danych.
**Cel:** zmapować zależności wokół kont (supplier / buyer / admin) żeby zaprojektować bezpieczny flow archiwizacji i ew. trwałego usuwania, włącznie z RODO.

P2 (i18n) zostało zamknięte tagiem `v-i18n-complete` na `829f5cc`. P3 dotyka znacznie wrażliwszych obszarów — płatności, historia handlowa, GDPR, RLS, Supabase Auth. **Idziemy ostrożniej niż przy i18n.**

---

## A. Mapa tabel powiązanych z tożsamością

### A.1 `profiles` — entry point tożsamości
**File:** `supabase/migrations/001_schema.sql:23-39` + `031_admin_levels.sql:32` + `032_secure_admin_rls_and_consent_versioning.sql:106-109` + `036_profiles_locale.sql`

Kolumny istotne dla lifecycle:
- `id` — UUID, FK do `auth.users(id)` **ON DELETE CASCADE**
- `role` — enum `'admin' | 'supplier' | 'buyer'`
- `admin_level` — `NULL | 'super'`
- `company_id` — FK do `companies(id)` ON DELETE SET NULL
- `retailer_id` — FK do `retailers(id)` ON DELETE SET NULL
- `active` — *NIE ISTNIEJE w schemacie* (audit subagent potwierdza)
- `accepted_terms_version`, `accepted_privacy_version`, `accepted_at` — RODO trail

**Triggery:**
- `on_auth_user_created` (`034:32-97`) — tworzy profile po INSERT do `auth.users`. SECURITY DEFINER, non-blocking.
- `trg_enforce_super_admin_on_role_change` (`033:36-117`) — BEFORE UPDATE; blokuje zmiany `role`/`admin_level` poza super-adminem.

### A.2 `companies` — supplier organization
**File:** `001:43-64` + `022:31-49` + `021:42-60`

Kolumny soft-state:
- `account_status` — enum `'pending_review' | 'active' | 'rejected' | 'suspended'` (default `'pending_review'`) (`022:33`)
- `preconnect_enabled` — boolean, default false (`022:36`)
- `fm_b2b_enabled` — boolean, default false (`022:39`)
- `approved_at`, `approved_by` (FK `profiles.id` ON DELETE SET NULL) (`022:42-45`)
- `status_note` — text, powód odrzucenia/zawieszenia (`022:48-49`)

**Trigger:** `trg_companies_set_approved_at` (`022:73-85`) — ustawia `approved_at` gdy status flip do `'active'`.

### A.3 `retailers` — retail chain
**File:** `001:103-116`

- `id` — INTEGER PK (hardcoded w seed)
- `active` — *NIE ISTNIEJE w schemacie głównej tabeli*, ale w `retailer_limits` jest `active` boolean (`001:317`)
- Frontend traktuje `retailers[].active !== false` jako filter (PreconnectFM.jsx:2016, 2388). Sugeruje to istnienie pola `active` jako późniejszy dodatek lub legacy property z JSONB

### A.4 Inne tabele z tożsamością

| Tabela | FK do tożsamości | ON DELETE | Wolumen danych |
|---|---|---|---|
| `payu_orders` | `company_id` → `companies.id` | CASCADE | Audyt płatności |
| `packages` | `company_id` → `companies.id` | CASCADE | Wallet/credits |
| `wallet_tx` | `company_id` → `companies.id` | CASCADE | Ledger |
| `offers` | `supplier_company_id` → `companies.id` | CASCADE | Treść handlowa |
| `offer_photos` | `offer_id` → `offers.id` | CASCADE | Storage refs |
| `sends` | `supplier_company_id`, `offer_id` | **brak ON DELETE**, CASCADE | **RESTRICT implicite** dla supplier_company_id |
| `legacy_offers` | `supplier_legacy_id` (string, NIE FK) | brak | Lookup po stringu |
| `legacy_sends` | `supplier_legacy_id`, `retailer_id` | retailer brak, supplier brak | Lookup po stringu |
| `fm_resps` | `supplier_company_id`, `retailer_id` | CASCADE | FM 2026 |
| `fm_prefs`, `fm_wishlists`, `fm_late_resps`, `company_target_retailers` | różne | CASCADE | FM 2026 |
| `fm_messages` | `from_user_id` → `auth.users.id` | SET NULL | Chat |
| `company_contacts`, `company_certs` | `company_id` | CASCADE | Profil firmy |
| `buyer_starred` | `buyer_user_id` → `auth.users.id` | CASCADE | Ulubione kupca |
| `audit_log` | `user_id` → `auth.users.id` | SET NULL | Audyt admin |
| `retailer_limits` | `retailer_id` | CASCADE | Limity |

**Cytat z audit subagenta:**
> "Schema does not include `active` or `archived_at` on `profiles`. Archive/soft-delete of user must happen via `auth.users` row deletion OR via `companies.account_status` for suppliers."

---

## B. Gdzie w aplikacji konto/firma/sieć są używane

### B.1 Frontend (`src/legacy/PreconnectFM.jsx`)

- **Filtry retailera/buyera:** `r.active !== false`, `b.active !== false` (lines 1997, 2016, 2072, 2079, 2310, 2388, 2390) — wszędzie domyśla się `active=true` jeśli brak pola
- **Supplier gating dla PreConnect/FM:** `co.preconnect_enabled`, `co.fm_b2b_enabled`, `co.account_status` (lines 2340-2343, 2644-2645)
- **Activation banner:** 4 statusy renderowane w shell — `pending_review`/`rejected`/`suspended`/`active-partial` (linie 3218..3282; przepisane w P2 final-qa fix #2)

### B.2 Backend (`src/lib/db.js`)

- **`createBuyer` / `updateBuyer`** linie 45, 385, 433 — `active = payload.active !== false`
- **`getRetailers`** linia 183 — `(r.buyers || []).find(b => b.active !== false)`
- **`saveCompanyStatus`** (ref. komentarz w 602) — admin może ustawić `account_status`, `preconnect_enabled`, `fm_b2b_enabled`
- **`listPendingCompanies`** linia 1382 — `.eq("account_status", "pending_review")`

### B.3 Backend (Netlify functions)

- **`admin-create-user`** — supplier/buyer/admin INSERT do `auth.users` + `profiles` (z `email_confirm: true`)
- **`admin-update-user`** — UPDATE `profiles.active`, role, retailer_id, buyer_categories itd.
- **`admin-reset-password`** — admin może wymusić nowe hasło lub magic link
- **`register-supplier-self`** — supplier self-register; jeśli któryś krok pada, robi cleanup: `await supaSvc.from("companies").delete().eq("id", company.id)` + `auth.admin.deleteUser(userId)` (linia 179)
- **`send-retailer-batch`** — pulluje `retailer.buyers` (filtruje `b.active`), wysyła per buyer locale

**Wniosek:** Jedyne istniejące HARD-DELETE w kodzie to:
- Rollback w `register-supplier-self` gdy któryś krok rejestracji failed (transactional cleanup, NIE business delete)
- `deleteFmWishlist`, `deleteFmLateResp` w db.js (wąsko: FM 2026 wishlist entries, nie konta)

**Brak business-level delete-account flow.** Cała aplikacja zakłada że konto istnieje albo jest soft-archived przez `account_status='suspended'` / `'rejected'`.

---

## C. Co może być soft-delete vs hard-delete

### C.1 Już istniejące soft-delete mechanizmy

| Encja | Mechanizm | Status |
|---|---|---|
| `companies.account_status` | enum 4 stany | ✅ używane w admin UI |
| `companies.preconnect_enabled` | bool gating | ✅ kontroluje wysyłki |
| `companies.fm_b2b_enabled` | bool gating | ✅ kontroluje FM |
| `offers.status='archived'` | enum stan | ✅ supplier ma button |
| `retailers[?].active`, `buyers[?].active` | bool filter | ⚠️ używane w app, ale nie ma jasno zdefiniowanej kolumny w schemacie |
| `profiles.active` | **brak** | ❌ nie istnieje |
| `archived_at`/`deleted_at` na żadnej tabeli | **brak** | ❌ nie istnieje |

### C.2 Rekomendacja per role

**SUPPLIER (firma + profil dostawcy):**
- **Soft-archive (default):** ustaw `companies.account_status='suspended'` + `preconnect_enabled=false` + `fm_b2b_enabled=false`
- Dane handlowe (oferty, wysyłki, packages, payu_orders, wallet_tx) **zostają** dla rozliczeń, RODO art. 6(1)(f) i audyt
- Supplier nie może się zalogować — *to wymaga dodatkowo* `auth.users.banned_until = '2099-12-31'` LUB nowej kolumny `profiles.archived_at`
- **Hard-delete (super-admin only, po >90 dniach od archiwizacji):** CASCADE DELETE `auth.users` → profile → company → wszystkie podrzędne. Storage cleanup wymaga osobnego sweepa
- **GDPR delete request:** osobny flow z anonimizacją (nie usuwanie). `companies.name='[usunięto]'`, profile.email pseudonim, ale `payu_orders.payu_order_id` zachowane (Ustawa o rachunkowości, 5 lat)

**BUYER (kupiec sieci):**
- **Soft-archive:** `profiles.active=false` (kolumna do dodania) LUB ustaw `retailers.buyers[].active=false` przez admin-update-user
- Aktualnie aplikacja używa `b.active !== false` — gdy `active=false`, buyer nie pokazuje się w `send-retailer-batch` filter (`activeBuyers`)
- Historia odczytów ofert (`sends.read_at`, `buyer_starred`) **zostaje**
- **Hard-delete:** rzadko potrzebne. Buyer to przeważnie email służbowy sieci, nie osoba prywatna z RODO
- **Sieć handlowa (retailer):** **prawie nigdy nie usuwana** — to entity biznesowy (Biedronka, Lidl). Można wprowadzić `active=false` (zakończona współpraca). Dane historyczne wysyłek zostają

**ADMIN:**
- **Soft-archive:** `profiles.role='supplier'` (downgrade) LUB `profiles.active=false`
- Audyt (`audit_log.user_id`) ma ON DELETE SET NULL → po usunięciu auth user, rekordy się orphan'ują ale akcja zostaje
- **Hard-delete:** tylko super-admin może. Jeśli admin był jedynym super-adminem — guard. Migracja musi sprawdzić `(SELECT COUNT(*) FROM profiles WHERE role='admin' AND admin_level='super') > 1` przed pozwoleniem na delete

---

## D. Co trzeba zachować dla historii

### D.1 Obowiązki ustawowe (PL)

| Dane | Wymóg | Okres |
|---|---|---|
| Faktury PayU (`payu_orders`) | Ustawa o rachunkowości, art. 74 | **5 lat** od końca roku obrotowego |
| Korespondencja handlowa | Ustawa o rachunkowości | **5 lat** |
| Wysyłki/oferty (`legacy_sends`, `sends`) | Dowody zawarcia umowy/oferty | **6 lat** (przedawnienie roszczeń) |
| Logi audytowe (`audit_log`) | RODO art. 5(2) accountability | **5 lat** zwykle |

**Implikacja:** Hard-delete NIE może objąć tych tabel. Anonimizacja zachowuje strukturę finansową ale usuwa PII.

### D.2 Co ZAWSZE zostaje (nawet przy hard-delete)

- `audit_log` rows (user_id SET NULL, action/entity zachowane)
- `payu_orders` z `payu_order_id` (compliance) — wymaga zmiany ON DELETE z CASCADE na SET NULL lub osobnej procedury anonimizacji
- `legacy_sends`, `sends` — wymaga zmiany ON DELETE lub pivot przez archiwizację

### D.3 Co można usunąć z czystym sumieniem

- `offer_photos` (storage objects + DB rows) — produkty wycofane
- `company_certs` (storage objects + DB rows) — certyfikaty wygasłe firmy
- `buyer_starred` — preferencje
- `fm_resps`, `fm_prefs`, `fm_wishlists`, `fm_late_resps` — dane eventu (>1 rok po evencie)
- `fm_messages` (orphaned przez SET NULL) — po pewnym czasie cron może zbierać

### D.4 Storage buckets — manualne cleanup wymagane

Audit subagent potwierdza: **wszystkie buckety mają path `<company_id|retailer_id>/...` ale BRAK FK cascade do storage z DB.**

| Bucket | Path | Cleanup po delete |
|---|---|---|
| `offer-photos` | `<company_id>/<offer_id>/<file>` | Wymaga osobnego sweep |
| `company-logos` | `<company_id>/<file>` | Wymaga sweep |
| `certs` | `<company_id>/<file>` (private) | Wymaga sweep |
| `company-materials` | `<company_id>/<file>` | Wymaga sweep |
| `retailer-logos` | `<retailer_id>/<file>` | Wymaga sweep |
| `brand-assets` | `<file>` (singleton) | Nie dotyczy delete-account |

**Konsekwencja:** P3 implementacja musi mieć krok `storage_cleanup_job(company_id|retailer_id)` w Netlify function lub Supabase function.

---

## E. Ryzyka RLS / Supabase Auth

### E.1 Usunięcie `auth.users` vs dezaktywacja profilu

**Cytat z audit subagenta:**
> "RLS does not enforce account_status. Policies check `is_admin()`, `app_company_id()`, `app_retailer_id()`, but NOT `account_status`. Application layer must enforce."

**Implikacje:**

1. **Jeśli usuniemy `auth.users` (hard-delete):**
   - `profiles` cascade down → user nie ma session, RLS automatycznie blokuje
   - Ale FK z innych tabel (sends, payu_orders) cascade lub failują → ryzyko utraty audit trail
   - Trzeba najpierw **zmienić ON DELETE** dla `payu_orders.company_id`, `sends.*` itp. na SET NULL — to migracja

2. **Jeśli dodamy `profiles.active=false` (soft-archive):**
   - **RLS się nie zmieni automatycznie** — supplier z `active=false` nadal widzi swoje oferty
   - Trzeba dodać sprawdzenie do helpera RLS: `app_role()`, `app_company_id()` mogą zwracać NULL jeśli `active=false`
   - Lub osobny helper `app_is_active() → boolean` używany w każdej polityce

3. **`auth.users.banned_until`:**
   - Supabase Auth ma built-in pole `banned_until` (timestamptz)
   - Można ustawić na `'2099-12-31'` żeby user się nie zalogował
   - **Nie wymaga zmiany RLS** — user nie ma session, więc `auth.uid()` jest NULL
   - **Cleanup-friendly:** un-ban przez `UPDATE auth.users SET banned_until=NULL`
   - **Mankament:** API to admin-only (service_role)

**Rekomendacja:** połączyć — `profiles.active=false` (app-level) + `auth.users.banned_until` (auth-level).

### E.2 Trigger `trg_enforce_super_admin_on_role_change`

- Jeśli archive zmienia `role` (np. admin → suspended_admin) trigger może zablokować
- Lepiej dodać kolumnę `archived_at` lub `active` zamiast zmieniać role

### E.3 RLS dla pending companies

- Aktualnie `companies_update_owner_or_admin` (`002:53-54`) pozwala suspended supplierowi edytować swoją firmę
- Czy chcemy żeby suspended supplier nadal mógł edytować profil? **Tak** (per banner activation flow: supplier może uzupełniać profil w pending_review)
- Ale czy `account_status='rejected'` powinien blokować edycję? **Otwarte pytanie** — wymaga decyzji biznesowej

---

## F. UI design — admin flows

### F.1 Admin: "Archiwizuj konto" (default)

**Scope:** wszystkie role (supplier/buyer/admin).

**UI lokalizacja:**
- `PageAdminFirmy` (admin > Firmy) — dla supplier: nowy button "Archiwizuj firmę" obok istniejących "Aktywuj"/"Wstrzymaj"/"Odrzuć"
- `PageAdminRetailers` (admin > Sieci) — dla buyer rows: button "Archiwizuj kupca" w kolumnie buyer cards
- `PageAdminTeam` (super admin > Administratorzy) — button "Archiwizuj administratora"

**Confirmation modal:**
```
⚠️ Archiwizujesz konto firmy {NAME}

Skutki:
✓ Firma nie zaloguje się
✓ Wysyłki pendingowe zostają, ale nie są wykonywane
✓ Historia (oferty, wysyłki, faktury) zostaje w systemie
✓ Można cofnąć — odznacz "Archiwizowane" w kolumnie statusu

Powód archiwizacji (wymagane):
[textarea — minimum 10 znaków]

[Anuluj] [Archiwizuj konto]
```

**Status badge w listach:**
- Aktywne — zielony
- Wstrzymane (`suspended`) — żółty
- Odrzucone (`rejected`) — czerwony
- **Archiwizowane** (nowe) — szary z ikoną archiwum
- Pending — niebieski

### F.2 Super-admin: "Usuń trwale"

**Scope:** tylko `super_admin` (`profiles.admin_level='super'`).
**Visibility:** ukryte do czasu spełnienia 3 warunków:
1. Konto jest już **archiwizowane od ≥90 dni** (`archived_at IS NOT NULL AND now() - archived_at > '90 days'`)
2. **Brak otwartych płatności** (`SELECT COUNT(*) FROM payu_orders WHERE company_id=$1 AND status IN ('pending','created')` = 0)
3. **Brak aktywnych wysyłek** (`SELECT COUNT(*) FROM sends WHERE supplier_company_id=$1 AND status IN ('queued','approved','sent')` = 0)

**Confirmation modal (dwustopniowy):**
```
🚨 KASUJESZ TRWALE: firma {NAME}

To NIE JEST archiwizacja. Operacja jest NIEODWRACALNA.

Zostaną usunięte:
❌ Profil dostawcy + auth user
❌ Wszystkie oferty ({N} szt.)
❌ Storage: logo, zdjęcia ofert, certyfikaty
❌ Wishlist FM 2026, target retailers, pre-konferencyjne odpowiedzi

ZOSTANĄ ZACHOWANE (compliance):
✓ Faktury PayU ({N} szt., wartość {SUM} EUR) — anonimizowane
✓ Wysyłki do sieci (audyt biznesowy)
✓ Audit log (action+entity, user_id=NULL)

Wpisz nazwę firmy żeby potwierdzić: [__________]
☐ Rozumiem, że tej operacji nie da się cofnąć
☐ Zweryfikowałem, że firma archiwizowana od ponad 90 dni
☐ Zweryfikowałem, że brak otwartych płatności

[Anuluj] [USUŃ TRWALE]
```

### F.3 GDPR delete request (osobny flow)

**Scope:** osoba fizyczna (supplier z jednoosobową firmą, buyer-osoba). RODO art. 17 "right to be forgotten".

**NIE to samo co biznesowa archiwizacja** — wymaga anonimizacji, nie usunięcia.

**UI:**
- W ustawieniach profilu (supplier/buyer): button "Złóż wniosek o usunięcie danych (RODO)"
- Generuje email do admina z prośbą
- Admin w panelu ma sekcję "Wnioski RODO" — przyjmuje/odrzuca z uzasadnieniem (30 dni na decyzję per RODO)

**Implementacja anonimizacji (na poziomie funkcji DB):**
```sql
-- profiles
UPDATE profiles SET name='[usunięto]', email='deleted-{uuid}@anonim.invalid',
                    phone=NULL, position=NULL
WHERE id=$1;

-- companies
UPDATE companies SET name='[usunięto]', nip=NULL, phone=NULL, website=NULL,
                    description=NULL, profile_data=NULL, logo_url=NULL
WHERE id=$2;

-- payu_orders ZOSTAJĄ z payu_order_id (compliance księgowe)
-- sends ZOSTAJĄ (historia transakcyjna)
-- audit_log SET user_id=NULL (już ON DELETE SET NULL)
```

---

## G. RODO/GDPR vs business archive

### G.1 Rozróżnienie

| Aspekt | Business archive | GDPR delete request |
|---|---|---|
| Inicjator | Admin | User-fizyczna |
| Powód | Niewspółpraca / fraud / zakończenie współpracy | Wycofanie zgody na przetwarzanie |
| Co się dzieje | `archived_at=now()`, `active=false`, banned_until | Anonimizacja PII + zachowanie struktury finansowej |
| Odwracalne? | Tak (un-archive) | Nie (anonimizacja jest jednokierunkowa) |
| Termin | Natychmiast | 30 dni (RODO art. 12(3)) |
| Wymagane potwierdzenie | Admin uzasadnienie | User formal request + admin decision |
| Storage cleanup | Po hard-delete | Natychmiast (pliki z PII) |

### G.2 Co nie podlega RODO delete

- Dane firm (B2B) — pseudonimizacja na poziomie osoby kontaktowej, dane firmy zostają
- Faktury — Ustawa o rachunkowości > RODO right to erasure
- Audit log — uzasadniony prawnie interes (RODO art. 6(1)(f))

### G.3 Wymagane do P3 implementacji

- Nowe pole: `companies.gdpr_deleted_at` (timestamptz) — znacznik anonimizacji
- Nowe pole: `profiles.gdpr_deleted_at` (timestamptz)
- Tabela `gdpr_requests` (nowa): id, user_id (SET NULL ok), submitted_at, decided_at, decided_by (admin), decision (enum), reason
- Email template: "Twój wniosek RODO przyjęto/odrzucono" (PL/EN)

---

## H. Propozycja etapów implementacji P3

**Wszystkie etapy = docs-first + małe branche, jak P2 i18n.** Nie idziemy z migrations bez review.

### Etap A — Audit (TEN BRANCH, gotowe)
- ✅ Ten dokument
- Bez kodu, bez migracji

### Etap B — Migration design (osobny audit doc, dalej bez migracji)
- `docs/account-lifecycle/P3_MIGRATION_PLAN.md`
- Spis brakujących kolumn (`profiles.active`, `profiles.archived_at`, `profiles.gdpr_deleted_at`, `companies.archived_at`, `companies.gdpr_deleted_at`, `retailers.active`, `retailers.archived_at`)
- Spis brakujących tabel (`gdpr_requests`, `archive_audit`)
- Spis zmian ON DELETE (np. `sends.supplier_company_id` z brak na SET NULL żeby przeżywało hard-delete)
- Zmiany RLS (helper `app_is_active()`, polityki sprawdzające)
- Trigger updates dla `archived_at` setowane przy `active=false`
- Bez SQL — tylko opis

### Etap C — Migration 037-039 (PR z SQL do review)
- 037_account_lifecycle_columns.sql — dodanie kolumn
- 038_account_lifecycle_rls.sql — update RLS
- 039_gdpr_requests_table.sql — nowa tabela
- Każda migracja idempotent, reversible
- Backfill: wszystkie istniejące profile → `active=true`, `archived_at=NULL`
- **NIE deployujemy migracji bez full review** + dry-run na sandbox Supabase

### Etap D — Backend: archive endpoints
- `netlify/functions/admin-archive-account.js` (admin scope)
- `netlify/functions/admin-restore-account.js`
- `netlify/functions/admin-hard-delete-account.js` (super-admin only)
- `netlify/functions/gdpr-anonymize-account.js`
- `netlify/functions/storage-cleanup-job.js` (cron-style sweep)
- Wszystkie idempotent + audit log entry

### Etap E — Frontend: admin UI
- `PageAdminFirmy` → archive/restore buttons + confirmation modals
- `PageAdminRetailers` → buyer-level archive
- `PageAdminTeam` → admin-level archive (super-admin guard)
- Status badges in listach
- Hard-delete tab w PageAdminTeam (super-admin only, hidden when no eligible records)
- GDPR requests inbox w PageAdminTeam

### Etap F — User-facing: GDPR self-service
- Settings → "Złóż wniosek RODO" w supplier/buyer profile
- Email confirmation flow przez Resend
- "Status wniosku" w profilu

### Etap G — Storage cleanup background job
- Daily cron przez Netlify Scheduled Functions
- Skanuje storage buckety, porównuje z DB
- Usuwa orphaned objects (no parent in DB)

### Etap H — Documentation + GDPR record
- `docs/legal/RODO_PROCEDURY.md` — formalne procedury
- Update `docs/legal/POLITYKA_PRYWATNOSCI.md` o sekcję "Twoje prawa — wniosek o usunięcie"
- Update `docs/legal/REGULAMIN.md` o sekcję "Zakończenie umowy/Archiwizacja konta"

---

## I. Rekomendacja końcowa

### Domyślny tryb: **soft-archive z możliwością cofnięcia**

1. **Wszystkie role:** admin może archiwizować przez button w panelu z confirmation modalem
2. **Soft-archive flag:** nowa kolumna `profiles.active` (boolean, default true) + `profiles.archived_at` (timestamptz nullable)
3. **Auth lock:** `auth.users.banned_until='2099-12-31'` przy archiwizacji
4. **RLS update:** helpery `app_company_id()`/`app_retailer_id()` zwracają NULL jeśli profile nie-active
5. **Reversible:** un-archive przywraca `active=true`, czyści `banned_until`

### Hard-delete: **TYLKO super-admin, ≥90 dni od archiwizacji, brak otwartych płatności**

1. Visible tylko dla `is_super_admin()`
2. Three checkboxes confirmation w modalu
3. Wpisanie nazwy firmy żeby potwierdzić (typed confirmation)
4. Backend: zmiana ON DELETE dla `payu_orders` i `sends` z CASCADE na SET NULL przed implementacją hard-delete (compliance księgowy)
5. Storage cleanup job kasuje pliki po DB delete
6. Audit log entry: `action='hard_delete'`, `entity='company'`, `entity_id=<uuid>`, `meta={reason, archived_for_days}`

### GDPR: **anonimizacja, nie usunięcie**

1. Osobny flow w settings supplier/buyer
2. Email do admina + tabela `gdpr_requests`
3. Admin akceptuje → backend wykonuje SQL anonimizacji (pseudonimy zamiast PII)
4. Faktury (`payu_orders`) zostają z `payu_order_id` dla compliance księgowego
5. Audit log: `action='gdpr_anonymize'`

### Backward-compat ZASADA: **żadnych zmian funkcjonalnych w P3 etapach A-B**

- P3-A (TEN AUDIT) — tylko docs
- P3-B (migration plan) — tylko docs, bez SQL
- P3-C i dalej — z SQL/code, z review na każdym kroku

---

## J. Out of scope dla P3 jako całości

- Multi-tenancy (jeden user → wiele firm) — to nie jest archiwizacja, to architektura
- Two-factor auth (2FA) — odrębny security epic
- Email transition (zmiana adresu email) — odrębny audit user-profile-changes
- Account merger (połączenie dwóch firm) — odrębny epic

---

## K. Sygnowane przez audit subagent

Schema audit produced przez Explore subagent w tym branchu. Quoty z `subagent output` użyte w sekcji A i E. Pełen output subagenta nie jest commitowany (zbyt długi), ale fakty są zacytowane wraz z file:line.

**Dane do potwierdzenia przed Etapem B (osobny audit):**
- Czy `retailers.active` jest faktycznie w schemacie? Frontend używa, ale `001:103-116` nie pokazuje
- Lista istniejących seed accounts w sandbox Supabase (żeby zaplanować backfill)
- Czy istnieje wcześniejszy admin audit log w `audit_log` — jakie akcje już są logowane
- Czy Resend webhook (`resend-webhook.js`) wymaga adjustments przy delete account

---

## L. Statystyki audytu

- **Migracje przejrzane:** 28 plików, ~3859 linii SQL
- **Tabel z FK do tożsamości:** 17 (4 z CASCADE na profiles, 11 z CASCADE na companies, 8 z CASCADE na retailers)
- **Storage buckets do cleanup:** 5 (offer-photos, company-logos, certs, company-materials, retailer-logos)
- **Soft-delete columns istniejące:** `companies.account_status`, `companies.preconnect_enabled`, `companies.fm_b2b_enabled`, `offers.status`, `retailers/buyers.active` (z JSONB lub frontend-only)
- **Soft-delete columns brakujące:** `profiles.active`, `profiles.archived_at`, `companies.archived_at`, `retailers.archived_at` + GDPR fields
- **RPC do uwzględnienia:** 3 (`mark_legacy_send_read`, `expire_legacy_sends_14d`, `purchase_package`)
- **Triggery na `auth.users`/`profiles`:** 3 (`on_auth_user_created`, `trg_enforce_super_admin_on_role_change`, `trg_profiles_updated`)

**Skala P3 implementacji:** estimated ~3 migracje + ~5 Netlify functions + ~3 admin UI screens + 1 user-facing GDPR flow + 2 docs. **Większa niż P2 i18n cycle.** Robimy w 6-8 etapach z review po każdym.
