# P3 — Plan sandboxowy: destrukcyjna część #8 (archiwizacja → anonimizacja / usunięcie)

> **Status: PLAN. Brak kodu wykonującego usuwanie/anonimizację.**
> `ACCOUNT_HARD_DELETE = false` i niepodpięte. Ten dokument NIE implementuje
> niczego destrukcyjnego — opisuje, jak to bezpiecznie zaprojektować i przetestować
> na **osobnym projekcie sandbox Supabase**, zanim cokolwiek dotknie produkcji.

## 1. Co już jest (fundament — bezpieczny, gotowy)

Zaimplementowane i za flagą `ACCOUNT_LIFECYCLE` (default OFF), bez destrukcji:

- `profiles.last_active_at` — śledzenie aktywności (bump przy wejściu do aplikacji),
  backfill `now()` przy migracji (zero przedwczesnych usunięć).
- Markery ostrzeżeń: `inactivity_warn30_sent_at`, `inactivity_warn7_sent_at`.
- Kolumny archiwum (przygotowane, **jeszcze nieużywane**): `archived_at`,
  `archived_by`, `archived_reason`.
- RPC `touch_last_active()`, `claim_due_inactivity_warnings()` (okna 30/7 dni rozłączne).
- Funkcja `send-inactivity-warnings` + szablon `inactivity-template.js` (PL/EN, 30/7 dni).
- Regulamin §16 (24 mc, ostrzeżenia, RODO) — opublikowany w HTML, wersja 1.2 (pending publikacji).

**Co NIE jest zrobione (celowo):** wykonanie archiwizacji (ustawienie `archived_at` +
blokada logowania), anonimizacja, hard-delete, FK→set-null + snapshoty finansowe,
tabela `gdpr_requests`. To zakres tego planu.

## 2. Zakres destrukcyjny do zaprojektowania

| Operacja | Trigger | Odwracalność | Flaga |
|---|---|---|---|
| **Auto-archiwizacja** po 24 mc | sweep (po okresie ostrzeżeń) | odwracalna (restore w grace) | `ACCOUNT_LIFECYCLE` |
| **Anonimizacja** (domyślna wg decyzji) | po grace (np. 90 dni od archiwizacji) | **nieodwracalna** dla PII | `ACCOUNT_HARD_DELETE` |
| **Hard-delete** | tylko super-admin, ręcznie | **nieodwracalna** | `ACCOUNT_HARD_DELETE` |

Decyzja Operatora (potwierdzona): po 24 mc → **anonimizacja** (zachowanie historii
finansowej); hard-delete tylko ręcznie przez super-admina.

## 3. Model danych / migracje DO ZAPROJEKTOWANIA (NIE aplikować na prod)

Numeracja ≥ **044** (043 zajęte przez proforma-activation). Budować na P3_MIGRATION_PLAN.md.

- **044 — delete-safety (FK → set null + snapshoty).** Aby anonimizacja/usunięcie konta
  NIE kasowało historii finansowej: `payu_orders`, `proformas`, `packages` powinny mieć
  `company_id` z `on delete set null` + snapshoty (`company_name_snapshot`,
  `company_nip_snapshot` — proformy już mają; payu_orders/packages do uzupełnienia).
  *To migracja zmieniająca FK — najwyższe ryzyko, wymaga testu na kopii schematu.*
- **045 — anonimizacja.** RPC `anonymize_account(p_profile_id)` (SECURITY DEFINER,
  super-admin only): pseudonimizuje `profiles` (email→`deleted-<uuid>@anonim.invalid`,
  name→`[usunięto]`), `companies` (name/nip/phone→placeholdery), ustawia
  `archived_at`/`archived_reason='gdpr_anonymized'`; **NIE rusza** payu_orders/proformas
  (zostają ze snapshotami i `company_id` = NULL po set-null).
- **046 — gdpr_requests** (wg P3): rejestr wniosków RODO (typ, status, daty, target).
- **Sweep wykonujący** (rozszerzenie `claim_due_inactivity_warnings`): `scan_and_archive_inactive()`
  — po przekroczeniu 24 mc + braku reakcji ustawia `archived_at` i (opcjonalnie)
  `auth.users.banned_until` (blokada logowania, przez service-role w funkcji Netlify).

## 4. Bramki bezpieczeństwa (wymagane PRZED jakąkolwiek destrukcją)

1. Flaga `ACCOUNT_HARD_DELETE = false` — anonimizacja/hard-delete całkowicie wyłączone,
   funkcje/RPC nie wołane, brak UI. Archiwizacja-wykonanie również za tą flagą.
2. **Super-admin gate** dla anonimizacji i hard-delete (nie zwykły admin).
3. **Grace period** (np. 90 dni od `archived_at`) przed anonimizacją — okno na restore.
4. **Pre-checki** (z P3): brak otwartych płatności (`payu_orders.status in (pending,created)`),
   brak aktywnych wysyłek (`legacy_sends` queued/approved/sent).
5. **Typed confirmation** (wpisz nazwę firmy) + checkboxy potwierdzające w UI hard-delete.
6. **Audit trail**: `account_lifecycle_events` — log każdej archiwizacji/anonimizacji/restore.
7. **Idempotencja**: ponowne wywołanie nie kasuje drugi raz / nie wysyła drugiego maila.

## 5. RODO

- **Anonimizacja domyślna** — PII pseudonimizowane; **historia rozliczeń (payu_orders,
  proformy, faktury) zachowana** w zakresie i okresie wymaganym prawem (ustawa o
  rachunkowości — zwykle 5 lat). Zgodne z §16 regulaminu i art. 5 ust. 1 lit. e RODO.
- **Hard-delete** tylko gdy brak obowiązku retencji i decyzja super-admina.
- **gdpr_requests** — ścieżka wniosku „usuń moje dane" (art. 17 RODO): wniosek →
  weryfikacja → anonimizacja, z zachowaniem śladu finansowego.

## 6. Procedura testowa na SANDBOXIE (rdzeń planu)

> **Bezwzględnie: osobny projekt Supabase (sandbox), NIGDY produkcja.** Osobny
> `SUPABASE_URL` / klucze; deploy preview Netlify wskazujący na sandbox.

**Krok 0 — izolacja.** Utwórz sandbox project (kopia schematu prod, dane TESTOWE).
Potwierdź, że env preview NIE wskazuje na prod (sprawdź `SUPABASE_URL`).

**Krok 1 — fundament.** Zaaplikuj migracje 039–043 + 042 (foundation) na sandbox.

**Krok 2 — seed.** Wstaw konta testowe z cofniętym `last_active_at`:
- konto A: `now() - 23 miesiące` (próg ostrzeżenia 30 dni),
- konto B: `now() - 24 miesiące + 7 dni` (próg 7 dni),
- konto C: `now() - 25 miesięcy` (kwalifikuje się do archiwizacji),
- konto D: aktywne (`now()`) — kontrola negatywna (nie może być ruszone).
Każde z testową historią: pakiet (kredyty), proforma, payu_order.

**Krok 3 — ostrzeżenia (już zbudowane).** Flip `ACCOUNT_LIFECYCLE=true` na sandbox,
wywołaj sweep. Oczekiwane: A→mail 30d, B→mail 7d, C→(oba markery), D→nic. Sprawdź
idempotencję (drugie wywołanie = 0 maili).

**Krok 4 — migracje destrukcyjne (044–046).** Zaaplikuj na sandbox. Test FK→set-null:
zsymuluj `company_id=NULL` na payu_orders/proformy → wiersze przeżywają ze snapshotami.

**Krok 5 — archiwizacja-wykonanie.** Flip `ACCOUNT_HARD_DELETE=true` **na sandbox**.
Wywołaj `scan_and_archive_inactive()`. Oczekiwane: C zarchiwizowane (`archived_at` set,
login zablokowany), A/B/D nietknięte. Test **restore** w grace.

**Krok 6 — anonimizacja.** Po (symulowanym) grace wywołaj `anonymize_account(C)`.
Weryfikuj:
- PII konta C pseudonimizowane (email/nazwa/NIP = placeholdery),
- **payu_orders / proforma C nadal istnieją** ze snapshotami (historia finansowa OK),
- `account_lifecycle_events` ma wpis,
- anonimizacja nieodwracalna (brak ścieżki recover PII),
- D (aktywne) całkowicie nietknięte.

**Krok 7 — uprawnienia.** Próba wywołania anonymize/hard-delete jako zwykły admin /
dostawca → odmowa (super-admin gate, RLS). Próba przy otwartej płatności → blokada.

**Krok 8 — rollback.** Flip obie flagi OFF → sweepy nie wołane, UI ukryte, zero zmian.

## 7. Kryteria wyjścia (sign-off przed PROD)

- [ ] Wszystkie testy 1–8 zielone na sandboxie.
- [ ] Historia finansowa udowodniono, że przeżywa anonimizację i hard-delete.
- [ ] Brak ścieżki, w której prod-dane mogłyby zostać dotknięte (env-guard zweryfikowany).
- [ ] Super-admin gate + grace + pre-checki działają.
- [ ] Regulamin §16 formalnie opublikowany (data + 14-dniowe powiadomienie, decyzja Operatora).
- [ ] Osobny przegląd prawny anonimizacji vs retencji (ustawa o rachunkowości).

## 8. Non-goals tego etapu

- **Brak** kodu wykonującego archiwizację/anonimizację/hard-delete w repo (poza tym planem).
- `ACCOUNT_HARD_DELETE` pozostaje `false` i niepodpięte aż do zielonego sign-offu sandbox.
- Żadnych migracji 044+ aplikowanych na produkcji.
