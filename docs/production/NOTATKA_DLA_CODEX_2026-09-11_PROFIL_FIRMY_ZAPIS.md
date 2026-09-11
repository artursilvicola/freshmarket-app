# Do review — „Profil firmy”: zapis bez widocznej informacji, wpisany opis „znika” (11.09.2026)

Gałąź `fix/fm-company-profile-feedback` od `main` 8a11db4 (= produkcja 943e130 + docs). Wyłącznie frontend panelu dostawcy + 3 teksty i18n. Bez migracji, RLS, zmian w bazie. Nie wdrożone.

## Zgłoszenie (Anna Wiernicka, konto wierniccy.co, 11.09 14:51–14:54)

Wylogowanie/zalogowanie → wpisany „opis proba 11.09 godz 14:51” w „Opis krótki” → „Podgląd kupca” pokazuje tekst → „Zapisz profil”: brak jakiejkolwiek informacji, po chwili pole puste.

## Diagnoza (kod + odczyt bazy)

1. **Zapis w ogóle nie ruszył.** `saveProfile` zaczyna od `if(!c.logo){ fl("Wgraj logo firmy.","warning"); return; }`. Firma wierniccy.co **nie ma logo** (`logo_url is null`, podgląd pokazuje awatar „W”), NIP ma. `companies.updated_at` = 09.07 — dziś nic nie zapisano.
2. **Komunikat był niewidoczny.** Toast (`flash`) renderuje się na górze `<main>` w zwykłym przepływie strony; przycisk „Zapisz profil” jest na samym dole długiego formularza, więc po kliknięciu użytkownik nie widzi nic. To samo dotyczy „Profil zapisany.” po udanym zapisie i błędów.
3. **Tekst „zniknął”, bo strona została przeładowana.** `profiles.last_active_at` = 14:54 (RPC `touch_last_active` woła się przy starcie aplikacji), logowanie 14:51 — o 14:54 aplikacja wystartowała ponownie (odświeżenie / ponowne wejście). Niezapisany szkic przepadł. Kod nie czyści formularza po nieudanym zapisie.
4. Poboczne: pola „Opis krótki/standardowy” zmieniały stan przez `setC` **bez** `setDirty(true)` (inne pola idą przez `u()`), więc mechanizm ochrony szkicu ich nie obejmował; oraz mojibake w PL: `supplier.company.certs.info` („ktĂłre… pokazaÄ‡… certyfikatĂłw”) i `certs.custom_hint` („JeĹ›li… wiÄ™cej niĹĽ”) — widoczne na zrzucie Anny.

Skala: 7 firm z FM B2B nie ma logo (Yuksel Seeds, Paweko, wierniccy.co, Moolenaar, Fresh roots, AGROSAD, Grupa Producentów Agros) — żadna z nich nie może dziś zapisać profilu firmy i żadna nie widzi dlaczego. Braku NIP nie ma w żadnej firmie FM. KRZYŚ-MAR (aktywny rekord) ma logo i NIP — ich wczorajsze zgłoszenie to osobny, już wdrożony błąd „Mój profil”.

## Zmiana (wersja po decyzji 11.09: braki NIE blokują zapisu)

- `src/lib/company-profile.js` (nowy): `companyProfileGaps(company, { nipRequired })` → `["logo"|"nip"]` — jedno źródło dla ostrzeżenia w UI i toastu po zapisie.
- `PageCompany`: „Zapisz profil” **zawsze zapisuje** uzupełnione pola (usunięte wczesne `return` przy braku logo/NIP). Nad przyciskami ramka „Profil zostanie zapisany, ale nie jest kompletny. Uzupełnij logo firmy i NIP.” (lista dynamiczna); po zapisie toast „Profil zapisany. Nie jest jeszcze kompletny — uzupełnij …” (ostrzeżenie) albo zwykłe „Profil zapisany.”. Opisy oznaczają formularz jako zmieniony (`setDirty`).
- NIP pozostaje wymagany osobno przy zakupie pakietu (payment modal, `NIP_REQUIRED`) — bez zmian.
- App: toast `flash` w obudowie `position: sticky; top: 8px` — widoczny także po przewinięciu strony (wszystkie panele; treść i czas 3,8 s bez zmian).
- i18n: `supplier.company.actions.incomplete_notice`, `toasts.saved_incomplete`, `gaps.{logo,nip,joiner}` PL/EN; poprawione dwa teksty PL sekcji certyfikatów; klucze `toasts.logo_required/nip_required` zostają (nieużywane w PageCompany).
- `export` na `PageCompany` tylko na potrzeby testu.

## Testy

- `src/lib/company-profile.test.js` (3): brak logo, brak NIP za flagą, komplet/pusty rekord.
- `src/legacy/CompanyProfileFeedback.test.jsx` (4, react-test-renderer): bez logo → ostrzeżenie nad przyciskiem, zapis idzie do bazy z wpisanym opisem, toast „niekompletny”; bez logo i NIP → obie pozycje, zapis przechodzi; z logo i NIP → brak ostrzeżenia, „Profil zapisany.”; wpisany opis nie ginie przy odświeżeniu rekordu w tle.
- `npm test` **143/143**, `npm run build` OK, `git diff --check` OK.

## Decyzja (Artur/Codex, 11.09)

Brak logo i brak NIP nie blokują zapisu profilu — są ostrzeżeniem o niekompletnym profilu. Wdrożenie: merge `fix/fm-company-profile-feedback` → `main`, osobny deploy bez migracji. Po wdrożeniu test na koncie `wierniccy.co`: wpisanie opisu → zapis → odświeżenie → ponowne logowanie. Tekst Anny z 14:51 nie został zapisany — trzeba go wpisać ponownie.
