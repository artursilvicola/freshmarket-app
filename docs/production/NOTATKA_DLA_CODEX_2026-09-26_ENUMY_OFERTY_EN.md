# Do wykonania — polskie wartości pól wyboru oferty w angielskiej wersji podglądu (26.09.2026)

Stan wyjściowy: `main` 1a79c7b (= produkcja). Zgłoszenie dotyczy frontu (`src/legacy/PreconnectFM.jsx`) i jednego renderera maila (`netlify/functions/_shared/render-retailer-email.js`). Bez migracji, bez RLS, bez zmian danych w bazie. Klucze EN dla wszystkich opcji już istnieją w `src/i18n/en/legacy.json` — do dopisania jest tylko logika mapowania przy wyświetlaniu.

## Zgłoszenie (Artur, 26.09)

Admin w wersji EN, podgląd konta kupca Paweł Kwiatkowski, szczegóły oferty PreConnect, sekcja „Packaging and palletisation”: znaczniki opakowań pokazują **„Luz”, „Karton”, „Siatka”** zamiast „Bulk”, „Carton”, „Net”. W tej samej sekcji „Shelf-ready (SRP)” pokazuje **„Do uzgodnienia”** zamiast „To be agreed”. Nagłówki i etykiety pól są po angielsku, więc rzuca się w oczy, że to wartości z bazy.

## Przyczyna

Formularz oferty (`PageOfferForm`, `PreconnectFM.jsx:6126–6540`) tłumaczy **etykiety** opcji przez `t(...)`, ale jako **wartość** zapisuje polski literał. Wzorzec jest ten sam we wszystkich kontrolkach:

```jsx
// TagToggle / RadioGroup: [wartość zapisywana, etykieta z t()]
["Siatka", t("supplier.offer_form.step2.packaging.format_items.siatka")]
["Do uzgodnienia", t("supplier.offer_form.step2.packaging.srp_options.tbd")]
// <select>: value = polski literał, treść = t()
<option value="Bezpośrednio do sklepów">{t("...delivery_model_options.direct")}</option>
```

Widoki oferty renderują surową wartość z bazy (`{p}`, `o.srp`, `o.coldChain` …) bez odwrotnego mapowania na klucz i18n. Mechanizm `offer.i18n_en` (`[feat/offer-i18n etap 2]`, `PreconnectFM.jsx:3665`, `db.js:401`) obejmuje tylko pola tekstowe (tytuł, opis, benefity), nie pola wyboru.

Wartości muszą **pozostać** polskie w bazie: logika formularza porównuje je wprost (np. `f.promoVolume==="Tak"` w `PreconnectFM.jsx:6343`), dane demo (`PreconnectFM.jsx:241–377`) i wszystkie zapisane oferty używają tych literałów, a moderacja AI (`ai-moderation-offer-review.js:131–140`) dostaje je w prompcie. Zmiana formatu zapisu to osobny, większy temat. Poprawka ma być po stronie **wyświetlania**.

## Inwentarz pól wyboru z polskimi wartościami

Wszystkie poniższe klucze EN są w `en/legacy.json` pod `supplier.offer_form.` (sprawdzone 26.09). „Gdzie wyświetlane” to miejsca, które dziś pokazują surową wartość.

| Pole oferty | Zapisywane wartości (PL) | Klucz i18n (prefiks `supplier.offer_form.`) | Gdzie wyświetlane surowo |
|---|---|---|---|
| `packaging[]` | Luz, Flowpack, Punnet, Clamshell, Siatka, Worek, Karton, IFCO, SRP, Pęczek, Bukiet, Display | `step2.packaging.format_items.{luz,flowpack,punnet,clamshell,siatka,worek,karton,ifco,srp,peczek,bukiet,display}` | 8200 (kupiec, szczegóły), 13157 (podgląd skrócony), 13215 (podgląd pełny), mail 272 |
| `srp` | Tak, Nie, Do uzgodnienia | `step2.packaging.srp_options.{yes,no,tbd}` | 8201, 13226 |
| `palletType` | EUR, CHEP, IFCO, Inna | `step2.packaging.pallet_type_options.{eur,chep,ifco,other}` | 8201, 13221 |
| `availabilityModel` | Całorocznie, Sezonowo, Krótkie okno, Tylko promo / spot | `step2.availability.model_options.{yearly,seasonal,short_window,spot}` | 8194, 13204 |
| `volumeUnit` | kg, t, kartony, palety, sztuki, pęczki, bukiety, wiadra | `step2.availability.unit_options.{kg,t,cartons,pallets,pieces,bunches,bouquets,buckets}` | 5908 (lista dostawcy), 7660 (lista kupca), 8045, 12673, 13062, 13126, 13148, 13206–13207, mail 272 |
| `deliveryDays[]` | Pn, Wt, Śr, Czw, Pt, Sob, Nd | `step2.availability.days.{mon,tue,wed,thu,fri,sat,sun}` | 8195, 13211 |
| `promoVolume`, `traceability`, `currentTests`, `promoPrice`, `contractProgram` | Tak, Nie | `yes`, `no` | 8212, 8231, 13210, 13241, 13244, 13252, 13253 |
| `coldChain` | Po stronie dostawcy, Po stronie kupca, Możliwe oba warianty, Do ustalenia, Nie dotyczy | `step2.logistics.transport_options.{supplier,buyer,both,tbd,n_a}` | 8206, 13234 |
| `deliveryModel` | Centrum dystrybucyjne (CD), Cross-dock, Bezpośrednio do sklepów, EXW, FCA, DDP | `step2.logistics.delivery_model_options.{cd,cross_dock,direct,exw,fca,ddp}` | 8206, 13231 |
| `samplesAvail` | Tak — wyślemy, Po uzgodnieniu, Nie | `step2.commercial.samples_options.{yes,tbd,no}` | 8231, 13254 |
| `offerType` | Program stały, Propozycja sezonowa, Propozycja pod promocję, Testowy listing, Dostawa spot / uzupełnienie braków | `step1.identification.offer_type_options.{program,seasonal,promo,test,spot}` | 8104, 13179 |
| `positioning` | Codzienna półka, Premium, Promocja, Bio / ekologiczne, Lokalne / regionalne, Sezonowe, Wygodne opakowanie / gotowe na półkę | `step1.identification.positioning_options.{daily,premium,promo,bio,local,seasonal,shelf_ready}` | 7651 (lista kupca), 8103, 13180 |
| `qualityClass` | Klasa I, Klasa Extra, Premium, A, Inna | `step1.quality_spec.quality_class_options.{class1,extra,premium,a,other}` | 8181, 13186 |
| `saleMode` | Bez marki, Marka producenta, Marka własna sieci (Private label), Marka regionalna | `step1.quality_spec.sale_mode_options.{no_brand,producer,private_label,regional}` | 8181, 13188 |
| `priceUnit` | kg, szt., karton, paleta, pęczek, bukiet | `step2.commercial.price_unit_options.{kg,pcs,carton,pallet,peczek,bukiet}` | 7683, 8222, 13127 |
| `incoterm` | EXW, FCA, DDP, CPT, Inne | `step2.commercial.incoterm_options.{exw,fca,ddp,cpt,other}` | 8225, 13250 |
| `category` | owoce, warzywa, kwiaty | `buyer.catalog.category_options.*` (już istnieją) | 8120 (KV „Category” w szczegółach kupca) |

Pola z wartościami własnymi (`customPackaging`, `customCert`) i nazwy certyfikatów (GlobalGAP, BRC …) zostają bez mapowania — to nazwy własne. Numery linii według `main` 1a79c7b.

## Błąd towarzyszący: filtr opakowania u kupca nigdy nie trafia

`PreconnectFM.jsx:985` — filtr „Packaging” na liście ofert kupca ma opcje `["Bulk","Cartons","IFCO","Flowpack","Punnet"]`, a `PreconnectFM.jsx:999` porównuje je z `o.packaging` (czyli z „Luz”, „Karton” …). Trafiają tylko `IFCO`, `Flowpack`, `Punnet`. „Bulk” i „Cartons” zawsze dają pustą listę, niezależnie od języka. Do naprawy w tej samej gałęzi: wartości opcji = zapisywane literały (`Luz`, `Karton`, `IFCO`, `Flowpack`, `Punnet`), etykiety z `format_items`.

## Proponowana zmiana

1. **Jeden moduł ze słownikiem** `src/lib/offer-enums.js`: dla każdego pola z tabeli mapa `wartość zapisywana → klucz i18n`. Formularz ma budować listy opcji **z tego samego słownika** (zamiast literałów wpisanych w JSX), żeby zapis i odczyt nie mogły się rozjechać.
2. **Helper wyświetlania** `offerEnumLabel(field, value, t)`: zwraca `t(klucz, { defaultValue: value })`. Nieznana wartość (stare dane, wpis własny) wraca bez zmian, nigdy pusta. Dla tablic (`packaging`, `deliveryDays`) mapowanie per element.
3. **Podmiana w widokach** wymienionych w tabeli: szczegóły oferty u kupca (`PageBuyerOfferDetail`, ok. 8040–8235), karta na liście kupca (7640–7690), lista ofert dostawcy (5895–5910), `OfferPreviewModal` skrócony i pełny (13088–13260), podgląd maila w adminie (12636–12680). W `OfferPreviewModal` istniejący `txt()` obsługuje tylko booleany; stringi „Tak”/„Nie” przechodzą surowo — objąć je helperem.
4. **Mail do kupca** (`render-retailer-email.js:206, 272`): dla `lng === "en"` opakowanie i jednostka wolumenu z tego samego słownika. Funkcja nie ma i18next, ale może importować słownik z `src/lib/offer-enums.js` oraz `src/i18n/en/legacy.json` (esbuild Netlify bunduje importy; jeśli to problem, mały słownik EN obok `CNAME_EN`). Wzorzec już jest: `[P2-backend-mails C2]` robi to dla nazw krajów i CTA.
5. **Filtr** z sekcji wyżej.
6. **Test w vitest**: (a) każda wartość z list opcji formularza ma wpis w słowniku i istniejący klucz w `pl/legacy.json` i `en/legacy.json`; (b) `offerEnumLabel` zwraca „Bulk” dla „Luz” przy EN, „Luz” przy PL i wartość surową dla nieznanej.

Zakres poza tą gałęzią (do osobnej decyzji): normalizacja wartości w bazie na klucze neutralne językowo. Wymagałaby migracji danych `offers`, zmiany warunków w formularzu, danych demo i promptu moderacji; nie robić teraz.

## Podobne miejsca w aplikacji — analiza

Przejrzane: `src/legacy/PreconnectFM.jsx`, `src/panels`, `src/pages`, `src/components`, `src/staff`, `src/auth`, `netlify/functions`.

**Wzorzec zrobiony poprawnie (wzór do naśladowania):** profil firmy zapisuje klucze neutralne (`producent`, `chlodnia`, `retail` …) i wyświetla przez `t(klucz, { defaultValue })` — `PreconnectFM.jsx:8303, 12868, 12911, 12930, 12938`. Tak samo powinny działać pola oferty.

**Do poprawy w tej samej gałęzi (widoczne dla dostawcy lub kupca w EN):**

| Miejsce | Problem |
|---|---|
| `PreconnectFM.jsx:3697` | kopia oferty dostaje sufiks „(Kopia)” w tytule niezależnie od języka UI |
| `PreconnectFM.jsx:5908`, `7660`, `7683` | jednostki `volumeUnit` / `priceUnit` surowe na listach dostawcy i kupca (objęte tabelą) |
| `render-retailer-email.js:272` | w mailu EN opakowanie i jednostka po polsku (objęte tabelą) |

**Do poprawy później, niższy priorytet (widzi tylko admin, panel admina bywa używany w EN):**

| Miejsce | Problem |
|---|---|
| `PreconnectFM.jsx:10628` `ACCOUNT_STATUS_LABELS` | statusy kont firm („Czeka na zatwierdzenie”, „Wstrzymane” …) bez `t()`; użycia 11408, 11792, 11987, 12388 |
| `PreconnectFM.jsx:12626–12651` | podgląd maila zbiorczego w adminie: tekst wstępu, „Propozycje wyróżnione”, „Pozostałe propozycje”, „Wolumen”, „Min. zamówienie”, „Dostępność”, „pozycja” — na sztywno po polsku, a sam mail ma wersję EN |
| `src/components/admin/FmEventDay.jsx` (35 linii z polskim tekstem poza `t()`) | moduł spotkań B2B, admin/obsługa; po evencie 24.09 moduł zamknięty |
| `src/pages/FmBoardPage.jsx` | tablica hali, celowo dwujęzyczna PL / EN w jednym napisie — zostawić |

**Sprawdzone i czyste:** `src/panels` (0 twardych polskich tekstów w JSX), `src/auth` (1, strona logowania), `src/staff` (2, panel obsługi). Nowsze moduły nie renderują pól wyboru oferty.

## Kontrola po wdrożeniu

1. EN, konto kupca (lub podgląd kupca z admina), oferta z opakowaniem „Luz, Karton, Siatka” i SRP „Do uzgodnienia”: sekcja Packaging pokazuje „Bulk, Carton, Net” i „To be agreed”. Ta sama oferta w PL bez zmian.
2. EN: sekcje Availability, Logistics, Certificates, Price terms u kupca bez polskich słów (model dostępności, dni dostaw, transport, model dostawy, próbki, Tak/Nie).
3. EN: karta na liście kupca — badge pozycjonowania i jednostka wolumenu po angielsku.
4. Filtr „Packaging” = Bulk na liście kupca zwraca oferty z „Luz”.
5. Mail testowy do kupca z `profiles.locale = en`: wiersz pod tytułem oferty bez „Karton”/„kartony”.
6. Oferta ze starą lub własną wartością (np. `customPackaging` = „Skrzynka drewniana”) wyświetla ją bez zmian w obu językach.
7. `npm test` zielone, w tym nowy test słownika.

## Wdrożenie

Gałąź od `main`, np. `fix/offer-enum-labels-en`. Tylko front + jeden renderer maila; bez migracji. Rollback: tag `prod-rollback-2026-09-26` na obecnym `main` (1a79c7b) przed scaleniem, jak przy poprzednich wdrożeniach (runbook `PRODUCTION_HANDOVER.md`).
