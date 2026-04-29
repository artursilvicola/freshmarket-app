# Fresh Market — Instrukcja uruchomienia (krok po kroku)

Instrukcja po polsku dla Arthura (artur.stasiak@freshmarket.eu).
Po wykonaniu kroków masz **działającą aplikację na Netlify** z bazą Supabase, autoryzacją i trzema panelami (kupiec / dostawca / admin).

**Czas potrzebny:** ~45 minut (większość to czekanie na deploye).

---

## KROK 0 — Sprawdź, co masz

- [x] Konto GitHub
- [x] Konto Netlify
- [ ] Konto Supabase (zakładamy w Kroku 1)
- [ ] Node.js 20+ na komputerze ([pobierz tutaj](https://nodejs.org/))

Sprawdź wersję Node:
```
node --version
```
Jeśli wynik zaczyna się od `v20.` lub wyżej — OK.

---

## KROK 1 — Załóż konto Supabase i nowy projekt

1. Wejdź na https://supabase.com → **Start your project** → zaloguj się przez GitHub (najwygodniej).
2. Po zalogowaniu kliknij **New Project**:
   - **Name:** `freshmarket-prod` (lub jak chcesz)
   - **Database Password:** wygeneruj silne hasło i **ZAPISZ JE** w menedżerze haseł — będzie potrzebne do migracji do freshmarket.eu w przyszłości.
   - **Region:** `Frankfurt (eu-central-1)` — najbliżej Polski
   - **Plan:** Free (wystarczy na start)
3. Klik **Create new project**. Czekaj 1–2 minuty aż się wygeneruje.
4. Po utworzeniu wejdź w **Project Settings → API** i zapisz dwie wartości — będą potrzebne za chwilę:
   - `Project URL` (np. `https://abcdefgh.supabase.co`)
   - `anon public` key (długi token JWT zaczynający się od `eyJ...`)

> ⚠️ **Nie myl `anon` z `service_role`!** `service_role` to klucz administratora — nigdy nie wkładaj go do frontendu.

---

## KROK 2 — Wgraj schemat bazy

1. W panelu Supabase wejdź w **SQL Editor** (ikona po lewej).
2. Klik **+ New query**.
3. Otwórz plik `supabase/migrations/001_schema.sql` z tego folderu, **skopiuj całą zawartość**, wklej do edytora SQL i kliknij **RUN** (Ctrl+Enter).
4. Powtórz to samo dla:
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_storage.sql`
   - `supabase/seed.sql` (opcjonalnie — wgrywa dane testowe Twoich firm i retailerów)

Po wszystkim w **Table Editor** powinieneś widzieć tabele: `profiles`, `companies`, `offers`, `retailers`, `sends`, itd.

---

## KROK 3 — Stwórz pierwszego admina

W **SQL Editor** wykonaj:

```sql
-- Najpierw zarejestruj się przez Authentication > Users > Add user (email + hasło)
-- Skopiuj wygenerowany ID użytkownika
-- Potem wykonaj poniższe (podmień UUID):
INSERT INTO profiles (id, role, name, email)
VALUES ('TWÓJ-UUID-Z-AUTH', 'admin', 'Arthur Stasiak', 'artur.stasiak@freshmarket.eu');
```

Alternatywnie: zarejestruj się przez frontend (Krok 7), a potem w SQL Editor zmień swoją rolę na admin:
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'artur.stasiak@freshmarket.eu';
```

---

## KROK 4 — Wstaw klucze do projektu lokalnie

1. W folderze projektu skopiuj `.env.example` jako `.env`:
   ```
   copy .env.example .env
   ```
2. Otwórz `.env` w edytorze i wstaw wartości z Kroku 1:
   ```
   VITE_SUPABASE_URL=https://twoj-projekt.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

---

## KROK 5 — Zainstaluj i uruchom lokalnie

W terminalu w folderze projektu:

```
npm install
npm run dev
```

Otwórz http://localhost:5173 — powinieneś zobaczyć ekran logowania.

---

## KROK 6 — Skopiuj swój istniejący kod aplikacji

Plik `PreconnectFM.jsx` (~470 KB), który wgrałeś, **skopiuj** do:
```
src/legacy/PreconnectFM.jsx
```

Twoja istniejąca aplikacja będzie działać jako "warstwa wizualna" — autoryzacja, baza i upload zdjęć są dorobione **wokół** niej, a nie zamiast.

---

## KROK 7 — Wypchnij na GitHub

```
git init
git add .
git commit -m "Initial: Fresh Market app with Supabase"
git branch -M main
git remote add origin https://github.com/TWOJ-LOGIN/freshmarket-app.git
git push -u origin main
```

(Wcześniej stwórz puste repo na github.com — bez README.)

---

## KROK 8 — Deploy na Netlify

1. https://app.netlify.com → **Add new site → Import from Git** → wybierz repo `freshmarket-app`.
2. Build settings (Netlify wykryje automatycznie z `netlify.toml`, ale zweryfikuj):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
3. **Environment variables** (kliknij **Add variable** dla każdej):
   - `VITE_SUPABASE_URL` — to samo co w `.env`
   - `VITE_SUPABASE_ANON_KEY` — to samo co w `.env`
   - `RESEND_API_KEY` — (opcjonalnie, dla maili — patrz Krok 10)
4. Klik **Deploy site**. Czekaj 2–3 minuty.
5. Otwórz wygenerowany adres `*.netlify.app` — działa!

---

## KROK 9 — Podpięcie domeny freshmarket.eu (później)

Kiedy będziesz gotowy:
1. W Netlify: **Domain settings → Add custom domain** → `app.freshmarket.eu` (subdomena, żeby nie kolidować z główną stroną).
2. U dostawcy DNS freshmarket.eu dodaj rekord CNAME: `app` → `<twoj-site>.netlify.app`.
3. Netlify automatycznie wystawi certyfikat SSL.

---

## KROK 10 — Mailing przez Resend (opcjonalnie, na potem)

Gdy chcesz, żeby oferty faktycznie szły mailem do kupców:

1. Załóż konto na https://resend.com (free tier: 3000 maili/miesiąc).
2. **API Keys → Create API Key**, skopiuj.
3. W Netlify: **Site settings → Environment variables** dodaj `RESEND_API_KEY`.
4. Zweryfikuj domenę freshmarket.eu w Resend (DNS records).
5. Funkcja `netlify/functions/send-offer.js` jest już gotowa — wywołasz ją z aplikacji.

---

## STRUKTURA PROJEKTU

```
freshmarket-app/
├── package.json              # zależności
├── vite.config.js            # config Vite
├── netlify.toml              # config Netlify (build + redirects)
├── .env.example              # template zmiennych środowiskowych
├── .env                      # TWOJE klucze (NIE commituj!)
├── .gitignore
├── index.html                # entry HTML
├── SETUP_INSTRUKCJA.md       # ten plik
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_schema.sql        # tabele
│   │   ├── 002_rls_policies.sql  # bezpieczeństwo (kto co widzi)
│   │   └── 003_storage.sql       # buckets dla zdjęć
│   └── seed.sql                  # dane testowe
│
├── netlify/
│   └── functions/
│       └── send-offer.js     # wysyłka maili (Resend)
│
└── src/
    ├── main.jsx              # entry point
    ├── App.jsx               # router ról + auth check
    ├── lib/
    │   ├── supabase.js       # klient Supabase
    │   └── db.js             # funkcje CRUD (getOffers, saveOffer, ...)
    ├── auth/
    │   ├── AuthProvider.jsx  # context + useAuth hook
    │   ├── LoginPage.jsx     # /login
    │   ├── RegisterPage.jsx  # /register
    │   └── ProtectedRoute.jsx
    ├── components/
    │   └── PhotoUploader.jsx # upload zdjęć do Supabase Storage
    ├── panels/
    │   ├── AdminPanel.jsx    # wrapper /admin
    │   ├── SupplierPanel.jsx # wrapper /dostawca
    │   └── BuyerPanel.jsx    # wrapper /kupiec
    └── legacy/
        └── PreconnectFM.jsx  # TWÓJ obecny kod (skopiuj sam)
```

---

## CO DZIAŁA OD RAZU PO KROKU 8

- ✅ Logowanie / rejestracja (email + hasło lub magic link)
- ✅ Trzy oddzielne panele po zalogowaniu
- ✅ Twoja istniejąca aplikacja PreconnectFM jako warstwa wizualna
- ✅ Baza danych w chmurze
- ✅ Upload zdjęć do oferty (komponent `<PhotoUploader>`)
- ✅ Bezpieczeństwo na poziomie bazy (RLS — kupiec nie zobaczy ofert innych kupców)

## CO DOROBIMY W KOLEJNYCH KROKACH

Każdy z tych elementów to osobna "sesja" prac, którą zrobimy oddzielnie:
1. **Migracja seed-data → Supabase** — zastąpienie `OFFERS_INIT`, `RETAILERS`, `COMPANIES_DB` zapytaniami do bazy.
2. **Stripe** — zakup pakietów (logika finansowa już jest w kodzie).
3. **Resend** — faktyczna wysyłka maili z ofertami.
4. **Fresh Market events** — algorytm matchingu zostaje, tylko podłączymy persystencję.

---

## PROBLEMY?

- **Build na Netlify się wywala** → sprawdź, czy zmienne `VITE_*` są ustawione w Environment variables
- **"Invalid API key"** → sprawdź, czy nie pomyliłeś `anon` z `service_role`
- **Logowanie nie działa** → w Supabase: **Authentication → Settings → Email auth** włączone? Confirm email wyłącz na czas testów.
- **RLS blokuje dane** → sprawdź w SQL Editor: `SELECT * FROM profiles WHERE id = auth.uid()` — masz rolę?

W razie wątpliwości napisz, pomogę.
