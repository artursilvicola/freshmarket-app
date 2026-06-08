# Audyt kont testowych dostawców — READ-ONLY (raport do review)

> **Status: tylko do odczytu. Żadnych DELETE/UPDATE, żadnych migracji, żadnego
> usuwania/anonimizacji kont.** Ten dokument to wyłącznie zestaw `SELECT`-ów do
> ręcznego uruchomienia w Supabase SQL Editor + reguły klasyfikacji. Decyzja
> (USUŃ / ZANONIMIZUJ / ZOSTAW) należy do Ciebie, per konto.

## Cel
Przygotować czystą listę kont dostawców z rekomendacją:
- **ZOSTAW** — ma historię finansową (proformy / zużyte kredyty / zaksięgowane PayU). **Nie ruszać bez osobnej decyzji** (księgowość).
- **ZANONIMIZUJ** — brak finansów, ale jest ślad operacyjny (wysyłki / oferty / wiadomości). Zachować historię operacyjną, usunąć PII.
- **USUŃ** — zero śladu wszędzie. Bezpieczne do skasowania.
- **NIGDY (pomiń)** — konto admina (`role='admin'` lub `admin_level` ustawione).

## Schemat / klucze łączące (zweryfikowane w migracjach)
| Zależność | Tabela | Klucz do firmy |
|---|---|---|
| Proformy | `proformas` (040) | `company_id → companies.id` |
| Pakiety kredytów | `packages` (001) | `company_id → companies.id` (+ `qty_used`) |
| Płatności PayU | `payu_orders` (024) | `company_id → companies.id` (status `completed` = zaksięgowane) |
| Wysyłki (PreConnect) | `legacy_sends` (004) | `supplier_legacy_id → companies.legacy_supplier_id` |
| Oferty | `legacy_offers` (004) | `supplier_legacy_id → companies.legacy_supplier_id` |
| Wiadomości | `fm_messages` | `from_user_id` / `to_user_id → profiles.id` (profile firmy) |
| Konto / login | `profiles` | `company_id → companies.id`; `role`, `admin_level`, `email`, `last_active_at` |

---

## Zapytanie 1 — MASTER: wszystkie firmy dostawców + zależności + rekomendacja
```sql
with sup as (
  select c.id as company_id, c.name as company, c.nip, c.legacy_supplier_id,
         c.account_status, c.created_at,
         (select string_agg(distinct p.email, ', ') from profiles p where p.company_id = c.id) as emails,
         (select max(p.last_active_at)            from profiles p where p.company_id = c.id) as last_active_at,
         (select count(*) from profiles p where p.company_id = c.id and (p.role = 'admin' or p.admin_level is not null)) as admin_profiles,
         (select array_agg(p.id) from profiles p where p.company_id = c.id) as profile_ids
  from companies c
),
dep as (
  select s.*,
    (select count(*) from proformas    pf where pf.company_id = s.company_id)                              as proformas,
    (select count(*) from packages     pk where pk.company_id = s.company_id)                              as packages,
    (select coalesce(sum(coalesce(pk.qty_used,0)),0) from packages pk where pk.company_id = s.company_id)  as credits_used,
    (select count(*) from payu_orders  po where po.company_id = s.company_id and po.status = 'completed')  as payu_completed,
    (select count(*) from legacy_sends ls where ls.supplier_legacy_id = s.legacy_supplier_id)              as sends,
    (select count(*) from legacy_offers lo where lo.supplier_legacy_id = s.legacy_supplier_id)             as offers,
    (select count(*) from fm_messages   m where m.from_user_id = any(s.profile_ids) or m.to_user_id = any(s.profile_ids)) as messages
  from sup s
)
select company_id, company, nip, emails, account_status, created_at, last_active_at,
       proformas, packages, credits_used, payu_completed, sends, offers, messages,
       (coalesce(emails,'') ~* '(test|example|demo|qa|sandbox|\+)') as looks_test,  -- HINT, nie decyzja
       case
         when admin_profiles > 0 then 'NIGDY (admin — pomiń)'
         when proformas > 0 or credits_used > 0 or payu_completed > 0 then 'ZOSTAW (historia finansowa)'
         when sends > 0 or offers > 0 or messages > 0 then 'ZANONIMIZUJ (ślad operacyjny)'
         else 'USUN (zero sladu)'
       end as rekomendacja
from dep
order by rekomendacja, company;
```
Kolumny: `company, nip, emails, account_status, created_at, last_active_at` + liczniki
(`proformas, packages, credits_used, payu_completed, sends, offers, messages`) + `looks_test`
(heurystyka po e-mailu — tylko podpowiedź) + `rekomendacja`.

---

## Zapytanie 2 — MUST-KEEP: konta z historią finansową (NIE usuwać bez decyzji)
```sql
select c.id as company_id, c.name as company, c.nip,
       (select string_agg(distinct p.email, ', ') from profiles p where p.company_id = c.id) as emails,
       (select count(*) from proformas pf where pf.company_id = c.id) as proformas,
       (select coalesce(sum(coalesce(pk.qty_used,0)),0) from packages pk where pk.company_id = c.id) as credits_used,
       (select count(*) from payu_orders po where po.company_id = c.id and po.status='completed') as payu_completed
from companies c
where (select count(*) from proformas pf where pf.company_id = c.id) > 0
   or (select coalesce(sum(coalesce(pk.qty_used,0)),0) from packages pk where pk.company_id = c.id) > 0
   or (select count(*) from payu_orders po where po.company_id = c.id and po.status='completed') > 0
order by company;
```

## Zapytanie 3 — ZANONIMIZUJ: brak finansów, jest ślad operacyjny
```sql
select c.id as company_id, c.name as company,
       (select string_agg(distinct p.email, ', ') from profiles p where p.company_id = c.id) as emails,
       (select count(*) from legacy_sends ls where ls.supplier_legacy_id = c.legacy_supplier_id) as sends,
       (select count(*) from legacy_offers lo where lo.supplier_legacy_id = c.legacy_supplier_id) as offers
from companies c
where not exists (select 1 from proformas pf where pf.company_id = c.id)
  and coalesce((select sum(coalesce(pk.qty_used,0)) from packages pk where pk.company_id = c.id),0) = 0
  and not exists (select 1 from payu_orders po where po.company_id = c.id and po.status='completed')
  and not exists (select 1 from profiles p where p.company_id = c.id and (p.role='admin' or p.admin_level is not null))
  and (
       exists (select 1 from legacy_sends  ls where ls.supplier_legacy_id = c.legacy_supplier_id)
    or exists (select 1 from legacy_offers lo where lo.supplier_legacy_id = c.legacy_supplier_id)
    or exists (select 1 from fm_messages m join profiles p on p.id in (m.from_user_id, m.to_user_id) where p.company_id = c.id)
  )
order by company;
```

## Zapytanie 4 — USUŃ: zero śladu wszędzie (kandydaci do skasowania)
```sql
select c.id as company_id, c.name as company, c.nip, c.created_at,
       (select string_agg(distinct p.email, ', ') from profiles p where p.company_id = c.id) as emails
from companies c
where not exists (select 1 from proformas pf where pf.company_id = c.id)
  and not exists (select 1 from packages  pk where pk.company_id = c.id)
  and not exists (select 1 from payu_orders po where po.company_id = c.id)
  and not exists (select 1 from legacy_sends  ls where ls.supplier_legacy_id = c.legacy_supplier_id)
  and not exists (select 1 from legacy_offers lo where lo.supplier_legacy_id = c.legacy_supplier_id)
  and not exists (select 1 from fm_messages m join profiles p on p.id in (m.from_user_id, m.to_user_id) where p.company_id = c.id)
  and not exists (select 1 from profiles p where p.company_id = c.id and (p.role='admin' or p.admin_level is not null))
order by created_at;
```

## Zapytanie 5 — kontrola: konta admina (mają zostać POMINIĘTE w czyszczeniu)
```sql
select c.id as company_id, c.name as company, p.email, p.role, p.admin_level
from profiles p
left join companies c on c.id = p.company_id
where p.role = 'admin' or p.admin_level is not null
order by p.admin_level nulls last, p.email;
```

---

## Jak czytać / dalsze kroki
1. **Uruchom Zapytanie 1** (master) → eksport do CSV. To pełny obraz.
2. **Zapytanie 5** → upewnij się, że Twoje konto (i inne admina) są na liście „NIGDY".
3. **Zapytanie 2** (must-keep) → te konta NIE idą do kasacji ani anonimizacji bez osobnej, świadomej decyzji (historia księgowa).
4. **Zapytanie 4** (zero śladu) → najbezpieczniejsi kandydaci do USUŃ; przejrzyj listę, oznacz które to realnie testy.
5. **Zapytanie 3** (anonimizacja) → konta z samym śladem operacyjnym; decyzja: anonimizować czy zostawić.
6. Dla każdego konta wpisz finalną decyzję (USUŃ / ZANONIMIZUJ / ZOSTAW). Heurystyka `looks_test` to tylko podpowiedź — **nie podejmuje decyzji za Ciebie**.

> **Następny etap (osobno, dopiero po Twojej liście):** wykonanie decyzji = działania
> destrukcyjne (anonimizacja / usuwanie). To **nie** jest częścią tego audytu — wejdzie
> za osobną flagą / planem z sign-offem (`ACCOUNT_HARD_DELETE` / `P3_DESTRUCTIVE_SANDBOX_PLAN`),
> z backupem i na sandboxie najpierw. Audyt niczego nie zmienia.

## Uwagi techniczne
- Wszystkie zapytania to czyste `SELECT` (+ CTE). Zero `DELETE`/`UPDATE`/`INSERT`/`ALTER`.
- `payu_completed` liczy tylko `status='completed'` (realnie zaksięgowane); `payu_orders` ogółem (też nieudane) jest w Zapytaniu 4 jako twardy „zero śladu".
- Jeśli któraś tabela nie istnieje w Twojej instancji (np. brak `fm_messages`) — usuń odpowiedni pod-`SELECT`; reszta zadziała.
- Audyt patrzy na firmy (`companies`) jako jednostkę dostawcy; konto-login to `profiles.company_id`.

---

# FINALNA LISTA DECYZYJNA (na podstawie wyniku MASTER z 2026-06-07)

> **Decyzja robocza Artura. Dalej TYLKO dokument — żadnego DELETE/UPDATE,
> żadnej migracji, żadnego usuwania kont.** Wykonanie = osobny etap (backup +
> sandbox + sign-off).

## A. DO ZOSTAWIENIA (na stałe) — 2
| company_id | firma | email | powód |
|---|---|---|---|
| `aaaaaaaa-bbbb-cccc-dddd-000000000001` | KJOW | artur@kjow.pl | admin |
| `9d27a028-bec0-4983-a436-5672efa3bdac` | KJOW Sp. z o.o. | sveta.stasiak@gmail.com | admin (NIP 1181976336 — realny) |

## B. DO DECYZJI PÓŹNIEJ (zostaw na razie — historia finansowa) — 3
| company_id | firma | email | finanse |
|---|---|---|---|
| `22222222-2222-2222-2222-222222222222` | Unica Group | artur.silvicola@gmail.com | proformy 2, kredyty 11 (seed UUID) |
| `33333333-3333-3333-3333-333333333333` | Pik Global | — | kredyty 5 (seed UUID) |
| `86457091-5171-44ce-a2a0-f032187a53b7` | OKSALE | oksale.pl@gmail.com | pakiet 1, kredyt 1 |
> Nie ruszać w turze 1. Decyzja seed-vs-realne osobno; usunięcie firmy finansowej
> kaskaduje `packages` i osierocą `proformas` (`company_id`→NULL) — wymaga świadomej zgody.

## C. DO USUNIĘCIA — TURA 1 (bez finansów) — 17
**C1. Zero śladu (13):**
| company_id | firma | email |
|---|---|---|
| `ce29858e-2344-453b-a485-4b2b9e29bcbb` | Codex Rejestracja Test 20260524165910 | — |
| `df78bad1-64a9-4809-9c06-fab7bb697d43` | Codex Rejestracja Test 20260524171134 | — |
| `8bbc4f7f-2eba-49bc-8600-f0e1c1ed87d8` | Dodstawca | — |
| `6a71aa14-701f-4475-85be-ba6da902f6f9` | Ekosady | aaaa@freshmarket.com.pl |
| `11111111-1111-1111-1111-111111111111` | Food Market | — (seed UUID) |
| `c4633c15-5b94-45a6-a7e4-d6b17c9613a0` | Marek Fruit | market@freshmarket.eu |
| `eca5955a-c45b-4d56-a481-ea93426259fb` | Profisad | artur@fresh-market.pl |
| `a8656d6a-1bd9-4ce8-89db-6f1487926a9c` | Test rbc | jjj@onet.pl |
| `e965d577-481f-4ef6-b5a4-2f14d9bc8227` | Test Supplier Sp. z o.o. | — |
| `6626ac84-6a9c-40b5-af9c-b648043e6999` | test1 | test1@kjow.pl |
| `6a39171a-b8ee-4cb5-911c-fa4c83ac3b4a` | Test5 | — (NIP 454545455) |
| `6dd7d223-fef9-4d7a-abbd-8722f93250f4` | Test5 | test7@kjow.pl |
| `b001b010-7310-42c5-9754-2058e06b1d95` | Test6 | — (NIP 44455334444) |

**C2. Ślad operacyjny, ale potwierdzony test + brak finansów → USUŃ zamiast anonimizować (4):**
| company_id | firma | email | ślad operacyjny |
|---|---|---|---|
| `70c10dbb-cd9c-4eb7-ab24-af0fc6070478` | Ecogroupa | pr@freshmarket.eu | sends 1, offers 2, msg 1 |
| `4d3ddc85-6148-49d4-9a8a-340241060bcc` | Food Market Court | artur.stasiak@kjow.pl | sends 5, offers 4, msg 1 |
| `a6365067-785f-4009-a5b7-6e6b24133648` | Polfarm S. A. | test3@kjow.pl | sends 3, offers 3, msg 1 |
| `6d3ef58a-03ea-4819-bbf4-6bf4074d84df` | Test6 | test6@freshmarket.eu | msg 1 |

Razem TURA 1: **17 firm** (13 zero-śladu + 4 testy-operacyjne). Wszystkie:
`proformas=0, packages=0, credits_used=0, payu_completed=0`.

## Read-only WERYFIKACJA przed turą 1 (SELECT — uruchomić tuż przed kasacją)
> Potwierdza, że 17 firm NADAL nie ma żadnych finansów (gdyby coś doszło między audytem a kasacją).
```sql
with tura1(company_id) as (values
  ('ce29858e-2344-453b-a485-4b2b9e29bcbb'::uuid),('df78bad1-64a9-4809-9c06-fab7bb697d43'),
  ('8bbc4f7f-2eba-49bc-8600-f0e1c1ed87d8'),('6a71aa14-701f-4475-85be-ba6da902f6f9'),
  ('11111111-1111-1111-1111-111111111111'),('c4633c15-5b94-45a6-a7e4-d6b17c9613a0'),
  ('eca5955a-c45b-4d56-a481-ea93426259fb'),('a8656d6a-1bd9-4ce8-89db-6f1487926a9c'),
  ('e965d577-481f-4ef6-b5a4-2f14d9bc8227'),('6626ac84-6a9c-40b5-af9c-b648043e6999'),
  ('6a39171a-b8ee-4cb5-911c-fa4c83ac3b4a'),('6dd7d223-fef9-4d7a-abbd-8722f93250f4'),
  ('b001b010-7310-42c5-9754-2058e06b1d95'),('70c10dbb-cd9c-4eb7-ab24-af0fc6070478'),
  ('4d3ddc85-6148-49d4-9a8a-340241060bcc'),('a6365067-785f-4009-a5b7-6e6b24133648'),
  ('6d3ef58a-03ea-4819-bbf4-6bf4074d84df'))
select c.id, c.name,
  (select count(*) from proformas pf where pf.company_id=c.id) as proformas,
  (select count(*) from packages pk where pk.company_id=c.id) as packages,
  (select count(*) from payu_orders po where po.company_id=c.id and po.status='completed') as payu_completed
from companies c join tura1 on tura1.company_id=c.id
order by c.name;
-- OCZEKIWANE: wszędzie 0/0/0. Jeśli gdzieś >0 → wypadać z tury 1.
```

## Uwagi do PRZYSZŁEGO etapu destrukcyjnego (NIE teraz)
- **`legacy_sends` / `legacy_offers` nie mają FK do companies** (łączenie po `supplier_legacy_id` text) → usunięcie firmy NIE skasuje ich automatycznie. Plan czyszczenia musi je usunąć osobno (po `supplier_legacy_id`), inaczej zostaną osierocone wiersze.
- **`packages`** → `on delete cascade` (znikną z firmą). **`proformas`** → `company_id`→NULL (zostają). **`fm_messages`** → `to/from_user_id`→NULL przy usunięciu usera.
- Usunięcie konta-loginu to też `auth.users` (Supabase Auth) — osobny krok od `companies`/`profiles`.
- **Kolejność i backup:** najpierw pełny backup, potem sandbox, potem dopiero prod. Wszystko za sign-offem, poza tym dokumentem.

## Następny krok
1. (opcjonalnie) Uruchom „WERYFIKACJĘ przed turą 1" — potwierdź 0/0/0.
2. Po Twojej akceptacji listy → przygotuję **osobny plan czyszczenia** (z kolejnością DELETE dla profiles/companies/legacy_sends/legacy_offers/auth, backupem i sandboxem) — DO REVIEW, nadal bez wykonania.
