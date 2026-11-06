# Do review Codexa: zmiana logo i końcowy pakiet SQL (przed wdrożeniem)

Gałąź `feat/marketing-photos`. Produkcja bez zmian (main 2447650). Zakres od commitu e3a27a6 (ostatni odebrany) do końca gałęzi:
```bash
git diff e3a27a6..origin/feat/marketing-photos
```

## Do sprawdzenia
1. **Logo w podglądzie.** `netlify/functions/marketing-preview.js`, `_shared/marketing-logo-data.js` (generowany przez `scripts/marketing-logo-data.mjs`). Podgląd dostaje logo jako data URI, bo ramka `sandbox` nie pobiera obrazków z localhost. Mail z `approve`, testu i wysyłki ma nadal adres HTTPS. Czy nic innego nie korzysta z podglądu jako treści wysyłanej?
2. **Tekst zastępczy logo.** Style `img` w `shellV2` (`_shared/marketing-templates.js`), zmiana dotyczy tylko układu 2.
3. **Migracja `20261107160000_marketing_suppression_lifts.sql`.** Nowa w tej rundzie: rejestr zniesień wypisu tylko do dopisywania, `marketing_lift_suppression()` (tylko powód `unsubscribe`, bez EXECUTE dla ról aplikacji), trigger odrzucający usunięcie wypisu bez wpisu w rejestrze. Czy dopasowanie po `email` + `created_at` wystarcza? Czy SECURITY DEFINER i uprawnienia są domknięte?
4. **`04-migracje-razem.sql`.** Siedem migracji 1:1 (sprawdza to `scripts/marketing-photos-deploy-check.mjs`), każda we własnej transakcji. Czy przerwanie w połowie i drugi Run są bezpieczne na danych produkcyjnych?
5. **`01-kontrola-migracji.sql` i `01b-kontrola-po-imporcie.sql`.** Czy kontrola wyłapuje wszystko, co musi być spełnione przed kodem?
6. **`02-konta-probne-reaktywacja.sql`.** W repo stoi flaga `false`. Bez potwierdzonej zgody i bez źródła zgody przerywa bez zmian. Czy historia wypisu jest kompletna?
7. **`00-CZYTAJ.md`.** Kolejność: migracje → kontrola → kod → zdjęcia → test na dwóch adresach, z blokadą wysyłki do pozostałych.

## Wyniki lokalne (06.11 wieczór)
* `PGLITE_PATH=… npx vitest run`: 116 plików, 989 testów OK.
* `scripts/marketing-photos-deploy-check.mjs` na schemacie sprzed wdrożenia (76 migracji, dane jak na prod): kontrola przed, plik łączony, kontrola po, liczby bez zmian, drugi Run, ochrona wypisów, reaktywacja z historią, ponowny wypis, sprzątanie: WSZYSTKO OK.
* Baza testowa: 83 migracje, kontrola po: bez różnic.

## Stan blokady wysyłki na produkcji (odczyt 06.11)
`MARKETING_SEND_ENABLED=false`. `MARKETING_SEND_ALLOWLIST` zawiera dokładnie dwa adresy próbne (`netlify env:list --context production --json`; `env:get` tej zmiennej zwraca fałszywy brak wartości).
