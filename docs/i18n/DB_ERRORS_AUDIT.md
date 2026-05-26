# `src/lib/db.js` — audyt user-facing error messages

**Krok 12 FAZA A** — inwentaryzacja zanim cokolwiek się tłumaczy. Tylko mapa, zero zmian w kodzie.

Branch: `feat/i18n-p1-db-errors-audit` · Baseline: `main` (po Krok 11 merge `f59161c`)

## Metodologia

1. `grep -n` w `src/lib/db.js`:
   - `throw new Error(...)` → 34 wystąpienia
   - `return { ok: false, error: ... }` → 18 wystąpień
   - Razem **52 user-facing-or-dev error strings** w pliku ~1700 linii / 84 exportowane funkcje
2. Mapowanie linii → najbliższa wcześniejsza definicja `export async function` (lub helper non-exported)
3. Dla każdej funkcji: `grep` callerów w `src/` → przypisanie A/B/C/D

## Kategorie

| Kod | Znaczenie | Co z tym robić |
|---|---|---|
| **A** | User-facing, używane poza `src/legacy/PreconnectFM.jsx` (auth/admin register/global shell) | Kandydaci do tłumaczenia w FAZIE B |
| **B** | Używane przez `src/legacy/PreconnectFM.jsx` | Zostaje na P2 (razem z PreconnectFM) |
| **C** | Passthrough z Supabase/Netlify (`error.message`, `err.message`, `HTTP ${status}`) | Nie tłumaczymy teraz — to backend, osobny temat |
| **D** | Dev-only sanity check (`"updateBuyerProfile wymaga id"`) — user nigdy nie zobaczy | Ignore |

## Pełna inwentaryzacja

### Helper: `validateBuyerAccountPayload` (linia 31, non-exported)

Wywoływany przez `createBuyerAccount` + `adminUpdateBuyerAccount` (admin tworzy/edytuje konto kupca).

| Linia | Treść | Kategoria |
|---|---|---|
| 41 | `"Kupiec musi mieć imię i nazwisko."` | **B** (legacy admin UI) |
| 42 | `"Kupiec musi mieć adres e-mail."` | **B** |
| 43 | `"Adres e-mail kupca ma niepoprawny format."` | **B** |
| 44 | `"Kupiec musi być przypisany do jednej sieci handlowej."` | **B** |
| 45 | `"Aktywny kupiec musi mieć przypisaną przynajmniej jedną kategorię."` | **B** |

### `saveCompanyContacts` (linia 123)

| Linia | Treść | Kategoria |
|---|---|---|
| 124 | `"Brak identyfikatora firmy."` | **B** (PreconnectFM profile firmy) |

### `generateCompanyDescriptionAI` (linia 225)

| Linia | Treść | Kategoria |
|---|---|---|
| 228 | `"Brak aktywnej sesji."` | **B** |
| 242 | `json?.error \|\| "Nie udalo sie wygenerowac opisu firmy."` | **B** (legacy AI feature) |

### `updateBuyerProfile` (linia 271)

| Linia | Treść | Kategoria |
|---|---|---|
| 272 | `"updateBuyerProfile wymaga id"` | **D** (dev sanity check) |

### `updateOwnBuyerProfile` (linia 296)

| Linia | Treść | Kategoria |
|---|---|---|
| 297 | `"updateOwnBuyerProfile wymaga id"` | **D** |
| 304 | `"Imię i nazwisko są wymagane."` | **B** (legacy profile UI) |

### `updateOwnSupplierProfile` (linia 318)

| Linia | Treść | Kategoria |
|---|---|---|
| 319 | `"updateOwnSupplierProfile wymaga id"` | **D** |
| 326 | `"Imię i nazwisko są wymagane."` | **B** |

### `changeOwnPassword` (linia 341)

| Linia | Treść | Kategoria |
|---|---|---|
| 342 | `"Wpisz aktualne hasło."` | **B** (legacy profile UI) |
| 344 | `"Nowe hasło musi mieć minimum 8 znaków."` | **B** |
| 348 | `"Brak aktywnej sesji."` | **B** |
| 353 | `"Nieprawidłowe aktualne hasło."` | **B** |
| 355 | `updErr.message \|\| "Nie udało się zmienić hasła."` | **B** + **C** (Supabase passthrough fallback) |

### `createBuyerAccount` (linia 359)

Admin-only flow (`POST /.netlify/functions/admin-create-user`).

| Linia | Treść | Kategoria |
|---|---|---|
| 371 | `"Brak aktywnej sesji admina"` | **B** (legacy admin UI) |
| 403 | `json?.error \|\| "Nie udało się utworzyć kupca"` | **B** + **C** |

> Funkcja jest używana tylko z legacy. Nasz `src/auth/RegisterPage.jsx` (admin register P0, Krok 10) NIE używa `createBuyerAccount` — wywołuje bezpośrednio `/.netlify/functions/admin-create-user`. Czyli ten throw siedzi w martwym dla nowych Krok-8+ stronach.

### `adminUpdateBuyerAccount` (linia 407)

| Linia | Treść | Kategoria |
|---|---|---|
| 420 | `"Brak aktywnej sesji admina"` | **B** |
| 421 | `"Brak identyfikatora kupca do aktualizacji."` | **B** |
| 453 | `json?.error \|\| "Nie udało się zaktualizować kupca"` | **B** + **C** |

### `createPayuOrder` (linia 608)

| Linia | Treść | Kategoria |
|---|---|---|
| 610 | `"Musisz być zalogowany żeby kupić pakiet."` | **B** (legacy buy-package flow w SupplierPanel) |
| 621 | `body?.error \|\| \`PayU: błąd ${res.status}\`` | **B** + **C** |
| 622 | `"PayU: brak redirectUri w odpowiedzi"` | **B** |

> PayU return landing (`src/auth/PurchaseReturnPage.jsx`, P0) używa `getPayuOrderByExt`, nie `createPayuOrder`. Tworzenie zamówienia inicjowane z PreconnectFM.

### `uploadBrandLogo` (linia 782)

| Linia | Treść | Kategoria |
|---|---|---|
| 783 | `"Brak pliku"` | **B** (legacy admin brand-settings) |
| 795 | `upErr.message` | **C** (Supabase Storage passthrough) |
| 799 | `"Nie udało się pobrać public URL"` | **B** |
| 809 | `` `Upload OK, ale zapis URL: ${updErr.message}` `` | **B** + **C** |
| 814 | `` `Upload OK, ale insert: ${insErr.message}` `` | **B** + **C** |

### `upsertLegacyOffer` (linia 860)

| Linia | Treść | Kategoria |
|---|---|---|
| 873 | `body?.error \|\| \`Nie udało się zapisać propozycji (${res.status})\`` | **B** + **C** (LEGACY funkcja) |

### `saveFmResp` (linia 1066)

| Linia | Treść | Kategoria |
|---|---|---|
| 1068 | `"saveFmResp wymaga retailer_id + supplier_company_id"` | **D** (dev sanity) |

### `saveFmSelectionConfirmation` (linia 1185)

| Linia | Treść | Kategoria |
|---|---|---|
| 1186 | `"saveFmSelectionConfirmation: companyId wymagane"` | **D** |

### `setCompanyTargetRetailers` (linia 1201)

| Linia | Treść | Kategoria |
|---|---|---|
| 1202 | `"setCompanyTargetRetailers: companyId wymagane"` | **D** |

### `saveFmWishlist` (linia 1242)

| Linia | Treść | Kategoria |
|---|---|---|
| 1243 | `"saveFmWishlist wymaga retailer_id + supplier_legacy_id"` | **D** |

### `notifySupplier` (linia 1372)

| Linia | Treść | Kategoria |
|---|---|---|
| 1376 | `"no_session"` | **B** (special token, nie zwykły message) |
| 1389 | `json?.error \|\| \`HTTP ${res.status}\`` | **B** + **C** |
| 1394 | `e?.message` | **C** (passthrough) |

### `selfRegisterSupplier` (linia 1401) ⭐

| Linia | Treść | Kategoria |
|---|---|---|
| 1434 | `json?.error \|\| "Nie udało się zarejestrować konta."` | **A** + **C** (fallback gdy backend nie zwróci error) |

> **JEDYNY user-facing error w `db.js` używany poza legacy.** Caller: `src/auth/RegisterSupplierPage.jsx` (P0 publiczny onboarding dostawcy). Aktualnie pokazany użytkownikowi przez `setErr(e.message || "Błąd rejestracji.")`.

### `sendRetailerBatch` (linia 1446)

| Linia | Treść | Kategoria |
|---|---|---|
| 1449 | `"Brak aktywnej sesji admina."` | **B** (legacy admin pipeline) |

### `suggestAdminChatReplyAI` (linia 1468)

| Linia | Treść | Kategoria |
|---|---|---|
| 1471 | `"Brak aktywnej sesji admina."` | **B** (legacy admin AI assistant) |
| 1482 | `json?.error \|\| "Nie udalo sie wygenerowac podpowiedzi odpowiedzi."` | **B** + **C** |

### `promoteToAdmin` (linia 1629)

Używana w legacy admin-team UI (super_admin może promować).

| Linia | Treść | Kategoria |
|---|---|---|
| 1631 | `"Niepoprawny email"` | **B** |
| 1639 | `findErr.message` | **C** |
| 1647 | `` `${email} już jest administratorem.` `` | **B** |
| 1656 | `updErr.message` | **C** |

### `demoteFromAdmin` (linia 1663)

| Linia | Treść | Kategoria |
|---|---|---|
| 1664 | `"Brak userId"` | **D** (dev sanity) |
| 1667 | `"Nie możesz zdjąć uprawnień administratora samemu sobie."` | **B** |
| 1675 | `error.message` | **C** |

### `setSuperAdmin` (linia 1682)

| Linia | Treść | Kategoria |
|---|---|---|
| 1683 | `"Brak userId"` | **D** |
| 1686 | `"Nie możesz odebrać sobie samemu uprawnień super admina."` | **B** |
| 1694 | `error.message` | **C** |

## Statystyki

| Kategoria | Licznik | Status |
|---|---|---|
| **A** — kandydat FAZY B | **1** | linia 1434 (`selfRegisterSupplier`) |
| **B** — legacy/PreconnectFM | **32** | Czekają na P2 razem z PreconnectFM |
| **C** — passthrough backend/Supabase | **~14** (często mieszane z B jako fallback) | Osobny temat (backend i18n / lub świadomie nie tłumaczyć) |
| **D** — dev sanity | **7** | Ignore — user nigdy nie zobaczy |
| **Razem** | **52** | |

## Kluczowe obserwacje

1. **`db.js` jest faktycznie centrum nerwowe LEGACY.** 32 z 52 errors (~62%) trafia bezpośrednio do PreconnectFM. Ich tłumaczenie ma sens dopiero **razem** z migracją PreconnectFM (P2).

2. **Tylko 1 funkcja (`selfRegisterSupplier`) ma user-facing error używany w P0/P1.** Wszystkie inne ścieżki poza legacy (P0 RegisterSupplierPage, P0 PurchaseReturnPage, P0/Krok 10 RegisterPage admin) używają funkcji read-only bez throw — albo wywołują Netlify Functions bezpośrednio.

3. **Passthrough z backendu (`json?.error`, `err.message`) zostaje wszędzie po polsku** dopóki Netlify Functions nie zaczną zwracać kluczy i18n zamiast surowych stringów. To duży temat — wykracza poza zakres P1.

4. **Dev sanity checks (`"X wymaga id"`) to martwy kod komunikatów** — nigdy nie widzi ich końcowy user, bo to pre-conditions wywoływane tylko przez sam kod aplikacji.

## Rekomendowana FAZA B — minimalny bezpieczny zakres

### Wariant 1 (minimum minimum): **`selfRegisterSupplier` linia 1434**

**Zakres:**
- W `db.js` linia 1434: zamiast hardcoded fallback `"Nie udało się zarejestrować konta."` zwracać klucz i18n (np. throw obiekt z polem `i18nKey` zamiast samego `message`), albo zostawić surowy fallback i przetłumaczyć **po stronie callera** w `RegisterSupplierPage.jsx`.
- Caller już ma `setErr(e.message || t("register.error_default"))` (P0 Krok 4) — czyli **jeśli backend zwraca `json.error`, ten string trafia do UI niezależnie od locale UI**. To dotyczy wszystkich błędów z Netlify Function `register-supplier-self`, nie tylko fallbacka w db.js.

**Wniosek:** zmiana w db.js samym nie rozwiązuje problemu — błędy z backendu to osobny temat (i18n po stronie Netlify Functions). Sam `db.js` linia 1434 to fallback rzadko triggered (gdy backend padnie bez zwrócenia error JSON-a).

**Koszt:** 1 linia kodu + 1 klucz w `auth.json`.
**Zysk:** marginalny — pokrywa edge case "backend padł kompletnie".

### Wariant 2 (zalecany): **Nic w FAZIE B teraz**

**Argument:**
- `db.js` to centrum legacy. Tłumaczenie ad-hoc 1 linii nie daje sensownego progressu i wprowadza precedens dotykania centrum nerwowego.
- Lepszy plan: **pomijamy db.js w P1 i zostawiamy go całego na P2 razem z PreconnectFM.** Wtedy w jednym spójnym kroku migrujemy wszystkie 32 user-facing errors + Trans w widoku.
- W międzyczasie: `selfRegisterSupplier` fallback i tak jest tylko triggered gdy backend padnie kompletnie — rzadkie, edge case.

**Co zamiast tego w P1:**
- P1 jest faktycznie **zamknięte** po Krokach 8-11. Wszystko "łatwe poza legacy" mamy.
- Następny sensowny krok to **wejście w PreconnectFM (P2)** — duży temat, ale to jedyne sensowne miejsce gdzie ma sens dotykać `db.js`.

### Wariant 3 (alternatywa): **Tylko comment w `db.js` z linkiem do tego audytu**

Bez zmian funkcjonalnych — dodać header w `db.js` z komentarzem typu:
```js
// [i18n] Wszystkie user-facing error messages w tym pliku są LEGACY
// i czekają na migrację razem z src/legacy/PreconnectFM.jsx w P2.
// Patrz docs/i18n/DB_ERRORS_AUDIT.md
```

To pomaga przyszłemu czytelnikowi (i Codexowi) zrozumieć dlaczego polski tekst tu zostaje.

## Decyzja do Codexa

Rekomenduję **Wariant 2 (Nic w FAZIE B teraz)** + opcjonalnie **Wariant 3 (komentarz w db.js)** jako side-effect:

- P1 traktujemy jako zamknięte po Krokach 8-11
- `db.js` zostaje legacy do P2
- Następnym sensownym krokiem nie jest "Krok 12 implementacja", tylko **decyzja strategiczna**: jak podejść do P2 (PreconnectFM + db.js + 11 maili Resend)

Czekam na opinię Codexa zanim cokolwiek zmieniam w `db.js`.
