# ACCOUNT_LIFECYCLE — READ-ONLY DRY-RUN (archiwum)

> Tylko dokumentacja + SELECT-y. Zero zmian danych, zero maili, zero flipa.
> Lustro logiki RPC `claim_due_inactivity_warnings` (migracja 042) — BEZ markerów/UPDATE.

## Logika (z migracji 042)
- Próg nieaktywności: `last_active_at <= now() − 24 miesiące` → kwalifikacja do usunięcia.
- Ostrzeżenie **30 dni**: `now()−24mo+7d < last_active_at <= now()−24mo+30d` i `warn30` niewysłane.
- Ostrzeżenie **7 dni**: `last_active_at <= now()−24mo+7d` i `warn7` niewysłane.
- Warunki: `active = true AND archived_at IS NULL AND last_active_at IS NOT NULL`.
- `delete_after = last_active_at + 24 miesiące`.

## Wynik DRY-RUN (2026-06-08)
| aktywne_konta_z_zegarem | juz_po_progu_24mc | ostrzezenie_30d | ostrzezenie_7d |
|---|---|---|---|
| 30 | 0 | **0** | **0** |

Lista kandydatów (Zapytanie 2): **pusta**. → **Flip byłby cichy: 0 maili.**

## Ważny niuans zegara
`ACCOUNT_LIFECYCLE=OFF` ⇒ `touch_last_active()` NIE bumpuje `last_active_at`
(stoi na dacie backfillu z 042). Dlatego:
- ~22 mc luzu (próg ≈ wiosna 2028) — zero ryzyka teraz,
- ale długie pozostawienie OFF zamraża zegar → po ~22 mc fałszywe „nieaktywni",
- **flip ON naprawia zegar** (od włączenia każde logowanie aktualizuje last_active_at),
  a maile i tak nie pójdą przez ~22 mc.

## Zapytanie 1 — podsumowanie
```sql
with base as (
  select p.id, p.last_active_at, p.inactivity_warn30_sent_at, p.inactivity_warn7_sent_at
  from profiles p
  where p.active = true and p.archived_at is null and p.last_active_at is not null
)
select
  count(*)                                                                                   as aktywne_konta_z_zegarem,
  count(*) filter (where last_active_at <= now() - interval '24 months')                     as juz_po_progu_24mc,
  count(*) filter (where last_active_at <= now() - interval '24 months' + interval '30 days'
                     and last_active_at >  now() - interval '24 months' + interval '7 days'
                     and inactivity_warn30_sent_at is null)                                   as ostrzezenie_30d,
  count(*) filter (where last_active_at <= now() - interval '24 months' + interval '7 days'
                     and inactivity_warn7_sent_at is null)                                    as ostrzezenie_7d
from base;
```

## Zapytanie 2 — lista kandydatów + flaga finansów
```sql
with cand as (
  select p.id as profile_id, p.email, p.role, p.active, p.company_id,
         p.last_active_at, p.created_at,
         (p.last_active_at + interval '24 months')::date as delete_after,
         case
           when p.last_active_at <= now() - interval '24 months' + interval '7 days'
                and p.inactivity_warn7_sent_at is null then '7d'
           when p.last_active_at <= now() - interval '24 months' + interval '30 days'
                and p.last_active_at >  now() - interval '24 months' + interval '7 days'
                and p.inactivity_warn30_sent_at is null then '30d'
         end as etap
  from profiles p
  where p.active = true and p.archived_at is null and p.last_active_at is not null
    and p.last_active_at <= now() - interval '24 months' + interval '30 days'
)
select c.etap, c.email, co.name as firma, c.role, co.account_status as status,
       c.last_active_at, c.created_at, c.delete_after,
       (select count(*) from proformas   pf where pf.company_id=c.company_id) as proformas,
       (select count(*) from packages    pk where pk.company_id=c.company_id) as packages,
       (select count(*) from payu_orders  po where po.company_id=c.company_id and po.status='completed') as payu_completed,
       case when exists(select 1 from proformas pf where pf.company_id=c.company_id)
              or exists(select 1 from packages  pk where pk.company_id=c.company_id)
              or exists(select 1 from payu_orders po where po.company_id=c.company_id and po.status='completed')
            then 'TAK — NIE USUWAĆ AUTOMATYCZNIE / ręczny review' else 'nie' end as ma_finanse
from cand c
left join companies co on co.id=c.company_id
order by c.delete_after, c.email;
```

## Przed flipem na prod — POWTÓRZYĆ DRY-RUN
Tuż przed ewentualnym merge flipa: uruchom Zapytanie 1, potwierdź
`ostrzezenie_30d = 0` i `ostrzezenie_7d = 0`. Jeśli >0 → STOP, przejrzeć listę.

## Zastrzeżenia
- `ACCOUNT_HARD_DELETE` **zostaje OFF** — flip dotyczy TYLKO zegara + ostrzeżeń, nie usuwania.
- Zanim KIEDYKOLWIEK pójdą realne ostrzeżenia/usuwanie: wrócić do tematu
  **regulaminu / §16 / 14 dni powiadomienia** (legal — osobna decyzja).
