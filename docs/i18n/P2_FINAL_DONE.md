# P2 — Full i18n done

**Status:** Ready for review → merge → tag `v-i18n-complete`.
**Branch:** `feat/i18n-final-language-debt-qa` (last branch w P2 cycle).

---

## P2 timeline (commits merged to main)

| Branch | Merge | Subject |
|---|---|---|
| `feat/i18n-mvp` | initial | i18n bootstrap, panel.json, App shell, RegisterPage, uploaders |
| `feat/i18n-p2-2*` | P2-2{a,b,c} | Buyer panel (all 9 components) |
| `feat/i18n-p2-3*` | P2-3{a,b,c} | Supplier dashboard, widgets, time plurals |
| `feat/i18n-p2-4*` | P2-4{a,b,c} | PageOffers, PageOfferForm, PageWysylki |
| `feat/i18n-p2-5*` | P2-5 | PageSupplierProfile, PageFinance, PageCompany |
| `feat/i18n-p2-shared` | shared | CNAMES locale-aware, OfferFilters, CompanyPreviewModal, OfferPreviewModal |
| `feat/i18n-p2-admin-pipeline` | admin+pipeline | Admin dashboard, retailers, firmy, pipeline filtering, moderation, batch email |
| `feat/i18n-p2-admin-extras-chat` | extras+chat | Branding, Team, AdminChat, FloatingChat |
| `feat/i18n-p2-fm-b2b` | fm | Fresh Market 2026 system (Supplier, Buyer, AdminFM, CorrectionPanel, PreferencesView, AlgorithmTrigger, ~221 keys) |
| `feat/i18n-p2-backend-mails` | backend | Resend templates PL/EN dispatcher (8 supplier + retailer batch), errLoc backend dictionary (~80 keys), 10 functions refactored |
| `feat/i18n-final-language-debt-qa` | this | AccountSwitcherBar, db.js 15 errors, dead ZoneLegend + send-offer.js removal, AI prompt bilingual, EN "submission(s)" copy |

---

## i18n leaf counts (legacy.json)

| Stage | PL leaves | EN leaves |
|---|---|---|
| P2-2 start | ~600 | ~600 |
| After P2-3{a,b,c} | ~900 | ~900 |
| After P2-4{a,b,c} | ~1100 | ~1100 |
| After P2-5 | ~1300 | ~1300 |
| After P2-shared | ~1450 | ~1450 |
| After P2-admin{pipeline,extras} | ~1750 | ~1750 |
| After P2-fm | 1871 | 1871 |
| After P2-final-qa C1..C4 | 1898 | 1898 |
| After P2-final-qa post-review (ASCII fix) | **1908** | **1908** |

Plus separate namespaces: `common.json`, `panel.json`, dane testowe.

---

## Backend / Netlify functions

### Resend templates (`_shared/supplier-email-templates.js`) — 9 templates

| Template | Locale-aware | Notes |
|---|---|---|
| `registration_accepted` | PL/EN | Welcome supplier po self-register |
| `account_activated` | PL/EN | Admin activated supplier |
| `account_rejected` | PL/EN | Admin rejected supplier |
| `account_suspended` | PL/EN | Admin suspended active supplier |
| `offer_to_moderation` | PL/EN | Supplier sent → admin moderation |
| `offer_approved` | PL/EN | Admin approved supplier offer |
| `offers_sent_to_retailer` | PL/EN | Notification F po wysyłce do retailera |
| `offers_read_by_buyer` | PL/EN | Notification H po odczycie kupca |
| `offer_expired` | PL/EN | Submission expired (14 days no read) |
| `admin_new_registration` | PL only | Internal FM team notification — stays PL |

### Retailer batch mail (`_shared/render-retailer-email.js`)

- Locale-aware per-buyer (`profiles.locale`)
- Mixed batch (PL + EN buyers) = 2 render passes
- CTA labels PL/EN (Request samples / Ask about price / Book a meeting / View submission)
- Country names locale-aware (CNAME_PL / CNAME_EN)

### Error wrappers (`_shared/error-messages.js`)

- `errLoc(locale, key, params)` dispatcher
- PL+EN dictionary ~80 kluczy
- Hierarchy: `payload.locale` → `profile.locale` → `Accept-Language` → `'pl'`
- 10 functions używają: register-supplier-self, admin-create-user, admin-update-user, admin-reset-password, create-payu-order, upsert-legacy-offer, ai-company-description, ai-admin-chat-suggestion, send-supplier-notification, send-retailer-batch, notify-supplier-read, mark-buyer-preconnect-seen

### AI prompts

- `ai-admin-chat-suggestion.js` — PL system prompt + reaktywny dispatcher "Odpowiadasz w języku rozmówcy" (AI sam wybiera PL/EN)
- `ai-company-description.js` — `systemPrompt(locale)` PL/EN + `buildCompanyPrompt(...,locale)` z bilingual field labels

### PayU integration

- `buyer.language: 'pl'|'en'` switch w PayU checkout UI
- Locale-aware product description + name (Standard 10 submissions package / Pakiet Standard 10 wysyłek)

---

## Auth templates (Supabase)

`supabase/auth-email-templates/*` — bilingual side-by-side PL+EN per README. Reset password, Confirm signup, Magic link. Wklejane w Supabase Dashboard (nie kod-controlled).

---

## DEAD code removed

- `netlify/functions/send-offer.js` (173 linie) — 0 call sites, zastąpione przez `send-retailer-batch.js`
- `ZoneLegend()` (PreconnectFM.jsx) — 10 linii, 0 call sites, zastąpione przez `fm.corrections.legend_*` keys

---

## What stays PL (intentional)

Per `P2_FINAL_LANGUAGE_DEBT_AUDIT.md` section C:
- **Frontend dev-only:** JSX comments, code comments, `console.warn`, dev assertion errors
- **Seed data:** FM_CHAINS, FM_SUPPLIERS, demo offer descriptions (polish trade show demo)
- **Display dictionaries:** CNAMES/STATUS_TIPS/CTA_MAP — PL fallback + EN keys w i18n JSON
- **Proper nouns:** Oksana Kozłowska, Ożarów Mazowiecki w EN files
- **HTML legal:** `public/regulamin.html`, `public/polityka-prywatnosci.html` (Polish legal)
- **Internal test page:** `public/testy-przed-produkcja.html` (admin only)
- **Backend templates / dictionary:** PL variants alongside EN (supplier-email-templates, error-messages, render-retailer-email)
- **Admin chat AI system prompt:** AI bilingual reactively
- **Algorithm warning `message` fields:** struct field, nie renderowane

---

## Final audit numbers

`scripts/pl-audit.cjs` post-review upgraded — wykrywa też ASCII-only PL markery
(`Brak`, `Nie udalo`, `Nie udało`, `wymaga`, `wymagane`, `Niepoprawny`,
`Upload OK, ale` itd.) — wcześniej audit łapał tylko diacritics.

Re-run po post-review fix:
- **files_with_pl_total:** 58
- **files_with_code_pl:** 40
- **total_code_hits:** 1128
- **total_code_ASCII hits:** 87 (większość w słownikach PL po stronie backendu —
  `error-messages.js` 32, w `error-messages.js` to definicje słownika)

`src/lib/db.js`:
- **0 user-facing PL** (wszystkie wrapped w `i18n.t("legacy:errors.db.*")`)
- **5 dev sanity assertions** zostają jako PL — każda ma `[P2-final-qa
  post-review] Dev sanity assertion` komentarz wyjaśniający, że odpalają się
  tylko gdy programista wywoła funkcję z brakującym argumentem (UI ścieżki
  zawsze podają wymagane parametry):
  - line 283: `updateBuyerProfile wymaga id`
  - line 1090: `saveFmResp wymaga retailer_id + supplier_company_id`
  - line 1209: `saveFmSelectionConfirmation: companyId wymagane`
  - line 1226: `setCompanyTargetRetailers: companyId wymagane`
  - line 1268: `saveFmWishlist wymaga retailer_id + supplier_legacy_id`

Top files (intentional / categorized C w audit):
- `PreconnectFM.jsx` 389 (seed data + display dicts + comments)
- `testy-przed-produkcja.html` 219 (internal admin)
- `regulamin.html` 122 + `polityka-prywatnosci.html` 101 (Polish legal)
- Backend templates / dictionary / AI prompts (~165) — intentional alongside EN

---

## Verification (Commit 4 + post-review fix)

- ✅ `npm run build` — vite 1276 kB / gzip 336 kB
- ✅ `node --check` na 24 plikach Netlify functions (15 functions + 9 _shared)
- ✅ Symmetry PL/EN: **1908/1908** symmetric (po post-review +10 keys)
- ✅ Re-grep PL diacritic audit: 1110 → 1090 (Commit 2+3) → 1128 (po post-review,
  wzrost wynika z dodanych ASCII-only markerów do detektora — sam codebase
  ma MNIEJ PL niż wcześniej)
- ✅ ASCII-only check w db.js: 0 user-facing, 5 dev sanity assertions (intentional)
- ✅ rg ASCII-PL patterns w db.js (`Brak aktywnej|Nie udalo|Nie udało|Brak userId|
   Brak pliku|Niepoprawny email|Upload OK, ale`): **0 hits**

---

## Po review/merge

1. Merge `feat/i18n-final-language-debt-qa` → main przez `--no-ff`
2. Build na main
3. Push origin main
4. Smoke test deploy
5. **Tag `v-i18n-complete`** na main commit po merge

---

## Co następne (P3 — out of scope tego cyklu)

Account lifecycle:
- Archiwizacja / usuwanie konta dostawcy
- Usuwanie konta kupca / sieci
- Usuwanie admina (z guards typu super_admin_only)
- Soft-delete vs hard-delete strategia per role
- GDPR compliance flows (data export, account deletion request)
- Audit log dla account state changes

To wymaga decyzji DB/RLS/migrations + UI flows — osobny epic.
