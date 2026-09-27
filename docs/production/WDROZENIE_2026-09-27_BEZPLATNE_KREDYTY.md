# Wdrożenie `feat/free-credit-grants` (kod v5; głowa gałęzi = kod + runbook) — krok po kroku

Przygotowane 27.09.2026 po pozytywnym review Codexa v4 (`REVIEW_CODEX_2026-09-27_BEZPLATNE_KREDYTY_V4.md`). **Nic z poniższego nie zostało wykonane.** Każdy krok ma warunek przejścia; przy niezgodności zatrzymać się i wrócić do Claude'a/Codexa.

Stan wyjściowy: `origin/main` = 37e90c7 (produkcja 792a4e9 + docs), gałąź zawiera `main` (fast-forward możliwy, 4 commity, 17 plików). Migracja: `supabase/migrations/20260927120000_free_credit_grants.sql`, 39188 B, sha256 `29eb68f8007e4bd991d458e274b6989aee8d3a1587b8371c2c6275ec1a4960a5` (v6).

Kolejność jest obowiązkowa: **kontrola → kopia → migracja → weryfikacja → kod → test → przyznania**. Między krokiem 3 a 5 nie przyznawać kredytów (stary kod rozlicza po staremu, bez grant-first).

---

## Krok 0 — uzgodnienie historycznych przyznań z bazą (SQL Editor, tylko odczyt)

Archiwum z 23.09 (`1FMK2026/outputs`, uzupełnienie Codexa `UZUPELNIENIE_CODEX_2026-09-27_HISTORYCZNE_KREDYTY.md`) mówi: **rekompensaty zostały wykonane 23.09 11:52** (123 kredyty, 93 firmy, `payment_ref = compensation:fm2026:…`, ważne do 31.12.2026), a wcześniej **75 firm dostało prezent rejestracyjny** (std_5, 5 kredytów, cena 0, bez referencji, ważne do 31.12.2026). Decyzja Artura: prezent rejestracyjny to osobne historyczne przyznanie — odnotować, nie dodawać ponownie, nie odejmować od rekompensaty, zachować zużycie i ważność, bez nowego powiadomienia.

Plik: `docs/production/sql/HISTORYCZNE_KREDYTY_2026-09-27_UZGODNIENIE.sql` — **część A** (tylko odczyt, działa na schemacie SPRZED migracji, wklejona w całości jako jedno wykonanie; kończy się `rollback`). Zawiera manifest per id z archiwum (75 + 123 + 3): firma, plan, ilość, cena, waluta, referencja, data przyznania, ważność — porównania NULL-safe, raport różnic per pole:

| Zapytanie | Oczekiwane | Jeśli inaczej |
|---|---|---|
| A1 | brakujących 0 dla trzech list | zatrzymać się; usunięte pakiety wyjaśnić przed częścią B |
| A2 | 0 wierszy różnic (firma, plan, ilość, cena, waluta, referencja, data, ważność; zużycie nie może zmaleć) | każdy wiersz różnic wyjaśnić; część B i tak odmówi zapisu przy różnicy |
| A3 / A3b | 123 = 123, tylko_w_bazie 0, tylko_w_archiwum 0; 0 wierszy z referencją wskazującą inną firmę | w bazie jest więcej/mniej rekompensat niż w archiwum → wyjaśnić |
| A4 | 0 wierszy | pakiety z ceną 0 spoza list → decyzja: dopisać do nieustalonych (nowy manifest) albo zostawić jako purchase |
| A5 | salda list (do notatki) | porównać z kontrolą po zapisie (sumy identyczne) |

Wniosek dla kroku 7: **rekompensaty są już przyznane → nowych przyznań rekompensaty = 0**, chyba że A1/A3 wykażą brakujące pakiety (wtedy tabela uprawnień z kroku 7).

Stary plik `KONTROLA_REKOMPENSAT_PRZED_MIGRACJA_2026-09-27.sql` zostaje jako kontrola pomocnicza (zapytanie 2 powinno pokazać partię z 23.09 09:52 UTC = 11:52 PL).

## Krok 1 — kopia i odciski (SQL Editor, tylko odczyt)

Plik: `docs/production/sql/KOPIA_I_ODCISKI_PRZED_MIGRACJA_2026-09-27_KREDYTY.sql`.

Odciski na pracującej produkcji: `packages` (poza `qty_used`), `package_plans` i `companies` muszą być identyczne przed i po migracji. `legacy_sends`, `wallet_tx` i `packages.qty_used` mogą się zmienić przez normalne odczyty propozycji między pomiarami — różnica tam nie jest skutkiem migracji: przy różnicy zatrzymać procedurę i wyjaśnić zmienione wiersze na podstawie eksportów (nowe `send_charge` w `wallet_tx`, nowe znaczniki w `legacy_sends`), nie odtwarzać kopii i nie ignorować. Jeśli wymagana jest ścisła identyczność, uzgodnić krótkie okno bez odczytów (np. wczesny ranek). Pojemność porównać po obu stronach północy warszawskiej — poprzedni widok liczył po `current_date` sesji.

1. Zapytanie 1 (odciski md5 pięciu tabel) → `MANIFEST.txt`.
2. Zapytanie 2 (stan liczbowy) → do notatki.
3. Zapytania 3 (JSON: packages, wallet_tx, package_plans, legacy_sends-billing) → pliki w `C:\Users\Artur\FreshMarket-Backups\FM-KREDYTY-20260927\przed\` (jak przy poprzednich wdrożeniach; DPAPI opcjonalnie).
4. Zapytanie 4 (definicja i opcje widoku) → do notatki.

## Krok 2 — punkt powrotu w gicie (lokalnie, bez wpływu na produkcję)

```bash
cd "C:/Users/Artur/OneDrive/Dokumenty/Claude/Projects/Fresh Market 2026" && git fetch origin && git tag prod-rollback-2026-09-27-grants 37e90c7 && git push origin refs/tags/prod-rollback-2026-09-27-grants
```

**Wykonane 27.09 (Claude):** tag `prod-rollback-2026-09-27-grants` = 37e90c7 utworzony i wypchnięty. Deploy Netlify opublikowany przed wdrożeniem: `6ab7ad014869860007bfe884` (37e90c7, published 26.09 13:31) — do „Publish deploy” przy rollbacku.

Warunek: `git log --oneline -1 origin/main` nadal pokazuje 37e90c7. Jeśli `main` się zmienił, najpierw `git merge origin/main` na gałęzi, ponowny `npm test` i `npm run build`, dopiero potem dalej.

## Krok 3 — migracja (SQL Editor, jedna transakcja)

1. Otworzyć `supabase/migrations/20260927120000_free_credit_grants.sql` i sprawdzić sumę: w PowerShell `Get-FileHash -Algorithm SHA256 .\supabase\migrations\20260927120000_free_credit_grants.sql` = `29EB68F8…60A5`.
2. Wkleić **całość** (plik zawiera `begin; … commit;`) do SQL Editora, uruchomić. Oczekiwane: „Success. No rows returned”. Dialog „destructive” (drop column / drop constraint if exists) potwierdzić — instrukcje dotyczą obiektów, których w produkcji nie ma (v1) lub są odtwarzane w tej samej transakcji (constrainty).
3. Przy błędzie: transakcja się wycofa; nic nie poprawiać ręcznie, przekazać treść błędu.

Migracja jest addytywna: nie zmienia istniejących wierszy (nowe kolumny z DEFAULT), nie usuwa nic poza obiektami z niewdrożonej v1.

## Krok 4 — weryfikacja po migracji (SQL Editor, tylko odczyt)

Plik: `docs/production/sql/KONTROLA_PO_MIGRACJI_2026-09-27_KREDYTY.sql` — każde zapytanie ma kolumnę `oczekiwane`. Kluczowe:

- A: **10** nowych kolumn, **brak** `grant_note`; B: tuż po migracji tylko `purchase`; C: plan `grant` nieaktywny;
- D: `charge_legacy_send_first_seen`, `mark_legacy_send_seen`, `mark_legacy_sends_supplier_notified` — execute tylko `service_role`; `admin_grant_free_credits`, `admin_record_historical_grants`, `mark_credit_grant_seen` — `authenticated` (funkcje same sprawdzają rolę; historyczne RPC bez sesji użytkownika wymaga `session_user = postgres`, czyli SQL Editora, plus `p_recorded_by` = profil admina);
- F: `security_invoker=true`, widok liczy po `business_today()`, **7** nowych kolumn;
- I: odciski `packages`/`package_plans`/`companies` identyczne z krokiem 1 (jedyna różnica: nowy wiersz `package_plans.grant`, wykluczony z odcisku); `legacy_sends`/`wallet_tx` — patrz uwaga w kroku 1.

Odciski → `MANIFEST.txt` (po-migracji). Dopiero po zgodności → krok 5.

## Krok 4b — odnotowanie historycznych przyznań (SQL Editor, zapis przez RPC) — WYKONAĆ PO KROKU 5

Dopiero po zgodności kroku 4, po deployu kodu (krok 5) i po akceptacji wyników części A przez Artura. Plik `docs/production/sql/HISTORYCZNE_KREDYTY_2026-09-27_ZAPIS.sql` — samowystarczalny i wykonywany jako JEDNO wykonanie z **automatycznym COMMIT** na końcu. Kolejność w pliku: `LOCK TABLE packages IN EXCLUSIVE MODE` (`lock_timeout` 10 s, `statement_timeout` 120 s — odczyty działają, zapisy rozliczeń czekają kilka sekund) → manifest → **pełna kontrola pod blokadą** (pola per id, rekompensaty w obie strony, referencja = firma wiersza, pakiety z ceną 0 spoza list, już oznaczone) → trzy wywołania `admin_record_historical_grants` → kontrola po zapisie → COMMIT. Każda różnica = wyjątek i pełne wycofanie, nic nie zostaje zapisane. Jeśli skrypt zgłosi przekroczenie `lock_timeout` (ktoś trzymał zapis), po prostu uruchomić ponownie. Wykonuje admin z SQL Editora; `p_recorded_by` = profil admina po e-mailu w pliku (sprawdzić, że `select id from profiles where email = 'artur.stasiak@freshmarket.eu' and role = 'admin'` zwraca 1 wiersz):

1. `registration` → 75 pakietów: `source = grant`, `grant_reason = registration`, `grant_historical = true`, `granted_at` = pierwotna data, `granted_by = NULL`, autor odnotowania = admin z `p_recorded_by`, `grant_seen_at = now()` (bez banera). Saldo, zużycie i ważność bez zmian.
2. `compensation` → 123 pakiety: jak wyżej z powodem rekompensaty.
3. `legacy` → 3 pakiety std_1 o nieustalonym źródle: `source = legacy` (opis neutralny „Pakiet historyczny — źródło nieustalone”, nie „Kupione”).

Każde wywołanie ma stały klucz idempotencji — powtórka zwraca `already_done`. Kontrola: zapytanie B i H z `KONTROLA_PO_MIGRACJI…` oraz A4 z uzgodnienia (sumy `qty_total`/`qty_used` identyczne przed i po). Dostawca po deployu zobaczy: pula „Bezpłatne od organizatora” z pozostałymi kredytami rejestracyjnymi i rekompensaty (ważne do 31.12.2026), w historii „Prezent za rejestrację na Fresh Market — przyznano wcześniej 5 kredytów”; **bez banera** (już „widziane”).

Kolejność: **najpierw krok 5 (kod), potem 4b** — stara funkcja rozliczeń nie zna kolejności grant-first, więc oznaczenie pul bezpłatnych przy aktywnym starym backendzie dałoby okres, w którym prezenty i zakupy schodzą po staremu. Między deployem a 4b (minuty) dostawcy widzą historyczne pakiety jeszcze jako „Kupione” — akceptowalne, 4b wykonać bezpośrednio po potwierdzeniu deployu. Po 4b obowiązuje ten sam zakaz bezwarunkowego powrotu do starego backendu, co po nowych przyznaniach.

## Krok 5 — kod (front + funkcje Netlify)

Lokalny `main` jest zajęty przez stary worktree w Temp, więc push refspecem:

```bash
cd "C:/Users/Artur/OneDrive/Dokumenty/Claude/Projects/Fresh Market 2026" && git fetch origin && git merge-base --is-ancestor origin/main origin/feat/free-credit-grants && git push origin refs/remotes/origin/feat/free-credit-grants:refs/heads/main
```

Kontrola deployu (Netlify buduje ~1–2 min):

```bash
cd "C:/Users/Artur/OneDrive/Dokumenty/Claude/Projects/Fresh Market 2026" && netlify api listSiteDeploys --data '{"site_id":"822fc61b-464d-4a95-8fe0-72eae7df7a3f","per_page":2}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const d of JSON.parse(s))console.log(d.id,d.state,(d.commit_ref||"").slice(0,7),d.published_at||"")})'
```

Warunek: deploy dla głowy gałęzi (`git log --oneline -1 origin/feat/free-credit-grants`) w stanie `ready`, potem:

```bash
curl -s https://b2b.freshmarket.eu/version.json
```

= `{"build":"<hash głowy gałęzi>…"}`. Bundle: `curl -s https://b2b.freshmarket.eu/ | grep -o '/assets/index-[^"]*\.js'` → w tym pliku występuje `admin_grant_free_credits` i `mark_credit_grant_seen`. Funkcje Netlify: log `mark-buyer-preconnect-seen` po pierwszym odczycie w kroku 6 nie może zawierać „Could not find the function public.mark_legacy_send_seen”.

## Krok 6 — test kontrolowany na encjach testowych

Encje: firma testowa „TEST Fresh Market – konto testowe (nie uczestniczy)” `09e52206…` (konto `test.dostawca@…`), sieć TEST `#990901` z kupcem testowym. Niczego nie aktywować w FM B2B.

| # | Krok | Warunek przejścia |
|---|---|---|
| 6.1 | Admin → Firmy → firma testowa → „Przyznaj bezpłatne kredyty”: 1 kredyt, powód „Prezent”, wiadomość „Test wdrożenia — do usunięcia”, notatka „test 27.09”, data domyślna. **Zapisać z SQL**: `select id as package_id, grant_batch_id, company_id, expires_at, qty_total, qty_used from packages where source='grant' and grant_historical=false and company_id='09e52206…' order by granted_at desc limit 1` | toast „Przyznano 1 … ważne do <dziś+3 mies.>”; znaczniki „bezpłatne 1 · <data>”, „kupione N”; zapisane pełne identyfikatory (bez wielokropków) |
| 6.2 | Ten sam formularz raz jeszcze NIE da się wysłać (zamknięty); otworzyć ponownie i przyznać identycznie → to NOWA partia (nowy klucz) — **nie robić**; zamiast tego w SQL Editorze: `select idempotency_key, qty, reason, note, company_ids from package_grant_batches order by created_at desc limit 3` | 1 partia testowa z notatką |
| 6.3 | SQL: `select source, grant_reason, grant_message, expires_at, payment_ref from packages where company_id = '09e52206…' order by purchased_at desc limit 3` | wiersz `grant`, `gift`, `payment_ref = grant:<batch>:<company>`, brak kolumny notatki |
| 6.4 | Sesja `test.dostawca` (PL): baner „Otrzymujesz 1 bezpłatny kredyt…” z wiadomością; Finanse → Saldo: „Bezpłatne od organizatora 1 pozostało”, „1 kredyt wygasa <data>”, linia „Dostępne do nowych wysyłek … · oczekuje na odczyt sieci …”; Cennik i pakiety → historia: „Bezpłatne kredyty od organizatora · prezent” + wiadomość; **nigdzie nie widać notatki** | zgodne |
| 6.5 | Przełączyć na EN → te same miejsca po angielsku; „Rozumiem/Got it” na banerze → baner znika, `grant_seen_at` ustawione (SQL) | zgodne |
| 6.6 | Wysyłki: pasek „Kredyty PreConnect: X z Y · nierozliczone w pulach: bezpłatne 1, kupione N · oczekuje na odczyt: M” | zgodne |
| 6.7 | **Odczyt** (decyzja Artura — patrz uwaga niżej): propozycja testowa od firmy testowej do sieci TEST, kupiec testowy otwiera listę PreConnect → SQL: `select data->>'billingStatus', data->>'packageSource', data->>'chargeTxId' from legacy_sends where legacy_id = <id>` | `charged`, `grant`, tx ≠ null; `packages.qty_used` bezpłatnego = 1; `wallet_tx` `send_charge` z `meta.package_source = grant` |
| 6.8 | Drugi odczyt tej samej propozycji (odświeżenie listy) | `qty_used` bez zmian, brak drugiego `send_charge` |
| 6.9 | Sprzątanie TYLKO pakietu z 6.1: `update packages set expires_at = public.business_today() - 1 where id = '<package_id z 6.1>' and grant_batch_id = '<grant_batch_id z 6.1>' and company_id = '<company_id>' and source = 'grant' and expires_at = '<expires_at z 6.1>' returning id` (wiersz, partia i `wallet_tx` zostają jako ślad). Osobno zanotować stan po teście z odczytem (1 kredyt zużyty → `qty_used=1`) i bez odczytu (propozycja testowa oczekująca rezerwuje kredyt do zwrotu po 14 dniach) | `returning` = dokładnie 1 wiersz; pojemność firmy testowej wraca do stanu sprzed testu (z uwzględnieniem zużycia/oczekującej propozycji) |

Uwaga do 6.7: odczyt przez kupca w aplikacji uruchamia powiadomienie dostawcy — **prawdziwy e-mail** na adres `test.dostawca@…`. Codex zastrzegł prawdziwy mail tylko za osobną zgodą. Opcje: (a) Artur potwierdza jeden mail na skrzynkę testową; (b) **bez maila**: w SQL Editorze wywołać bezpośrednio `select public.mark_legacy_send_seen('<id wysyłki testowej>', '09e52206…', 'app_list')` dwa razy — pierwsze `billing.charged=true, package_source=grant`, drugie `already_charged`; to potwierdza RPC i rozliczenie, **nie** pełną funkcję Netlify z pocztą (zapisać tę różnicę w wyniku); (c) później obserwować naturalny odczyt wyłącznie zapytaniami SELECT. Nie używać realnej propozycji uczestnika jako zamiennika testu bez zgody na mail. Nie dodawać przełącznika wyłączającego powiadomienia dla klientów.

## Krok 7 — faktyczne przyznania (dopiero po akceptacji wyników kroku 6)

**Według archiwum rekompensaty są już przyznane (23.09) — spodziewane nowe przyznania: 0.** Krok wykonać tylko dla firm, których A2/A1 nie znalazły w bazie, albo dla nowych decyzji Artura. Wyłącznie przez panel admina (RPC sprawdza `auth.uid()` admina — z SQL Editora nie zadziała, i tak ma być).

1. Lista firm: **nie** ze starego skryptu `KREDYTY_PRECONNECT_NIEOBECNE_SIECI_2026-09-23.sql` (pomijał historyczne przydziały dwóch sieci, bez zabezpieczenia przed ponowieniem). Jeśli w ogóle: tabela **firma → uprawnione nieobecne sieci (Biedronka 100, Mega Image 133, Stokrotka 110) → potwierdzone wcześniejsze przyznania z tego tytułu (po `payment_ref compensation:fm2026:retailer:<id>:company:<uuid>`) → liczba pozostała** (0, 1, 2 lub 3). Wcześniejszy prezent rejestracyjny nie zmniejsza rekompensaty; zużyta rekompensata nadal liczy się jako przyznana. Brak dowodu = przypadek nierozstrzygnięty do wyjaśnienia, nie automatyczna kolejna rekompensata.
2. Panel: osobna partia dla każdej pozostałej liczby (1, 2, 3), firmy dodawane wyszukiwarką w modalu. Powód „Rekompensata”, data domyślna (3 miesiące od dnia przyznania), notatka wewnętrzna np. „Rekompensata FM 2026 — uzupełnienie po uzgodnieniu z archiwum 23.09 — decyzja Artura <data>”.
3. Proponowana wiadomość dla odbiorcy (PL; dostawcy EN zobaczą ją w tym samym brzmieniu — wiadomość nie jest tłumaczona):
   > Otrzymują Państwo bezpłatne kredyty PreConnect od organizatora Fresh Market jako rekompensatę za odwołane spotkania z siecią, która nie mogła uczestniczyć w wydarzeniu. Kredyty można wykorzystać do przesłania propozycji dowolnej sieci dostępnej w PreConnect. Najpierw zużywane są kredyty bezpłatne; kredyt jest pobierany dopiero, gdy sieć odczyta propozycję.
4. Po każdej partii: toast z liczbą firm i datą; SQL `select id, company_count, qty, reason, expires_at, created_at from package_grant_batches order by created_at desc limit 3` → dla KAŻDEJ nowej partii: `select count(*), sum(qty_total) from packages where grant_batch_id = '<batch_id>'` = liczba firm i firmy × qty (nie globalny `count(*) where source='grant'`, który obejmuje test i historię).
5. Kontrola u jednego z dostawców (podgląd z admina): baner, karta pul.
6. Komunikat do firm poza aplikacją (mail/newsletter) — osobna decyzja; aplikacja maili nie wysyła.

## Rollback

- **Front/funkcje** (tylko przed krokiem 4b i przed jakimkolwiek przyznaniem): preferowane **przywrócenie poprzedniego deployu w Netlify** (Deploys → deploy dla 37e90c7 zanotowany w kroku 2 → „Publish deploy”), bez ruszania `main`. Alternatywa gitowa wymaga świadomego cofnięcia refa: `git push --force-with-lease=main:<hash głowy main po wdrożeniu> origin refs/tags/prod-rollback-2026-09-27-grants:refs/heads/main` — zwykły push zostanie odrzucony jako non-fast-forward; nie używać bezwarunkowego `--force`. Stary kod działa z nową bazą (nie czyta nowych kolumn), ale rozlicza po staremu: bez grant-first i bez atomowości. **Po kroku 4b lub po przyznaniu kredytów nie przywracać starego deployu** — najpierw wyłączyć nowe przyznania (revoke niżej), zachować migrację, historię i atomowe rozliczanie; rollback backendu uzgodnić osobno.
- **Baza**: migracja addytywna; nie cofać. Ewentualne wyłączenie przyznań = `revoke execute on function public.admin_grant_free_credits(uuid[], integer, text, text, text, text, date) from authenticated`.
- **Kopie** z kroku 1 służą do porównania, nie do przywracania (żadne istniejące wiersze nie są modyfikowane).

## Po wdrożeniu — do notatki §34 w `FM_KOLEJKI_WDROZENIE.md`

Godziny kroków 0–6, wynik kontroli rekompensat, odciski przed/po, id deployu Netlify, `version.json`, wynik testu kontrolowanego, decyzja o 6.7, liczba partii i kredytów z kroku 7.

## Poza zakresem (osobne zadanie, z review Codexa v4)

`netlify/functions/send-retailer-batch.js:181–183, 350–369` — ścieżka wysyłki do sieci kwalifikuje także wiersze `sent` bez znacznika maila i zapisuje cały snapshot po odpowiedzi poczty; równoległy odczyt jest możliwy. Zalecane utwardzenie ograniczonym scalaniem pól (jak `mark_legacy_sends_supplier_notified`) + test wysyłka/odczyt. Nie blokuje tego wdrożenia.
