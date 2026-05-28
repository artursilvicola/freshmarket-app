# Admin Companies 2.0 — UX + implementation plan

**Branch:** `feat/admin-companies-ux-plan`
**Status:** Docs-only. Zero kodu, zero migracji. Plan do review przez Codex/Artura przed pierwszym branchem kodowym.
**Bazuje na:** `docs/admin/ADMIN_COMPANIES_2_0_AUDIT.md` (Commit 1 tego brancha).

---

## 0. Cel + założenia

### 0.1 Cel produktowy

Przebudować `Admin → Firmy` z one-list-fits-all + modal-only-contact na **CRM-owy panel obsługi firm** z:

1. **Segregacją statusów w taby** zamiast 1-bit filtra `all|pending`
2. **Kontaktem widocznym od razu w wierszu** (e-mail + telefon + osoba) zamiast w modalu
3. **Right-side drawer** z pełnym detalem firmy (zamiast pełnoekranowego modala, który ucinał kontekst listy)
4. **Czat z firmą jednym kliknięciem** z poziomu wiersza (bez przełączania widoków)
5. **Search + multi-filter + bulk actions** (na bazie istniejących statusów; bez nowych enum values)

### 0.2 Hard guardrails (przeniesione z briefa użytkownika)

Te ograniczenia obowiązują przez **całe** Admin Companies 2.0 (wszystkie 5 branchy kodowych):

- ❌ **Żadnych migracji SQL** (re-używamy istniejących kolumn `account_status`, `preconnect_enabled`, `fm_b2b_enabled`, `status_note`, `contacts`, `email`, `phone`)
- ❌ **Żadnego hard-delete** (poza scope; super-admin only po 90 dniach, P3 Phase D+)
- ❌ **Żadnego GDPR delete** (P3 Phase F, osobny projekt)
- ❌ **Żadnych zmian RLS** policies
- ❌ **Żadnych zmian PayU** (purchase_package, payu_orders, webhook — nie ruszamy)
- ❌ **Żadnych zmian template'ów maili** (account_activated/rejected/suspended pozostają as-is)
- ❌ **Żadnych zmian algorytmu FM** (matching / scoring / recommendations — nie ruszamy)
- ❌ **Żadnych zmian w produkcyjnych danych**
- ❌ **`Zarchiwizowane` tab NIE implementujemy** w tej serii (brak `archived_at` w schemacie — czeka na P3 Phase C migracja 037)

### 0.3 Założenia techniczne

- React + Vite, istniejący `PageAdminFirmy` w `src/legacy/PreconnectFM.jsx` (linie 7745–8166)
- i18n via `react-i18next`, namespace `admin.firmy.*` (już częściowo istnieje)
- Tabs/drawer/forms: na bazie istniejących komponentów z projektu (`Btn`, `Inp`, `Alrt`, `Modal`) — bez nowych dependency
- Statusy: tylko **4 istniejące enum values** (`pending_review`, `active`, `rejected`, `suspended`)
- Chat: tabela `fm_messages` + thread resolution przez pair `(userId, "admin")` (już istniejące)
- Data: `companies`, `dbCapacity` view, `profiles` (FK przez `company_id`)

### 0.4 Co NIE jest objęte tym planem

- Hard-delete / GDPR delete → P3
- Archived tab + `archived_at` migration → P3 Phase C
- Last login z `auth.users.last_sign_in_at` → osobne RPC/query (poza scope)
- Audit trail (kto/kiedy/co zmienił) → osobna tabela `admin_audit_log` (poza scope)
- Bulk PayU operations → poza scope
- Mass-mail (osobno do wielu firm) → poza scope
- Fix `updateLimit` client-only bug → osobny branch `fix/admin-package-persist`, nie część 2.0

---

## 1. Nowa struktura zakładek

### 1.1 Mapowanie tab → status

| Tab key | Label PL | Label EN | Filter | Domyślnie pokazane akcje per row |
|---|---|---|---|---|
| `active` | Aktywne | Active | `account_status === "active"` | Suspend, Czat, Kontakt, Pakiet |
| `pending` | Do zatwierdzenia | Pending review | `account_status === "pending_review"` | Approve, Reject (z notką), Kontakt |
| `suspended` | Wstrzymane | Suspended | `account_status === "suspended"` | Reactivate, Czat, Kontakt |
| `rejected` | Odrzucone | Rejected | `account_status === "rejected"` | Reactivate, Kontakt |
| `archived` | Zarchiwizowane | Archived | _FUTURE — nie implementować_ | — |
| `all` | Wszystkie | All | brak filtra status | wszystkie kontekstowo |

### 1.2 Default tab

**`active`** — bo to najczęstszy use case (admin obsługuje normalne firmy). Pending wybija się badge'em w nagłówku zakładki.

### 1.3 Counter badges per tab

Każdy tab pokazuje liczbę firm po prawej stronie nazwy:

```
Aktywne (124)   Do zatwierdzenia (3)   Wstrzymane (8)   Odrzucone (2)   Wszystkie (137)
```

Liczby liczone z `dbCapacity` (lub `companies` jeśli `dbCapacity` jeszcze nie loaded). Counter dla `pending` ma **dodatkowo amber kropkę** jeśli `> 0` — żeby admin od razu widział że jest robota.

### 1.4 Tab archived (przyszłość — bez kodu w 2.0)

W UI: tab dostępny ale **disabled + tooltip** "Wkrótce — wymaga P3 Phase C". Można pominąć całkowicie do P3.

Rekomendacja: **nie renderować** tabu archived w 2.0. Pojawi się dopiero po migracji 037 (dodaje `companies.archived_at`).

### 1.5 i18n keys do dodania

```json
"admin.firmy.tabs": {
  "active": "Aktywne",
  "pending": "Do zatwierdzenia",
  "suspended": "Wstrzymane",
  "rejected": "Odrzucone",
  "archived": "Zarchiwizowane",
  "all": "Wszystkie"
},
"admin.firmy.tabs_count_aria": "{{count}} firm"
```

(EN: `Active / Pending review / Suspended / Rejected / Archived / All`)

### 1.6 URL state

Tab persisted w URL search param: `?tab=pending`. Reload nie traci tabu.

---

## 2. Nowy layout listy firm

### 2.1 Per-row kolumny (compact)

Każdy wiersz pokazuje teraz w **jednym rzędzie** (bez expand) najważniejsze dane operacyjne:

| Kolumna | Źródło | Renderer |
|---|---|---|
| Avatar / logo | `companies.logo_url` lub fallback emoji | `<CompanyLogo>` 32×32 |
| Nazwa firmy | `companies.name` | bold + status pill obok |
| Kraj | `companies.country` | 2-letter code + emoji flag |
| **Email kontakt** | `companies.contacts[0].email` ?? `companies.email` | `mailto:` link + copy button |
| **Telefon kontakt** | `companies.contacts[0].phone` ?? `companies.phone` | `tel:` link + copy button |
| **Osoba kontaktowa** | `companies.contacts[0].name` + `position` | inline text |
| Pakiet | `lim.pkg_plan` | small badge |
| Wykorzystanie | `lim.qty_used / lim.qty_total` | mini meter (green/amber/red jak teraz) |
| FM / PreConnect | `fm_b2b_enabled` / `preconnect_enabled` | 2 dot indykatory |
| **Akcje** | — | `[Czat] [Szczegóły] [...]` |

### 2.2 Status pill

Status pokazany jako pill obok nazwy firmy (zamiast osobnej kolumny — oszczędza miejsce):
- `pending_review` → amber `⏳ Pending`
- `active` → green `✓ Aktywne`
- `rejected` → red `✕ Odrzucone`
- `suspended` → orange `⏸ Wstrzymane`

### 2.3 Akcje per row

**Quick actions** (zawsze widoczne):
- `[💬 Czat]` — otwiera prawy drawer z chatem (sekcja 4)
- `[Szczegóły]` — otwiera prawy drawer z pełnym detalem firmy (sekcja 3)

**Overflow** (`...` menu, status-zależne):
- Pending: `Approve` / `Reject`
- Active: `Suspend`
- Suspended/Rejected: `Reactivate`
- Always: `Skopiuj e-mail` / `Skopiuj telefon` / `Wyślij e-mail (mailto)`

### 2.4 Brak expand-in-place

Expand inline z poprzedniej wersji **znika** — zastępuje go prawy drawer (sekcja 3). Powód: drawer jest spójny, zachowuje listę widoczną, łatwiej przełączać między firmami bez tracenia kontekstu.

### 2.5 Sortowanie

Klik nagłówek kolumny sortuje:
- Nazwa (A-Z / Z-A)
- Kraj
- Pakiet
- Wykorzystanie (% used DESC default)
- Status (grupowanie wg statusu)
- Approved at (najnowsze first) — _tylko w tab `active`_

Default per tab:
- `active` → wykorzystanie DESC (najpierw ci, którzy używają)
- `pending` → najstarsze first (FIFO obsługi)
- `suspended` / `rejected` → status_note timestamp DESC
- `all` → nazwa A-Z

### 2.6 Pagination

Pierwsze 50 firm per tab + przycisk `Załaduj więcej` (incremental, nie strony). Liczba 50 jest pragmatyczna: <100 firm aktywnych mieści się w 2 paczkach, lista nie zamula DOM.

### 2.7 Wirtualizacja

**NIE** w pierwszej iteracji. Dodajemy dopiero gdy aktywnych firm > 300 (mała szansa w MVP). Wirtualizacja komplikuje sticky headers i drag-select w bulk actions.

### 2.8 Empty states

| Tab | Empty message |
|---|---|
| `active` | "Brak aktywnych firm. {{button: Zobacz pending}}" |
| `pending` | "Brak firm do zatwierdzenia ✓" |
| `suspended` | "Brak wstrzymanych firm" |
| `rejected` | "Brak odrzuconych firm" |
| `all` | "Brak firm. Sprawdź filtry." |

### 2.9 i18n keys do dodania

```json
"admin.firmy.row": {
  "no_contact_email": "Brak e-maila",
  "no_contact_phone": "Brak telefonu",
  "copy_email": "Skopiuj e-mail",
  "copy_phone": "Skopiuj telefon",
  "send_email": "Wyślij e-mail",
  "open_chat": "Otwórz czat",
  "open_details": "Szczegóły",
  "more_actions": "Więcej akcji"
},
"admin.firmy.empty_active": "Brak aktywnych firm.",
"admin.firmy.empty_suspended": "Brak wstrzymanych firm",
"admin.firmy.empty_rejected": "Brak odrzuconych firm",
"admin.firmy.load_more": "Załaduj więcej",
"admin.firmy.load_more_with_count": "Załaduj kolejne {{count}}"
```

---

## 3. Right-side drawer — pełny detal firmy

### 3.1 Trigger

Klik `[Szczegóły]` w rzędzie → drawer wjeżdża z prawej strony (~480 px szerokości). Lista po lewej zostaje widoczna.

### 3.2 Layout drawera (top-down)

```
┌─────────────────────────────────────┐
│ [Logo] Nazwa firmy        [×]      │  ← header sticky
│ Status pill · Kraj · NIP            │
├─────────────────────────────────────┤
│ TAB: [Podgląd] [Czat] [Pakiet]      │  ← subtaby drawera
│      [Historia] [Notatki]           │
├─────────────────────────────────────┤
│                                     │
│  (content of selected subtab)       │
│                                     │
└─────────────────────────────────────┘
```

### 3.3 Subtab `Podgląd` (default)

Re-używa logiki `CompanyPreviewModal` ale w drawer'ze:
- Pełne descriptions (short + long)
- Profile data sections (offer, markets, operations, certs, materials, supplier_pitch)
- **Lista kontaktów** (nie tylko primary) — `companies.contacts[]` jako cards z `name / position / phone / email` + każdy z `mailto:` / `tel:`
- Active offers (jak w obecnym modalu, z buyer privacy guard zachowanym)
- Brak nowej logiki — port istniejącego renderu modala

### 3.4 Subtab `Czat`

Embedded chat thread dla firmy. Wymaga rozwiązania:
- Mapping `companies.id` → `profiles.id` (owner = user którego `profiles.company_id === companies.id`)
- Reuse renderer'a z `PageAdminChat` (lista wiadomości + textarea + send button)
- Implicit thread = pair `(profileId, "admin")` — bez nowej tabeli

Szczegóły implementacji w sekcji 5.

### 3.5 Subtab `Pakiet`

- Wykorzystanie (`qty_used / qty_total` + progress bar)
- Pakiet plan (display only w 2.0; **NIE** dodajemy zmiany planu bo `updateLimit` ma bug client-only — patrz sekcja 0.4)
- Pkg expiry date
- PreConnect toggle (`preconnect_enabled`) — z save
- FM B2B toggle (`fm_b2b_enabled`) — z save
- AI description editor (re-używamy istniejący flow `regenerateForCompany` / `approveDescriptions` / `startEdit`/`saveEdit`/`cancelEdit`)

### 3.6 Subtab `Historia`

- Ostatnie 20 wysyłek firmy (z `sends`, filtered po company match)
- Per row: offer name → retailer name → status badge + tooltip ostatniego eventu
- Bez akcji — read only
- `approved_at` timestamp w nagłówku
- `status_note` (jeśli istnieje) widoczne na górze

### 3.7 Subtab `Notatki`

**Status_note** (istniejące pole `companies.status_note`):
- Textarea z notatką
- Save button → `patchCompany(id, { status_note })`
- Pokazuje "Ostatnia zmiana: {timestamp}" jeśli możliwe (z `updated_at`)

**NIE** dodajemy w 2.0:
- Admin notes (free-text, oddzielne pole) — wymagałoby `companies.admin_notes` kolumny (nowa migracja, naruszenie guardrail)
- Audit log — wymagałby osobnej tabeli

Notka: w przyszłości można dodać `companies.admin_notes` jako osobną migrację — poza scope.

### 3.8 Akcje statusowe w drawerze (footer sticky)

W dolnej części drawera, sticky bar z akcjami zależnymi od statusu:

| Status | Footer actions |
|---|---|
| `pending_review` | `[Approve] [Reject z notką]` |
| `active` | `[Suspend z notką]` |
| `rejected` | `[Reactivate]` |
| `suspended` | `[Reactivate]` |

Click `Reject` / `Suspend` → inline prompt textarea (status_note) → confirm → `changeAccountStatus(id, target, note)` (reuse istniejącej funkcji). Email transactional leci jak teraz.

### 3.9 Nav between firmami

W headerze drawera dodatkowo `[← Prev] [Next →]` strzałki — admin może bez klikania `×` przeskakiwać po liście. Pozycja przewijania listy follow'uje.

### 3.10 i18n keys do dodania

```json
"admin.firmy.drawer": {
  "tab_preview": "Podgląd",
  "tab_chat": "Czat",
  "tab_package": "Pakiet",
  "tab_history": "Historia",
  "tab_notes": "Notatki",
  "close": "Zamknij",
  "prev_company": "Poprzednia firma",
  "next_company": "Następna firma",
  "notes_save": "Zapisz notatkę",
  "notes_saved": "Zapisano",
  "history_recent_sends": "Ostatnie wysyłki",
  "no_history": "Brak wysyłek"
}
```

---

## 4. Statusy + lifecycle

### 4.1 Reuse istniejących enum values

Bez nowych statusów. Mapping:

| Akcja w UI | Status target | Email | Side-effects |
|---|---|---|---|
| Approve (z pending) | `active` | `account_activated` | `preconnect_enabled=true`, `approved_at=now()` |
| Reject (z pending) | `rejected` | `account_rejected` | `status_note=required` |
| Suspend (z active) | `suspended` | `account_suspended` | `status_note=required` |
| Reactivate (z suspended/rejected) | `active` | `account_activated` | `approved_at=now()` (overwrite OK) |

Wszystko reuse `changeAccountStatus(id, newStatus, note)` z obecnego kodu (linie 7834-7873).

### 4.2 Brak nowych przejść

Bez `archived` (czeka P3). Bez `pending_email_verify` (osobne). Bez `trial_ended` (osobne).

### 4.3 Status_note workflow

- Pending → Reject: **wymagane** podanie powodu (textarea required, button disabled gdy empty)
- Active → Suspend: **wymagane** podanie powodu
- Pending → Approve: opcjonalne (welcome note)
- Reactivate: opcjonalne

UI: inline prompt drawer footer (sekcja 3.8), zamiast oddzielnego dialogu.

### 4.4 Confirmation guard

- Reject + Suspend → modal "Czy na pewno? Wyślemy email do firmy" + preview snippet template'a
- Approve → no extra confirm (one click = approve)
- Reactivate → no extra confirm

### 4.5 Bulk actions w pending

W tab `pending` per row checkbox + bulk bar na dole:

```
[✓] Zaznacz wszystkie    [Approve N firm] [Reject N firm z notką]
```

Bulk reject: jedna wspólna `status_note` dla wszystkich (single textarea w modalu). Każda firma dostaje email osobno (loop call do `dbNotifySupplier`).

Bulk approve: brak notki, leci `changeAccountStatus(id, "active", "")`.

**Nie** dodajemy bulk dla `suspend` / `reactivate` w 2.0 (mniej częste, ryzykowne). Tylko bulk dla `pending`.

### 4.6 i18n keys do dodania

```json
"admin.firmy.status_change": {
  "reject_reason_required": "Podaj powód odrzucenia",
  "suspend_reason_required": "Podaj powód wstrzymania",
  "approve_confirm": "Zatwierdzić tę firmę?",
  "reject_confirm": "Odrzucić tę firmę? Wyślemy e-mail.",
  "suspend_confirm": "Wstrzymać tę firmę? Wyślemy e-mail.",
  "reactivate_confirm": "Reaktywować tę firmę?",
  "bulk_approve_n": "Zatwierdzić {{count}} firm?",
  "bulk_reject_n": "Odrzucić {{count}} firm?",
  "bulk_reason_shared": "Powód (wspólny dla wszystkich)"
}
```

---

## 5. Czat z firmą — integracja

### 5.1 Cel

Admin klika `[💬 Czat]` w rzędzie firmy lub subtab `Czat` w drawerze → widzi konwersację z **właścicielem profilu tej firmy** i może odpisać. Bez przechodzenia do `PageAdminChat` i szukania user'a po liście.

### 5.2 Mapping companyId → owner profileId

**Helper** (w `src/lib/db.js`, nowy ale małyx):

```js
export async function getCompanyOwnerProfile(companyId) {
  // Wybiera primary owner: profile z company_id === companyId
  // i (preferowanie) role === 'supplier' (lub jakkolwiek w schemacie się nazywa)
  // Fallback: pierwszy znaleziony
  const { data } = await supabase
    .from('profiles')
    .select('id, email, role, active')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data; // { id, email, role, active } | null
}
```

Edge cases:
- **Brak ownera** (firma bez user'a, np. created by admin) → UI pokazuje "Brak właściciela konta. Czat niedostępny." w subtab Czat
- **Owner inactive** (`profiles.active === false`) → UI pokazuje warning "Konto wstrzymane — wiadomości mogą nie dotrzeć" ale pozwala napisać
- **Wielu właścicieli** (np. firma ma 2 supplier accounts) → bierzemy primary (najstarszy created_at); UI ma menu "Zmień adresata" w przyszłości

### 5.3 Chat renderer reuse

`PageAdminChat` ma już całą logikę threadu, message log, send, mark read. Refactor:
- Wydzielenie chat threadu jako sub-component `<AdminChatThread userId={profileId} myId={adminId} />`
- `PageAdminChat` używa wybiera userId z listy → mountuje `<AdminChatThread>`
- Drawer subtab `Czat` mountuje `<AdminChatThread userId={ownerProfileId} myId={adminId}>` z `getCompanyOwnerProfile` resolved
- Quick `[💬 Czat]` button w rzędzie listy: otwiera drawer + auto-select subtab Czat

### 5.4 Brak nowej tabeli

Bez `chat_threads` table — nadal pair `(userId, "admin")` implicit (P3 Phase B notuje że to suboptymalne ale nie ruszamy w 2.0).

### 5.5 Read receipts

Otworzenie subtab Czat → automatyczne `onMarkThreadRead(profileId, "admin")` (jak teraz w `PageAdminChat`).

### 5.6 Notification badge

Liczba unread per firma w rzędzie listy:
- Query: `messages.filter(m => m.toId === "admin" && m.fromId === ownerProfileId && !m.read_at).length`
- Wymaga `companies` ↔ `profiles` mapping (już w 5.2) — w App `useEffect` można pre-compute `Map<companyId, ownerProfileId>` raz przy load
- Render: `[💬 Czat (3)]` w rzędzie + tab `active` counter podsumuje "X firm ma nieprzeczytane"

### 5.7 Channel inny niż chat?

W 2.0 **tylko in-app chat**. Email send-to-supplier z poziomu admin (oddzielny od status emails) **nie** w scope. Tylko `mailto:` link (otwiera mail client admina).

### 5.8 i18n keys do dodania

```json
"admin.firmy.chat": {
  "no_owner_profile": "Brak właściciela konta. Czat niedostępny.",
  "owner_inactive_warning": "Konto wstrzymane — wiadomości mogą nie dotrzeć.",
  "send": "Wyślij",
  "placeholder": "Wiadomość do {{companyName}}…",
  "unread_n": "{{count}} nieprzeczytane",
  "change_recipient": "Zmień adresata"
}
```

---

## 6. Filtry + search

### 6.1 Top search bar

Powyżej tabów:

```
[🔍 Szukaj po nazwie, e-mailu, NIP, kraju, osobie kontaktowej…]
```

- Debounced (300 ms)
- Match: case-insensitive `includes` na: `companies.name`, `companies.email`, `companies.phone`, `companies.tax_id` (jeśli istnieje), `companies.country`, `contacts[].name`, `contacts[].email`
- Liczy się **w obrębie aktywnego tabu** (search nie przeskakuje statusów chyba że user jest w `all`)
- Pokazuje liczbę matchów: "Znaleziono 12 firm w {{tabName}}"

### 6.2 Filter dropdown (obok search)

`[Filtry ▾]` panel z multi-select:

| Filter | Wartości | Default |
|---|---|---|
| Kraj | unique z `companies.country` | all |
| Pakiet | `std_5`, `std_10`, `std_20`, `prem_10`, `prem_20` | all |
| PreConnect | enabled / disabled / both | both |
| FM B2B | enabled / disabled / both | both |
| Wykorzystanie | `<70%` / `70-89%` / `≥90%` / all | all |
| Pkg expiry | `expired` / `<30 days` / `<90 days` / `>90 days` | all |

Apply: instant (no Apply button). Pokazuje `[Wyczyść (N filtrów)]` jeśli aktywne.

### 6.3 Saved filters (przyszłość)

Nie w 2.0. Wymaga `admin_saved_filters` table (migracja).

### 6.4 URL state

Wszystkie aktywne filtry + search + tab w URL:
```
?tab=active&q=mleko&country=PL,DE&pkg=prem_10
```

Share-able link, browser back works.

### 6.5 i18n keys do dodania

```json
"admin.firmy.search": {
  "placeholder": "Szukaj po nazwie, e-mailu, NIP, kraju, osobie…",
  "results_n_in_tab": "Znaleziono {{count}} firm w {{tab}}"
},
"admin.firmy.filters": {
  "open": "Filtry",
  "clear_n": "Wyczyść ({{count}})",
  "country": "Kraj",
  "package": "Pakiet",
  "preconnect": "PreConnect",
  "fm_b2b": "FM B2B",
  "usage": "Wykorzystanie",
  "pkg_expiry": "Ważność pakietu",
  "usage_low": "<70%",
  "usage_mid": "70-89%",
  "usage_high": "≥90%",
  "expiry_expired": "Wygasły",
  "expiry_30d": "Wygasa <30 dni",
  "expiry_90d": "Wygasa <90 dni",
  "expiry_later": "Wygasa >90 dni"
}
```

---

## 7. Drobne fixy do zrobienia po drodze

Te bugi z auditu da się zaadresować bezpiecznie w obrębie 2.0 bez wychodzenia poza scope:

### 7.1 AI status labels — i18n

Linie 7883-7888 w `PreconnectFM.jsx` mają hardcoded PL:
```js
const aiStatusLabels = {
  pending: "Czeka na review",
  approved: "✓ Zatwierdzony",
  edited: "Edytowany ręcznie",
  rejected: "Odrzucony"
};
```

→ Przenieść do `i18n/pl/admin.json` jako `admin.firmy.ai_status.{pending,approved,edited,rejected}` + EN counterpart. **Robić w branchu 1 (`tabs-and-list`) przy okazji**.

### 7.2 `updateLimit` client-only — **NIE FIX**

⚠️ Nie ruszamy w 2.0. To wymaga DB persist + walidacji + ewentualnie PayU sync. **Osobny branch** `fix/admin-package-persist` po 2.0.

W 2.0: w subtab `Pakiet` w drawerze **NIE** dajemy edycji planu/maxa (display only). Zamiast tego inline notatka "Edycja limitów — wkrótce" + link do osobnego ticketu.

### 7.3 Capacity fallback do mock LIMITS_INIT

Obecnie jak `dbCapacity` empty → fallback do mock seed (3 demo companies). W 2.0:
- Jeśli `dbCapacity.length === 0` po load → loading skeleton, **nie** mock data
- Po load → jeśli realnie 0 firm → empty state per tab

---

## 8. Implementation split — 5 branchy sekwencyjnych

Każdy branch musi być **mergeable osobno** (lista + drawer mają działać niezależnie od chatu, np.). Po każdym merge: deploy do prod, observe day, decyzja czy iść z następnym.

### Branch 1 — `feat/admin-companies-tabs-and-list` (NAJWAŻNIEJSZE — first)

**Pain solved:** segregacja statusów + kontakt widoczny w wierszu.

**Scope:**
- 5 tabs (active / pending / suspended / rejected / all) z counter badges
- Nowy layout per row (kolumny z sekcji 2.1)
- Email/phone visible w wierszu z `mailto:` / `tel:` + copy buttons
- Status pill obok nazwy
- Sortowanie kolumn (sekcja 2.5)
- Pagination "Załaduj więcej" 50-row
- Empty states per tab
- URL state dla aktywnego tab (`?tab=`)
- i18n keys tabs + row + empty (sekcje 1.5, 2.9)
- **Bonus fix:** AI status labels → i18n (sekcja 7.1)

**Out of scope:** drawer (zostaje stara modal Preview), chat integration, search/filters, bulk actions.

**Risk:** zmiana layoutu listy w produkcji. Mitygacja: feature flag `ADMIN_COMPANIES_2_0_ENABLED=true|false`, można szybko cofnąć.

**Acceptance:**
- [ ] Admin widzi tabs z liczbami
- [ ] Każda zakładka pokazuje tylko firmy danego statusu
- [ ] Email + phone widoczny w wierszu, klikalny
- [ ] Klik `[Podgląd]` otwiera **starą** modal (zachowane)
- [ ] Klik `[Czat]` w rzędzie → nawigacja do `PageAdminChat` (stara droga)
- [ ] Sortowanie i pagination działają
- [ ] AI status labels po polsku/angielsku zależnie od locale

**Test plan:**
- Manual: każdy tab pokazuje poprawnie filtered firmy
- Manual: nowe i18n keys EN switch
- Manual: empty state przy filtrze bez wyników
- Manual: copy button kopiuje do clipboard
- `npm run build` zielony

---

### Branch 2 — `feat/admin-companies-detail-drawer`

**Pain solved:** zamiast full-screen modala, drawer z prawej trzyma listę widoczną.

**Scope:**
- Right-side drawer komponent (~480 px)
- 5 subtabs: Podgląd / Pakiet / Historia / Notatki / _placeholder Czat (disabled)_
- Port istniejącej logiki `CompanyPreviewModal` do subtab Podgląd
- Subtab Pakiet: PreConnect + FM B2B toggle, AI editor (reuse), display only plan/max
- Subtab Historia: ostatnie 20 wysyłek + approved_at + status_note display
- Subtab Notatki: edycja `status_note` z save
- Footer sticky z status actions (sekcja 3.8)
- Nav `[← Prev] [Next →]` w headerze drawera
- Zamiast `[Podgląd]` button w rzędzie → `[Szczegóły]` otwiera drawer
- Stara modal `CompanyPreviewModal` jako fallback w buyer view (poza Admin Firmy) — nie ruszamy

**Out of scope:** subtab Czat (disabled placeholder), search/filters, bulk actions.

**Risk:** drawer może colidować z istniejącym Z-index modali (toasty, FloatingChat). Mitygacja: test z otwartymi modalami + chatem.

**Acceptance:**
- [ ] Klik `[Szczegóły]` otwiera drawer, lista widoczna
- [ ] Wszystkie 4 active subtaby renderują się
- [ ] Zmiana subtab nie zamyka drawera
- [ ] Status actions w footerze działają (approve/reject/suspend/reactivate)
- [ ] Email notification leci jak dotąd
- [ ] Drawer close button + `Esc` zamyka
- [ ] `[← Prev] [Next →]` przeskakuje po visible firmach z listy

**Test plan:**
- Manual: każdy subtab content się ładuje
- Manual: status change + email check (staging)
- Manual: drawer + chat floating + toast nie nakładają się źle
- `npm run build` zielony

---

### Branch 3 — `feat/admin-companies-contact-actions`

**Pain solved:** szybkie operacje kontaktowe (copy / mailto / search).

**Scope:**
- Search bar (sekcja 6.1) — debounced, multi-field match
- Filter dropdown (sekcja 6.2) — kraj / pakiet / preconnect / fm_b2b / usage / pkg expiry
- URL state dla search + filters (sekcja 6.4)
- Copy buttons (e-mail, telefon) — toast confirm
- `mailto:` z prefilled subject z `companies.name`
- Akcja `Skopiuj e-mail wszystkim widocznym firmom` w nagłówku listy (po filtrze)

**Out of scope:** chat integration, bulk status actions, drawer changes.

**Risk:** Mały. Filtry to client-side filter `companies` array.

**Acceptance:**
- [ ] Search znajduje firmę po fragmencie nazwy, emaila, NIP
- [ ] Filter multi-select kraj + pakiet zawęża listę
- [ ] URL state survives reload
- [ ] Copy e-mail kopiuje do clipboard, toast `Skopiowano`
- [ ] `Wyczyść filtry` reset wszystkiego
- [ ] Wyszukiwanie w obrębie tabu (przełączenie tabu reset query)

**Test plan:**
- Manual: search "frutas" znajduje "Frutas SA"
- Manual: filter PL + prem_10 → tylko premium polskie
- Manual: URL `?q=mleko` na reload pokazuje pre-filled search
- `npm run build` zielony

---

### Branch 4 — `feat/admin-companies-chat-entry`

**Pain solved:** czat z firmy bez przełączania widoku.

**Scope:**
- Helper `getCompanyOwnerProfile(companyId)` w `src/lib/db.js` (sekcja 5.2)
- Refactor `PageAdminChat` thread renderer → wydzielony sub-component `<AdminChatThread>`
- Subtab `Czat` w drawerze (enable z placeholder z branch 2)
- Quick `[💬 Czat]` button w rzędzie listy → otwiera drawer + auto-select subtab Czat
- Unread badge per row (`[💬 Czat (3)]`)
- Pre-compute `Map<companyId, ownerProfileId>` przy load App
- i18n keys chat (sekcja 5.8)

**Out of scope:** zmiana storage (nadal pair-based threading), email channel.

**Risk:** Refactor `PageAdminChat` może coś popsuć w istniejącym admin chat panelu. Mitygacja: regression test starego `PageAdminChat` po refactorze.

**Pre-requisite:** Branch 2 (drawer) merged.

**Acceptance:**
- [ ] Klik `[💬 Czat]` w rzędzie firmy otwiera drawer z chat thread
- [ ] Wysłanie wiadomości pojawia się natychmiast
- [ ] Unread badge per firma się aktualizuje
- [ ] Otwarcie chat → automatic mark thread as read
- [ ] Firma bez owner profile → komunikat "Brak właściciela konta"
- [ ] Stary `PageAdminChat` panel działa as before (regression check)

**Test plan:**
- Manual: nowa wiadomość od suppliera → badge `(1)` przy firmie
- Manual: odpisanie z drawera → wiadomość widoczna u suppliera
- Manual: firma bez user'a → graceful empty state
- Manual: stary admin chat panel — bez regresji
- `npm run build` zielony

---

### Branch 5 — `feat/admin-companies-suspend-restore`

**Pain solved:** workflow suspend/restore + bulk approve/reject pending.

**Scope:**
- Bulk checkbox + bulk bar w tab `pending` (sekcja 4.5)
- Confirmation modale dla suspend/reject (sekcja 4.4)
- Bulk approve N firm (single click)
- Bulk reject N firm + shared status_note
- Reactivate flow w drawerze footer
- Toast summarized: "Zatwierdzono X firm, błędy: Y"
- i18n keys status_change (sekcja 4.6)

**Out of scope:** archived tab (P3), hard-delete, GDPR. Bulk suspend/reactivate (mniej common — osobny branch jeśli zapotrzebowanie).

**Risk:** **Najwyższe** w 2.0 — bulk operations + masowe maile do suppliera. Mitygacja:
- Confirmation modal z liczbą + preview adresatów
- Rate limit per email send (1 req/sec) żeby nie kicked przez Resend/SES
- Każdy failed call logged, finalny toast z summary
- Feature flag `ADMIN_BULK_ENABLED` żeby szybko wyłączyć

**Pre-requisite:** Branch 1 (tabs i pending tab visible).

**Acceptance:**
- [ ] Pending tab pokazuje checkbox per row + master checkbox
- [ ] Bulk bar `[Approve N firm] [Reject N firm]` aktywuje się gdy ≥1 selected
- [ ] Approve N: confirm dialog z liczbą → loop changeAccountStatus
- [ ] Reject N: shared status_note dialog → loop changeAccountStatus
- [ ] Toast summary "Zatwierdzono 4, błędy: 1"
- [ ] Każda firma dostaje email osobno
- [ ] Pending counter aktualizuje się real-time

**Test plan:**
- Manual staging: bulk approve 3 firm, check 3 maile w mailbox
- Manual staging: bulk reject 2 firm z notką "test", check email content
- Manual: błąd w środku loop — toast pokazuje partial
- `npm run build` zielony

---

### 8.6 Branch ordering rationale

1. **`tabs-and-list` first** — biggest UX pain (per Artura recommendation): segregacja statusów + kontakt w wierszu. Niezależny od reszty.
2. **`detail-drawer` second** — zamienia modal na drawer, foundation dla `chat-entry`. Nie wymaga DB changes.
3. **`contact-actions` third** — search + filtry. Niezależny od chatu. Można potem zmienić priorytet z `chat-entry`.
4. **`chat-entry` fourth** — wymaga drawer (branch 2) merged + małego helpera DB. Najwięcej refactoru po Branch 2.
5. **`suspend-restore` last** — bulk actions to highest risk (masowe emaile). Robimy ostatnie żeby fundamenty (tabs, drawer, chat) były battle-tested.

### 8.7 Feature flags

Per branch flagi w `src/config/features.js`:
- `ADMIN_COMPANIES_2_0_LIST` (branch 1)
- `ADMIN_COMPANIES_2_0_DRAWER` (branch 2)
- `ADMIN_COMPANIES_2_0_FILTERS` (branch 3)
- `ADMIN_COMPANIES_2_0_CHAT` (branch 4)
- `ADMIN_COMPANIES_2_0_BULK` (branch 5)

Default `false` przy first commit, flip na `true` po smoke test na staging i pierwszy dzień obserwacji w prod.

Po stabilizacji wszystkich 5 → usuwamy flagi + stary kod w osobnym cleanup branchu.

---

## 9. Otwarte pytania produktowe

Te wymagają decyzji Artura przed implementacją odpowiedniego brancha:

### Q1 (Branch 1) — Default tab na load
- **A)** `active` (najczęstszy use case, pending w badge)
- **B)** `pending` (force admin to handle pending first)
- **C)** Last used (persisted w localStorage)
- Rekomendacja: **A**.

### Q2 (Branch 1) — Sortowanie default w `active`
- **A)** Wykorzystanie DESC (kto najbliżej limitu)
- **B)** Approved DESC (najnowsze first)
- **C)** Alfabetycznie
- Rekomendacja: **A**.

### Q3 (Branch 2) — Czy drawer ma replace modal w buyer view?
- **A)** Tylko admin: drawer (admin); modal: buyer
- **B)** Wszędzie drawer
- Rekomendacja: **A** (mniej zmian, buyer view stable).

### Q4 (Branch 2) — Subtab `Pakiet` — czy display only czy z edit?
- **A)** Display only w 2.0 (bezpiecznie, bug `updateLimit` poza scope)
- **B)** Z edit (ryzyko: zmiana planu nie persist do DB)
- Rekomendacja: **A**.

### Q5 (Branch 3) — Search w `all` tab — czy resetuje gdy user zmieni tab?
- **A)** Tak (query lokalne per tab)
- **B)** Nie (global, multi-tab)
- Rekomendacja: **A** (mniej confusing).

### Q6 (Branch 4) — Wielu właścicieli firmy
- **A)** Primary owner = najstarszy `profile.created_at`
- **B)** UI z menu "wybierz do kogo napisać"
- Rekomendacja: **A** w 2.0, **B** w przyszłej iteracji.

### Q7 (Branch 5) — Bulk action limit
- **A)** Max 20 firm per bulk action (rate limit defence)
- **B)** Bez limitu, z rate-limited send (1/sec)
- Rekomendacja: **A** — explicit limit jest safer.

### Q8 (cross) — Lokalizacja "Wstrzymane" vs "Suspended"
- Czy admin używa terminu "suspended"/"wstrzymane" konsekwentnie czy mieszamy "blocked"/"zablokowane"?
- Rekomendacja: **"Wstrzymane"** (PL) / **"Suspended"** (EN), jak w obecnych emailach.

---

## 10. Risks + mitygacje

| Risk | Impact | Mitygacja |
|---|---|---|
| Regression w obecnym admin flow (status change, AI desc) | High | Feature flag per branch; cofnięcie 1-click |
| Wydajność listy >300 firm bez wirtualizacji | Medium | Pagination 50, monitor; wirtualizacja iteracja 2 |
| `getCompanyOwnerProfile` brak owner'a | Low | UI graceful empty state |
| Bulk approve wysyła 50 maili naraz, rate limit Resend | High | Hard limit 20 + sequential send 1/sec |
| Drawer Z-index conflict z FloatingChat | Low | Test podczas Branch 2 |
| `updateLimit` bug zaakceptowany jako display-only | Low | Notatka w docs + ticket follow-up |
| AI status hardcoded PL → przeoczone przy refactorze | Low | Explicit fix w Branch 1 acceptance criteria |
| Search clipboard API niedostępne | Low | Fallback `document.execCommand("copy")` |

---

## 11. Out of scope — przyszłe iteracje

- **Archived tab** (P3 Phase C, migracja 037 dodaje `archived_at`)
- **Hard-delete + GDPR delete** (P3 Phase D-F)
- **Audit trail** (kto/kiedy/co zmienił) — osobna tabela `admin_audit_log`
- **Mass-email** (wysyłka custom maila do wielu firm naraz)
- **CSV export** firm + kontaktów
- **Last login** z `auth.users.last_sign_in_at`
- **Saved filters** (`admin_saved_filters` table)
- **Wirtualizacja listy** (gdy >300 firm)
- **Edycja planu pakietu** (fix `updateLimit` — osobny branch)
- **Admin notes free-text** (`companies.admin_notes` migracja)
- **Wielu owners chat menu** (Q6 — iteration 2)
- **Bulk suspend/reactivate** (po sprawdzeniu UX bulk approve/reject)

---

## 12. Sign-off

Plan gotowy do review przez Codex + Artura. Czeka na decyzje w Q1-Q8 (rekomendacje są w treści).

Po akceptacji:
1. Branch `feat/admin-companies-ux-plan` mergowany do main (docs-only)
2. Pierwszy branch kodowy: **`feat/admin-companies-tabs-and-list`** (per rekomendacja Artura)
3. Iteracje per Branch 2-5 z feature flagami

---

## 13. Quick reference — co zmienia w istniejących plikach

| Plik | Zmiana | Branch |
|---|---|---|
| `src/legacy/PreconnectFM.jsx` lines 7745-8166 | Refactor `PageAdminFirmy` na tabs + nowy row layout | 1 |
| `src/legacy/PreconnectFM.jsx` lines 7883-7888 | AI status labels → i18n | 1 |
| `src/legacy/PreconnectFM.jsx` lines 8483-8673 | Port `CompanyPreviewModal` → subtab Podgląd drawer | 2 |
| `src/legacy/PreconnectFM.jsx` lines 1360-1500 (~) `PageAdminChat` | Wydzielenie `<AdminChatThread>` sub-component | 4 |
| `src/lib/db.js` | Nowy helper `getCompanyOwnerProfile(companyId)` | 4 |
| `src/i18n/pl/admin.json` (lub equivalent) | Nowe keys: tabs, row, drawer, chat, filters, status_change, ai_status | 1, 2, 3, 4, 5 |
| `src/i18n/en/admin.json` | Counterparts EN | 1, 2, 3, 4, 5 |
| `src/config/features.js` | Feature flags `ADMIN_COMPANIES_2_0_*` | wszystkie |

**Bez zmian:** `supabase/migrations/*`, `netlify/functions/*` (emaile), `src/lib/payu.js`, `src/lib/fmAlgorithm.js`.
