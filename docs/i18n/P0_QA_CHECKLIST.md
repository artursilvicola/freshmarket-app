# P0 i18n MVP — Manual QA Checklist

Sign-off checklist dla branch `feat/i18n-mvp` przed merge'em do `main` i tagiem `v-i18n-mvp`.

P0 obejmuje publiczny onboarding EN (login + rejestracja + reset hasła + landing po PayU) oraz stopkę prawną. Wnętrza paneli, PreconnectFM.jsx i pipeline maili do retailerów zostają polskie — to P1/P2.

---

## Pre-flight (przed testami)

Te kroki są wymagane raz, na środowisku docelowym (staging / produkcja).

### Migracja DB
- [ ] `supabase/migrations/036_profiles_locale.sql` jest wgrane do Supabase Cloud (kolumna `profiles.locale text default 'pl'` istnieje)
- [ ] Weryfikacja: `select column_default from information_schema.columns where table_name='profiles' and column_name='locale';` → `'pl'::text`

### Supabase Auth email templates
Supabase nie wgrywa template'ów z gita — trzeba ręcznie wkleić w Dashboard.

Pełna instrukcja: [`supabase/auth-email-templates/README.md`](../../supabase/auth-email-templates/README.md).

Skrócony checklist:
- [ ] Custom SMTP w Supabase Dashboard wskazuje na Resend (`smtp.resend.com:465`, sender `hello@freshmarket.eu`)
- [ ] Reset password template — wklejone `reset-password/subject.txt` + `reset-password/body.html`
- [ ] Confirm signup template — wklejone `confirm-signup/subject.txt` + `confirm-signup/body.html`
- [ ] Magic link template — wklejone `magic-link/subject.txt` + `magic-link/body.html`
- [ ] Test SMTP: w Dashboard → Authentication → Users → "Send password recovery" → mail przychodzi z `hello@freshmarket.eu`

### Build i deploy
- [ ] `npm run build` lokalnie przechodzi bez błędów
- [ ] Netlify deploy z brancha `feat/i18n-mvp` zielony
- [ ] Smoke test: `/login` ładuje się bez błędów w konsoli

---

## A. UI — strony auth

### A1. PL login flow
- [ ] Otwórz `/login` w incognito (lub po wyczyszczeniu localStorage)
- [ ] Domyślny język = PL (LanguageSwitcher w prawym górnym pokazuje `PL` pogrubione, `EN` szare)
- [ ] Header: `Fresh Market` + `Panel B2B — owoce i warzywa`
- [ ] Etykiety pól: `Email`, `Hasło`
- [ ] Placeholder: `ty@firma.pl`
- [ ] Przycisk: `Zaloguj się`
- [ ] Linki: `Zapomniałeś hasła?`, `Albo zaloguj przez magic link`
- [ ] Footer: `Regulamin · Polityka Prywatności · Kontakt`
- [ ] Klik `Regulamin` → otwiera nową kartę z `/regulamin` (polski dokument, brak banner draft)
- [ ] Klik `Polityka Prywatności` → otwiera `/polityka-prywatnosci`

### A2. EN login flow
- [ ] Na `/login` kliknij `English` w LanguageSwitcher
- [ ] Header zmienia się na `B2B panel — fruits and vegetables`
- [ ] Etykiety: `Email`, `Password`
- [ ] Placeholder: `you@company.com`
- [ ] Przycisk: `Sign in`
- [ ] Linki: `Forgot your password?`, `Or sign in with a magic link`
- [ ] Footer: `Terms of Service · Privacy Policy · Contact`
- [ ] Klik `Terms of Service` → otwiera `/regulations` (EN draft z banerem żółtym "subject to legal review")
- [ ] Klik `Privacy Policy` → otwiera `/privacy-policy` (EN draft z banerem)
- [ ] Otwórz nową kartę `/login` → EN nadal wybrane (localStorage persistence działa)

### A3. Register supplier PL
- [ ] Na `/login` (PL) kliknij `Zarejestruj firmę` → `/zarejestruj-dostawce`
- [ ] Wszystkie etykiety pól po polsku (`Email służbowy *`, `Hasło (min. 8 znaków) *`, `Nazwa firmy *`, …)
- [ ] Country dropdown: `Polska, Niemcy, Czechy, Słowacja, …`
- [ ] Consent block po polsku z linkami `Regulamin` i `Politykę Prywatności` wskazujące na `/regulamin` i `/polityka-prywatnosci`
- [ ] Konsent ma 2 paragrafy ze `<strong>` (proces zatwierdzenia, widoczność danych)
- [ ] Po wypełnieniu i submit → ekran sukcesu `Rejestracja przyjęta` / `Czekamy na decyzję administratora`
- [ ] Sukces block: `✓ Konto zostało utworzone. Wysłaliśmy potwierdzenie na <strong>email</strong>. Konto firmy <strong>company</strong> czeka na zatwierdzenie przez administratora.`
- [ ] **W bazie:** `select locale from profiles where email='<test_email>'` → `pl`
- [ ] **W bazie:** `select raw_user_meta_data->>'locale' from auth.users where email='<test_email>'` → `pl`

### A4. Register supplier EN
- [ ] Na `/login` (EN) kliknij `Register your company` → `/zarejestruj-dostawce` w EN
- [ ] Wszystkie etykiety po angielsku (`Business email *`, `Password (min. 8 characters) *`, `Company name *`, …)
- [ ] Country dropdown: `Poland, Germany, Czechia, Slovakia, …`
- [ ] Consent block po angielsku, linki `Terms of Service` i `Privacy Policy` wskazujące na `/regulations` i `/privacy-policy`
- [ ] Po submit → `Registration accepted` / `Awaiting admin approval`
- [ ] Sukces block: `✓ Your account has been created. We sent a confirmation to <strong>email</strong>. Company account <strong>company</strong> is awaiting admin approval.`
- [ ] **W bazie:** `profiles.locale = 'en'`
- [ ] **W bazie:** `auth.users.raw_user_meta_data->>'locale' = 'en'`

### A5. Reset password page (`/reset-password`)
Wymaga maila reset z poprzedniego kroku albo manualnego `/login` → `Zapomniałeś hasła?`.
- [ ] W PL: heading `Reset hasła`, etykieta `Nowe hasło (min 8 znaków)`, przycisk `pokaż`/`ukryj`, submit `Ustaw nowe hasło`
- [ ] W EN: heading `Password reset`, etykieta `New password (min. 8 characters)`, przycisk `show`/`hide`, submit `Set new password`
- [ ] Walidacja: 2 niezgodne hasła → `Hasła nie są takie same.` / `Passwords don't match.`
- [ ] Walidacja: < 8 znaków → `Hasło musi mieć minimum 8 znaków.` / `Password must be at least 8 characters.`
- [ ] Sukces → `Hasło zmienione. Przekierowuję do panelu…` / `Password changed. Redirecting to the panel…`

### A6. Purchase return (`/zakup-ok?ext=<test>`)
Wymaga test PayU order. Można symulować ręcznie wstawiając rekord w `payu_orders` o różnym statusie.
- [ ] Status `pending` (loading) → PL: `Sprawdzamy płatność…` / EN: `Verifying payment…`
- [ ] Status `completed` → PL: `Pakiet aktywny ✓` / EN: `Package active ✓`, kwota wyświetlana w obu
- [ ] Status `canceled` → PL/EN warianty
- [ ] Status `rejected`/`failed` → PL/EN warianty z `failure_reason`

### A7. LanguageSwitcher persistence
- [ ] Niezalogowany: zmień język na EN → odśwież stronę → nadal EN (localStorage `fm_locale='en'`)
- [ ] Niezalogowany: zmień język na EN → otwórz devtools → `localStorage.getItem('fm_locale_pending_sync')` → `'1'`
- [ ] Niezalogowany z pending EN, zaloguj się jako user z `profiles.locale='pl'` → UI ustawia się na EN (pending wygrywa)
- [ ] Po loginie sprawdź bazę → `profiles.locale = 'en'` (sync z DB udany)
- [ ] `localStorage.getItem('fm_locale_pending_sync')` → `null` (flaga skasowana po sukcesie)
- [ ] Wyloguj → odśwież → nadal EN (localStorage trzyma)

---

## B. Email Layer

### B1. Welcome supplier mail PL (Resend)
Po self-rejestracji w PL na adres podany w formularzu przychodzi mail.
- [ ] Sender: `Fresh Market <newsletter@freshmarket.eu>`
- [ ] Subject: `Fresh Market – otrzymaliśmy zgłoszenie rejestracyjne`
- [ ] Treść po polsku: `Dzień dobry [Imię],`, `dziękujemy za rejestrację firmy <strong>X</strong>...`
- [ ] Przycisk: `Otwórz panel dostawcy`
- [ ] Footer: `ul. Marii 17/25, 05-803 Pruszków, Polska`
- [ ] Source HTML: `<html lang="pl">`

### B2. Welcome supplier mail EN
Po self-rejestracji w EN.
- [ ] Subject: `Fresh Market – we received your registration`
- [ ] Treść: `Hello [Name],`, `thank you for registering <strong>X</strong>...`, `admin approval`, `submissions to retailers`, `Fresh Market 2026 B2B Meetings`
- [ ] Przycisk: `Open supplier panel`
- [ ] Footer: `ul. Marii 17/25, 05-803 Pruszków, Poland`
- [ ] Source HTML: `<html lang="en">`

### B3. Admin notification (zawsze PL, niezależnie od locale dostawcy)
- [ ] Self-register w EN → mail do `newsletter@freshmarket.eu` PO POLSKU (`Fresh Market – nowa rejestracja: …`)
- [ ] Self-register w PL → też po polsku
- [ ] Treść admina nie zmienia się — operacyjnie zespół FM dostaje zawsze PL

### B4. Reset password mail (bilingual Supabase Auth)
- [ ] `/login` → `Forgot password?` → wpisz adres → submit
- [ ] Mail subject: `Fresh Market B2B — Zmiana hasła / Password reset`
- [ ] Heading w mailu: `Zmiana hasła · Password reset`
- [ ] Body ma sekcję PL nad sekcją EN
- [ ] CTA button: `Ustaw nowe hasło · Set new password`
- [ ] Footer: `24 September 2026, Warsaw, Poland`
- [ ] Klik w przycisk → redirect na `/reset-password` z sesją PASSWORD_RECOVERY

### B5. Magic link mail (bilingual)
- [ ] `/login` → przełącz na magic link → wpisz adres → submit
- [ ] Subject: `Fresh Market B2B — Link logowania / Sign-in link`
- [ ] Heading: `Link logowania · Sign-in link`
- [ ] Body bilingual
- [ ] CTA: `Zaloguj się · Sign in`

### B6. Confirm signup mail (jeśli email confirmation włączone)
W konfiguracji obecnej (`email_confirm: true` w `register-supplier-self.js`) ten mail nie jest wysyłany — Supabase pomija confirmation. Ale jeśli kiedyś włączymy:
- [ ] Subject: `Fresh Market B2B — Potwierdź e-mail / Confirm your email`
- [ ] Heading: `Potwierdź adres e-mail · Confirm your email`
- [ ] Body bilingual

---

## C. Legal Layer

### C1. `/regulamin` (PL)
- [ ] Dostępne pod `https://b2b.freshmarket.eu/regulamin` (bez `.html`, rewrite w `netlify.toml`)
- [ ] Header: `Regulamin korzystania z platformy`, `Wersja 1.0`, `Obowiązuje od: 24 maja 2026`
- [ ] 16 sekcji `§ 1 - § 16`
- [ ] Brak żółtego banera draft (PL doc jest finalny po Kroku 4 prod-rollout)

### C2. `/polityka-prywatnosci` (PL)
- [ ] Dostępne pod `/polityka-prywatnosci`
- [ ] Header: `Polityka Prywatności`, `Wersja 1.0`
- [ ] 10 sekcji
- [ ] Brak banera draft

### C3. `/regulations` (EN draft)
- [ ] Dostępne pod `/regulations` (rewrite z Krok 4b)
- [ ] Żółty banner: `English version — draft, subject to legal review. Both language versions are official; in case of doubt regarding a specific clause we recommend consulting the Polish version until the English text has been confirmed by legal counsel.`
- [ ] Header: `Terms of Service`, `Version 1.0`, `Effective from: 24 May 2026`
- [ ] 16 sekcji `§ 1 - § 16` po angielsku
- [ ] Terminologia v1.1: `Submission`, `Retailer`, `Admin`, `Operator`, `PreConnect`, `FM B2B Meetings`

### C4. `/privacy-policy` (EN draft)
- [ ] Dostępne pod `/privacy-policy`
- [ ] Żółty banner draft
- [ ] Header: `Privacy Policy`, `Version 1.0`, `Effective from: 24 May 2026`, `Data Controller: KJOW Sp. z o.o.`
- [ ] 10 sekcji po angielsku, włącznie z asymetryczną widocznością Supplier↔Buyer i listą procesorów (Supabase, Netlify, Resend, PayU, OpenAI)
- [ ] Terminologia v1.1

---

## D. Panel Layer (tylko stopka — wnętrza paneli zostają PL w P0)

### D1. LegalFooter w panelu Supplier
- [ ] Zaloguj się jako Supplier (PL) → `/dostawca`
- [ ] Footer u dołu: `© [rok] Fresh Market · KJOW Sp. z o.o.` z pogrubionym `Fresh Market` (color `#0f172a`)
- [ ] Linki: `Regulamin · Polityka Prywatności · hello@freshmarket.eu`
- [ ] Przełącz na EN przez switcher w PanelTopBar (top bar wciąż PL — to P1)
- [ ] Footer się aktualizuje: `Terms of Service · Privacy Policy · hello@freshmarket.eu`
- [ ] `Fresh Market` w copyright nadal pogrubiony
- [ ] Klik `Terms of Service` → otwiera `/regulations` w nowej karcie

### D2. LegalFooter w panelu Buyer
- [ ] Zaloguj się jako Buyer → `/kupiec`
- [ ] To samo co D1 — stopka działa, wnętrze panelu PL

### D3. LegalFooter w panelu Admin
- [ ] Zaloguj się jako Admin → `/admin`
- [ ] To samo co D1

---

## E. Persistence (DB + localStorage)

### E1. `profiles.locale` w bazie
- [ ] Zaloguj się jako user z `profiles.locale='pl'` → UI w PL
- [ ] Zmień język w panelu przez switcher → UPDATE `profiles.locale='en'` w bazie (sprawdź przez SQL editor: `select locale from profiles where id='<user_id>'`)
- [ ] Wyloguj → odśwież → zaloguj ponownie → UI startuje w EN (DB locale wygrywa)

### E2. localStorage `fm_locale`
- [ ] Niezalogowany na `/login`: w devtools `localStorage.getItem('fm_locale')` → `'pl'`
- [ ] Zmień na EN → `localStorage.getItem('fm_locale')` → `'en'`
- [ ] Zamknij browser → otwórz → `/login` w EN (localStorage persist)

### E3. Pending sync flag (`fm_locale_pending_sync`)
- [ ] Niezalogowany: switcher na EN → `localStorage.getItem('fm_locale_pending_sync')` → `'1'`
- [ ] Zaloguj się jako user z DB `locale='pl'`:
  - UI ustawia się na EN (pending wygrywa nad DB)
  - W tle: UPDATE `profiles.locale='en'`
  - Po sukcesie: `localStorage.getItem('fm_locale_pending_sync')` → `null` (flaga skasowana)
- [ ] Symulacja błędu UPDATE (manualnie wyłącz RLS / odłącz network): flaga zostaje `'1'`, sync ponowi się przy następnym loginie

---

## Sign-off

- [ ] Wszystkie testy **A1-A7** OK
- [ ] Wszystkie testy **B1-B5** OK (B6 opcjonalne)
- [ ] Wszystkie testy **C1-C4** OK
- [ ] Wszystkie testy **D1-D3** OK
- [ ] Wszystkie testy **E1-E3** OK
- [ ] Annotated tag `v-i18n-mvp` utworzony na ostatnim commit `feat/i18n-mvp`
- [ ] Tag wypchnięty do `origin`
- [ ] PR `feat/i18n-mvp` → `main` otwarty / zatwierdzony / merged

Po sign-off P0 jest zamknięty. Następna faza: **P1** (panele admin/supplier/buyer + PanelTopBar). `PreconnectFM.jsx` zostaje w P2.
