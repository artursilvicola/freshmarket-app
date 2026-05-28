# P2 — Final language-debt QA AUDIT

**Branch:** `feat/i18n-final-language-debt-qa`
**Status:** Commit 1 (audit). Commits 2/3/4 = naprawy + verification.
**Cel:** zamknąć pozostałe PL leftover'y po P2-pipeline / P2-extras / P2-fm / P2-backend-mails. Po review/merge tag `v-i18n-complete`.

---

## Method

Skrypt `scripts/pl-audit.cjs` skanuje:
- `src/` (frontend React)
- `netlify/functions/` (backend)
- `public/` (statyczne pliki)
- `supabase/auth-email-templates/` (Supabase Auth bilingual templates)

Wykluczone:
- `src/i18n/pl/` (PL JSON-y — legitimatelnie PL)
- `node_modules/`, `dist/`, `.git/`, `build/`

Output: `pl-audit.json` (gitignored, generowany on-demand).

**Summary:**
- **58 plików** z dowolnym PL diacritickiem
- **40 plików** z PL poza komentarzami
- **1110 hits łącznie** poza komentarzami

---

## A. To fix now (Commit 2 — frontend leftovers)

### A.1 `src/legacy/PreconnectFM.jsx` — AccountSwitcherBar (lines 8676..8765)

Brakujące tłumaczenia:
- **Line 8676** `ROLE_LABELS = { admin:"Admin", supplier:"Dostawca", buyer:"Kupiec" }` — used at lines 8701, 8740
- **Line 8721** Role filter labels: `["all","Wszyscy"], ["admin","Admin"], ["supplier","Dostawcy"], ["buyer","Kupcy"]`
- **Line 8750** `(sieć nieaktywna)` — buyer's retailer disabled label
- **Line 8754** `✓ aktywne` — currently active account marker

**Akcja:** Dodać klucze `legacy.shell.account_switcher.*` (PL+EN) + zamienić ROLE_LABELS na `t()`-driven helper. Filter labels per ROLE.

### A.2 Dead `ZoneLegend()` removal (PreconnectFM.jsx lines 8785..8794)

```js
function ZoneLegend() { ... }
```

**Grep `ZoneLegend`:** tylko definicja, **0 call sites**. **Akcja:** usunąć (10 linii) + jeden komment-marker `/* ── ZoneLegend ── */` nad nią.

### A.3 `src/lib/db.js` — 14 unwrapped Error throws (admin-facing)

| Line | Throw |
|---|---|
| 48 | `"Kupiec musi mieć imię i nazwisko."` (validateBuyerInput) |
| 49 | `"Kupiec musi mieć adres e-mail."` |
| 51 | `"Kupiec musi być przypisany do jednej sieci handlowej."` |
| 52 | `"Aktywny kupiec musi mieć przypisaną przynajmniej jedną kategorię."` |
| 418 | `"Nie udało się utworzyć kupca"` (createBuyer fallback) |
| 468 | `"Nie udało się zaktualizować kupca"` (updateBuyer fallback) |
| 816 | `"Nie udało się pobrać public URL"` (uploader) |
| 890 | `Nie udało się zapisać propozycji (${status})` (saveOffer fallback) |
| 1451 | `"Nie udało się zarejestrować konta."` (registerSupplierSelf fallback) |
| 1478 | `"Nie udało się wysłać maila."` (sendSupplierEmail fallback) |
| 1660 | `Brak użytkownika ${email}. Najpierw musi zarejestrować się...` (promoteAdmin) |
| 1664 | `${email} już jest administratorem.` |
| 1684 | `"Nie możesz zdjąć uprawnień administratora samemu sobie."` |
| 1703 | `"Nie możesz odebrać sobie samemu uprawnień super admina."` |

**Akcja:** Wrap w `i18n.t("legacy:errors.db.{key}")` zgodnie z istniejącym wzorcem (już użytym np. na line 132). Dodać klucze w PL+EN legacy.json.

---

## B. To fix now (Commit 3 — backend/mail copy cleanup)

### B.1 Dead `netlify/functions/send-offer.js` removal (173 lines)

**Grep `send-offer`:**
- `src/auth/RegisterPage.jsx:13` — komentarz dokumentacyjny ("admin-create-user")
- `src/auth/RegisterPage.jsx:91` — wywołuje `admin-create-user`, NIE `send-offer`
- `src/lib/db.js` — żadnego wywołania `send-offer`
- `src/legacy/PreconnectFM.jsx` — żadnego wywołania

**0 call sites z `/.netlify/functions/send-offer`.** Plik DEAD. **Akcja:** usunąć cały plik.

### B.2 `ai-company-description.js` bilingual system prompt

System prompt hardcoded PL: `"Piszesz po polsku, językiem handlowym..."`. Locale-aware dispatcher już wczytany (caller.locale) z C3 — wystarczy `systemPrompt(locale)` z dwiema wersjami PL/EN. Codex flagged jako optional dla final QA.

**Akcja:** Dodać `systemPromptEN()` + przełącznik `lng === "en" ? systemPromptEN() : systemPromptPL()`. JSON output structure pozostaje (`description_short` + `description`).

### B.3 `render-retailer-email.js` EN subject copy

Per Codex notatka: w EN buyer mail subject mamy `"offer/offers"` — Codex sugeruje `"submission(s)"` lub `"product proposal(s)"` (zgodność z terminologią v1.1). 

Obecna funkcja `pluralOfferEN(n)` zwraca `"offer"` / `"offers"`. Zmiana na `"submission"` / `"submissions"` zgodna z resztą EN templates supplier-side (gdzie już używamy "submission").

**Akcja:** Zmienić `pluralOfferEN` na zwracanie `submission(s)`. Subject sygnalizujący `"Fresh Market PreConnect – N submissions for {retailer}"`.

---

## C. Legitimately stays (po review)

### C.1 PreconnectFM.jsx PL hits które ZOSTAJĄ

Z 387 hitów PL:
- **38 JSX comments** + **341 line comments** = 379 dev-only komentarzy
- **CNAMES dict** (line 70) — używany przez `getCountryName(code)` helper (P2-shared) który dispatchuje PL/EN. PL keys są fallback display.
- **STATUS_TIPS / STATUS_MAP / CTA_MAP** dictionaries — PL fallback labels. UI używa `t("common.status_tips.*")` etc. EN keys istnieją w `src/i18n/en/common.json`.
- **FM_CHAINS / FM_SUPPLIERS** seed data (~127+) — demo data dla FM 2026 (polskie sieci, polskie firmy). To są nazwy własne polskich firm — Biedronka, Lidl Polska, Dino Polska itp. Wszystko w PL bo to polski rynek handlowy.
- **Demo offer descriptions** (~153+) — seed data, polskie marketing copy dla demo
- **Algorithm warning `message` fields** (buildFMData) — algorytm generuje PL message w warnings struct (zostaje w struct, NIE renderowane — UI używa strukturalnych pól)

### C.2 i18n EN files — PL proper nouns

`src/i18n/en/common.json` + `src/i18n/en/legacy.json` zawierają:
- `"Oksana Kozłowska"` (proper name, multi-occurrence)
- `"Ożarów Mazowiecki"` (place name)
- `"Zmień język / Change language"` (bilingual switcher label)
- `_note` meta fields

Wszystko **intentional** — proper nouns z polskimi diacritickami nie tłumaczone.

### C.3 Backend templates / dictionary — PL warianty

| Plik | Hits | Status |
|---|---|---|
| `_shared/supplier-email-templates.js` | 57 | PL template variants (EN dispatched alongside) — intentional |
| `_shared/error-messages.js` | 48 | PL dictionary keys (EN keys istnieją) — intentional |
| `_shared/render-retailer-email.js` | 14 | PL i18n object literal (EN literal istnieje) — intentional |
| `_shared/function-env.js` | 2 | envErrorPayload PL hint (admin diagnostic) — OK |
| `_shared/load-kompendium.js` | 2 | fallback msg — OK |
| `ai-admin-chat-suggestion.js` | 40 | PL system prompt (AI dispatches per `"Odpowiadasz w języku rozmówcy"`) — intentional |
| `payu-notify.js` | 2 | PayU webhook (server-to-server) — OK |

### C.4 HTML files

| Plik | Hits | Status |
|---|---|---|
| `public/regulamin.html` | 120 | Polish legal — stays PL |
| `public/polityka-prywatnosci.html` | 99 | Polish legal — stays PL |
| `public/regulations.html` | 2 | EN legal version (2 PL hits to proper nouns — KJOW Sp. z o.o. address) — intentional |
| `public/privacy-policy.html` | 2 | EN legal version (2 PL hits to proper nouns) — intentional |
| `public/testy-przed-produkcja.html` | 216 | Internal admin test page — PL — stays |
| `supabase/auth-email-templates/*` | 10+6+10 | Bilingual side-by-side per README — stays |

### C.5 Frontend dev-only

| Plik | Hits | Status |
|---|---|---|
| `src/App.jsx` | 3 | All JSX comments — dev-only |
| `src/auth/AuthProvider.jsx` | 2 | `console.warn` dev message + dev assertion error — dev-only |
| `src/auth/LoginPage.jsx` | 7 | JSX comments — dev-only |
| `src/auth/RegisterSupplierPage.jsx` | 9 | JSX comments — dev-only |
| `src/auth/PurchaseReturnPage.jsx` | 1 | JSX comment — dev-only |
| `src/components/LanguageSwitcher.jsx` | 1 | code comment — dev-only |
| `src/components/LegalFooter.jsx` | 1 | JSX comment — dev-only |
| `src/legacy/README.md` | 7 | Dev doc — OK |

### C.6 Build artifacts

`vite.config.js.timestamp-*.mjs` (untracked) — build cache, ignore.

---

## D. Verification (Commit 4)

Po commitach 2+3:
1. **`npm run build`** — vite production build pass
2. **`node --check`** wszystkie `netlify/functions/*.js` + `_shared/*.js`
3. **Symmetry PL/EN** w `legacy.json` + `common.json`
4. **Re-run `pl-audit.cjs`** — porównaj total_code_hits przed/po (powinno spaść o ~20-30)
5. **Update docs/i18n/P0_DONE.md** lub dodać `P2_FINAL_DONE.md` z podsumowaniem całego P2

Po merge:
6. **Tag `v-i18n-complete`** na main

---

## E. Scope strictly respected

- Bez zmian DB schema, RLS, migrations
- Bez zmian algorytmu FM (buildFMData / algorithm trigger)
- Bez zmian PayU logic / payload (poza buyer.language który już mamy w C3)
- Bez zmian Resend payload format (poza locale dispatch w treści)
- Bez account lifecycle features (archiwizacja/usuwanie — to P3)
- Bez nowych funkcji — tylko copy/cleanup

---

## F. Statystyki

- Files audited: 58
- Hits to fix (commits 2+3): ~22 (14 db.js + 4 AccountSwitcherBar + ZoneLegend removal + 2 ai-company-description + 1 retailer subject)
- Files to delete: 1 (`send-offer.js`)
- Files to clean up: ~5 (`PreconnectFM.jsx`, `db.js`, `legacy.json`, `ai-company-description.js`, `render-retailer-email.js`)
- Total PL hits accepted as intentional: ~1085 (templates + seeds + comments + legal + proper nouns)
