# Wdrożenie `feat/free-credit-grants` (kod 2c32036, głowa gałęzi 6599796 = kod + runbook) — krok po kroku

Przygotowane 27.09.2026 po pozytywnym review Codexa v4 (`REVIEW_CODEX_2026-09-27_BEZPLATNE_KREDYTY_V4.md`). **Nic z poniższego nie zostało wykonane.** Każdy krok ma warunek przejścia; przy niezgodności zatrzymać się i wrócić do Claude'a/Codexa.

Stan wyjściowy: `origin/main` = 37e90c7 (produkcja 792a4e9 + docs), gałąź zawiera `main` (fast-forward możliwy, 4 commity, 17 plików). Migracja: `supabase/migrations/20260927120000_free_credit_grants.sql`, 30 186 B, sha256 `7162e4c3e98b7a7bfbd3bd2dcc54c1bf9ad2329883835cb69b52ec79f9225807`.

Kolejność jest obowiązkowa: **kontrola → kopia → migracja → weryfikacja → kod → test → przyznania**. Między krokiem 3 a 5 nie przyznawać kredytów (stary kod rozlicza po staremu, bez grant-first).

---

## Krok 0 — kontrola istniejących rekompensat (SQL Editor, tylko odczyt)

Plik: `docs/production/sql/KONTROLA_REKOMPENSAT_PRZED_MIGRACJA_2026-09-27.sql`.

| Wynik zapytania 1 | Decyzja |
|---|---|
| pusty | rekompensat nie ma → po wdrożeniu przyznaje je admin z panelu (krok 7) |
| wiersze z 23–27.09, `plan='std_1'`, cena 0 | rekompensaty JUŻ SĄ → **nie przyznawać drugi raz**; zapisać listę `id`; ewentualne oznaczenie jako `grant` = osobna decyzja i osobny UPDATE po tej liście (nie robić w tym wdrożeniu) |
| inne wiersze z ceną 0 (demo, ręczne) | zostają `purchase` — nie klasyfikujemy po cenie |

Wynik (wklejony) trafia do notatki wdrożeniowej (§34 runbooka).

## Krok 1 — kopia i odciski (SQL Editor, tylko odczyt)

Plik: `docs/production/sql/KOPIA_I_ODCISKI_PRZED_MIGRACJA_2026-09-27_KREDYTY.sql`.

1. Zapytanie 1 (odciski md5 pięciu tabel) → `MANIFEST.txt`.
2. Zapytanie 2 (stan liczbowy) → do notatki.
3. Zapytania 3 (JSON: packages, wallet_tx, package_plans, legacy_sends-billing) → pliki w `C:\Users\Artur\FreshMarket-Backups\FM-KREDYTY-20260927\przed\` (jak przy poprzednich wdrożeniach; DPAPI opcjonalnie).
4. Zapytanie 4 (definicja i opcje widoku) → do notatki.

## Krok 2 — punkt powrotu w gicie (lokalnie, bez wpływu na produkcję)

```bash
cd "C:/Users/Artur/OneDrive/Dokumenty/Claude/Projects/Fresh Market 2026" && git fetch origin && git tag prod-rollback-2026-09-27-grants 37e90c7 && git push origin refs/tags/prod-rollback-2026-09-27-grants
```

Warunek: `git log --oneline -1 origin/main` nadal pokazuje 37e90c7. Jeśli `main` się zmienił, najpierw `git merge origin/main` na gałęzi, ponowny `npm test` i `npm run build`, dopiero potem dalej.

## Krok 3 — migracja (SQL Editor, jedna transakcja)

1. Otworzyć `supabase/migrations/20260927120000_free_credit_grants.sql` i sprawdzić sumę: w PowerShell `Get-FileHash -Algorithm SHA256 .\supabase\migrations\20260927120000_free_credit_grants.sql` = `7162E4C3…5807`.
2. Wkleić **całość** (plik zawiera `begin; … commit;`) do SQL Editora, uruchomić. Oczekiwane: „Success. No rows returned”. Dialog „destructive” (drop column if exists / drop constraint if exists) potwierdzić — obie instrukcje działają na obiektach, których w produkcji nie ma.
3. Przy błędzie: transakcja się wycofa; nic nie poprawiać ręcznie, przekazać treść błędu.

Migracja jest addytywna: nie zmienia istniejących wierszy (nowe kolumny z DEFAULT), nie usuwa nic poza obiektami z niewdrożonej v1.

## Krok 4 — weryfikacja po migracji (SQL Editor, tylko odczyt)

Plik: `docs/production/sql/KONTROLA_PO_MIGRACJI_2026-09-27_KREDYTY.sql` — każde zapytanie ma kolumnę `oczekiwane`. Kluczowe:

- A: 7 nowych kolumn, **brak** `grant_note`; B: tylko `purchase`; C: plan `grant` nieaktywny;
- D: `charge_legacy_send_first_seen`, `mark_legacy_send_seen`, `mark_legacy_sends_supplier_notified` — execute tylko `service_role`; `admin_grant_free_credits`, `mark_credit_grant_seen` — `authenticated` (funkcja sama sprawdza rolę);
- F: `security_invoker=true`, widok liczy po `business_today()`, 6 nowych kolumn;
- I: **odciski identyczne** z krokiem 1 (jedyna różnica to nowy wiersz `package_plans.grant`, wykluczony z odcisku).

Odciski → `MANIFEST.txt` (po-migracji). Dopiero po zgodności → krok 5.

## Krok 5 — kod (front + funkcje Netlify)

Lokalny `main` jest zajęty przez stary worktree w Temp, więc push refspecem:

```bash
cd "C:/Users/Artur/OneDrive/Dokumenty/Claude/Projects/Fresh Market 2026" && git fetch origin && git merge-base --is-ancestor origin/main origin/feat/free-credit-grants && git push origin refs/remotes/origin/feat/free-credit-grants:refs/heads/main
```

Kontrola deployu (Netlify buduje ~1–2 min):

```bash
cd "C:/Users/Artur/OneDrive/Dokumenty/Claude/Projects/Fresh Market 2026" && netlify api listSiteDeploys --data '{"site_id":"822fc61b-464d-4a95-8fe0-72eae7df7a3f","per_page":2}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const d of JSON.parse(s))console.log(d.id,d.state,(d.commit_ref||"").slice(0,7),d.published_at||"")})'
```

Warunek: deploy dla `6599796` (głowa gałęzi; kod identyczny z 2c32036, dodatkowo tylko ten runbook) w stanie `ready`, potem:

```bash
curl -s https://b2b.freshmarket.eu/version.json
```

= `{"build":"6599796…"}`. Bundle: `curl -s https://b2b.freshmarket.eu/ | grep -o '/assets/index-[^"]*\.js'` → w tym pliku występuje `admin_grant_free_credits` i `mark_credit_grant_seen`. Funkcje Netlify: log `mark-buyer-preconnect-seen` po pierwszym odczycie w kroku 6 nie może zawierać „Could not find the function public.mark_legacy_send_seen”.

## Krok 6 — test kontrolowany na encjach testowych

Encje: firma testowa „TEST Fresh Market – konto testowe (nie uczestniczy)” `09e52206…` (konto `test.dostawca@…`), sieć TEST `#990901` z kupcem testowym. Niczego nie aktywować w FM B2B.

| # | Krok | Warunek przejścia |
|---|---|---|
| 6.1 | Admin → Firmy → firma testowa → „Przyznaj bezpłatne kredyty”: 1 kredyt, powód „Prezent”, wiadomość „Test wdrożenia — do usunięcia”, notatka „test 27.09”, data domyślna | toast „Przyznano 1 … ważne do <dziś+3 mies.>”; znaczniki „bezpłatne 1 · <data>”, „kupione N” |
| 6.2 | Ten sam formularz raz jeszcze NIE da się wysłać (zamknięty); otworzyć ponownie i przyznać identycznie → to NOWA partia (nowy klucz) — **nie robić**; zamiast tego w SQL Editorze: `select idempotency_key, qty, reason, note, company_ids from package_grant_batches order by created_at desc limit 3` | 1 partia testowa z notatką |
| 6.3 | SQL: `select source, grant_reason, grant_message, expires_at, payment_ref from packages where company_id = '09e52206…' order by purchased_at desc limit 3` | wiersz `grant`, `gift`, `payment_ref = grant:<batch>:<company>`, brak kolumny notatki |
| 6.4 | Sesja `test.dostawca` (PL): baner „Otrzymujesz 1 bezpłatny kredyt…” z wiadomością; Finanse → Saldo: „Bezpłatne od organizatora 1 pozostało”, „1 kredyt wygasa <data>”, linia „Dostępne do nowych wysyłek … · oczekuje na odczyt sieci …”; Cennik i pakiety → historia: „Bezpłatne kredyty od organizatora · prezent” + wiadomość; **nigdzie nie widać notatki** | zgodne |
| 6.5 | Przełączyć na EN → te same miejsca po angielsku; „Rozumiem/Got it” na banerze → baner znika, `grant_seen_at` ustawione (SQL) | zgodne |
| 6.6 | Wysyłki: pasek „Kredyty PreConnect: X z Y · nierozliczone w pulach: bezpłatne 1, kupione N · oczekuje na odczyt: M” | zgodne |
| 6.7 | **Odczyt** (decyzja Artura — patrz uwaga niżej): propozycja testowa od firmy testowej do sieci TEST, kupiec testowy otwiera listę PreConnect → SQL: `select data->>'billingStatus', data->>'packageSource', data->>'chargeTxId' from legacy_sends where legacy_id = <id>` | `charged`, `grant`, tx ≠ null; `packages.qty_used` bezpłatnego = 1; `wallet_tx` `send_charge` z `meta.package_source = grant` |
| 6.8 | Drugi odczyt tej samej propozycji (odświeżenie listy) | `qty_used` bez zmian, brak drugiego `send_charge` |
| 6.9 | Sprzątanie: `update packages set expires_at = current_date - 1 where payment_ref like 'grant:%' and company_id = '09e52206…'` (test przestaje liczyć się do pojemności; wiersz i partia zostają jako ślad) | pojemność firmy testowej wraca do stanu sprzed testu |

Uwaga do 6.7: odczyt przez kupca uruchamia powiadomienie dostawcy — **prawdziwy e-mail** na adres `test.dostawca@…`. Codex zastrzegł prawdziwy mail tylko za osobną zgodą. Opcje: (a) Artur potwierdza jeden mail na skrzynkę testową, (b) krok 6.7–6.8 wykonać po wdrożeniu na pierwszej realnej propozycji pod nadzorem (SQL jak wyżej), (c) pominąć — ścieżka jest pokryta testami SQL/równoległymi i integracyjnym z atrapą poczty.

## Krok 7 — faktyczne przyznania (dopiero po akceptacji wyników kroku 6)

Wyłącznie przez panel admina (RPC sprawdza `auth.uid()` admina — z SQL Editora nie zadziała, i tak ma być).

1. Lista firm: KROK 1 skryptu `1FMK2026/outputs/KREDYTY_PRECONNECT_NIEOBECNE_SIECI_2026-09-23.sql` (tylko odczyt) → nazwy firm i liczba kredytów (1 za każdą z sieci: Biedronka, Mega Image, Stokrotka). Jeśli krok 0 wykazał istniejące rekompensaty — **pominąć te firmy**.
2. Panel: firmy z 1 kredytem jedną partią (dodawanie firm wyszukiwarką w modalu), firmy z 2 kredytami drugą partią. Powód „Rekompensata”, data domyślna (3 miesiące od dnia przyznania), notatka wewnętrzna np. „Rekompensata FM 2026: Biedronka/Mega Image/Stokrotka nieobecne — decyzja Artura 23.09”.
3. Proponowana wiadomość dla odbiorcy (PL; dostawcy EN zobaczą ją w tym samym brzmieniu — wiadomość nie jest tłumaczona):
   > Otrzymują Państwo bezpłatne kredyty PreConnect od organizatora Fresh Market jako rekompensatę za odwołane spotkania z siecią, która nie mogła uczestniczyć w wydarzeniu. Kredyty można wykorzystać do przesłania propozycji dowolnej sieci dostępnej w PreConnect. Najpierw zużywane są kredyty bezpłatne; kredyt jest pobierany dopiero, gdy sieć odczyta propozycję.
4. Po każdej partii: toast z liczbą firm i datą; SQL `select company_count, qty, reason, expires_at, created_at from package_grant_batches order by created_at desc limit 3`; `select count(*) from packages where source = 'grant'` = suma firm × partii.
5. Kontrola u jednego z dostawców (podgląd z admina): baner, karta pul.
6. Komunikat do firm poza aplikacją (mail/newsletter) — osobna decyzja; aplikacja maili nie wysyła.

## Rollback

- **Front/funkcje**: `git push origin refs/tags/prod-rollback-2026-09-27-grants:refs/heads/main` (Netlify przebuduje 37e90c7). Stary kod działa z nową bazą (nie czyta nowych kolumn), ale rozlicza po staremu: bez grant-first i bez atomowości. **Nie robić rollbacku kodu po przyznaniu kredytów** bez uzgodnienia — przyznane pule byłyby zużywane w złej kolejności.
- **Baza**: migracja addytywna; nie cofać. Ewentualne wyłączenie przyznań = `revoke execute on function public.admin_grant_free_credits(uuid[], integer, text, text, text, text, date) from authenticated`.
- **Kopie** z kroku 1 służą do porównania, nie do przywracania (żadne istniejące wiersze nie są modyfikowane).

## Po wdrożeniu — do notatki §34 w `FM_KOLEJKI_WDROZENIE.md`

Godziny kroków 0–6, wynik kontroli rekompensat, odciski przed/po, id deployu Netlify, `version.json`, wynik testu kontrolowanego, decyzja o 6.7, liczba partii i kredytów z kroku 7.

## Poza zakresem (osobne zadanie, z review Codexa v4)

`netlify/functions/send-retailer-batch.js:181–183, 350–369` — ścieżka wysyłki do sieci kwalifikuje także wiersze `sent` bez znacznika maila i zapisuje cały snapshot po odpowiedzi poczty; równoległy odczyt jest możliwy. Zalecane utwardzenie ograniczonym scalaniem pól (jak `mark_legacy_sends_supplier_notified`) + test wysyłka/odczyt. Nie blokuje tego wdrożenia.
