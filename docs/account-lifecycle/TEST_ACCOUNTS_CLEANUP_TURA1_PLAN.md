# Plan czyszczenia kont testowych — TURA 1 (do review, BEZ wykonania)

> **Status: PLAN. Nic nie jest wykonane.** Wszystkie DELETE w pliku wykonawczym
> są **zakomentowane**. Żadnych UPDATE, żadnych migracji, żadnych zmian danych,
> żadnego usuwania kont na tym etapie.

## Zakres
- **Tylko 17 firm** z bucketu „USUŃ TURA 1" (raport `TEST_ACCOUNTS_AUDIT_READONLY.md`, sekcja C).
- **NIETKNIĘTE:** `Unica Group`, `Pik Global`, `OKSALE` (DECYZJA PÓŹNIEJ — finanse) oraz oba konta `KJOW`/admin.
- Wszystkie 17 ma potwierdzone `proformas=0, packages=0, credits_used=0, payu_completed=0`.

## Pliki
| Plik | Rola |
|---|---|
| `cleanup_tura1_dryrun.sql` | **READ-ONLY** — re-weryfikacja finansów + liczby wierszy + lista user_id + backup CSV |
| `cleanup_tura1_execute.sql` | **SZABLON** — DELETE-y **zakomentowane**, w kolejności, w transakcji `BEGIN…ROLLBACK` |
| ten dokument | procedura + bezpieczeństwo |

## Kolejność czyszczenia (uzasadnienie)
1. **`legacy_sends` / `legacy_offers`** po `supplier_legacy_id` — **brak FK** do `companies`
   (łączenie po polu tekstowym), więc usunięcie firmy ich NIE skasuje. Trzeba jawnie, najpierw.
2. **(opcjonalnie) `fm_messages`** testów — `from/to_user_id` mają `on delete set null`,
   więc bez tego zostaną osierocone wiersze. Dla testów lepiej usunąć.
3. **`profiles`** (konta-loginy w aplikacji) — `where company_id in (17)`.
4. **`companies`** — kaskaduje `packages` / `payu_orders` / `company_buyers`
   (`proformas.company_id` → NULL, ale tu proformas=0).
5. **`auth.users`** — **OSOBNY, RĘCZNY krok** (Supabase Auth / Admin API), dla user_id z dry-run.
   Usunięcie `profiles` NIE usuwa loginu z Auth.

## Procedura (krok po kroku — do wykonania przez Ciebie, później)
1. **Backup pełny:** Supabase → Database → Backups (snapshot / PITR point).
2. **Backup logiczny:** `cleanup_tura1_dryrun.sql` ZAPYTANIE D → eksport CSV każdej tabeli (17 firm).
3. **Dry-run weryfikacja:** ZAPYTANIE A → wszędzie `0/0/0/0`. Jeśli gdzieś >0 → firma wypada z Tury 1.
4. **Liczby:** ZAPYTANIE B → zapisz ile wierszy zniknie z każdej tabeli (sign-off).
5. **Sandbox (zalecane):** odtwórz bazę na kopii, wykonaj `execute` (odkomentowany) z `COMMIT`,
   sprawdź, że aplikacja działa i znikły tylko te 17 firm. Dopiero potem prod.
6. **Prod:** odkomentuj DELETE w `execute`, uruchom w transakcji, sprawdź liczby przy
   `ROLLBACK`, a gdy się zgadzają — zmień na `COMMIT`.
7. **Krok 4 (auth.users):** osobno, ręcznie, dla user_id z ZAPYTANIA C.
8. **Po fakcie:** ponów ZAPYTANIE 1 (MASTER) z audytu — lista powinna mieć 17 firm mniej.

## Bezpieczniki
- DELETE-y **zakomentowane** — plik nic nie zrobi „jak jest".
- Transakcja domyślnie `ROLLBACK` — nawet po odkomentowaniu nic się nie zapisze, dopóki świadomie nie zmienisz na `COMMIT`.
- `payu_orders` (wszystkie statusy) policzone w ZAPYTANIU B — dla tych 17 `completed=0`,
  ale gdyby były nieukończone wiersze, kaskada `companies` je usunie (transparentnie w liczbie).
- Jeśli jakiś FK zablokuje DELETE `profiles`/`companies` (np. `account_lifecycle_events`),
  zatrzymaj się, zidentyfikuj tabelę-dziecko i dopisz ją do KROKU 1 — **nie forsuj**.

## Czego ten plan NIE robi
- Nie usuwa, nie anonimizuje, nie modyfikuje żadnych danych.
- Nie rusza Unica/Pik/OKSALE ani kont admina.
- Nie wykonuje kroku auth.users.
- Wszystko czeka na Twój ręczny sign-off i wykonanie po Twojej stronie.

## Następny etap (po Twojej decyzji)
- Wykonanie Tury 1 (ręcznie, po backupie + sandbox).
- Osobno: decyzja o Unica/Pik/OKSALE (DECYZJA PÓŹNIEJ).
- Dopiero potem rozważać flip `ACCOUNT_LIFECYCLE` (maile 30/7 dni), gdy dane są czyste.
