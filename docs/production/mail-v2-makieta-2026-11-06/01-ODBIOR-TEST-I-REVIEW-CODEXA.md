# Mail v2 + biblioteka zdjęć — odbiór na środowisku testowym i pakiet do review Codexa (06.11.2026)

Gałąź: `feat/marketing-photos`. **Tylko środowisko testowe** (Supabase `rruszzdffclfhbtfeznb`, `.env.test`).
Bez wysyłki maili, bez scalania do `main`, bez wdrożenia produkcyjnego. Makieta wyglądu **nie jest** zatwierdzona przez
Artura — do osobnej akceptacji na podstawie zrzutów w `zrzuty-test/`.

## 1. Co zostało zbudowane

| Obszar | Pliki |
|---|---|
| Migracja (tylko baza testowa) | `supabase/migrations/20261107100000_marketing_photos.sql` — sha256 `953943331e29bdfe83363b81347cf66898ab60a4d49656dcd97f699ab6edcbb3` |
| Logika czysta (bez I/O) | `netlify/functions/_shared/marketing-photos.js` — prawdziwy format/wymiary z bajtów, limity wersji do maila, rotacja, zamrożenie, dHash |
| Odczyt biblioteki (service_role) | `netlify/functions/_shared/marketing-photo-data.js` |
| Funkcja Netlify (jedyna droga zapisu do bucketa) | `netlify/functions/marketing-photos.js` — list / upload / approve / update / disable / enable / suggest / usage |
| Szablon v2 | `netlify/functions/_shared/marketing-templates.js` — `renderMarketingTemplate({layoutVersion: 2, photo})`, `DEFAULT_CONTENT_V2`, `V2_TEXT`, zielone logo `public/brand/fm-email-logo-green.png` |
| Kampania | `netlify/functions/marketing-campaign.js` — `create` (układ 2 + zdjęcie z rotacji), `set_photo`, `approve` (zamrożenie `frozen_photo`), `get` (zdjęcie) |
| Podgląd / test | `netlify/functions/marketing-preview.js`, `marketing-send.js` (test renderuje z zamrożenia) |
| Panel | `src/components/admin/MarketingPhotoLibrary.jsx` (zakładka „Biblioteka zdjęć”), `MarketingActivation.jsx` (zakładki, kafelek zdjęcia, okno wyboru), `src/lib/marketing-photo-prep.js` (kadr/skalowanie/dHash/sha256 w przeglądarce), i18n PL/EN (+97 kluczy `admin.marketing.*`) |
| Skrypty | `scripts/marketing-photos-seed.mjs` (zasiew 38 oryginałów na bazę testową), `scripts/marketing-photos-sql-smoke.mjs` (PGlite) |
| Testy | `tests/marketing-photos-lib.test.js`, `tests/marketing-photos-fn.test.js`, `tests/marketing-templates-v2.test.js`, `tests/marketing-campaign-photo.test.js`, `tests/marketing-photos.integrated.test.js`, `src/lib/marketing-photo-prep.test.js`, `src/components/admin/MarketingPhotoLibrary.test.jsx`, `tests/fixtures/image-headers.js` |

### Model danych
* `marketing_photos` — metadane: tytuł, alt PL/EN, podpis PL/EN, rodzaj (`authentic`/`ai`), pochodzenie, prawa, kategorie, rok,
  `status` (`pending` → `ready` → `disabled`), `review_note`, `source_sha256` (unikalny — duplikat oryginału), `dhash`, `current_version_id`.
* `marketing_photo_versions` — **niezmienne** wersje plików (trigger odrzuca update/delete; service_role bez update/delete;
  unikalna `storage_path`). Nowy plik = nowa wersja = nowa ścieżka `photos/<photo_id>/v<n>-<sha12>.jpg`.
* `marketing_campaigns` + `photo_id`, `photo_version_id`, `layout_version` (1 = stary układ, default dla istniejących wierszy; 2 = ze zdjęciem),
  `frozen_photo` (jsonb: id zdjęcia i wersji, adres HTTPS, alt/podpis PL/EN, wymiary, sha256).
* widok `marketing_photo_usage` (security_invoker) — kampanie per zdjęcie z `sent_count` (tylko prawdziwe, `accepted`, bez testów).
* bucket `marketing-photos`: publiczny ODCZYT, 2 MB, jpeg/png/webp; **brak** polityk insert/update/delete (zapis wyłącznie funkcją z service_role).

### Zasady
* Jedno zdjęcie na kampanię, wspólne PL/EN (alt/podpis w języku maila).
* Rotacja (`pickPhoto`): tylko `ready` z plikiem → najpierw spoza 4 ostatnich kampanii, które **faktycznie wysyłały** → nieprzypisane do innych
  otwartych kampanii (draft/approved/sending) → nigdy niewysłane (najstarsze wgranie) → najdawniej wysłane. Ostrzeżenia: `pool_small` (< 5),
  `all_recent`, `all_assigned_elsewhere`, `no_ready_photos`. Ręczny wybór dozwolony (`set_photo`), zmiana zdjęcia podbija `content_version`.
* Zatwierdzenie kampanii: pierwszy warunkowy UPDATE zapisuje `frozen_content` (układu 2) **i** `frozen_photo` w jednej operacji; wiadomości
  renderowane wyłącznie z zamrożenia. Zdjęcie wyłączone/bez pliku w chwili zatwierdzenia = 409 (administrator wybiera inne), nigdy „bez zdjęcia po cichu”.
* Wyłączenie zdjęcia / nowa wersja pliku nie dotyka starych maili (HTML zamrożony w `marketing_messages`, plik zostaje, adres niezmienny).
* Stare kampanie (`layout_version = 1`) renderują dotychczasowy szablon (ciemny nagłówek, białe logo, długa treść) — bez zmian.
* Nie jest to ogólny edytor newsletterów: edytowalne pozostają temat / treść (powitanie + dwa zdania) / przycisk; hasło, dopisek, pasek mailingu,
  pomoc, zasady kredytów i stopka są stałe.

## 2. Wyniki testów (06.11, 18:10)
* `PGLITE_PATH=… npx vitest run` → **114 plików testów przeszło, 1 pominięty** (`marketing-preview-isolation.integrated` wymaga startu podglądu), **966 testów OK, 2 pominięte**.
* `scripts/marketing-sql-smoke.mjs` (łańcuch 77 migracji + RPC marketingu) → WSZYSTKO OK.
* `scripts/marketing-photos-sql-smoke.mjs` → WSZYSTKO OK (idempotencja migracji, unikalność ścieżki/oryginału, trigger niezmienności,
  kolumny kampanii, widok użycia liczy tylko prawdziwe wysyłki, FK restrict, RLS: dostawca 0 / admin 1, service_role bez delete/update wersji,
  bucket publiczny 2 MB z jedną polityką SELECT).
* `npx vite build` → OK.
* Baza testowa: `node scripts/marketing-test-env.mjs` → migracja zastosowana (1 nowa, 77 w rejestrze); `node scripts/marketing-photos-seed.mjs`
  → 38 dodanych (18 `ready`, 20 `pending`), 0 błędów.

## 3. Kontrola punktów Artura na bazie testowej (skrypt jednorazowy, wynik WSZYSTKO OK)
| Punkt | Wynik |
|---|---|
| 18 zatwierdzonych do wyboru, 20 zapasowych nieaktywne | `ready` 18 / `pending` 20; każde pending z notatką „zapas — do przeglądu”; okno wyboru i rotacja biorą wyłącznie `ready` (test UI: 2 z 4 kart w oknie) |
| Rotacja omija ostatnie użycia i uwzględnia otwarte kampanie | testy `pickPhoto` (4 ostatnie wysyłające, kampania bez wysyłki nie liczy się, inne otwarte kampanie niżej, własna kampania wyłączona z liczenia, ostrzeżenia) + test funkcji `suggest` |
| Zatwierdzenie zamraża zdjęcie, podpis i alt z treścią | test approve: `frozen_photo` (url HTTPS, alt/podpis PL/EN, wersja) w tym samym UPDATE co `frozen_content`; wiadomości PL/EN zawierają zamrożony adres i alty |
| Zmiana/wyłączenie zdjęcia nie zmienia wcześniejszych wiadomości | SQL: wyłączenie zdjęcia → `frozen_photo` kampanii bez zmian; test: ponowne approve po wyłączeniu i podmianie altu renderuje ze starego zamrożenia; wersje niezmienne (trigger) |
| Ponowienie wysyłki zachowuje ten sam HTML i obraz | batch wysyła zapisany `html` z rejestru i sprawdza `payload_hash` (bez zmian); test z adresu zespołu renderuje z `frozen_content` + `frozen_photo` |
| Stare kampanie korzystają z dotychczasowego szablonu | 12 kampanii sprzed 06.11 na bazie testowej ma `layout_version = 1`; test approve układu 1 → ciemny nagłówek, długa treść, bez zdjęcia |
| Pliki bez EXIF/GPS, zapis tylko administratorowi | 38/38 plików bez EXIF/XMP/IPTC/ICC, 1200×800 JPEG ≤ 200 KB; upload do bucketa i insert do tabel odrzucone dla anon, zalogowanego dostawcy **i zalogowanego admina** (zapis idzie wyłącznie przez funkcję `marketing-photos` po `requireAdmin`); odczyt tabel: admin 38 wierszy, dostawca 0 |

**Publiczna dostępność zdjęć na bazie testowej: TAK.** Wszystkie 38 plików są pobieralne bez logowania pod stałym adresem
`https://rruszzdffclfhbtfeznb.supabase.co/storage/v1/object/public/marketing-photos/photos/<id>/v1-<sha12>.jpg`
(HTTP 200, `cache-control: public, max-age=31536000`). To zamierzone — klient poczty musi pobrać obraz bez logowania; panel ostrzega o tym
przy wgrywaniu. Tak samo będzie na produkcji po wdrożeniu.

## 4. Zrzuty (zrzuty-test/)
* `mail-pl-komputer-640.png`, `mail-en-komputer-640.png` — finalny mail z bazy testowej (kampania „Mają kredyty, brak propozycji | #13”, firma TEST Sad Kowalski, zdjęcie z rotacji 2025/0137).
* `mail-pl-telefon-375.png`, `mail-en-telefon-375.png` — ten sam mail w szerokości telefonu (375 px).
* `panel-biblioteka-zdjec.jpg`, `panel-biblioteka-karty.png` — zakładka Biblioteka zdjęć (38 zdjęć, 18 w rotacji, ostrzeżenie o publicznym adresie).
* `panel-kampania-kafelek-zdjecia.jpg`, `panel-podglad-modal.jpg` — kafelek zdjęcia w kampanii i podgląd w panelu.
* Źródła: `podglad-testowy-pl.html`, `podglad-testowy-en.html` (HTML z funkcji `marketing-preview`; logo podmienione na kopię lokalną do zrzutu).

## 5. Do decyzji Artura (osobna akceptacja wyglądu)
1. Układ v2 (jasny nagłówek, zdjęcie, hasło „Pierwszy krok do nowej sieci handlowej.”, dwa zdania, pasek daty + przycisk, pomoc, zasady, jasna stopka).
2. Tematy maili zostały **bez zmian** z układu 1 (zatwierdzone 5.11); treści domyślne skrócone do powitania + dwóch zdań per grupa (`DEFAULT_CONTENT_V2`).
3. Podpis archiwalny per rocznik: „Zdjęcie archiwalne: rozmowy B2B na Fresh Market 2025/2026”; alt PL/EN wspólny dla kategorii „rozmowy B2B”.

## 6. Dla Codexa — na co patrzeć
* Migracja: `security_invoker` na widoku (PG15+), trigger niezmienności vs. ewentualne przyszłe porządki; brak polityk zapisu w storage (celowo).
* `marketing-campaign.js`: `set_photo` i `approve` (kolejność: sprawdzenie zdjęcia PRZED warunkowym UPDATE; 409 gdy zdjęcie nieready).
* `marketing-photos.js` `upload`: walidacja z bajtów (`sniffImage`), limity, duplikaty (`source_sha256`, `sha256`, dHash ≤ 6 z `allow_similar`), `upsert:false`, `cacheControl` rok, nowa wersja = nowa ścieżka.
* Przeglądarka (`marketing-photo-prep.js`): canvas → nowy JPEG bez metadanych; oryginał nie opuszcza komputera; sha256 oryginału liczony lokalnie.
* UI: zdjęcie zmienia `content_version` (podgląd ↔ zatwierdzenie spójne), po zatwierdzeniu brak przycisków.
* Uwaga techniczna: w podglądzie testowym (netlify dev, iframe `sandbox`) zielone logo z `http://localhost:8888/brand/…` nie wczytuje się w ramce podglądu panelu; plik jest serwowany (HTTP 200) i w normalnej karcie renderuje się poprawnie — na produkcji adres to `https://b2b.freshmarket.eu/brand/fm-email-logo-green.png` (jak dotychczasowe białe logo).

## 7. Otwarte / poza zakresem
* `MARKETING_SEND_ALLOWLIST` nadal ustawiona na prod (zdjąć przed prawdziwą kampanią) — bez związku z tą gałęzią.
* Instrukcja administratora (rozdział Marketing) nie opisuje jeszcze biblioteki zdjęć — do uzupełnienia po akceptacji wyglądu.
* Wgrywanie z panelu (canvas, kadr suwakiem) sprawdzone testem komponentu i w kodzie; próba ręczna z prawdziwym plikiem w przeglądarce do wykonania przez Artura/Codexa na podglądzie testowym (`node scripts/dev-test.mjs`, konto `codex.admin@freshmarket.test`).
