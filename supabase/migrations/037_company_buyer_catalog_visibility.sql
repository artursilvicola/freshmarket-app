-- 037_company_buyer_catalog_visibility.sql
--
-- Supplier-controlled visibility in the buyer company catalog.
-- Default behavior remains open: every active retailer can see every supplier
-- company profile in the catalog. A supplier may hide their company profile
-- from selected retailers by adding rows here.

create table if not exists public.company_hidden_retailers (
  company_id uuid not null references public.companies(id) on delete cascade,
  retailer_id integer not null references public.retailers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, retailer_id)
);

create index if not exists idx_company_hidden_retailers_company
  on public.company_hidden_retailers(company_id);

create index if not exists idx_company_hidden_retailers_retailer
  on public.company_hidden_retailers(retailer_id);

alter table public.company_hidden_retailers enable row level security;

drop policy if exists "chr_admin_all" on public.company_hidden_retailers;
drop policy if exists "chr_supplier_own" on public.company_hidden_retailers;
drop policy if exists "chr_buyer_read_own_retailer" on public.company_hidden_retailers;

create policy "chr_admin_all" on public.company_hidden_retailers
  for all using (is_admin()) with check (is_admin());

create policy "chr_supplier_own" on public.company_hidden_retailers
  for all using (
    app_role() = 'supplier' and company_id = app_company_id()
  ) with check (
    app_role() = 'supplier' and company_id = app_company_id()
  );

-- Buyers only need to know which companies are hidden from their own retailer.
-- This keeps catalog filtering client-side without exposing other retailers'
-- visibility settings.
create policy "chr_buyer_read_own_retailer" on public.company_hidden_retailers
  for select using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

comment on table public.company_hidden_retailers is
  'Supplier opt-out list for buyer catalog visibility. Missing row = visible to that retailer.';

-- Tighten company catalog visibility for buyer accounts at the source.
-- Admins and suppliers keep the previous broad authenticated view. Buyers see
-- only active supplier companies that are not hidden from their retailer.
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
        and not exists (
          select 1
          from public.company_hidden_retailers chr
          where chr.company_id = companies.id
            and chr.retailer_id = app_retailer_id()
        )
      )
    )
  );

-- Keep related profile details aligned with the company visibility rule.
-- Existing policies allowed every authenticated user to read contacts/certs
-- directly if they knew the company id. Buyers should only read details for
-- supplier companies visible to their own retailer.
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
