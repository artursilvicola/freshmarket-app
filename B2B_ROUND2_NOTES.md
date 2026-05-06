# B2B_ROUND2_NOTES.md — Status + plan dalszych kroków

**Data:** 2026-05-06
**Repo:** `freshmarket-app` (commit pending)
**Cel rundy:** wymiana warstwy danych pod istniejącym UI (PreconnectFM.jsx). Bez przebudowy UI.

---

## ✅ Co zrobione w tym kroku

### 1. Migracja `008_fm2026_data_layer.sql` (nowa)

- `retailers.legacy_chain_id` (text, unique) — mapuje stare hardcoded ID z `FM_CHAINS` (np. `"100"` dla Biedronki) na realny rekord w bazie.
- `companies.legacy_fm_id` (text, unique) — to samo dla `FM_SUPPLIERS` (`"s1"` dla UNICA).
- `company_target_retailers` (M:N) — preferencje dostawcy do sieci handlowych (klucz FM 2026 matchmaking).
- `fm_wishlists` — kupiec stawia priorytet na dostawcy.
- `fm_late_resps` — opóźnione odpowiedzi kupca.
- `fm_messages` — konwersacje admin/supplier/buyer.
- RLS dla wszystkich nowych tabel + dla istniejących `fm_settings` / `fm_prefs` / `fm_resps` (były bez RLS w 001).

### 2. `src/lib/db.js` — rozszerzenie warstwy danych (+13 nowych funkcji)

- `getRetailerByLegacyId(legacyChainId)` — lookup po fmId
- `getCompanyByLegacyFmId(legacyFmId)`
- `getFmResps(retailerId)` / `saveFmResp(...)` / `deleteFmResp(id)` — odpowiedzi kupca (zone/status)
- `getFmSchedule()` / `saveFmSchedule(schedule)` — odczyt/zapis harmonogramu w `fm_settings.schedule` JSONB
- `getCompanyTargetRetailers(companyId)` / `setCompanyTargetRetailers(companyId, items)` — preferencje dostawcy (replace-set)
- `getFmWishlists(retailerId)` / `saveFmWishlist(...)` / `deleteFmWishlist(...)`
- `getFmLateResps(retailerId)` / `saveFmLateResp(...)`
- `getFmMessages({...})` / `saveFmMessage(...)` / `markFmMessageRead(id)`
- `bulkUpsertCompanies(companies)` — migracja seed `COMPANIES_DB` do tabeli `companies` (mapuje `fmId → legacy_fm_id`)
- `bulkUpsertRetailers(retailers)` — to samo dla `FM_CHAINS`

### 3. `src/App.jsx` — zabezpieczenie `/register`

- `/register` jest teraz pod `<ProtectedRoute allowedRoles={["admin"]}>` — tylko zalogowany admin może kreować nowe konta.
- Komentarz tłumaczy: publiczna rejestracja idzie przez `freshmarket.eu/registration` → admin akceptuje uczestnika → tworzy konto B2B.

### 4. `src/auth/LoginPage.jsx` — zniknął publiczny link do rejestracji

- Stopka: zamiast "Nie masz konta? Zarejestruj się" → "Konta B2B są tworzone przez administratora po zatwierdzeniu rejestracji na freshmarket.eu/registration".

### 5. `src/auth/AuthProvider.jsx` — wzbogacony profile

- `loadProfile()` robi teraz JOIN do `companies` (id, name, country, legacy_fm_id, pkg_plan) i `retailers` (id, name, country).
- Dodaje do `profile` pola: `legacy_fm_id`, `company_name`, `company_country`, `country`, `pkg_plan`, `retailer_name`.
- Te pola są konsumowane przez `PreconnectFM App()` przy budowie `account`.

### 6. `src/legacy/PreconnectFM.jsx` — App entry: profile-driven mapping

Patch w `App({ initialRole, currentUser })` (linie ~1136–1175):

- **admin**: `account.id = currentUser.id || "admin"`, `name = profile.name || email`, bez hardcoded "Oksana".
- **buyer**: `account.retailerId = currentUser.retailer_id` (już nie zawsze 100/Biedronka!). Title bierze się z `currentUser.retailer_name` lub `Sieć #${rid}`.
- **supplier**: `account.id = currentUser.company_id`, `account.fmId = currentUser.legacy_fm_id`, `account.name = currentUser.company_name`, `country` z `companies.country`. Już nie zawsze "UNICA GROUP / s1".

---

## ⏳ Co JESZCZE zostaje do Round 2 (do następnego patcha)

### A. Wymiana `localStorage` persistence (linie 1475–1490 PreconnectFM.jsx)

Block:
```jsx
useEffect(() => {
  localStorage.setItem("fm_fmPrefs",   JSON.stringify(fmPrefs));
  localStorage.setItem("fm_fmResps",   JSON.stringify(fmResps));
  localStorage.setItem("fm_retailers", JSON.stringify(retailers));
  localStorage.setItem("fm_companies", JSON.stringify(companies));
  if(fmSchedule) localStorage.setItem("fm_fmSchedule", JSON.stringify(fmSchedule));
  localStorage.setItem("fm_refundNotifs", JSON.stringify(refundNotifs));
  localStorage.setItem("fm_fmWishlists", JSON.stringify(fmWishlists));
  localStorage.setItem("fm_fmLateResps", JSON.stringify(fmLateResps));
  localStorage.setItem("fm_previewFor", JSON.stringify(previewFor));
  localStorage.setItem("fm_messages", JSON.stringify(messages));
});
```

Plan zamiany (każda linia → wywołanie z `db.js`):

| stare | nowe |
|---|---|
| `localStorage.setItem("fm_fmPrefs", ...)` | dla każdego `retailerId` w fmPrefs: `saveFmPrefs(retailerId, prefs)` |
| `localStorage.setItem("fm_fmResps", ...)` | dla każdej odpowiedzi: `saveFmResp({ retailer_id, supplier_company_id, ... })` |
| `localStorage.setItem("fm_retailers", ...)` | `bulkUpsertRetailers(retailers)` (raz przy zmianie listy, nie na każdy keystroke) |
| `localStorage.setItem("fm_companies", ...)` | `bulkUpsertCompanies(companies)` (j.w.) |
| `localStorage.setItem("fm_fmSchedule", ...)` | `saveFmSchedule(fmSchedule)` |
| `localStorage.setItem("fm_fmWishlists", ...)` | `saveFmWishlist(...)` per item |
| `localStorage.setItem("fm_fmLateResps", ...)` | `saveFmLateResp(...)` per item |
| `localStorage.setItem("fm_messages", ...)` | `saveFmMessage(...)` per nowa wiadomość (NIE bulk!) |
| `localStorage.setItem("fm_refundNotifs", ...)` | (tymczasowo zostaw localStorage; tabela `fm_refund_notifs` nie jest priorytetem) |
| `localStorage.setItem("fm_previewFor", ...)` | (UI state; może zostać w localStorage) |

**UWAGA przy zamianie:** ten useEffect leci na każdą zmianę state. Bezpośrednie zamienienie `localStorage` na `bulkUpsert*` skutkowałoby setkami zapytań do Supabase przy każdym kliknięciu. Trzeba to zmienić na **debounced** zapis (np. lodash.debounce 1s) albo na **per-action zapisy** w handlerach (gdzie kupiec klika Accept/Reject — tam wywołać `saveFmResp(...)`, nie w globalnym useEffect).

### B. Wymiana initial loaderów `fm_*` z localStorage na Supabase

- linia 1255: `localStorage.getItem("fm_companies")` → `getCompanies()` (już mamy w db.js)
- linia 1309: `localStorage.getItem("fm_retailers")` → `getRetailers()` (już mamy)
- linia 1380: `localStorage.getItem("fm_fmPrefs")` → `getFmPrefs(retailerId)` per retailer (loop) lub bulk SELECT
- linia 1383: `localStorage.getItem("fm_fmResps")` → `getFmResps()`
- linia 1472: `localStorage.getItem("fm_fmSchedule")` → `getFmSchedule()`

Wzór jak dla offers/sends: `useState(SEED) → useEffect( load → if empty seed bulkUpsert → setState )`.

### C. Trigger `handle_new_user` — auto-tworzenie profilu

W 001 jest:
```sql
insert into public.profiles (id, email, role)
values (new.id, new.email, 'supplier')
```

To znaczy że KAŻDY user dostaje rolę `supplier` po Sign Up. Jeśli admin tworzy konto buyer, musi ręcznie zmienić rolę. Co więcej, do zapisu `company_id` / `retailer_id` musi to robić **po** rejestracji.

**Lepiej:** Admin tworzy konto przez Service Role API z `user_metadata: { role, company_id, retailer_id }`, a trigger czyta to:

```sql
-- 008.5: poprawiony handle_new_user
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, role, company_id, retailer_id, name)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'supplier'),
    nullif(new.raw_user_meta_data->>'company_id', '')::uuid,
    nullif(new.raw_user_meta_data->>'retailer_id', '')::integer,
    new.raw_user_meta_data->>'name'
  )
  on conflict (id) do update set
    role        = coalesce(excluded.role, profiles.role),
    company_id  = coalesce(excluded.company_id, profiles.company_id),
    retailer_id = coalesce(excluded.retailer_id, profiles.retailer_id),
    name        = coalesce(excluded.name, profiles.name);
  return new;
end;
$$ language plpgsql security definer;
```

Dodać do migracji `008` lub `009`.

### D. Admin UI: "Zatwierdź rejestrację → utwórz konto B2B"

W `PreconnectFM.jsx` w `PageAdminRegistrations` (jeśli istnieje, tę widoki tworzyłem w Round 10A.4 dla freshmarket-eu — w freshmarket-app prawdopodobnie nie ma) — dodać przycisk:

```jsx
<button onClick={() => createB2BAccount(reg)}>
  Zatwierdź + utwórz konto B2B + wyślij magic link
</button>
```

Ten button woła **Netlify Function** `manual-confirm.js` (do dodania), która:
1. Tworzy `auth.users` przez `admin.createUser({ email, user_metadata: { role, company_id, retailer_id, name }})` (Service Role).
2. Update `event_registrations.status = 'confirmed'`, `event_registrations.user_id = newUser.id`.
3. Wysyła magic link przez `supabase.auth.signInWithOtp({ email, options: { redirectTo: 'https://app.freshmarket.eu/' }})`.

To jest **B2B Round 3** (osobny commit), nie Round 2.

---

## 🧪 Test plan po deploy migracji 008

1. Wgrać `008_fm2026_data_layer.sql` w Supabase SQL Editor.
2. Manualnie ustawić `legacy_chain_id` dla Biedronki (`UPDATE retailers SET legacy_chain_id='100' WHERE id=100`) i 1-2 innych testowych sieci.
3. Manualnie ustawić `legacy_fm_id` dla 1 testowego suppliera (`UPDATE companies SET legacy_fm_id='s1' WHERE id=...`).
4. Przypisać testowemu kupcowi `retailer_id=100` w `profiles`.
5. Przypisać testowemu dostawcy `company_id=<uuid>` w `profiles`.
6. Zalogować się jako kupiec → sprawdzić czy `account.title = "Biedronka"` (nie "Test Kupiec").
7. Zalogować się jako dostawca → sprawdzić czy `account.name = <nazwa firmy z DB>` (nie "UNICA GROUP").

Jeśli krok 6/7 działa — patch App entry działa poprawnie.

---

## 📌 Kolejne kroki (B2B Round 3, 4, 5)

- **Round 3**: Profil supplier-a w Supabase (zamiast `fm_companies` localStorage) + UI do `company_target_retailers` + certyfikaty (`company_certs` już istnieje).
- **Round 4**: Panel buyer — accept/reject zapis do `fm_resps` przez `saveFmResp()`.
- **Round 5**: Generator harmonogramu (Edge Function lub Postgres function) + publikacja przez `saveFmSchedule()`.

Algorytm matchingu — najtrudniejszy kawałek. Wymaga rozmowy z Tobą o constraints (ile slotów, ile spotkań/supplier, jak resolve konflikty).
