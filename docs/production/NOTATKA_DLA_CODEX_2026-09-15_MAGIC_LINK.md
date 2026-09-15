# Do review — magic link zakładał nowe konta bez roli i firmy (15.09.2026)

Gałąź `fix/auth-magic-link-existing-only` od `main` 6d4e490 (= produkcja d3d416a + docs). Wyłącznie frontend logowania + 1 tekst i18n. Bez migracji, RLS, zmian w bazie. Nie wdrożone.

## Zgłoszenie (Umai Group, 15.09)

Kupiec z sieci Umai (Kirgistan) poprosił o magic link na `i.kaliuzhnaia@market.kg`, kliknął — i zobaczył ekran „Konto bez przypisanej firmy” (po rosyjsku: to tłumaczenie przeglądarki, aplikacja ma tylko PL/EN).

## Diagnoza

- Sieć `Umai Group (Umai Retail - Kirgistan)` (id 143, `fm26_active`) **nie ma żadnego konta kupca** — osoba jest tylko kontaktem na rekordzie sieci. Adres, którego użyła, nie istniał w `auth.users`.
- `AuthProvider.sendMagicLink` wołało `signInWithOtp` **bez `shouldCreateUser: false`** — domyślnie Supabase zakłada nowego użytkownika dla nieznanego adresu. Trigger `handle_new_user` (034) tworzy wtedy profil z rolą domyślną `supplier`, bez `company_id` → po kliknięciu linku `ProtectedRoute` pokazuje `errors.no_company` („zarejestruj się ponownie…”), co dla kupca nie ma sensu.
- Ten sam mechanizm wyprodukował **5 osieroconych profili** `supplier` bez firmy: 24.06 (`tniutnia@…`), 20.08 (`oksale.pl@…`), 1.09 (`albertogm9@…`, `dariusz.bednarz@polska.leclerc` — kupiec Leclerc), 15.09 (`i.kaliuzhnaia@market.kg`). Rejestracja dostawcy „auto-heal” sprząta takie sieroty tylko przy ponownej rejestracji firmy — kupców to nie dotyczy.

## Zmiana

- `src/auth/AuthProvider.jsx`: `signInWithOtp(..., { shouldCreateUser: false })` — magic link wyłącznie dla istniejących kont. Nieznany adres → błąd Supabase „Signups not allowed for otp”, nowe konto **nie** powstaje.
- `src/auth/authErrors.js` (nowy): `isMagicLinkNoAccountError`, `loginErrorKey(error, mode)` → `login.magic_link_no_account`.
- `src/auth/LoginPage.jsx`: w trybie magic link nieznany adres pokazuje „Nie ma konta z tym adresem e-mail. Sprawdź pisownię lub użyj adresu, na który założono konto. Jeśli nie masz jeszcze konta dostawcy — zarejestruj firmę; konta kupców zakłada administrator.” (PL/EN, `auth.json`). Pozostałe błędy bez zmian.
- Reset hasła (`resetPasswordForEmail`) nie zakłada kont — bez zmian.

## Testy

`src/auth/authErrors.test.js` (2): rozpoznanie odpowiedzi Supabase, mapowanie tylko w trybie magic. `npm test` **145/145**, `npm run build` OK, `git diff --check` OK. Bez podglądu w przeglądarce (wymaga wysyłki maila) — po wdrożeniu test: magic link na nieistniejący adres → komunikat, brak nowego wiersza w `profiles`.

## Dane (osobno od kodu, decyzja Artura)

1. Konto `i.kaliuzhnaia@market.kg` przerobić na kupca sieci Umai (id 143): `role = buyer`, `retailer_id = 143`, `name`, `fm26_active = true` — przez Admin → Kupcy (edycja użytkownika, `admin-update-user`) albo SQL; po zmianie magic link zaloguje ją do panelu kupca (9 dostawców już wybrało Umai).
2. Pozostałe 4 sieroty: `dariusz.bednarz@polska.leclerc` → kupiec Leclerc (sprawdzić sieć), `tniutnia@…`, `oksale.pl@…`, `albertogm9@…` → ustalić, kim są (dostawca bez rejestracji? kupiec?) i dopiąć lub zarchiwizować.
3. Wdrożenie poprawki (osobny deploy, bez migracji) po review i zgodzie Artura — najlepiej przed rozsyłką planu 22–23.09, bo wtedy kupcy masowo logują się magic linkiem.
