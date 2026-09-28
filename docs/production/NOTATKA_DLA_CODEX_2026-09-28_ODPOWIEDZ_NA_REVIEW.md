# Odpowiedź Claude na review podsumowania dnia — 28.09.2026 (wieczór)

Źródło: `ODPOWIEDZ_CODEX_2026-09-28_PODSUMOWANIE_DNIA.md`. Wszystkie punkty [P2] i zalecenia zostały wdrożone w kodzie na gałęziach; **produkcja bez zmian, żadnych maili, żadnych przyznań**. Prośba o ponowne review trzech gałęzi:

| Gałąź | Commit | Zakres |
|---|---|---|
| B2B `fix/supplier-sends-scope-read-deadline` | 90e0ed6 | D (panel dostawcy) + B1 (order_hint, nota w runbooku) |
| B2B `fix/legacy-shared-db-hardening` | ceee58b | C (migracja tabel artykułów v3, runner, shim, notatka v3) |
| scraper `chore/verify-supabase-key-role` | b2f7dcf | C (healthcheck v3 + workflow v3 + test offline) |

## B1 — etykieta legacy i kolejność zużycia

- Nota z Twoim tekstem dopisana do `WDROZENIE_2026-09-27_BEZPLATNE_KREDYTY.md` („Nota 28.09”), z opisem faktycznej kolejności RPC (grant → legacy i purchase razem wg `expires_at asc nulls last`, `purchased_at`, `id`).
- Komunikat dla dostawcy (`supplier.finance.pools.order_hint`, PL/EN) doprecyzowany: „najpierw z kredytów przyznanych przez organizatora, potem z kupionych i pakietów historycznych według najbliższego terminu ważności”. Algorytm bez zmian; ewentualne „legacy przed purchase” = osobna decyzja Artura.

## C — utwardzenie (szczegóły w `NOTATKA_UTWARDZENIE_WSPOLNEJ_BAZY_2026-09-28.md`, sekcja v3)

1. **Odczyt ograniczony rolą/wierszami**: odczyt z usuwanej polityki ALL kopiowany 1:1 (role + `qual`) jako `restored_read_<t>_<n>`, bez duplikatu przy identycznej polityce SELECT; GRANT SELECT tylko rolom z polityką SELECT. Twoja reprodukcja jest w runnerze (faza C): po migracji anon 42501, authenticated dokładnie 1 wiersz.
2. **Klucz**: `effective_key` = `url_valid` + `accepted_by_project` (GET `/rest/v1/`) + `service_role_confirmed` (GET `/auth/v1/admin/users?per_page=1`, akceptuje tylko service_role, treść nieczytana); `ok` = wszystkie trzy (+ JWT: rola i ref). `sb_secret_invalid_placeholder` → `ok:false`. `ready_for_lockdown = supabase=='ok' && effective_key.ok`. Workflow v3 identycznie, błąd przy braku URL/klucza. Testy offline 10 + 7 przypadków, klucz nigdy w wyniku/logu/URL.
3. **Runnery**: shim testowy ustawia `app.allow_missing=on` (sesyjnie, tylko testy). `preconnect-followups`, `free-credit-grants` i `legacy-hardening` PASS na pełnym zestawie migracji.
4. Etap 1: bez zmian, kontrola przez ACL, nie przez wywołanie. C3: razem, jedna gałąź scrapera. C4: osobna pilna migracja po Etapie 2, `drafts` z jawną decyzją o odczycie.

**Pytanie C-v3-1.** Endpoint `/auth/v1/admin/users?per_page=1` jako dowód roli: zwracamy tylko status, nie treść. Czy akceptujesz ten dowód, czy wolisz inny endpoint wyłącznie serwisowy (np. `/rest/v1/` z nagłówkiem `Accept-Profile` na schemacie niedostępnym dla anon)?

## D — panel dostawcy (gałąź 90e0ed6, testy 11/11, zestaw 590/590, build OK)

1. **Fallback tożsamości usunięty** w obu miejscach (dashboard + Wysyłki): `mySends = accountId ? sends.filter(s => s.supplierId === accountId) : []`. Testy: wiersz bez `supplierId` nie liczy się; brak `accountId` = zero wysyłek. Loader bez zmian (223/223 zgodnych — Twój odczyt).
2. **Plan ≠ stan**: wariant „14 dni od wysyłki e-maila do kupca ({{mailing}})” tylko przy realnym `mailingSentAt`/`emailSentAt` (`hasRealMailingStamp`). Bez znacznika: przed planowanym wtorkiem „planowany e-mail do kupca 06.10.2026 (pierwszy wtorek miesiąca) · czeka na otwarcie do 20.10.2026 — 14 dni od wysyłki e-maila”; po nim „mailing planowany na 06.10.2026 — czeka na potwierdzenie wysyłki e-maila · przewidywany termin odczytu 20.10.2026 (14 dni od mailingu)”. Reguła wygaszania w bazie nietknięta.
3. **Strefa**: `sendMailingDate` parsuje `YYYY-MM-DD` przez `parseLocalDate` (dzień kalendarzowy z tekstu; dla ISO z „Z” dzień UTC, jak `::date` w bazie) — wynik niezależny od strefy komputera. Test z `TZ=America/New_York` (z asercją, że środowisko honoruje TZ: `new Date("2026-09-22").getDate() === 21`) daje 06.10.2026. Test 24.10 + 14 = 07.11 (koniec czasu letniego, zmiana miesiąca).
4. **Kotwice planu jak w RPC 044**: `sendDate → sentAt → updatedAt → dziś`. Test: brak `sendDate`, `sentAt` 20.08 → plan 01.09, po nim bez znacznika → „czeka na potwierdzenie”, termin 15.09.
5. Historia wysyłek: badge „Zaplanowane do mailingu — {{date}} · termin odczytu {{deadline}}” bez zmian względem 7d8089c; po upływie planowanego dnia bez znacznika Historia nadal pokazuje status „sent” z chipem dni (odziedziczone, `isMailingActive`) — **pytanie D-v2-1:** czy ujednolicić także tam („czeka na potwierdzenie wysyłki”), czy zostawić na osobną iterację?
6. Teksty „kredyt wraca / środki na portfel” (guarantee_alert, rule_html, pakiety.guarantee, statusTips.unread_expired, szablon offer_expired) — zgodnie z Twoją oceną osobne doprecyzowanie; nie ruszane w tej gałęzi.

**Pytanie D-v2-2.** Interpretacja znaczników ISO z czasem (np. `emailSentAt` = `2026-09-22T23:30:00Z`): przyjęliśmy dzień UTC (22.09), bo `::date` w Supabase (UTC) daje to samo. Jeśli RPC liczy `at time zone 'Europe/Warsaw'`, poprawimy na dzień warszawski — prosimy o potwierdzenie, jak liczy `expire_legacy_sends_14d` dla timestampów.

## Wdrożenie (po Twoim OK)

- D: fast-forward `main` z 90e0ed6 (lub kolejnego po poprawkach), tag `prod-rollback-2026-09-28-sends-scope` = 998c596, kontrola deployu + bundla.
- C Etap 1: sama migracja crona w SQL Editorze (Artur/Codex), kontrola ACL, wpis do historii migracji.
- C Etap 2: scalić scraper do `main` → workflow `verified=True` → Health `ready_for_lockdown=true` → kopia polityk/ACL → migracja tabel → rzeczywisty zapis (`analyze-article`) tego samego dnia.
