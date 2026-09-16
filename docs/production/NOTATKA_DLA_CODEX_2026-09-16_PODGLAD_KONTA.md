# Do review — „Mój profil" w podglądzie cudzego konta nadpisywał profil admina (16.09.2026)

Gałąź `fix/profile-impersonation-guard` od `main` 93b5b69 (= produkcja 24564e7 + docs). Frontend paneli + jedna funkcja w `db.js` + teksty PL/EN. Bez migracji, RLS, zmian w bazie. Nie wdrożone.

## Zgłoszenie (Artur, 16.09)

Konto admina `jagoda.knadel@freshmarket.eu` zmieniło imię i nazwisko z „Jagoda Knadel" na „Nancy".

## Co się stało — chronologia z bazy (16.09)

| Godzina | Zdarzenie |
|---|---|
| 11:09 | przy firmie **Fresh roots** (EG, `331dd4bd…`) powstaje kontakt „Nancy Muhammed", stanowisko „commercial director of fresh roots" |
| 11:13 | profil admina Jagody: `name = "Nancy"`, `position = "Muhammed"`, `updated_at` i `last_active_at` = 11:13 |
| 11:18 | zapis firmy Fresh roots (`companies.updated_at`) |

Czyli: admin przełączył się paskiem kont na konto dostawcy **Fresh roots**, uzupełniał jego dane i po drodze wypełnił stronę **„Mój profil"** danymi osoby kontaktowej dostawcy. Zapis trafił na konto admina.

## Przyczyna

`AccountSwitcherBar` (tylko admin) pozwala wejść w panel dowolnego dostawcy/kupca — `switchAccount` podmienia `account`, menu pokazuje pozycje dostawcy, w tym „Mój profil". Tymczasem:

- `updateOwnSupplierProfile(id, patch)` **ignoruje** przekazany identyfikator i zapisuje do profilu z sesji (`auth.getUser()`); komentarz `[fix/supplier-profile-save]` tłumaczy dlaczego (panel podaje `company_id`, nie `id` profilu). W podglądzie oznacza to nadpisanie profilu **zalogowanego admina**.
- Druga, groźniejsza pułapka na tym samym ekranie: `ChangePasswordSection` → `changeOwnPassword` robi re-auth po e-mailu **z sesji** i zmienia hasło zalogowanego użytkownika, a formularz wyżej pokazuje e-mail dostawcy. Admin mógł zmienić sobie hasło w przekonaniu, że zmienia je dostawcy.
- Kupiec: `updateOwnBuyerProfile` zapisuje po przekazanym `id`, więc nie nadpisuje admina, ale sekcja hasła ma ten sam problem.

Konto admina Jagody ma dodatkowo `company_id` wskazujące na jej dawną firmę-rekord „Jagoda Knadel" (suspended) — pozostałość po rejestracji przed promocją na admina; nie ma wpływu na ten błąd.

## Zmiana

- `src/lib/profile-guard.js` (nowy): `isOwnAccount(account, currentUser)` — czy panel pokazuje konto zalogowanego (supplier po `company_id`, buyer po `retailer_id`, admin po `id`); `isOwnProfileTarget({argId, uid, companyId})` dla warstwy danych.
- `App`: `viewingOtherAccount = !isOwnAccount(account, currentUser)` → przekazane do obu stron profilu.
- `PageSupplierProfile` i `PageBuyerProfile` w trybie podglądu: ostrzeżenie „Oglądasz panel innego konta…", pola tylko do odczytu, **brak** przycisku zapisu i **brak** sekcji zmiany hasła; próba zapisu kończy się komunikatem, nie zapisem.
- `db.js` `updateOwnSupplierProfile`: twarda odmowa (`errors.db.profile_not_own`), gdy wskazany identyfikator nie jest ani `auth.uid()`, ani `company_id` zalogowanego — defensywa niezależna od UI.
- i18n PL/EN: `profile.impersonation.notice`, `profile.impersonation.blocked`, `errors.db.profile_not_own`.

Nie zmieniam samego paska przełączania kont ani uprawnień admina — podgląd działa jak dotąd, wyłączona jest tylko edycja „własnego" profilu w cudzym kontekście.

## Testy

- `src/lib/profile-guard.test.js` (5): rozpoznanie własnego konta dla trzech ról, przypadek z 16.09 (admin → konto dostawcy), brak sesji, puste identyfikatory; strażnik zapisu w db.
- `src/legacy/SupplierProfilePrefill.test.jsx` (+2): tryb podglądu — ostrzeżenie, brak przycisku zapisu, brak sekcji hasła, `updateOwnSupplierProfile` niewołane; własne konto działa jak dotąd.
- `npm test` **162/162**, `npm run build` OK, `git diff --check` OK.

## Do decyzji (Artur)

1. Przywrócenie danych konta Jagody: `name = "Jagoda Knadel"`, `position` → puste (poprzedniej wartości nie znamy; „Muhammed" na pewno nią nie było). Jedno zapytanie + wpis w `audit_log`.
2. Wdrożenie poprawki (osobny deploy, bez migracji).
