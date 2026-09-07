# Kolejki B2B v4.4 — wynik testu hostowanego i poprawka obowiązkowa

Testy wykonano na płatnej gałęzi Supabase i osobnym Netlify Deploy Preview. Produkcja i `main` nie zostały zmienione.

## Błąd znaleziony w v4.2/v4.3

`FM_CONFLICT` był zgłaszany z SQLSTATE `40001` (`serialization_failure`). PostgREST 14.5 automatycznie ponawia ten kod, dlatego nieaktualne wywołania wpadały w długie retry i kończyły się `PGRST003`. To nie był limit puli ani wolna transakcja.

Poprawka obowiązkowa: każde `RAISE EXCEPTION 'FM_CONFLICT'` ma używać `ERRCODE = 'PT409'`. Jest to oficjalny niestandardowy kod PostgREST zwracający HTTP 409 bez automatycznych retry. Frontend i testy nadal rozpoznają `FM_CONFLICT` po komunikacie.

## Wyniki po poprawce

- SQL T0–T16 w transakcji z ROLLBACK: OK.
- Vitest: 25/25; build: OK.
- Zalew 5×: całość 212 ms; zwycięzca 69 ms; 4 × `FM_CONFLICT`; 0 timeoutów.
- Zalew 20×: całość 261 ms; zwycięzca 83 ms; 19 × `FM_CONFLICT`; 0 `FM_BUSY`; 0 innych błędów; `last_called_nr` wzrósł dokładnie raz.
- Pełna ścieżka Netlify → GoTrue → RPC, idempotencja, dwa stanowiska, dwa urządzenia, brute force 40×, reset PIN/stare tokeny, block/unblock oraz Realtime dla dwóch operatorów: OK.

## Adres tablicy

Adresem kanonicznym jest `/tablice`, docelowo `https://b2b.freshmarket.eu/tablice`. Stare `/tablica` przekierowuje na `/tablice` z zachowaniem parametrów i fragmentu URL.

Do włączenia przed produkcją: zmiana `40001` → `PT409` oraz poprawki routingu z commitu Codexa v4.4. Nie wdrażać starej migracji 053 z `40001`.
