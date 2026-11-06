# Wdrożenie listy dozwolonych adresów + próba poczty na dwóch kontach (06.11.2026)

Kod: gałąź `feat/marketing-activation` do 8511067 (odbiór Codexa zakończony). Ostatni deploy prod: main 5a73b74 (kod 072326b + docs).
Kolejność (Codex): **migracja → kod → lista dwóch adresów → włączenie wysyłki → test → wyłączenie wysyłki.**
Każdy krok ze zmianą produkcji wykonuje się dopiero po „wdrażaj” Artura; Run w SQL Editor i kliknięcia „Zatwierdź”/„Wyślij” klika Artur.

## Krok 1 — migracja (PRZED kodem)
- Plik `01-migracja-claim-allowlist.sql` = `supabase/migrations/20261106100000_marketing_claim_allowlist.sql` (cmp identyczne), SHA-256 LF `c27395852f7b60fa4f6780d63b9e893dfed495b30cae5f850c567a8ec0454a0f`, 85 linii.
- Przed Run: projekt `sklyfuvzjikkqerxtulo` w adresie karty; hash zawartości edytora zgodny; `02-kontrola-przed-i-po.sql` PRZED (1 sygnatura 4-arg, `text[]` 0) i zapisane liczby kampanii/wiadomości.
- Po Run „Success”: `02-kontrola…` PO (1 sygnatura z `p_allowed_emails text[]`, service_role EXECUTE 1, authenticated 1, liczby kampanii/wiadomości bez zmian).
- Stary kod (072326b) woła funkcję 4 argumentami → po migracji działa dalej (domyślny 5. parametr). Nowy kod bez migracji → błąd RPC.

## Krok 2 — kod
- Tag rollbacku `prod-pre-allowlist-2026-11-06` = 5a73b74 PRZED przesunięciem main; `git merge-base --is-ancestor origin/main HEAD`; `git push origin HEAD:main`; Netlify CI.
- Kontrola: `version.json` = 8511067, funkcje marketing-* bez tokenu 401, `MARKETING_SEND_ENABLED=false` nadal.
- Rollback kodu: Netlify „Publish deploy” poprzedniego (6aecc813 / 072326b). Migracji NIE cofać (stary kod z nią działa).

## Krok 3 — konta próbne
- Kontrola 06.11 (tylko odczyt): `spiker.artur@gmail.com` i `artur.silvicola@gmail.com` nie istnieją w auth.users / profiles / marketing_suppressions (0 wierszy).
- `03-konta-probne.sql` v2 (Artur, SQL Editor prod): 2 firmy (PL/NL, active, PreConnect włączony, bez kredytów) + 2 operatorzy (pl/en, hasło losowe nieznane — logowanie tylko przez reset/magic link). Nazwy bez „ZZZ TEST”, żeby silnik ich nie wykluczył.
  - Review Codexa P1: PRZED zapisem kontrola tożsamości (UUID firm, UUID użytkowników, adresy, profile, tożsamości auth); każdy konflikt = `RAISE EXCEPTION` = cała transakcja wycofana, nic nie zmienione. Ponowienie dozwolone tylko dla potwierdzonych kont tej próby (UUID + adres + firma). Kontrola końcowa: dokładnie 2 kompletne konta, inaczej wycofanie.
  - Oczekiwany wynik Run: 2 wiersze (supplier / active=true / pl|en / firma active + preconnect). Każdy komunikat „KONFLIKT…” = stop i decyzja Artura.
  - PO utworzeniu sprawdzić OSOBNO logowanie Supabase (PGlite z atrapą `auth.identities` tego nie potwierdza — Codex): na b2b.freshmarket.eu „nie pamiętam hasła” / magic link na `spiker.artur@gmail.com` → mail → zalogowanie jako dostawca firmy „Próba marketingu PL (Artur)”. To jest mail usługowy Supabase, nie marketingowy — nie wymaga flagi wysyłki.
- `05-przebieg-probny-pglite.mjs` v3: 33 asercje (konflikty A–C przerywają bez zmian, D czysta baza + idempotencja, E/E2/E3/E4 = 04 przy obcej firmie / ZAMIENIONYCH firmach operatorów / company_id NULL / adresie pod innym UUID przerywa bez zmian, F = końcowy stan każdego konta, G kontrola 02); nieudana asercja = kod wyjścia 1 (`--self-test-fail` sprawdzony = 1).

## Krok 4 — lista + flaga (Netlify, kontekst production) → redeploy
- `MARKETING_SEND_ALLOWLIST=spiker.artur@gmail.com,artur.silvicola@gmail.com` (bez spacji, małe litery; wpis bez `@` = 403 `allowlist_invalid`).
- `MARKETING_SEND_ENABLED=true`.
- `netlify api createSiteBuild` (zmienne wymagają redeployu); `netlify env:get` obu zmiennych po deployu.

## Krok 5 — próba (panel admina, Artur klika)
1. Marketing → Aktywacja PreConnect → grupa „Do wybranych firm”, nazwa np. „Próba poczty 06.11” → „Sprawdź aktualny stan” → zaznaczyć TYLKO „Próba marketingu PL (Artur)” i „Marketing trial EN (Artur)” → podgląd PL/EN → Zatwierdź (2) → rejestr: 2 wiersze pending.
2. Opcjonalnie „Test” na jeden z dwóch adresów (osobny wiersz is_test; wypis z niego nic nie zapisuje).
3. „Wyślij z rejestru” → oczekiwane `accepted 2`, `allowlist {active:true, blocked:0, waiting:0}`, kampania `sent`.
4. Kontrola: skrzynki Gmail (PL/EN, nagłówek z białym logo, link wypisu, List-Unsubscribe), otwarcie → `marketing_email_events` (webhook Resend, tag kind=marketing), wypis przez stronę (PL) i one-click (EN) → `marketing_suppressions` 2 wiersze; druga kampania do tych firm → wiersze `suppressed`, 0 maili.
5. Zrzuty i wyniki do `docs/production/odbior-marketing-2026-11-06/`.

## Krok 6 — po próbie
- `MARKETING_SEND_ENABLED=false` + redeploy (lista może zostać do pierwszej prawdziwej wysyłki; wtedy ZDJĄĆ, inaczej partia pominie wszystkich).
- `04-po-probie.sql` v3 (review 52fc873 P2): każda DOKŁADNA para osobno — UUID użytkownika + adres + rola supplier + firma z nazwą, porównania `is not distinct from`; zamienione przypisania, brak firmy albo adres pod innym UUID = przerwanie PRZED zmianami; kontrola końcowego stanu każdego konta (operator active=false, firma suspended + preconnect off), inaczej wycofanie; wypisy zostają. Kampanię próbną zamknąć w panelu.
- Memory + §20 dokumentu głównego.
