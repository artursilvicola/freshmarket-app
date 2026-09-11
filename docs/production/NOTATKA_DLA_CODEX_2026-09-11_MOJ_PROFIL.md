# Do review — „Mój profil” dostawcy: dane osoby znikają po ponownym zalogowaniu (11.09.2026)

Gałąź `fix/fm-supplier-profile-prefill` od `main` f0e68b9 (= produkcja dcfd60b + docs). Wyłącznie frontend panelu dostawcy. Bez migracji, RLS, zmian w bazie. Nie wdrożone.

## Zgłoszenie (KRZYŚ-MAR, przez Annę)

„Po każdym ponownym zalogowaniu znikają dane kontaktowe z profilu, nawet jeśli wcześniej uzupełnią je na nowo. W zakładce B2B wszystko działa.”

## Diagnoza

- W bazie dane **są**: `profiles` firmy KRZYŚ-MAR ma `name = Agnieszka Piechaczek`, `position = Handlowiec`, telefon 9 cyfr, `updated_at` 10.09 15:45 (minutę po logowaniu 15:44). Admin widzi je w „Operator konta”. Zapis (`updateOwnSupplierProfile` → `profiles` po `auth.uid()`) działa.
- Błąd jest w **wczytywaniu**: `PageSupplierProfile` inicjalizował formularz z `account` (`account.name`, `account.phone`, `account.position`), a `buildAccountFromCurrentUser` dla dostawcy nie kopiował `phone`/`position` z profilu, zaś `account.name` to **nazwa firmy** (`company_name || name`). Efekt po każdym logowaniu: pole „Imię i nazwisko” = nazwa firmy, telefon i stanowisko puste — dostawca wpisuje od nowa, zapis się udaje, przy następnym logowaniu znów to samo. Kupiec ma osobną ścieżkę (`buyer` z `currentUser.phone/position`) i tego błędu nie ma.

## Zmiana (`src/legacy/PreconnectFM.jsx`)

- `buildAccountFromCurrentUser` (dostawca): `personName`, `phone`, `position` z `currentUser` (+ zależności `currentUser?.phone/position`); przebudowa `account` porównuje też te pola.
- `PageSupplierProfile`: formularz z `account.personName/phone/position/email`; efekt synchronizuje formularz z `account`, gdy nie ma edycji w toku (`dirty`); po udanym zapisie `onSaved(saved)` → `setAccount` w App (bez ponownego logowania dane zostają). `account.name` nadal = nazwa firmy (nagłówek, pole „Firma”).
- `export` na `PageSupplierProfile` tylko na potrzeby testu.

## Testy

`src/legacy/SupplierProfilePrefill.test.jsx` (4): wypełnienie z profilu (osoba ≠ firma), stary kształt `account` → puste pola bez błędu, doczytany profil wypełnia formularz, ale nie kasuje edycji w toku; zapis → `updateOwnSupplierProfile` + `onSaved` z danymi po normalizacji + toast. `npm test` **136/136**, `npm run build` OK, `git diff --check` OK. Bez podglądu w przeglądarce (wymaga konta dostawcy) — renderowanie sprawdzone testem.

## Uwaga poboczna

`account.name` dla dostawcy to nazwa firmy — każdy przyszły ekran „osoby” musi czytać `account.personName`. Warto to zapisać w handoverze IT (§5.2/6.2).

## Do decyzji

Wdrożenie (osobny deploy, bez migracji) po review i zgodzie Artura. Po wdrożeniu: informacja do KRZYŚ-MAR, że dane są zapisane i po zalogowaniu będą widoczne; nie muszą nic wpisywać ponownie.
