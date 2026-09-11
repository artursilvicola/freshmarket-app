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

## Zmiana

- `src/lib/company-profile.js` (nowy): `companySaveBlockers(company, { nipRequired })` → `["logo"|"nip"]` — jedno źródło dla blokady w `saveProfile` i dla komunikatu w UI.
- `PageCompany`: ramka nad przyciskami „Podgląd kupca / Zapisz profil” („Zanim zapiszesz: Wgraj logo firmy.”) widoczna od razu, dopóki wymagania nie są spełnione; `saveProfile` używa tej samej listy i tego samego tekstu w toaście; opisy oznaczają formularz jako zmieniony (`setDirty`).
- App: toast `flash` w obudowie `position: sticky; top: 8px` — widoczny także po przewinięciu strony (wszystkie panele; treść i czas 3,8 s bez zmian).
- i18n: `supplier.company.actions.blocked_title` PL/EN; poprawione dwa teksty PL sekcji certyfikatów.
- `export` na `PageCompany` tylko na potrzeby testu.

**Nie zmieniam reguły** „logo wymagane do zapisu” — to decyzja produktowa (patrz niżej).

## Testy

- `src/lib/company-profile.test.js` (3): brak logo, brak NIP za flagą, komplet/pusty rekord.
- `src/legacy/CompanyProfileFeedback.test.jsx` (3, react-test-renderer): bez logo → ramka z powodem, klik „Zapisz” → toast ostrzegawczy, `updateCompany` niewołane; z logo i NIP → brak ramki, zapis do bazy + „Profil zapisany.”; wpisany opis nie ginie przy odświeżeniu rekordu firmy w tle (ten sam id).
- `npm test` **142/142**, `npm run build` OK, `git diff --check` OK. Bez podglądu w przeglądarce (konto dostawcy) — render sprawdzony testami.

## Do decyzji (Artur)

1. Czy brak logo ma nadal **blokować** zapis całego profilu? Alternatywa: zapis zawsze możliwy, brak logo tylko jako ostrzeżenie (karty planu i katalog mają fallback na inicjały). Zmiana to jedna linia w `saveProfile` (ostrzeżenie zamiast `return`) + tekst.
2. Wdrożenie tej poprawki (osobny deploy, bez migracji) po review i zgodzie.
3. Odpowiedź dla Anny: zapis zatrzymał wymóg logo; po wgraniu logo (sekcja „Logo firmy” na górze profilu) zapis przejdzie. Po wdrożeniu komunikat będzie widoczny przy przycisku.
