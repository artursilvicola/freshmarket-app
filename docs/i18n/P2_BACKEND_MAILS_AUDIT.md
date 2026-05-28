# P2 — Backend mails + error wrappers AUDIT

**Branch:** `feat/i18n-p2-backend-mails`
**Status:** Commit 1 (audit) — bez zmian funkcjonalnych. Commits 2 i 3 robią właściwe i18n.
**Scope:** Resend templates (Netlify functions) + user-facing backend errors. NIE ruszamy: algorithm, PayU logic, RLS, DB schema, migrations.

---

## A. Email templates inventory

### A.1 Supabase Auth templates (`supabase/auth-email-templates/`)

| Template | Status | Audience | Akcja |
|---|---|---|---|
| `reset-password/body.html` | ✅ Bilingual PL+EN side-by-side | Supplier+Buyer+Admin | **Brak akcji** — README wyjaśnia że Supabase Auth nie zna locale w momencie generowania linku (legacy users bez `user_metadata.locale`), więc bilingual side-by-side jest bezpiecznym wariantem. |
| `confirm-signup/body.html` | ✅ Bilingual PL+EN side-by-side | Supplier (self-register) | **Brak akcji** |
| `magic-link/body.html` | ✅ Bilingual PL+EN side-by-side | Wszyscy | **Brak akcji** |

**Wniosek:** Auth templates są dwujęzyczne — wklejone w Supabase Dashboard, nie edytujemy w tym branchu.

---

### A.2 Resend transactional templates (`netlify/functions/_shared/supplier-email-templates.js`)

| Template | Funkcja | Status locale | Audience | Akcja (C2) |
|---|---|---|---|---|
| `registration_accepted` | `tplRegistrationAccepted` | ✅ PL/EN (dispatch po `payload.locale`) | Supplier (po self-register) | **brak** — już ok |
| `account_activated` | `tplAccountActivated` | ❌ PL only | Supplier (admin zatwierdził konto) | **Add EN variant** |
| `account_rejected` | `tplAccountRejected` | ❌ PL only | Supplier (admin odrzucił) | **Add EN variant** |
| `account_suspended` | `tplAccountSuspended` | ❌ PL only | Supplier (admin zawiesił) | **Add EN variant** |
| `offer_to_moderation` | `tplOfferToModeration` | ❌ PL only | Supplier (oferta → moderacja) | **Add EN variant** |
| `offer_approved` | `tplOfferApproved` | ❌ PL only | Supplier (admin zaakceptował) | **Add EN variant** |
| `offers_sent_to_retailer` (+`tplOfferSentToRetailer` alias) | `tplOffersSentToRetailer` | ❌ PL only | Supplier (mail zbiorczy wysłany) | **Add EN variant** + `pluralOffers` |
| `offers_read_by_buyer` (+`tplOfferReadByBuyer` alias) | `tplOffersReadByBuyer` | ❌ PL only | Supplier (kupiec zobaczył) | **Add EN variant** |
| `offer_expired` | `tplOfferExpired` | ❌ PL only | Supplier (oferta wygasła) | **Add EN variant** |
| `admin_new_registration` | `tplAdminNewRegistration` | ❌ PL only | Admin (newsletter@freshmarket.eu) | **Zostaje PL** — internal admin notification, audience FM team |

**Łącznie do dorobienia: 8 templates × EN variant** + dispatcher `pickLocale(input)` (już zaimplementowany — używać konsekwentnie).

---

### A.3 Resend retailer batch mail (`netlify/functions/_shared/render-retailer-email.js`)

| Template | Status | Audience | Akcja |
|---|---|---|---|
| `renderRetailerEmail` (zbiorczy mail z ofertami → buyer) | ❌ PL only (hardcoded `<html lang="pl">`, polish subject, intro, "Szanowni Państwo", "trafia do X kupców", footer, CTA labels) | Buyer (kupiec sieci) | **Refactor na PL/EN** — wybór po `buyer.locale` z `profiles.locale` |

**Plurals do EN:** "oferta/oferty/ofert" → "offer/offers", "kupca/kupców" → "buyer/buyers".

CTA labels w `renderOfferBlock`:
- "Poproś o próbki" → "Request samples"
- "Zapytaj o cenę i wolumen" → "Ask about price & volume"
- "Umów spotkanie" → "Book a meeting"
- "Zobacz ofertę" → "View offer"

**Caller:** `send-retailer-batch.js`. Każdy buyer ma własny `profile.locale` — mail per buyer może być w innym języku. Loop renderuje raz HTML w EN i raz w PL jeśli mieszany batch.

---

### A.4 DEAD code

| Plik | Status | Akcja |
|---|---|---|
| `netlify/functions/send-offer.js` | DEAD — brak wywołań w `src/` | **Nie ruszać w C2.** Final QA (`feat/i18n-p2-final-qa`) usunie razem z `ZoneLegend()`. |

---

## B. User-facing backend error inventory

Klasyfikacja:
- **🟢 brak akcji** — błąd nigdy nie dociera do UI (internal call, fire-and-forget z 200, webhook)
- **🟡 admin only** — pokazane tylko adminowi (admin UI bilingual → trzeba EN)
- **🔴 supplier/buyer** — pokazane userowi końcowemu (user UI bilingual → trzeba EN)

### B.1 `admin-create-user.js` (admin only)

| Status | Error |
|---|---|
| 401 | "Brak naglowka Authorization" |
| 401 | "Nieprawidlowy token" |
| 403 | "Tylko admin moze tworzyc konta B2B" |
| 400 | "Niepoprawny JSON" |
| 400 | "Brak email" |
| 400 | "Niepoprawna role (admin/supplier/buyer)" |
| 400 | "supplier wymaga company_id" |
| 400 | "buyer wymaga retailer_id" |
| 400 | "buyer wymaga imienia i nazwiska" |
| 400 | "Wybrana sieć handlowa nie istnieje." |
| 500 | "Nie udało się sprawdzić duplikatów kupców." |
| 409 | "Kupiec z tym adresem e-mail już istnieje." |
| 409/500 | "Nie udalo sie utworzyc usera: ${msg}" |
| 500 | "Konto utworzone, ale update profile nie powiodl sie: ${msg}" |
| 200+warning | "Konto utworzone, magic link nie wygenerowany: ${msg}" |

**Audience:** Admin → bilingual UI. **Akcja C3:** locale-aware (per admin `profiles.locale`).

### B.2 `admin-reset-password.js` (admin only)

Errors: "Brak naglowka Authorization", "Nieprawidlowy token", "Tylko admin moze resetowac hasla", "Niepoprawny JSON", "Brak email", "Podaj new_password ALBO send_magic_link=true", "User nie znaleziony", "Nie udalo sie zaktualizowac hasla: ${msg}", "Magic link nie wygenerowany: ${msg}".

**Akcja C3:** locale-aware.

### B.3 `admin-update-user.js` (admin only)

Errors: "Brak naglowka Authorization", "Nieprawidlowy token", "Tylko admin moze aktualizowac konta B2B", "Niepoprawny JSON", "Brak user_id", "Kupiec musi mieć imię i nazwisko.", "Kupiec musi mieć adres e-mail.", "Kupiec musi być przypisany do jednej sieci handlowej.", "Aktywny kupiec musi mieć przynajmniej jedną kategorię.", "Nie znaleziono profilu kupca do aktualizacji.", "Ta ścieżka służy tylko do zarządzania kupcami.", "Wybrana sieć handlowa nie istnieje.", "Nie udało się sprawdzić duplikatów kupców.", "Kupiec z tym adresem e-mail już istnieje.", "Nie udalo sie zaktualizowac auth.users: ${msg}", "Auth zaktualizowany, ale profil nie: ${msg}".

**Akcja C3:** locale-aware.

### B.4 `admin-env-status.js` (admin only — diagnostics)

Mały plik, używany przez admin do diagnostyki env. **Akcja C3:** sprawdzić, pewnie minimalne błędy.

### B.5 `register-supplier-self.js` (supplier — self-register, public)

| Status | Error |
|---|---|
| 400 | "Niepoprawny JSON" |
| 400 | "Podaj poprawny adres email." |
| 400 | "Hasło musi mieć minimum 8 znaków." |
| 400 | "Podaj nazwę firmy." |
| 400 | "Nazwa firmy jest za długa." |
| 409 | "Konto z tym adresem email już istnieje. Spróbuj zalogować się lub odzyskać hasło." |
| 500 | "Nie udało się utworzyć konta: ${msg}" |
| 500 | "Nie udało się utworzyć firmy: ${msg}" |
| 500 | "Nie udało się utworzyć profilu: ${msg}" |

**Audience:** Public, anonymous user (przed loginem). Locale z `body.locale` przekazane z UI rejestracji. **Akcja C3:** locale-aware (locale już zwalidowany na początku handlera).

### B.6 `send-supplier-notification.js` (admin OR supplier)

Errors: "Niepoprawny JSON", "Brak template", "Brak tokena", "Nieprawidłowy token", "Tylko admin lub supplier może wywołać.", "Brak adresata maila.", "Nieznany template: ${template}", "Resend error".

**Audience:** Admin głównie, supplier dla wybranych templates. **Akcja C3:** locale-aware po caller locale.

### B.7 `send-retailer-batch.js` (admin only)

Errors: "Brak nagłówka Authorization", "Nieprawidłowy token", "Nie znaleziono profilu użytkownika", "Tylko admin może wysyłać zbiorcze maile do sieci.", "Niepoprawny JSON", "Brak retailer_id", "send_ids jest puste — nie ma czego wysłać.", "Sieć handlowa nie znaleziona.", "Sieć ${name} nie ma żadnego aktywnego kupca z e-mailem. Najpierw uzupełnij Buyer w 'Sieci'.", "Błąd odczytu sends: ${msg}", "Brak ofert gotowych do wysyłki — wszystkie są odrzucone, w moderacji albo już wysłane.".

**Akcja C3:** locale-aware. Także retailer mail render w `render-retailer-email.js` ma być per-buyer locale (C2).

### B.8 `notify-supplier-read.js` (buyer/admin — fire-and-forget)

Errors: "Brak tokenu autoryzacji", "Nieprawidłowy token", "Konto jest nieaktywne", "Tylko kupiec lub admin może oznaczyć ofertę jako zobaczoną", "Niepoprawny JSON", "Brak / nieprawidłowy legacy_id".

**Akcja C3:** locale-aware.

### B.9 `mark-buyer-preconnect-seen.js` (buyer/admin — fire-and-forget)

Errors: "Brak tokenu autoryzacji", "Nieprawidłowy token", "Konto kupca jest nieaktywne", "Tylko kupiec lub admin może oznaczyć oferty jako zobaczone", "Niepoprawny JSON".

**Akcja C3:** locale-aware.

### B.10 `upsert-legacy-offer.js` (supplier/admin)

Errors: "Brak tokenu autoryzacji", "Niepoprawny JSON", "Nieprawidłowy token", "Brak profilu użytkownika", "Brak ID propozycji", "Konto dostawcy nie jest przypisane do firmy", "Nie udało się przygotować identyfikatora dostawcy: ${msg}", "Brak uprawnień do zapisu propozycji", "Brak identyfikatora dostawcy", "${supabaseError.message}".

**Audience:** Supplier (głównie). **Akcja C3:** locale-aware.

### B.11 `create-payu-order.js` (supplier)

Errors: "Brak tokenu autoryzacji", "Niepoprawny JSON", "Nieprawidłowy token", "Profil nie znaleziony", "Tylko dostawca może kupować pakiety", "Konto nie jest przypisane do firmy. Skontaktuj się z administratorem.", "Brak plan_id", "Plan ${planId} nie istnieje lub jest nieaktywny", "Nie udało się zarejestrować zamówienia: ${msg}", "PayU API: ${msg}".

**Audience:** Supplier. **Akcja C3:** locale-aware. + `buyer.language` w PayU API call (`"pl"` → `locale`).

### B.12 `ai-company-description.js` (supplier/admin)

Errors: "Brak naglowka Authorization", "Nieprawidlowy token", "Nie znaleziono profilu uzytkownika", "Ta funkcja jest dostepna tylko dla admina lub dostawcy.", "Niepoprawny JSON", "Brak danych firmy do opisu.", "Dostawca moze generowac opis tylko dla swojej firmy.".

**Akcja C3:** locale-aware errors.

**Special: AI system prompt** — currently hardcoded PL ("Piszesz po polsku, językiem handlowym..."). Codex wcześniej fixował podobne (P2-extras AI fallback). **C3 should also**: gate `systemPrompt(locale)` so AI generates in supplier's locale. To jest po prawdzie zmiana logiki AI prompt (generated content), ale narrowly user-facing. Out-of-scope per "tylko user-facing błędy" — pomijam, do final QA.

### B.13 `ai-admin-chat-suggestion.js` (admin only)

Errors: "Brak naglowka Authorization", "Nieprawidlowy token", "Ta funkcja jest dostepna tylko dla administratora.", "Niepoprawny JSON", "Brak wiadomosci do analizy.".

**Akcja C3:** locale-aware (admin locale).

System prompt już handle lang reaktywnie: "Odpowiadasz w języku rozmówcy" — OK, AI sam dispatcha.

### B.14 `payu-notify.js` (PayU webhook — server-to-server)

Audience: PayU server. **Brak akcji** — webhook responses nie są widoczne userowi.

### B.15 `resend-webhook.js` (Resend webhook — server-to-server)

Audience: Resend server. **Brak akcji.**

### B.16 `_shared/function-env.js` (`envErrorPayload`)

`error: "${scope}: brak konfiguracji środowiska"` + `hint: "Ustaw brakujące zmienne w Netlify -> Site configuration -> Environment variables i zrób nowy deploy."`

**Audience:** Admin tylko (gdy env miss). **Akcja C3:** locale-aware albo zostawić PL (admin diagnostic).

### B.17 `_shared/legacy-send-seen.js`, `_shared/supplier-read-notify.js`

Internal helpers — bez UI errors. Mogą wewnętrznie zwracać `reason: "owner_not_found"` etc. — logowane, nie pokazywane userowi. **Brak akcji.**

---

## C. Architektura wyboru locale dla C2/C3

### C.1 Hierarchia (zgodnie z ustaleniami)

```
1. payload.locale         (z body request, jeśli frontend przekazał — najwyższy priorytet)
2. profiles.locale        (z DB, jeśli backend już wczytał profile)
3. user_metadata.locale   (z auth.users — fallback)
4. 'pl'                   (domyślny fallback)
```

Backend nie sięga do DB samodzielnie — albo dostaje `locale` w payload, albo czyta `profiles.locale` razem z innym SELECT (np. owner profile w `notify-supplier-read`). Jedyna nowa rzecz: dodać `, locale` do SELECT'ów które już ciągną profile.

### C.2 Internal admin notifications — zostają PL

- `tplAdminNewRegistration` (admin_new_registration → newsletter@freshmarket.eu)
- Mail do FM team o nowej rejestracji
- Wszystkie maile na `newsletter@freshmarket.eu` / FM internal mailboxes

### C.3 Helper: `pickLocale(input)` w `supplier-email-templates.js` — JUŻ ISTNIEJE

```js
function pickLocale(input) {
  if (!input) return "pl";
  const raw = String(input).trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_TPL_LOCALES.includes(raw) ? raw : "pl";
}
```

Konsekwentnie używać w każdym `tplFoo` na początku.

### C.4 Helper do tłumaczenia errorów (proponowany dla C3)

Zamiast hardcoded `errJson(403, "Tylko admin...")` per function — stwórz `_shared/error-messages.js` z dispatcherem `errLoc(locale, key, params)`:

```js
const MESSAGES = {
  pl: {
    no_auth_header: "Brak nagłówka Authorization",
    invalid_token: "Nieprawidłowy token",
    only_admin: "Tylko admin może wywołać tę funkcję.",
    ...
  },
  en: {
    no_auth_header: "Authorization header missing",
    invalid_token: "Invalid token",
    only_admin: "This function is available only to administrators.",
    ...
  }
};
export function errLoc(locale, key, params = {}) {
  const lng = pickLocale(locale);
  let msg = MESSAGES[lng]?.[key] || MESSAGES.pl[key] || key;
  for (const [k, v] of Object.entries(params)) msg = msg.replace(`{${k}}`, v);
  return msg;
}
```

Frontend płaci za locale w request header `Accept-Language` albo w body (preferred). Backend reads.

---

## D. Plan implementacji

### Commit 1 — audit (TEN COMMIT)
- Ten plik
- **Brak zmian w funkcjach** — tylko dokumentacja
- Build OK (no code change)
- Push branch + bez merge

### Commit 2 — maile locale-aware
- **`supplier-email-templates.js`:** dorobić EN variants dla 8 templates (`tplAccountActivated`, `tplAccountRejected`, `tplAccountSuspended`, `tplOfferToModeration`, `tplOfferApproved`, `tplOffersSentToRetailer`, `tplOffersReadByBuyer`, `tplOfferExpired`). Wzór: jak `tplRegistrationAccepted` — main fn dispatcher po `pickLocale(payload.locale)` → PL/EN funkcja.
- **`render-retailer-email.js`:** refactor PL/EN — `locale` parameter, locale-aware subject/intro/footer/CTA labels.
- **Caller updates:** `send-retailer-batch.js` (pass per-buyer `locale` from `profiles.locale`), `send-supplier-notification.js` (resolve recipient `locale` from profile SELECT), `notify-supplier-read.js` (już ma owner profile SELECT — dodać `, locale`), `supplier-read-notify.js` (helper, dodać locale do owner SELECT).
- Build + ewentualne testy

### Commit 3 — backend error wrappers
- Stworzyć `_shared/error-messages.js` z dispatcherem `errLoc(locale, key, params)` i słownikiem PL/EN.
- Refactor user-facing errors w funkcjach:
  - `admin-create-user.js`
  - `admin-update-user.js`
  - `admin-reset-password.js`
  - `register-supplier-self.js`
  - `create-payu-order.js`
  - `upsert-legacy-offer.js`
  - `ai-company-description.js`
  - `send-supplier-notification.js`
  - `send-retailer-batch.js`
  - `notify-supplier-read.js`
  - `mark-buyer-preconnect-seen.js`
- Każda funkcja czyta locale z payload (preferred) → fallback z profile (gdy SELECT'ujemy already) → fallback 'pl'.
- Raw Supabase/PayU technical passthrough (`error.message` z DB) zostają jako fallback — nie tłumaczymy ich.
- Push branch + bez merge

### Guardrails
- Build po każdym commicie
- Brak zmian w algorithm, PayU logic, RLS, DB schema, migrations
- Symetria PL/EN dla JSON (jeśli dodamy do `_shared/error-messages.js` z dictionary structure, sprawdzić że oba locale mają te same klucze)

---

## E. Out of scope (do final QA branch)

- `send-offer.js` — DEAD code, do usunięcia
- `ZoneLegend()` — DEAD code, do usunięcia
- `ai-company-description.js` system prompt PL→EN — zmiana logiki AI prompts (out of scope błędów)
- `AccountSwitcherBar` PL leftover (per Codex)
- Full PL string grep w całej apce
- Tag `v-i18n-complete`

---

## F. Statystyki audytu

- **8 supplier email templates** do dorobienia EN
- **1 retailer email template** (`renderRetailerEmail`) do refactoru PL/EN
- **~80 user-facing backend errors** w ~10 funkcjach do dispatcheru `errLoc(locale, key)`
- **3 Supabase auth templates** — bez akcji (już bilingual)
- **2 webhook endpoints** (payu-notify, resend-webhook) — bez akcji (server-to-server)
- **1 internal helper** (`_shared/function-env.js`) — opcjonalnie EN

**Łączny zakres C2 + C3:** ~9 plików edytowanych + 1 nowy plik `_shared/error-messages.js`. Brak zmian w DB/migracjach/RLS/algorithm.
