# Dostępy testowe dla Codexa — Fresh Market

**Aplikacja:** https://b2b.freshmarket.eu (fallback: https://freshmarketb2b.netlify.app)
**Status:** TEST environment, hasła można ujawniać tylko zaufanym agentom testowym.

---

## Konta testowe (3 role, 3 oddzielne loginy)

> **WAŻNE:** Te konta są dedykowane dla **automatyzacji testowej Codexa**. Po zakończeniu testów zaleca się ich usunięcie albo zmianę haseł.

### 1. ADMIN — pełen dostęp do panelu administratora

| Pole | Wartość |
|---|---|
| Email | `codex.admin@freshmarket.test` |
| Hasło | `CodexAdmin2026!` |
| Rola | `admin` |
| Po logowaniu | Redirect do `/admin` |
| Sidebar | Pipeline / Sieci / Firmy / Wiadomości / FM Spotkania |
| Dodatkowo | Switcher do podglądu jako dowolny dostawca/kupiec |

### 2. SUPPLIER (DOSTAWCA) — Food Market

| Pole | Wartość |
|---|---|
| Email | `codex.supplier@freshmarket.test` |
| Hasło | `CodexSupplier2026!` |
| Rola | `supplier` |
| Firma | Food Market (UUID `11111111-1111-1111-1111-111111111111`) |
| Po logowaniu | Redirect do `/dostawca` |
| Sidebar | Wysyłki / Moje propozycje / Finanse / Twoja firma / Spotkania FM 2026 |

### 3. BUYER (KUPIEC) — Biedronka

| Pole | Wartość |
|---|---|
| Email | `codex.buyer@freshmarket.test` |
| Hasło | `CodexBuyer2026!` |
| Rola | `buyer` |
| Sieć | Biedronka (`retailer_id = 100`) |
| Po logowaniu | Redirect do `/kupiec` |
| Sidebar | Propozycje asortymentowe / Dostawcy / Zapisane / Mój Profil / Spotkania FM 2026 |

---

## Setup — JAK utworzyć te konta (jednorazowe, ~30 sekund)

1. Wejdź do Supabase SQL Editor:
   https://supabase.com/dashboard/project/sklyfuvzjikkqerxtulo/sql/new
2. Otwórz plik **`supabase/tests/e2e_create_test_accounts.sql`**
3. Skopiuj całą zawartość → wklej do SQL Editor → kliknij **Run**
4. Skrypt:
   - Tworzy 3 konta w `auth.users` z hashed bcrypt password
   - Auto-confirmuje email (pomija weryfikację)
   - Ustawia rolę i przypisanie (company_id / retailer_id) w `profiles`
   - Pomija tworzenie jeśli konto już istnieje (idempotent)
5. Wynik na końcu pokazuje 3 wiersze: email + rola + nazwa

**Po uruchomieniu** Codex może logować się dowolnym z tych 3 emaili.

---

## Test scenariusze dla Codexa

### A. Test izolacji (każda rola widzi tylko swoje)
1. Login `codex.admin@...` — w panelu admin powinien widzieć **wszystkie** wysyłki w Pipeline
2. Login `codex.supplier@...` — w "Moje propozycje" widzi oferty Food Market + ze seed
3. Login `codex.buyer@...` — w "Propozycje asortymentowe" widzi tylko oferty wysłane do Biedronki (retailer 100)

### B. Test PreConnect flow
1. Login `codex.supplier@...` → "Dodaj propozycję" → Step 1-3 → Opublikuj
2. → Wysyłki → Wyślij do Biedronki → status `pending_moderation`
3. Wyloguj, login `codex.admin@...` → Pipeline → Zatwierdź → Wyślij → status `sent`
4. Wyloguj, login `codex.buyer@...` → Propozycje asortymentowe → Powinieneś widzieć nową ofertę

### C. Test uploadu zdjęć
1. Login `codex.supplier@...` → Twoja firma → Logo → drag&drop pliku PNG
2. Login `codex.supplier@...` → Moje propozycje → edytuj ofertę → Step 1 D. Zdjęcia → drag&drop 1-3 plików
3. Sprawdzenie po stronie `codex.buyer@...`: oferta widoczna z miniaturą głównego zdjęcia + accordion "Zdjęcia produktu (N)"

### D. Test FM 2026 (Fresh Market 2026)
1. Login `codex.admin@...` → FM Spotkania → włącz `schedulingOpen=true` (lub przez SQL)
2. Login `codex.supplier@...` → Wybór sieci → wybierz top 5 + 60
3. Login `codex.buyer@...` → Spotkania FM 2026 → akceptuj/odrzuć dostawców
4. Powrót do `codex.admin@...` → Uruchom algorytm matchingu → opublikuj harmonogram
5. Wszystkie role widzą swoje spotkania

### E. Test izolacji storage (zdjęcia)
1. `codex.supplier@...` wgrywa logo firmy → jest w `company-logos` bucket
2. `codex.buyer@...` widzi to logo (jeśli jego sieć ma wysyłkę od tego dostawcy)
3. Inny kupiec (np. retailer 999, brak ofert) NIE widzi tego logo

---

## Kontrola — sprawdzenie czy konta istnieją

W Supabase SQL Editor:

```sql
select u.email, p.role::text, p.name,
       coalesce(p.retailer_id::text, '—') as retailer,
       coalesce(p.company_id::text, '—') as company
from auth.users u
left join profiles p on p.id = u.id
where u.email like 'codex.%@freshmarket.test'
order by p.role;
```

**Oczekiwany wynik:**
| email | rola | name | retailer | company |
|---|---|---|---|---|
| codex.admin@freshmarket.test | admin | Codex Admin | — | — |
| codex.buyer@freshmarket.test | buyer | Codex Buyer Biedronka | 100 | — |
| codex.supplier@freshmarket.test | supplier | Codex Supplier | — | 11111111-... |

---

## Czyszczenie po testach (opcjonalne)

Jeśli chcesz usunąć konta testowe:

```sql
delete from auth.users where email like 'codex.%@freshmarket.test';
-- profiles zostaną usunięte przez ON DELETE CASCADE
```

---

## Uwagi bezpieczeństwa

- Hasła w plain text w tym dokumencie są celowo (test environment, sharing z agentem testowym)
- Te konta NIE mają dostępu do żadnych prawdziwych danych handlowych — wszystko to seed/test data
- Email confirmation jest WYŁĄCZONE w Supabase (na czas testów) — produkcja powinna mieć włączone
- Storage RLS pozwala każdemu authenticated na upload — produkcja powinna mieć ściślejsze polityki

**Po zakończeniu testów Codex'a:** zmień hasła wszystkich kont (lub usuń je całkowicie).
