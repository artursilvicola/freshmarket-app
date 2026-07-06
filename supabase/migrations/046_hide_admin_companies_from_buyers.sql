-- 046_hide_admin_companies_from_buyers.sql
-- [fix/hide-admin-companies-from-buyers]
--
-- Problem: konta administratorów (zakładane najpierw przez rejestrację
-- dostawcy, potem promowane) mają powiązane firmy w `companies`
-- (np. KJOW, Internet Factory, OKSALE). Katalog "Dostawcy" w panelu kupca
-- pokazywał te firmy jak zwykłych dostawców.
--
-- Fix: kupiec (role=buyer) nie widzi firm, do których przypięty jest
-- JAKIKOLWIEK profil z role='admin'. Admin i supplier widzą bez zmian.
-- Wzorzec jak 037 — zaostrzamy te same 3 polityki (companies / contacts /
-- certs), dokładając warunek w gałęzi buyer.
--
-- Funkcja security definer — subquery do profiles w politykach RLS musi
-- ominąć RLS na profiles (jak app_role()/is_admin() z 001).

create or replace function public.company_has_admin_profile(cid uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles p
    where p.company_id = cid
      and p.role = 'admin'
  );
$$ language sql security definer stable;

comment on function public.company_has_admin_profile(uuid) is
  'True jeśli firma jest powiązana z profilem administratora — takie firmy są ukrywane przed kupcami w katalogu.';

-- ── companies ──
drop policy if exists "companies_select_all_authenticated" on public.companies;
create policy "companies_select_all_authenticated" on public.companies
  for select using (
    auth.uid() is not null
    and (
      is_admin()
      or app_role() <> 'buyer'
      or (
        app_retailer_id() is not null
        and coalesce(account_status, 'active') = 'active'
        and not company_has_admin_profile(companies.id)
        and not exists (
          select 1
          from public.company_hidden_retailers chr
          where chr.company_id = companies.id
            and chr.retailer_id = app_retailer_id()
        )
      )
    )
  );

-- ── company_contacts ──
drop policy if exists "contacts_select_all_authenticated" on public.company_contacts;
create policy "contacts_select_all_authenticated" on public.company_contacts
  for select using (
    auth.uid() is not null
    and (
      is_admin()
      or app_role() <> 'buyer'
      or (
        app_retailer_id() is not null
        and exists (
          select 1
          from public.companies c
          where c.id = company_contacts.company_id
            and coalesce(c.account_status, 'active') = 'active'
            and not company_has_admin_profile(c.id)
            and not exists (
              select 1
              from public.company_hidden_retailers chr
              where chr.company_id = c.id
                and chr.retailer_id = app_retailer_id()
            )
        )
      )
    )
  );

-- ── company_certs ──
drop policy if exists "certs_select_all_authenticated" on public.company_certs;
create policy "certs_select_all_authenticated" on public.company_certs
  for select using (
    auth.uid() is not null
    and (
      is_admin()
      or app_role() <> 'buyer'
      or (
        app_retailer_id() is not null
        and exists (
          select 1
          from public.companies c
          where c.id = company_certs.company_id
            and coalesce(c.account_status, 'active') = 'active'
            and not company_has_admin_profile(c.id)
            and not exists (
              select 1
              from public.company_hidden_retailers chr
              where chr.company_id = c.id
                and chr.retailer_id = app_retailer_id()
            )
        )
      )
    )
  );
