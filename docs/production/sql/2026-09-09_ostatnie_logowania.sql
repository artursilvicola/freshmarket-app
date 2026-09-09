-- ============================================================================
-- Kto i kiedy ostatnio logował się do b2b.freshmarket.eu
-- Tylko ODCZYT. Uruchamiać w Supabase SQL Editor (projekt sklyfuvzjikkqerxtulo).
-- Źródło daty logowania: auth.users.last_sign_in_at (GoTrue aktualizuje przy
-- każdym udanym logowaniu — hasłem, magic linkiem i po odświeżeniu sesji).
-- Konta obsługi numerków (rola 'staff') pojawią się tu dopiero po ich utworzeniu.
-- ============================================================================
select
  p.role                                                              as rola,
  coalesce(c.name, r.name, '(brak przypisania)')                      as podmiot,
  p.name                                                              as osoba,
  u.email,
  to_char(u.last_sign_in_at at time zone 'Europe/Warsaw',
          'YYYY-MM-DD HH24:MI')                                       as ostatnie_logowanie,
  case when u.last_sign_in_at is null then null
       else (now()::date - (u.last_sign_in_at at time zone 'Europe/Warsaw')::date)
  end                                                                 as dni_temu,
  to_char(u.created_at at time zone 'Europe/Warsaw', 'YYYY-MM-DD')    as konto_od,
  coalesce(c.account_status, '-')                                     as status_firmy,
  p.active                                                            as konto_aktywne
from auth.users u
join public.profiles p   on p.id = u.id
left join public.companies c on c.id = p.company_id
left join public.retailers r on r.id = p.retailer_id
order by
  case p.role when 'admin' then 0 when 'buyer' then 1 when 'supplier' then 2 else 3 end,
  u.last_sign_in_at desc nulls last;

-- Skrót: ile kont w każdej roli i ile nigdy się nie logowało
-- select p.role, count(*) as konta, count(*) filter (where u.last_sign_in_at is null) as nigdy
-- from auth.users u join public.profiles p on p.id = u.id group by p.role order by 1;

-- Sieci, w których ŻADEN kupiec się nie logował
-- select r.name from public.retailers r
--  where exists (select 1 from public.profiles p where p.retailer_id = r.id)
--    and not exists (select 1 from public.profiles p join auth.users u on u.id = p.id
--                     where p.retailer_id = r.id and u.last_sign_in_at is not null)
--  order by 1;
