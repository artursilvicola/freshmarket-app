-- ===========================================================================
-- Faza 2 RPC — DRY-RUN (READ-ONLY) dla expire_legacy_sends_14d na kotwicy mailingu
-- ===========================================================================
-- Tylko SELECT. Bez create function, bez update/insert, bez migracji, bez RPC.
-- Pierwszy wtorek liczony INLINE w zapytaniu. Parsowanie dat guardowane regexem
-- (krzywy rekord = NULL, nie wyjątek), więc nic nie wywali zapytania.
--
-- Kotwica NOWA  : mailingSentAt -> emailSentAt -> first_tuesday_on_or_after(base)
--                 -> sentAt -> updated_at        (base = sendDate -> sentAt -> updated_at)
-- Kotwica STARA : sentAt -> updated_at
-- Granulacja: dzień (current_date - 14). Dla review w zupełności wystarcza.
--
-- Każde zapytanie wklejaj OSOBNO. Zapytania 1-3 współdzielą ten sam prolog CTE.
-- ===========================================================================


-- ===========================================================================
-- ZAPYTANIE 1 — PODSUMOWANIE (extra_would_expire / rescued_would_not_expire / total)
-- ===========================================================================
with s as (
  select ls.legacy_id, ls.status, ls.supplier_legacy_id, ls.retailer_id, ls.updated_at,
         nullif(ls.data->>'sendDate','')      as send_date_raw,
         nullif(ls.data->>'sentAt','')        as sent_at_raw,
         nullif(ls.data->>'emailSentAt','')   as email_sent_at_raw,
         nullif(ls.data->>'mailingSentAt','') as mailing_sent_at_raw
  from legacy_sends ls
  where ls.status = 'sent'
),
p as (
  select s.*,
    case when send_date_raw       ~ '^\d{4}-\d{2}-\d{2}' then substring(send_date_raw       from 1 for 10)::date end as send_date,
    case when sent_at_raw         ~ '^\d{4}-\d{2}-\d{2}' then substring(sent_at_raw         from 1 for 10)::date end as sent_at,
    case when email_sent_at_raw   ~ '^\d{4}-\d{2}-\d{2}' then substring(email_sent_at_raw   from 1 for 10)::date end as email_sent_at,
    case when mailing_sent_at_raw ~ '^\d{4}-\d{2}-\d{2}' then substring(mailing_sent_at_raw from 1 for 10)::date end as mailing_sent_at
  from s
),
b as (
  select p.*, coalesce(send_date, sent_at, updated_at::date) as base_date from p
),
ft as (
  select b.*,
    (date_trunc('month', base_date)::date
       + ((2 - extract(dow from date_trunc('month', base_date))::int + 7) % 7)) as ft_this,
    ((date_trunc('month', base_date) + interval '1 month')::date
       + ((2 - extract(dow from (date_trunc('month', base_date) + interval '1 month'))::int + 7) % 7)) as ft_next
  from b
),
a as (
  select ft.*,
    case when base_date <= ft_this then ft_this else ft_next end as planned_mailing_date,
    coalesce(sent_at, updated_at::date) as old_anchor,
    coalesce(mailing_sent_at, email_sent_at,
             (case when base_date <= ft_this then ft_this else ft_next end),
             sent_at, updated_at::date) as proposed_anchor
  from ft
),
v as (
  select a.*,
    (old_anchor      < (current_date - 14)) as old_exp,
    (proposed_anchor < (current_date - 14)) as new_exp
  from a
)
select
  count(*) filter (where new_exp and not old_exp) as extra_would_expire,        -- MUSI 0 / ręczna akceptacja
  count(*) filter (where old_exp and not new_exp) as rescued_would_not_expire,  -- może >0 (oczekiwane)
  count(*)                                        as total_sent
from v;


-- ===========================================================================
-- ZAPYTANIE 2 — LISTA EXTRA (nowa wygasi, stara NIE) — rekordy ryzyka
-- ===========================================================================
with s as (
  select ls.legacy_id, ls.status, ls.supplier_legacy_id, ls.retailer_id, ls.updated_at,
         nullif(ls.data->>'sendDate','')      as send_date_raw,
         nullif(ls.data->>'sentAt','')        as sent_at_raw,
         nullif(ls.data->>'emailSentAt','')   as email_sent_at_raw,
         nullif(ls.data->>'mailingSentAt','') as mailing_sent_at_raw
  from legacy_sends ls
  where ls.status = 'sent'
),
p as (
  select s.*,
    case when send_date_raw       ~ '^\d{4}-\d{2}-\d{2}' then substring(send_date_raw       from 1 for 10)::date end as send_date,
    case when sent_at_raw         ~ '^\d{4}-\d{2}-\d{2}' then substring(sent_at_raw         from 1 for 10)::date end as sent_at,
    case when email_sent_at_raw   ~ '^\d{4}-\d{2}-\d{2}' then substring(email_sent_at_raw   from 1 for 10)::date end as email_sent_at,
    case when mailing_sent_at_raw ~ '^\d{4}-\d{2}-\d{2}' then substring(mailing_sent_at_raw from 1 for 10)::date end as mailing_sent_at
  from s
),
b as (select p.*, coalesce(send_date, sent_at, updated_at::date) as base_date from p),
ft as (
  select b.*,
    (date_trunc('month', base_date)::date
       + ((2 - extract(dow from date_trunc('month', base_date))::int + 7) % 7)) as ft_this,
    ((date_trunc('month', base_date) + interval '1 month')::date
       + ((2 - extract(dow from (date_trunc('month', base_date) + interval '1 month'))::int + 7) % 7)) as ft_next
  from b
),
a as (
  select ft.*,
    coalesce(sent_at, updated_at::date) as old_anchor,
    coalesce(mailing_sent_at, email_sent_at,
             (case when base_date <= ft_this then ft_this else ft_next end),
             sent_at, updated_at::date) as proposed_anchor
  from ft
),
v as (
  select a.*, (old_anchor < (current_date - 14)) as old_exp, (proposed_anchor < (current_date - 14)) as new_exp from a
)
select v.legacy_id,
       c.name as company, r.name as retailer, v.status,
       v.send_date, v.sent_at, v.email_sent_at, v.mailing_sent_at,
       v.old_anchor, v.proposed_anchor, 'EXTRA' as bucket
from v
left join companies c on c.legacy_supplier_id = v.supplier_legacy_id
left join retailers  r on r.id = v.retailer_id
where v.new_exp and not v.old_exp
order by v.proposed_anchor, v.legacy_id;


-- ===========================================================================
-- ZAPYTANIE 3 — LISTA RESCUED (stara wygasi, nowa JESZCZE nie) — oczekiwane
-- ===========================================================================
with s as (
  select ls.legacy_id, ls.status, ls.supplier_legacy_id, ls.retailer_id, ls.updated_at,
         nullif(ls.data->>'sendDate','')      as send_date_raw,
         nullif(ls.data->>'sentAt','')        as sent_at_raw,
         nullif(ls.data->>'emailSentAt','')   as email_sent_at_raw,
         nullif(ls.data->>'mailingSentAt','') as mailing_sent_at_raw
  from legacy_sends ls
  where ls.status = 'sent'
),
p as (
  select s.*,
    case when send_date_raw       ~ '^\d{4}-\d{2}-\d{2}' then substring(send_date_raw       from 1 for 10)::date end as send_date,
    case when sent_at_raw         ~ '^\d{4}-\d{2}-\d{2}' then substring(sent_at_raw         from 1 for 10)::date end as sent_at,
    case when email_sent_at_raw   ~ '^\d{4}-\d{2}-\d{2}' then substring(email_sent_at_raw   from 1 for 10)::date end as email_sent_at,
    case when mailing_sent_at_raw ~ '^\d{4}-\d{2}-\d{2}' then substring(mailing_sent_at_raw from 1 for 10)::date end as mailing_sent_at
  from s
),
b as (select p.*, coalesce(send_date, sent_at, updated_at::date) as base_date from p),
ft as (
  select b.*,
    (date_trunc('month', base_date)::date
       + ((2 - extract(dow from date_trunc('month', base_date))::int + 7) % 7)) as ft_this,
    ((date_trunc('month', base_date) + interval '1 month')::date
       + ((2 - extract(dow from (date_trunc('month', base_date) + interval '1 month'))::int + 7) % 7)) as ft_next
  from b
),
a as (
  select ft.*,
    coalesce(sent_at, updated_at::date) as old_anchor,
    coalesce(mailing_sent_at, email_sent_at,
             (case when base_date <= ft_this then ft_this else ft_next end),
             sent_at, updated_at::date) as proposed_anchor
  from ft
),
v as (
  select a.*, (old_anchor < (current_date - 14)) as old_exp, (proposed_anchor < (current_date - 14)) as new_exp from a
)
select v.legacy_id,
       c.name as company, r.name as retailer, v.status,
       v.send_date, v.sent_at, v.email_sent_at, v.mailing_sent_at,
       v.old_anchor, v.proposed_anchor, 'RESCUED' as bucket
from v
left join companies c on c.legacy_supplier_id = v.supplier_legacy_id
left join retailers  r on r.id = v.retailer_id
where v.old_exp and not v.new_exp
order by v.proposed_anchor, v.legacy_id;


-- ===========================================================================
-- ZAPYTANIE 4 — liczba rekordów Z emailSentAt, BEZ mailingSentAt (status=sent)
-- ===========================================================================
select count(*) as email_without_mailing
from legacy_sends
where status = 'sent'
  and nullif(data->>'emailSentAt','')   is not null
  and nullif(data->>'mailingSentAt','') is null;


-- ===========================================================================
-- ZAPYTANIE 5 — liczba rekordów BEZ emailSentAt i BEZ mailingSentAt (status=sent)
-- ===========================================================================
select count(*) as no_email_no_mailing
from legacy_sends
where status = 'sent'
  and nullif(data->>'emailSentAt','')   is null
  and nullif(data->>'mailingSentAt','') is null;
