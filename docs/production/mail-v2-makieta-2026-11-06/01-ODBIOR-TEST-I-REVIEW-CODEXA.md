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

## 8. Poprawki po review Codexa (06.11, P1 + P2) — druga runda

**P1 (niezatwierdzone zdjęcia były publiczne).** Każdy upload trafia teraz do PRYWATNEGO bucketa `marketing-photos-pending`
(bez żadnej polityki storage; czyta i pisze wyłącznie funkcja z service_role). Wiersz wersji ma `public_url = NULL` i `published_at = NULL`.
Dopiero `approve` konkretnej wersji wywołuje `publishVersion`: pobiera bajty z prywatnego bucketa, sprawdza sha256 z wiersza,
kopiuje pod TĘ SAMĄ niezmienną ścieżkę do publicznego `marketing-photos` (`upsert:false`, cache rok), ustawia `public_url`/`published_at`
(jedyne przejście dozwolone przez trigger niezmienności) i usuwa kopię prywatną. Kampania, podgląd, rotacja i panel używają wyłącznie
wersji opublikowanych; zatwierdzenie kampanii z wersją nieopublikowaną = 409 `photo_version_not_approved`.

**P2 (nowy kadr dziedziczył zatwierdzenie).** `marketing_photos.approved_version_id` = konkretna zatwierdzona i opublikowana wersja.
`current_version_id` = ostatnio wgrany plik. Upload nowej wersji zatwierdzonego zdjęcia zostawia status `ready` i `approved_version_id`
na starym kadrze (rotacja i wybór dalej biorą v1), a v2 czeka prywatnie na `approve { photo_id, version_id }`. Panel pokazuje
„Nowy kadr (wersja N) czeka na zatwierdzenie” i osobny przycisk; miniatura i okno wyboru zawsze z wersji zatwierdzonej.

**Migracja** `20261107110000_marketing_photo_versions_approval.sql` (tylko baza testowa): `public_url` nullable + `published_at/by`
+ check (adres tylko z `published_at`), nowy trigger (publikacja pending→published; cofnięcie publikacji wyłącznie dla wersji
nieużywanej przez kampanie ani niezatwierdzonej; wszystko inne odrzucane; DELETE nadal zabroniony), `approved_version_id`
z backfillem dla `ready`, prywatny bucket. Kolejność w pliku: nowy trigger PRZED backfillem (stary odrzuciłby update).

**Porządki na bazie testowej** (`scripts/marketing-photos-unpublish-pending.mjs`, po sprawdzeniu użycia): 20 wersji zdjęć pending
cofnięte do prywatnego bucketa (żadna nie była użyta w kampanii ani zatwierdzona), 18 zatwierdzonych zostało opublikowanych.
Kontrola na bazie testowej po porządkach: 20/20 plików pending niedostępnych anonimowo pod publicznym adresem (HTTP 400),
prywatny bucket bez logowania i z kluczem anon = 400, zalogowany dostawca i admin nie czytają prywatnego bucketa, 18/18 zatwierdzonych
pobieralnych (200), wszystkie 38 bez EXIF/XMP/IPTC/ICC, katalogi w storage: publiczny 18 / prywatny 20.

**Regresje dodane:** `tests/marketing-photos-fn.test.js` (upload → tylko prywatny bucket, bez adresu; approve publikuje pod tą samą
ścieżką z weryfikacją sha256 i usuwa kopię prywatną; niezgodny sha256 = STOP bez publikacji; sekwencja approve v1 → upload v2 → lista/
rotacja na v1, v2 prywatna → approve v2 przełącza, v1 zostaje opublikowana; wersja innego zdjęcia 404; enable bez zatwierdzonej wersji 409),
`tests/marketing-campaign-photo.test.js` (set_photo bierze zatwierdzoną v1 mimo wgranej v2; zdjęcie bez zatwierdzonej wersji 409;
zatwierdzenie kampanii z wersją nieopublikowaną / inną niż zatwierdzona = 409 bez wiadomości), `tests/marketing-photos-lib.test.js`
(pula = tylko approved_version_id), `scripts/marketing-photos-sql-smoke.mjs` (wersja po wgraniu bez adresu, publikacja, zmiana sha256/adresu
odrzucona, nowy kadr nie zmienia approved, cofnięcie publikacji wersji użytej odrzucone, prywatny bucket), komponent (kadr prywatny bez
miniatury, osobny przycisk zatwierdzenia nowego kadru, miniatura z v1).

## 9. Poprawki po review Codexa 31ba803 (trzecia runda, 3 luki P2)

1. **Podgląd kadru przed zatwierdzeniem.** `list` zwraca przy każdej wersji oczekującej `pending_version.preview`: dla wersji prywatnej
   podpisany adres z bucketa `marketing-photos-pending` (TTL 600 s, tworzony service_role wyłącznie po `requireAdmin`), dla wersji
   opublikowanej stały adres publiczny. Nowa akcja `preview_version { version_id }` robi to samo dla jednej wersji. Panel: zdjęcie
   oczekujące pokazuje prawdziwy kadr zamiast szarego pola; przy podmianie karta pokazuje miniaturę zatwierdzonej v1 ORAZ podgląd
   nowego kadru v2 obok ostrzeżenia i przycisku „Zatwierdź nowy kadr (v2)”. Notka o 10-minutowej ważności adresu.
2. **Przerwane zatwierdzenie.** Wersja ≠ `approved_version_id` jest „oczekująca” także wtedy, gdy jest już opublikowana
   (`pending_version.published = true`): przycisk zatwierdzenia nie znika, panel pokazuje czerwoną notkę „opublikowana, ale zatwierdzenie
   nie zostało zapisane”, a ponowny `approve` nie wgrywa pliku drugi raz (`publishVersion` idempotentna) i tylko domyka
   `approved_version_id`. Regresja: awaria zapisu zdjęcia po publikacji → 500 → lista z `published:true` → ponowienie 200 bez uploadu.
3. **Sprzątanie ponawialne.** `unpublishVersion`: kopia do prywatnego → usunięcie publicznego (z kontrolą, że obiekt faktycznie zniknął) →
   dopiero wtedy zapis wiersza. Nieudane usunięcie zostawia wiersz `published`, więc kolejne uruchomienie skryptu wraca do wersji; gdy
   publiczny obiekt już nie istnieje po częściowej próbie, bajty idą z kopii prywatnej; brak obiektu w obu bucketach = STOP.
   Regresje w `tests/marketing-photo-data.test.js` (10 testów): idempotencja publikacji, plik już w publicznym, sha256, nieudane usunięcie
   + ponowienie, Storage „OK bez usunięcia”, awaria zapisu wiersza + ponowienie, brak obiektu, podpisane podglądy.

## 10. Poprawki po review Codexa e3f14b3 (czwarta runda, narzędzie porządkowe: P1 + P2)

**Trwały, ponawialny stan wycofywania publikacji (migracja `20261107120000_marketing_photo_unpublish_state.sql`, tylko baza testowa):**
* `marketing_photo_versions.unpublishing_at/by` — stan „wycofywanie w toku”.
* `marketing_photo_version_claim_unpublish(version_id, by)` — JEDEN atomowy UPDATE: zajmuje tylko wersję opublikowaną, nieużywaną przez
  żadną kampanię (`photo_version_id`, `frozen_photo`) i niebędącą zatwierdzoną wersją zdjęcia; ponowne zajęcie już zajętej = sukces
  (ponawialność). `marketing_photo_version_release_unpublish` zwalnia stan (plik nadal publiczny). Obie tylko dla service_role.
* Triggery w bazie na czas zajęcia: `marketing_campaigns` (insert/update `photo_version_id`) i `marketing_photos` (`approved_version_id`)
  odrzucają wersję nieopublikowaną albo wycofywaną — wyścig „kampania przypisała zdjęcie po wstępnej kontroli skryptu” jest zamknięty
  w bazie, nie w kodzie. Cofnięcie publikacji (`published_at → NULL`) wymaga wcześniejszego zajęcia (trigger niezmienności); po cofnięciu
  stan jest zerowany.
* Kolejność w `unpublishVersion`: **zajęcie w bazie → kopia do prywatnego → usunięcie publicznego → kontrola → wiersz**. Plik jest dotykany
  dopiero po zajęciu. `isPublished()` zwraca false dla wersji wycofywanej, więc `set_photo`, zatwierdzenie kampanii, podgląd i `approve`
  wersji (409 `version_unpublishing`) odmawiają także po stronie funkcji.

**Klasyfikacja błędów Storage (`isNotFoundError`):** za „brak pliku” uchodzi wyłącznie jednoznaczny not-found (statusCode/status 404 albo
komunikat „Object not found”/„not_found”); 401/403/408/429/5xx, timeout i każdy inny błąd zatrzymują operację ze stanem zajętym do ponowienia
(`--release <version_id>` w skrypcie zwalnia ręcznie). Ta sama zasada dotyczy kontroli po usunięciu.

**Regresje:** `tests/marketing-photo-data.test.js` (15): wyścig z przypisaniem → odmowa zajęcia, plik nietknięty; 503 przy pobraniu →
STOP i ponowienie po ustąpieniu awarii; 403 przy kontroli po usunięciu → STOP; cofnięcie bez zajęcia odrzucone; release; klasyfikacja
błędów. SQL smoke na PGlite: zajęcie odmówione dla użytej/zatwierdzonej, blokady przypisania/zatwierdzenia/nowej kampanii w trakcie
wycofywania, przypisanie wersji nieopublikowanej odrzucone na poziomie bazy, wyścig po przypisaniu, zwolnienie i domknięcie stanu,
uprawnienia RPC. Funkcja: `approve` wersji wycofywanej = 409.

Baza testowa po migracji: 79 migracji w rejestrze, skrypt porządkowy nie ma nic do cofnięcia (18 opublikowanych i zatwierdzonych, 20 prywatnych).

## 11. Poprawki po review Codexa 7fa031f (piąta runda: wspólna blokada + bezpieczny release)

**P1 — wyścig transakcji.** Migracja `20261107130000_marketing_photo_unpublish_locks.sql` (tylko baza testowa): wszystkie trzy operacje
biorą blokadę TEGO SAMEGO wiersza `marketing_photo_versions`:
* zajęcie do wycofania: `SELECT … FOR UPDATE` (czeka na blokady współdzielone), a DOPIERO PO uzyskaniu blokady osobna instrukcja
  sprawdza użycie (świeża migawka READ COMMITTED widzi zatwierdzone w międzyczasie przypisanie) i dopiero potem UPDATE;
* strażnicy przypisania (`photo_version_id` ORAZ `frozen_photo`) i zatwierdzenia (`approved_version_id`): `SELECT … FOR SHARE` — czekają
  na trwające zajęcie i oceniają NAJNOWSZY wiersz (locking read), więc po commicie zajęcia widzą `unpublishing_at` i odrzucają.
Dwie transakcje nie mogą obie przejść: albo przypisanie zdąży (zajęcie po blokadzie zwraca false), albo zajęcie zdąży (przypisanie
po blokadzie dostaje wyjątek).

**Test równoległości na prawdziwym Postgresie** (`scripts/marketing-photos-race-test.mjs`, trzy niezależne połączenia `pg`, BEGIN
w dwóch, celowe przeplatanie z czekaniem na blokadzie; wrapper `tests/marketing-photos-race.integrated.test.js` pod `FM_RACE_TEST=1`):
1. A zajmuje bez commitu → B przypisuje → B CZEKA na blokadzie → A commit → B odrzucone przez strażnika.
2. B przypisuje bez commitu → A zajmuje → A CZEKA → B commit → zajęcie = false (widzi przypisanie po blokadzie).
3. jak 1, ale B zatwierdza wersję (`approved_version_id`) → B czeka → odrzucone.
4. jak 2, ale B zatwierdza → zajęcie = false.
5. dwa równoległe zajęcia → drugie czeka, oba true (ponawialność), bez zakleszczenia.
Wynik na bazie testowej: WSZYSTKO OK (wiersze „ZZZ TEST wyścig blokad” zostają: zdjęcie disabled, kampania closed, wersja bez pliku —
wersji nie da się usunąć przez niezmienność).

**P2 — `--release`.** `releaseUnpublish` przed zwolnieniem stanu ładuje wersję, sprawdza, że publiczny obiekt istnieje i ma sha256
z wiersza; gdy go nie ma (jednoznaczny not-found), a jest kopia prywatna z poprawnym sha256 — PRZYWRACA plik pod ten sam adres
(`upsert:false`) i weryfikuje po odczycie; gdy nie ma kopii, sha256 się nie zgadza albo Storage odpowiada błędem innym niż not-found —
ODMOWA (stan zostaje zajęty, trzeba dokończyć wycofanie skryptem). Regresje w `tests/marketing-photo-data.test.js`: przywrócenie
z kopii prywatnej, odmowa bez kopii, zły sha256 kopii, 503, zły sha256 publicznego, wersja niezajęta.

## 12. Poprawki po review Codexa e4513f2 (szósta runda: koniec `--release`)

Zgodnie z zaleceniem: bezpieczne zwalnianie nie jest teraz potrzebne, więc `--release` zostało USUNIĘTE w całości — z kodu
(`releaseUnpublish`), ze skryptu porządkowego i z bazy (migracja `20261107140000_marketing_photo_drop_release.sql`, tylko baza testowa:
`drop function marketing_photo_version_release_unpublish`). Stan `unpublishing_at` kończy WYŁĄCZNIE dokończone wycofanie publikacji
(trigger zeruje go przy `published_at → NULL`); wycofanie jest idempotentne i ponawialne, więc „utknięty” stan rozwiązuje ponowne
uruchomienie skryptu, nigdy wyzerowanie znacznika. Dodatkowo: service_role straciło UPDATE kolumn `unpublishing_at/by` (ustawia je tylko
RPC claim), a trigger niezmienności odrzuca wyzerowanie albo zmianę ustawionego `unpublishing_at` nawet dla właściciela bazy.

**Regresja wzajemnego wykluczania (dwa przebiegi tej samej wersji, `tests/marketing-photo-data.test.js`):**
* zatrzymanie pierwszego przebiegu PRZED usunięciem publicznego → równoległy drugi przebieg (ponowne zajęcie = sukces) kończy wycofanie →
  wznowienie pierwszego: usuwa (obiektu już nie ma), kontrola potwierdza brak, zapis wiersza = 0 wierszy → błąd „row not updated”,
  stan końcowy spójny (plik tylko prywatny, wiersz wycofany, nic nie odblokowane);
* zatrzymanie PO usunięciu, przed zapisem wiersza → drugi przebieg domyka z kopii prywatnej → wznowienie pierwszego nie zmienia stanu;
* bezpośrednie wyzerowanie `unpublishing_at` odrzucone (mock triggera), stan kończy tylko `unpublishVersion`.
SQL smoke: funkcja release nie istnieje, wyzerowanie/zmiana `unpublishing_at` odrzucone triggerem, service_role bez UPDATE na tych kolumnach,
wyścig po przypisaniu nadal zamknięty. Test wyścigu dwóch połączeń (`marketing-photos-race-test.mjs`) resetuje stan między scenariuszami
przez dokończenie wycofania i ponowną publikację wiersza logicznego; wiersz testowy kończy jako wycofany.

## 13. Decyzja Artura: wycofanie wersji jest NIEODWRACALNE (siódma runda)

Migracja `20261107150000_marketing_photo_unpublish_final.sql` (tylko baza testowa): trwały znacznik `marketing_photo_versions.unpublished_at`,
ustawiany WYŁĄCZNIE przez trigger w chwili zakończenia wycofania (`published_at → NULL`); nie da się go wyzerować, zmienić ani ustawić ręcznie.
Trigger odrzuca ponowną publikację wersji z tym znacznikiem („create a new version with a new path”); RPC zajęcia zwraca false dla wersji
wycofanej; strażnicy kampanii/zatwierdzenia i tak jej nie przyjmą (nieopublikowana). W kodzie `publishVersion` robi ŚWIEŻY odczyt wiersza
PRZED jakąkolwiek operacją Storage i odmawia dla wersji wycofanej lub wycofywanej (nawet gdy wywołujący trzyma stary obiekt), a UPDATE
publikacji ma dodatkowy warunek `unpublished_at is null`; `approve` wersji wycofanej = 409 `version_unpublished`; lista nie pokazuje jej jako
oczekującej. Ponowne użycie zdjęcia = nowa wersja z nową ścieżką (upload → approve) — publikuje się normalnie. `--release` nie wraca.

**Regresja (zalecona):** dwa wycofania (pierwsze zatrzymane przed usunięciem, drugie domyka) → próba ponownej publikacji tej samej wersji
odrzucona przed Storage (0 uploadów, 0 pobrań) i w bazie (trigger) → wznowienie starszego procesu nic nie zmienia („row not updated”, stan
spójny: plik tylko prywatny, znacznik trwały) → trzecie wycofanie = „already_unpublished” bez dotykania Storage → nowa wersja z nową ścieżką
publikuje się. SQL smoke na PGlite (82 migracje): ponowna publikacja wycofanej odrzucona, znacznik trwały, ręczne ustawienie odrzucone,
zajęcie = false, przypisanie odrzucone, nowa wersja OK. Test wyścigu dwóch połączeń: reset między scenariuszami tworzy NOWĄ wersję logiczną
(i sprawdza, że wycofana nie wraca do publikacji).

## 7. Otwarte / poza zakresem
* `MARKETING_SEND_ALLOWLIST` nadal ustawiona na prod (zdjąć przed prawdziwą kampanią) — bez związku z tą gałęzią.
* Instrukcja administratora (rozdział Marketing) nie opisuje jeszcze biblioteki zdjęć — do uzupełnienia po akceptacji wyglądu.
* Wgrywanie z panelu (canvas, kadr suwakiem) sprawdzone testem komponentu i w kodzie; próba ręczna z prawdziwym plikiem w przeglądarce do wykonania przez Artura/Codexa na podglądzie testowym (`node scripts/dev-test.mjs`, konto `codex.admin@freshmarket.test`).
