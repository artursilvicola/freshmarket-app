# Admin Companies 2.0 — Audit obecnego panelu Admin → Firmy

**Branch:** `feat/admin-companies-ux-plan`
**Status:** Audit only. Bez zmian kodu, bez migracji.
**Cel:** zmapować obecny `PageAdminFirmy` żeby zaprojektować przebudowę do CRM-owego panelu obsługi firm + szybkiej komunikacji.

Bazuje na deep-audit przez Explore subagent. Lokalizacja kodu: `src/legacy/PreconnectFM.jsx` linie 7745–8166 (~420 linii) + `CompanyPreviewModal` linia 8483 + `FloatingChat` linia 1257 + `PageAdminChat` linia 1360.

---

## A. Struktura komponentu

### A.1 State (linie 7750–7761)

| State | Typ | Cel |
|---|---|---|
| `expandedId` | `string \| null` | ID pojedynczej rozwiniętej firmy (jedna naraz) |
| `filter` | `"all" \| "pending"` | Aktualny filter widoku |
| `statusNoteDraft` | `{[id]: text}` | Notatka/powód odrzucenia per firma (przed save) |
| `savingStatusId` | `string \| null` | ID firmy w trakcie zapisu statusu |
| `aiLoadingId` | `string \| null` | ID firmy w trakcie regeneracji AI |
| `editingId` | `string \| null` | ID firmy w trybie edycji opisów AI |
| `editDraft` | `{description_short, description}` | Draft edycji |
| `previewCompany` | `co \| null` | Trigger dla `CompanyPreviewModal` |

### A.2 Props (linia 7745)

```js
PageAdminFirmy({
  limits,           // legacy fallback state (mock LIMITS_INIT)
  updateLimit,      // (id, changes) — local state only; brak save do DB
  sends,            // wysyłki
  offers,           // oferty
  orders,           // niewykorzystane (passed but inert)
  fl,               // toast callback
  retailers,
  companies,
  setCompanies,     // wraps bulkUpsertCompanies (DB)
  dbCapacity,       // view company_capacity z DB
  refreshCapacity,  // reload dbCapacity
});
```

### A.3 Sekcje layoutu (~lines 7913–8152)

1. Header + filter buttons ("Wszystkie" / "Do zatwierdzenia") z badge `pendingCount`
2. Empty state (`<Alrt>`) gdy lista pusta
3. Lista firm — każda firma to **karta** z:
   - **Collapsed header** (7938-7962): logo, nazwa, status badge, kraj, pkg, validity, PreConnect/FM badges, usage meter, chevron
   - **Expanded details** (7963-8143): status section, package usage progress, package input, AI description editor, sends history
4. `CompanyPreviewModal` mount (warunkowy)

---

## B. Filter i lista

### B.1 Filter (linia 7753)

- Default: `"all"`
- Wartości: `"all"` (wszystkie firmy), `"pending"` (tylko `account_status === "pending_review"`)
- **Brak innych filtrów:** brak typu firmy, kraju, pakietu, FM B2B, kontaktu, aktywności, etc.

### B.2 Logika filtrowania (7895–7911)

```js
const capacitySource = dbCapacity.length > 0 ? dbCapacity : [];
const allLims = capacitySource.map(c => ({...}));
const pendingCount = capacitySource.filter(c => c.account_status === "pending_review").length;
const visibleLims = filter === "pending" ? allLims.filter(pending) : allLims;
```

- **Brak sorting** — kolejność wynika z DB
- **Brak pagination** — wszystkie renderowane naraz, żadnej wirtualizacji
- **Brak search**

### B.3 Per-row kolumny (collapsed)

- Logo `CompanyLogo` (fallback emoji)
- Nazwa
- Status badge (kolorowane)
- Kraj (kod 2-literowy)
- Package (e.g. `prem_10`)
- Pkg validity (YYYY-MM-DD)
- PreConnect icon (amber jeśli `enabled=false` przy active)
- FM B2B icon (teal jeśli enabled)
- Used/max counter z meterem (green<70 / amber 70-89 / red≥90)
- Chevron expand

### B.4 Empty states

- `filter="pending"` + brak → `admin.firmy.empty_pending`
- `filter="all"` + brak → `admin.firmy.empty_all`

---

## C. Akcje per firma

### C.1 Status lifecycle (`changeAccountStatus`, linie 7834–7873)

| Current | Available actions | Target | Email template |
|---|---|---|---|
| `pending_review` | Approve / Reject | `active` / `rejected` | `account_activated` / `account_rejected` |
| `active` | Suspend | `suspended` | `account_suspended` |
| `rejected` | Reactivate | `active` | `account_activated` |
| `suspended` | Reactivate | `active` | `account_activated` |

**Side-effects:**
- `→active`: auto `preconnect_enabled=true`, `approved_at=ISO`
- `status_note` saved (rejection reason / suspension reason)
- Email async via `dbNotifySupplier()` → `/.netlify/functions/send-supplier-notification`
- Toast: `admin.firmy.toast_status_changed_*`

### C.2 Access flags (`toggleAccessFlag`, linie 7875–7880)

Dwa niezależne toggle (linie 8012–8026):
- **PreConnect** (`preconnect_enabled`) — auto-set `true` przy activation, można toggle osobno
- **FM B2B** (`fm_b2b_enabled`) — opt-in only (admin manualnie włącza)

Oba: `patchCompany` → `bulkUpsertCompanies` + `refreshCapacity()`.

### C.3 Package (linie 8039–8056)

- **Max limit** input → `updateLimit(id, {max})` — **brak persist do DB!** Tylko client state
- **Plan dropdown** (`std_5/10/20/prem_10/20`) → `updateLimit(id, {pkg})` — analogicznie tylko state

⚠️ **Pułapka**: zmiany limit/pkg są efemeryczne. Reload strony cofnie.

### C.4 AI description (3 funkcje, linie 7777–7827, 8057–8127)

| Akcja | Funkcja | Status flow |
|---|---|---|
| Generate / regenerate | `regenerateForCompany(firmCo)` | → `pending` |
| Approve | `approveDescriptions(firmCo)` | `pending` → `approved` |
| Edit inline | `startEdit` / `saveEdit` / `cancelEdit` | → `edited` |

**Review status badges** (hardcoded PL w const linie 7883-7888 — *NOT i18n'd!*):
- `pending` → "Czeka na review" (amber)
- `approved` → "✓ Zatwierdzony" (green)
- `edited` → "Edytowany ręcznie" (teal)
- `rejected` → "Odrzucony" (red, ale UI go nie pokazuje)

### C.5 Send history (linie 8128–8143)

- Ostatnie 5 wysyłek danej firmy, reversed chronologically
- Per row: emoji, offer→retailer, status badge tooltip
- **View-only**, brak akcji

---

## D. Źródła danych

### D.1 Resolve firmy

```js
const firmCo = (companies||[]).find(c => c.id === lim.id) || { id: lim.id };
```
Z parent `companies` prop (loaded via App `bulkUpsertCompanies` reverse — initial query gdzieś w `App.useEffect`).

### D.2 Capacity (linie 7890–7935)

| Field | Source | Notes |
|---|---|---|
| capacity primary | `dbCapacity` (view `company_capacity`) | Async load |
| capacity fallback | `limits` (mock seed) | Gdy dbCapacity empty |
| usage calc | filtruje `sends` po `legacyKeyMatchesCompany(s.supplierId, firmCo)`, excluduje `rejected/refunded/queued` | |

### D.3 Mapping fields per row

| Field | Source | Notes |
|---|---|---|
| `name` | `lim.name` (z capacity view → `companies.name`) | |
| `country` | `lim.country` | 2-letter code |
| `account_status` | `firmCo.account_status` | Default "active" |
| `approved_at` | `firmCo.approved_at` | Tylko gdy `status="active"` |
| `preconnect_enabled`, `fm_b2b_enabled` | `firmCo.*` booleans | |
| `pkg_plan` | `lim.pkg` | |
| `pkg_expiry` | `lim.pkgExpiry` | Truncated YYYY-MM-DD |
| `description_short`, `description`, `ai_review_status` | `firmCo.*` | AI fields |
| `contacts` | `firmCo.contacts` | **Tylko w preview modal, NIE w row** |

### D.4 Profile data (JSONB)

`companies.profile_data` — pełna struktura `{basics, offer, trade, operations, materials, supplier_pitch}` widoczna **tylko** w `CompanyPreviewModal`, nie w panelu admin firmy.

---

## E. Contact info — KRYTYCZNA LUKA dla planu

### E.1 Co JEST widoczne w row + expanded

**Nic.** Admin nie widzi w panelu:
- imienia/nazwiska osoby kontaktowej
- emaila kontaktowego
- telefonu

Expanded row pokazuje: nazwę, status, kraj, package info, AI descriptions, ostatnie 5 wysyłek. **Zero contact info.**

### E.2 Co JEST widoczne w `CompanyPreviewModal` (po klik "Podgląd")

- Logo, nazwa, kraj, miasto, NIP, rok założenia, liczba pracowników, website
- Types, categories badges
- Pełne AI descriptions
- Profile data (offer, markets, operations, certs, materials)
- **Contacts section** (linie 8624–8628): rendering `co.contacts || []` jako rows z `{name, position, phone, email}`
- Active offers list

### E.3 Source kontaktów

- `co.contacts` array — wypełniany przez supplier'a w `PageCompany` (komponent linia 4363-4700)
- Każdy contact: `{role, name, position, phone, email}`
- Storage: `companies.contacts` JSONB column

### E.4 Czego BRAKUJE — pain points admina

1. **Email/telefon w wierszu listy** — admin musi klikać "Podgląd" żeby zobaczyć kontakt → mocno spowalnia obsługę
2. **Telefon firmy** (`companies.phone` field) — nie pokazywany nigdzie w panelu
3. **Imię + nazwisko głównego kontaktu** — tylko w modal
4. **`profiles.email`** (konto auth) vs `companies.contacts[0].email` (kontakt biznesowy) — brak rozróżnienia w UI
5. **`mailto:` / `tel:` links** — **brak**
6. **Copy email / copy phone buttons** — **brak**
7. **Chat z firmą bezpośrednio z admin firmy** — **brak integracji**

### E.5 Field mapping contact

| Co admin chce | Aktualne źródło | Status w panelu |
|---|---|---|
| Email firmy biznesowy | `companies.email` | NIE pokazywane |
| Telefon firmy | `companies.phone` | NIE pokazywane |
| Email osoby kontaktowej | `companies.contacts[0].email` | Tylko modal |
| Telefon osoby kontaktowej | `companies.contacts[0].phone` | Tylko modal |
| Imię/nazwisko kontaktu | `companies.contacts[0].name` | Tylko modal |
| Email konta usera | `profiles.email` (FK przez company_id) | NIE pulled w panelu |
| Stanowisko | `companies.contacts[0].position` | Tylko modal |

---

## F. CompanyPreviewModal scope (linie 8483–8673)

### F.1 Props

```js
CompanyPreviewModal({ co, onClose, offers, sends, buyerRetailerId, role })
```

### F.2 Co pokazuje (nad row z panelu)

1. Logo + branding (nazwa, kraj, miasto, NIP, website)
2. Pełne descriptions (short + long, jeśli różne)
3. Profile data sections (jeśli supplier wypełnił):
   - Offer: products year-round, seasonal, customer types, private label
   - Markets: export countries, main markets, volumes, partnership types
   - Operations: capabilities badges
   - Certs: lista z numerami + validity
   - Materials: gallery PDF/zdjęcia
   - Supplier pitch
4. **Contacts** (8624-8628): full cards z `{name, position, phone, email}`
5. Active offers (8630-8670):
   - Filtruje `offers.status="active"` dla company
   - Privacy guard: jeśli `role="buyer"` — pokazuje tylko oferty wysłane do retailera buyera

### F.3 Co nie pulled

- Package/capacity info (nie potrzebne dla preview supplier'a)
- Sends status history
- Admin notes / status_note

---

## G. Chat infrastructure

### G.1 Storage

- Tabela: `fm_messages` (z 008 migration)
- Kolumny (per audit P3 Phase A sekcja A): `id`, `thread_key`, `from_role`, `from_user_id` (FK auth.users ON DELETE SET NULL), `to_role`, `body`, `data`, `read_at`, `created_at`

### G.2 Thread resolution (`FloatingChat` linie 1264–1267, `PageAdminChat` linie 1387–1392)

```js
// Brak explicit thread UUID — filtruje messages po pair (userId, "admin")
const thread = messages.filter(m =>
  (m.fromId === myId && m.toId === "admin") ||
  (m.fromId === "admin" && m.toId === myId)
).sort((a,b) => a.timestamp - b.timestamp);
```

- **Brak thread table** — konwersacja rekonstruowana per session z message log
- Implicit thread = pair (userId, "admin")

### G.3 Admin chat panel (`PageAdminChat`, linia 1360+)

- Lista wszystkich unique uczestników (userów którzy pisali do admina) z unread counter
- Selecting thread: `onMarkThreadRead(uid, "admin")`
- Wyświetla wybrany thread + reply input
- **Brak direct launch z `PageAdminFirmy` → `PageAdminChat`**

### G.4 Czy admin może napisać z firmy?

**Nie** — obecnie disconnected.

Co trzeba dodać:
1. Button w expanded row (next to status actions) — np. `Czat z firmą`
2. Callback `onOpenChatWithCompany(companyId)` przekazany z App
3. Navigation `nav("a-chat")` + setSelected(uid_supplier_owner_of_company)
4. Albo inline drawer (większy refactor)

**Pre-requisite:** trzeba zmapować `companies.id` → `profiles.id` (owner via `company_id` FK). Może wymagać query w App (`getCompanyOwnerProfileId(companyId)`).

---

## H. Status lifecycle — szczegóły

### H.1 Status values (const linia 7738)

| Value | Color | Meaning |
|---|---|---|
| `pending_review` | amber | Nowa rejestracja czeka na approval |
| `active` | green | Approved, ma access do platformy |
| `rejected` | red | Odrzucony, nie może się rerejestrować |
| `suspended` | red | Revoked, można reaktywować |

### H.2 Transitions (linie 7997-8008)

Mapping w sekcji C.1.

### H.3 Email per transition (linia 7849-7852)

```js
const tplKey = newStatus === "active" ? "account_activated"
             : newStatus === "rejected" ? "account_rejected"
             : newStatus === "suspended" ? "account_suspended"
             : null;
```

Payload (7857-7862):
```js
{
  companyName: firmCo.name,
  preconnectEnabled: newStatus === "active" ? true : !!firmCo.preconnect_enabled,
  fmB2bEnabled: !!firmCo.fm_b2b_enabled,
  statusNote: note,
}
```

### H.4 Persistence

- Local: `patchCompany(id, {account_status, status_note})`
- DB: `bulkUpsertCompanies` (via `setCompanies`)
- Refresh: `refreshCapacity()`

### H.5 Inne status fields

- `approved_at` (ISO) — set on activation, display "Zatwierdzono YYYY-MM-DD" (linia 7983)
- `status_note` (text) — textarea visible jeśli `isPending || status==="rejected" || status==="suspended"` (linia 7987)

### H.6 "Archived" status?

**Brak.** Suspended/rejected pozostają w głównej liście — admin nie ma "schowaj na zawsze" w tym panelu (per P3 audit, ten stan dopiero do dodania w P3 Phase C).

---

## I. PreConnect + FM toggles

### I.1 UI (linie 8012-8026)

Dwa labelled checkboxes w expanded status section:
- **PreConnect** (`preconnect_enabled`) — teal jeśli enabled
- **FM B2B** (`fm_b2b_enabled`) — purple jeśli enabled

### I.2 Auto-set

- Activation auto-włącza `preconnect_enabled=true` (linia 7843)
- FM B2B zostaje opt-in (admin manualnie)

### I.3 Per-company override

**Tak.** Można mieć `active` + `preconnect_enabled=false` (display: warning icon w row, linia 7953).

### I.4 Persistence

`bulkUpsertCompanies` (linie 1548-1549 db.js) — round-trip z `account_status, preconnect_enabled, fm_b2b_enabled`.

---

## J. Package / capacity / limits

### J.1 `limits` prop (legacy fallback)

- Source: `App.useState(LIMITS_INIT)` (linia 1937)
- Seed: 3 demo companies `{id, name, country, pkg, max, used, pkgExpiry, email}`
- Update: `updateLimit(id, {max, pkg})` (linia 3020)
- **NIE persist do DB** — tylko client state ⚠️

### J.2 `dbCapacity` prop (real)

- Source: assumed `getAllCompanyCapacity()` w App `useEffect`
- Columns: `id, name, country, pkg_plan, qty_total, qty_used, pkg_expiry, account_status`
- Primary source gdy available

### J.3 `refreshCapacity`

Triggered przy zmianie `account_status / preconnect_enabled / fm_b2b_enabled / pkg_plan` (linie 7767-7773).

### J.4 Pakiety + plany (linie 8039-8056)

- **Max limit** input — `updateLimit(id, {max})` — tylko state
- **Plan dropdown** — `std_5/10/20/prem_10/20` — tylko state

### J.5 Usage display (linie 8030-8038)

- Read `lim.max` + computed `used` z filtered sends
- Pct: `(used / lim.max) * 100`, capped 100% width
- Color: green<70, amber 70-89, red ≥90
- Format: `"X/Y {unit}"`

---

## K. Activity / history

### K.1 Activity log per firma

**Brak** — żadnego activity log w panelu.

### K.2 Co jest displayed

1. **Approved date** (linia 7983): jeśli `active` + `approved_at` → "Zatwierdzono YYYY-MM-DD"
2. **Sends history** (linie 8128-8143): ostatnie 5, reversed chronologically, per row emoji + offer→retailer + status badge

### K.3 Last login

**Brak** — żadnej last_login data. Wymagałoby query na `auth.users.last_sign_in_at` (Supabase) lub własnego tracking w `profiles`.

---

## L. Notes / admin metadata

### L.1 `status_note` (linie 7976, 7987-7994, 8836-8839)

- Cel: rejection reason, suspension reason, activation comment
- Textarea visible jeśli pending/rejected/suspended
- Storage: `companies.status_note`
- **Nie persistuje przy innych statusach** (klaruje przy transitions)

### L.2 "Admin notes" field

**Nie istnieje** — brak free-text annotations field. Dodanie wymagałoby kolumny `companies.admin_notes` (lub osobna tabela `admin_notes(company_id, author_id, body, created_at)`).

### L.3 Inne metadata not in panel

- `completeness` score
- `logo_url`
- `certs` (tylko modal)
- `profile_data` (tylko modal)

---

## Summary stats

| Aspect | Count | Notes |
|---|---|---|
| State variables | 8 | expandedId, filter, statusNoteDraft, savingStatusId, aiLoadingId, editingId, editDraft, previewCompany |
| Major functions | 7 | patchCompany, regenerateForCompany, approveDescriptions, startEdit/saveEdit/cancelEdit, changeAccountStatus, toggleAccessFlag |
| Status states | 4 | pending_review, active, rejected, suspended (brak archived) |
| DB calls | 3 main | bulkUpsertCompanies, dbGenerateCompanyDescriptionAI, dbNotifySupplier |
| Email templates | 3 | account_activated, account_rejected, account_suspended |
| Package plans | 5 | std_5, std_10, std_20, prem_10, prem_20 |
| Per-row actions | ~12 | approve/reject/suspend/reactivate, PreConnect/FM toggle, AI regenerate/edit/approve, preview, sends list |
| Contact info w row | 0 | ❌ critical gap |
| Filter dimensions | 1 (status pending) | ❌ minimal |
| Search | brak | ❌ |
| Pagination | brak (all-at-once render) | UX ryzyko przy >100 firm |
| Chat z firmy | brak | ❌ disconnected from PageAdminChat |
| Admin notes field | brak | ❌ |
| Last login | brak | ❌ |
| Activity log | brak | ❌ (tylko approved_at + sends 5) |
| Bulk actions | brak | ❌ |

---

## Top 10 obserwacji dla redesign

1. **Contact bottleneck**: zero contact info w row/expanded → wymagana klik na "Podgląd" żeby dosięgnąć kontaktu
2. **Chat disconnect**: brak chat z poziomu firmy, admin musi switch context do `PageAdminChat` i znaleźć user
3. **Package management broken**: `updateLimit` tylko client state — nie ma persist do DB. **Bug do potwierdzenia w P3 lub osobnym fix branch**
4. **AI status hardcoded PL** (linie 7883-7888) — pominięte przy P2 i18n. Mała usterka do fix przy okazji
5. **Capacity timing**: `dbCapacity` loaded async; fallback `limits` jest mock — może mylić admina przy slow load
6. **No bulk actions**: nie można approve/reject wielu pending firm naraz
7. **Status note UX**: textarea always-visible dla pending/rejected/suspended; brak history zmian
8. **Last login missing**: brak metryki aktywności suppliera
9. **Archive not implemented**: suspended/rejected zostają w list permanently
10. **No audit trail**: zmiany się zapisują, ale brak logu "kto/kiedy/co zmienił"

---

## Powiązania z P3

P3 Phase A audit i Phase B plan już istnieją w `docs/account-lifecycle/`. **Admin Companies 2.0 jest komplementarne, NIE wymaga P3 dokończenia.**

Co czeka na P3:
- ❌ Archive flow (tab "Zarchiwizowane" w nowym UI — będzie dostępny dopiero po migracji 037)
- ❌ Hard-delete (super-admin only po 90 dniach, P3 Phase D+)
- ❌ GDPR self-service (P3 Phase F)

Co Admin Companies 2.0 może zrobić bez P3:
- ✅ Lepsze filtrowanie statusów (już istniejące `pending_review/active/rejected/suspended`)
- ✅ Contact info w wierszu (z `companies.contacts[0]` lub `companies.email/phone`)
- ✅ Chat z firmy (wymaga endpoint helper, ale tabela `fm_messages` istnieje)
- ✅ Search / multi-filter / bulk actions
- ✅ Detail drawer (zamiast modal preview)
- ✅ Suspend/restore flow (już istnieje `suspended` enum value)

---

## Sign-off

Audit gotowy do plan stage. Następny dokument: `ADMIN_COMPANIES_2_0_PLAN.md` z UX + technical plan implementacji w 5 małych branchach.
