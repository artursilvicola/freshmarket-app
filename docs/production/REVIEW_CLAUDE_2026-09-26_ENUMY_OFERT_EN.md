# Review Claude — `fix/offer-enum-labels-en` 3f7b8e1 (26.09.2026)

Werdykt: **kierunek i zakres poprawne, do wdrożenia po trzech drobnych poprawkach**. Wartości w bazie i warunki formularza nietknięte, filtr naprawiony, mail EN objęty, escaping zachowany. Gałąź zawiera `origin/main` 1a79c7b, main nie ruszył się od rana.

## Co sprawdziłem

- Diff `PreconnectFM.jsx` linia po linii: każda lista opcji buduje się z `offerEnumOptions`, kolejność i wartości identyczne jak w literałach sprzed zmiany (w tym `Pon` dla poniedziałku — miałem w raporcie `Pn`, Codex ma rację). Warunki typu `f.promoVolume==="Tak"` bez zmian.
- Wszystkie miejsca z mojej tabeli podmienione na `offerEnumLabel`: szczegóły kupca, lista kupca, lista dostawcy, wybór oferty do wysyłki, oba podglądy, podgląd maila admina, jednostki wolumenu i ceny, incoterm.
- Filtr: opcje `Luz, Karton, IFCO, Flowpack, Punnet` z etykietą z helpera, porównanie po wartości zapisanej.
- Mail: import modułu z `src/` i pliku JSON przez esbuild (`netlify.toml` ma `node_bundler = "esbuild"`, pakiet jest `type: module`) — bundluje się, test `tests/offer-enum-email.test.js` przechodzi.
- `Object.hasOwn` już jest w dwóch innych miejscach `src`, więc nie wprowadza nowego ryzyka przeglądarkowego.
- Uruchomiłem pełny Vitest w worktree Codexa: **523/523 przeszło, 1 plik nie wystartował** (poniżej).

## Do poprawy przed scaleniem

1. **`src/legacy/OfferEnumLabels.test.jsx` wymaga zmiennych Supabase.** Importuje `PreconnectFM.jsx` → `lib/db.js` → `lib/supabase.js`, a `createClient` rzuca bez `VITE_SUPABASE_URL`. W worktree bez `.env` cały plik pada („no tests”), z fikcyjnym env przechodzi 5/5. Wynik 528/528 Codexa zależał od env w jego sesji. Zrobić jak pozostałe testy komponentów: `vi.mock("../lib/supabase", () => ({ supabase: {...}, isSupabaseConfigured: true }))` (wzór: `src/components/admin/FmEventDay.stations.test.jsx:10`). Bez tego test padnie na CI i u każdego bez `.env`.
2. **Słownik `category` ma klucz `ziola`, a zapisywana wartość to `zioła`.** Formularz oferty buduje listę kategorii z `CEMOJI` (`PreconnectFM.jsx:134`: `owoce, warzywa, kwiaty, zioła, inne`), więc oferta z ziołami zostanie po polsku w KV „Category” u kupca. Poprawka: w `OFFER_ENUM_KEYS.category` klucz `"zioła"` (można zostawić `ziola` jako alias). Test „every persisted option has real PL and EN labels” tego nie wykrył, bo sprawdza istnienie kluczy i18n, a nie zgodność z wartościami formularza — warto dodać asercję, że `Object.keys(CEMOJI)` ⊆ klucze słownika `category`.
3. **Select kategorii w formularzu oferty pokazuje surowy klucz** (`{v} {k}` → „🌿 zioła” również w EN, `PreconnectFM.jsx:6189`). Ten sam wzorzec co reszta zgłoszenia, tylko po stronie formularza. Zamienić na `{v} {offerEnumLabel("category", k, t)}`, wartość zapisu bez zmian.

## Drobiazgi, bez blokowania

- W podglądzie maila admina (ok. 12673) nagłówki „Wolumen”, „Min. zamówienie”, „Dostępność”, „Opakowanie” zostały po polsku — zgodne z raportem Codexa (osobny zakres, podgląd powinien używać finalnego renderera).
- `offerEnumLabel` dla `volumeUnit` z wartością `""` zwraca `""` — poprawnie, żadnych „undefined” w tekście.

## Zgoda na osobny zakres

Akceptuję odłożenie: MOQ jako tekst wolny („1 Paleta”), historyczne jednostki `T/mies.` itp. (najpierw inwentarz danych), `ACCOUNT_STATUS_LABELS` i podgląd maila w adminie, moduł dnia wydarzenia. Sezon `2026-11 → 2026-06` na zrzucie to dane oferty, nie kod — do sprawdzenia z dostawcą, ewentualnie walidacja `from ≤ to` w formularzu jako osobna zmiana.

## Po poprawkach

Tag `prod-rollback-2026-09-26` na `main` 1a79c7b przed scaleniem, deploy Netlify z `main`, potem kontrola z sekcji „Kontrola po wdrożeniu” w `NOTATKA_DLA_CODEX_2026-09-26_ENUMY_OFERTY_EN.md` (oferta ze zrzutu u kupca EN i PL, filtr Bulk, oba podglądy). Mail testowy tylko na osobne polecenie Artura.
