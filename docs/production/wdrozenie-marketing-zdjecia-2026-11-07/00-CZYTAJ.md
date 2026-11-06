# Wdrożenie: mail v2 + biblioteka zdjęć (wygląd zaakceptowany przez Artura 06.11, zgoda „możesz wdrażać”)

Kod: gałąź `feat/marketing-photos` (ostatni commit po review Codexa: e3a27a6 + poprawka wyszukiwania kampanii w teście wyścigu).
Stan: 7 rund review zamknięte; zmiana logo i końcowy pakiet SQL czekają na review Codexa (`05-DLA-CODEXA.md`). Wygląd maila (PL/EN, komputer i telefon) i wybór zdjęcia pokazane Arturowi 07.11
(`docs/production/mail-v2-makieta-2026-11-06/zrzuty-test/`). **Żaden krok poniżej nie startuje bez akceptacji wyglądu i osobnego „wdrażaj”.**
Kolejność (Codex): **migracje → kod → kontrolowany import zdjęć → próba wyłącznie na dwóch adresach → wyłączenie wysyłki.** Bez masowej wysyłki.
Run w SQL Editor i kliknięcia „Zatwierdź”/„Wyślij” klika Artur. Produkcja = Supabase `sklyfuvzjikkqerxtulo`, Netlify `b2b.freshmarket.eu`.

## Krok 0 — akceptacja wyglądu (Artur)
Zrzuty: `mail-pl-komputer-640.png`, `mail-en-komputer-640.png`, `mail-pl-telefon-375.png`, `mail-en-telefon-375.png`, `app-wybor-zdjecia.jpg`,
`app-kampania-kafelek.jpg`. Do decyzji także: tematy zostawione z układu 1, treści domyślne skrócone do powitania + dwóch zdań, podpis archiwalny per rocznik.

## Krok 1 — migracje (PRZED kodem; 8 plików w tej kolejności, złożone 1:1 w `04-migracje-razem.sql`, jeden Run w SQL Editor prod)
| # | plik | SHA-256 (pierwsze 16) | linii |
|---|---|---|---|
| 1 | `20261107100000_marketing_photos.sql` | `953943331e29bdfe` | 172 |
| 2 | `20261107110000_marketing_photo_versions_approval.sql` | `b302869ada0f6251` | 121 |
| 3 | `20261107120000_marketing_photo_unpublish_state.sql` | `90bf8f3c5d05ab4f` | 154 |
| 4 | `20261107130000_marketing_photo_unpublish_locks.sql` | `94ebf81af028780c` | 84 |
| 5 | `20261107140000_marketing_photo_drop_release.sql` | `d0b00481ec9f99c7` | 84 |
| 6 | `20261107150000_marketing_photo_unpublish_final.sql` | `0ae80708edc0bad2` | 120 |
| 7 | `20261107160000_marketing_suppression_lifts.sql` | `10a2892b49fa7303` | 84 |
| 8 | `20261107170000_marketing_review_fixes.sql` | `ef67a9c2b69525a4` | 120 |
* Przed każdym Run: projekt `sklyfuvzjikkqerxtulo` w adresie karty; plik z repo (`cmp` z gałęzią), nie z kopii.
* `01-kontrola-migracji.sql` PRZED (oczekiwane: 0 tabel zdjęć, bucket brak) i PO każdym etapie (tabela kontrolna w pliku: tabele, kolumny kampanii,
  widok, 2 buckety, 3 triggery, 1 RPC claim, brak funkcji release, liczby kampanii/wiadomości BEZ zmian).
* Wszystkie 8 jest idempotentnych i addytywnych; stary kod (bez zdjęć) działa z nimi dalej (`layout_version` domyślnie 1, kolumny zdjęć NULL). Migracji NIE cofać.
* Próba pakietu: `scripts/marketing-photos-deploy-check.mjs` na schemacie SPRZED tych migracji (76 plików) z danymi jak na produkcji: kontrola przed, plik łączony, kontrola po, drugi Run, reaktywacja, sprzątanie.

## Krok 2 — kod
* Przed przesunięciem main: tag rollbacku `prod-pre-photos-2026-11-07` = aktualny main; `git merge-base --is-ancestor origin/main HEAD`;
  `git push origin HEAD:main`; Netlify CI. Nowych zmiennych środowiska NIE ma (bucket i funkcje z service_role, który już jest).
* Kontrola po deployu: `version.json` = commit gałęzi; `marketing-photos` bez tokenu → 401; `/brand/fm-email-logo-green.png` → 200 image/png;
  `MARKETING_SEND_ENABLED=false` nadal; zakładka „Biblioteka zdjęć” pusta (0 zdjęć); istniejące kampanie w panelu pokazują „Kampania w starym układzie”.
* Rollback kodu: Netlify „Publish deploy” poprzedniego. Migracji nie cofać.

## Krok 3 — kontrolowany import zdjęć (panel admina, Artur, bez skryptu z kluczami prod)
* Źródło: 18 zatwierdzonych oryginałów z `docs/production/mail-v2-makieta-2026-11-06/zdjecia-drive/oryginaly/wybrane/zatw_*.jpg`
  (lista + rocznik + ID Drive w `zdjecia-drive/kontakt.json`). 20 zapasowych NIE importujemy na prod do czasu przeglądu Artura.
* Panel: Marketing → Biblioteka zdjęć → „Dodaj zdjęcia” (można wiele naraz): dla każdego kadr 3:2 suwakiem (podgląd = to, co w mailu), nazwa,
  alt PL/EN, podpis PL/EN (domyślnie „Zdjęcie archiwalne: rozmowy B2B na Fresh Market {rok}”), rodzaj „autentyczne”, pochodzenie, prawa → „Zapisz do
  biblioteki” → plik ląduje w PRYWATNYM buckecie (bez adresu). Potem „Zatwierdź kadr” dla każdego = publikacja pod stały adres.
* Dlaczego panel, nie skrypt: każde zdjęcie przechodzi przez tę samą funkcję co produkcja (walidacja bajtów, duplikaty sha256/dHash, EXIF usunięty
  w przeglądarce) i wymaga świadomego zatwierdzenia; skrypt zasiewu jest celowo zablokowany dla projektu prod.
* Kontrola po imporcie (`01b-kontrola-po-imporcie.sql`): 18 `ready` z `approved_version_id`, 18 wersji opublikowanych, 0 pending, 18 obiektów w publicznym
  buckecie i 0 w prywatnym, każdy plik 1200×800 JPEG ≤ 200 KB (`niezgodne_wersje` = 0), bez EXIF, bo plik powstaje w przeglądarce jako nowy JPEG (przy imporcie przez panel sprawdzić wyrywkowo 1 plik, bo test 38/38 dotyczył zasiewu przez sharp); anonimowy GET 200.
* Minimalna pula: ≥ 5 (ostrzeżenie `pool_small` poniżej). Rotacja omija 4 ostatnie wysyłające kampanie.

## Krok 4 — konta próbne + lista + flaga
* WARUNEK: Artur pisze w czacie zdanie: „Zgadzam się ponownie otrzymać testowe maile na spiker.artur@gmail.com i artur.silvicola@gmail.com.” Samo „wdrażaj” nie cofa wypisu (review Codexa 07.11).
* Konta z próby 06.11 są na prod zawieszone i mają wypis. `02-konta-probne-reaktywacja.sql` (Artur, SQL Editor prod): w repo stoi z flagą `false` i bez źródła zgody, więc bez potwierdzenia przerywa bez zmian. Po zdaniu Artura: flaga `true` + data i miejsce zgody w `v_consent_source`.
* Skrypt: kontrola tożsamości (każdy konflikt = wyjątek = nic nie zmienione) → konta aktywne → `marketing_lift_suppression()` dla dokładnie dwóch adresów. Historia zostaje w `marketing_suppression_lifts` (kopia wypisu + dosłowna zgoda, tylko dopisywanie). Znieść można tylko wypis `unsubscribe`, nigdy odbicie ani skargę.
* Netlify (kontekst production): NAJPIERW kontrola `MARKETING_SEND_ALLOWLIST` przez `netlify env:list --context production --json` (06.11: zawiera dokładnie dwa adresy próbne; `netlify env:get` tej zmiennej zwraca fałszywy brak wartości, nie używać), DOPIERO POTEM `MARKETING_SEND_ENABLED=true` → `netlify api createSiteBuild` → kontrola obu zmiennych.

## Krok 5 — próba (panel, Artur klika; wyłącznie 2 adresy)
1. Marketing → Kampanie → grupa „Do wybranych firm”, nazwa „Próba mail v2 07.11” → kampania dostaje zdjęcie z rotacji (kafelek + powód) — można zmienić
   „Wybierz zdjęcie”. → „Sprawdź aktualny stan” → zaznaczyć TYLKO „Próba marketingu PL (Artur)” i „Marketing trial EN (Artur)” → Podgląd PL / EN
   (zielone logo, zdjęcie, hasło, data mailingu, przycisk) → Zatwierdź (2) → rejestr 2 wiersze pending; kafelek zdjęcia pokazuje „zamrożone”.
2. „Wyślij z rejestru” → oczekiwane `accepted 2`, `allowlist {active:true, blocked:0, waiting:0}`, kampania `sent`. Lista blokuje każdy inny adres (403 przy teście).
3. Kontrola w Gmailu PL/EN: logo zielone z `b2b.freshmarket.eu/brand/…`, zdjęcie z `…/storage/v1/object/public/marketing-photos/…`, alt/podpis w języku,
   telefon (Gmail mobile) — zdjęcie na całą szerokość, przycisk pod datą. Wypis NIE klikać (chyba że Artur chce powtórzyć kontrolę wypisu).
4. Rejestr: „Zapisana wiadomość” = dokładnie ten HTML; `marketing_photo_usage` pokazuje kampanię z `sent_count 2`; biblioteka: zdjęcie „wysyłało 1”.
5. Zrzuty i wyniki do `docs/production/odbior-marketing-zdjecia-2026-11-07/`.

## Krok 6 — po próbie
* `MARKETING_SEND_ENABLED=false` + redeploy. `MARKETING_SEND_ALLOWLIST` zostaje do pierwszej prawdziwej kampanii — wtedy ZDJĄĆ (inaczej partia pominie wszystkich).
* `03-po-probie.sql` (= `04-po-probie.sql` v3 z pakietu 06.11, bez zmian): konta próbne z powrotem zawieszone, dokładne pary, kontrola końcowa. Kampanię próbną zamknąć.
* Pliki zdjęć zostają (adresy w wysłanych mailach muszą działać). Zdjęcia nie kasujemy — tylko „Wyłącz”, gdy trzeba.

## Blokada wysyłki (obowiązuje przez całe wdrożenie)
Do kroku 4 `MARKETING_SEND_ENABLED=false`. Przed włączeniem flagi `netlify env:list --context production --json` musi pokazać na liście dokładnie dwa adresy próbne. Lista odrzuca innych adresatów przy zajmowaniu wiadomości w bazie i przy transporcie. Flaga wraca na `false` zaraz po próbie. Listę zdejmuje dopiero osobna decyzja o pierwszej prawdziwej kampanii.

## Co NIE wchodzi w to wdrożenie
* 20 zdjęć zapasowych (po przeglądzie Artura — wgrać tym samym trybem, zatwierdzić kadr po kadrze).
* Rozdział „Biblioteka zdjęć” w instrukcji administratora (do dopisania po akceptacji wyglądu).
* Wiersze testowe „ZZZ TEST wyścig blokad” istnieją tylko na bazie testowej.

## Dziennik wdrożenia (06.11.2026 wieczór)
* Codex: runda 1 NO-GO (3×P2), po poprawkach runda 2 GO dla kroku 1 (72a2a4a).
* Krok 1: kontrola przed = 28/28 zgodnych; 8 migracji (Run: Artur) Success; kontrola po = 28/28, 4 kampanie / 2 wiadomości / 2 wypisy bez zmian.
* Krok 2: tag `prod-pre-photos-2026-11-07` = 2447650, main = 72a2a4a, `version.json` 72a2a4a19f04; marketing-* bez tokenu 401; logo 200; flaga false; lista = 2 adresy próbne.
* Krok 3: 18 zdjęć w panelu; opublikowane 17, każde HTTP 200 anonimowo, JPEG 1200×800, max 153 KB, 0 metadanych; `niezgodne_wersje` 0. 2026/0173 (pion) ZOSTAJE prywatny: kadr ucina głowę, decyzja Artura.
* Krok 4: zgoda Artura w czacie 06.11 ok. 21:32. `02a-reaktywacja-ze-zgoda-06-11.sql` = 02 + dwie linie (flaga, źródło zgody), wklejony do SQL Editora, czeka na Run Artura.
* Do poprawy po próbie: tekst ostrzeżenia w bibliotece mówi „każdy plik publiczny”, a oczekujące są prywatne.
