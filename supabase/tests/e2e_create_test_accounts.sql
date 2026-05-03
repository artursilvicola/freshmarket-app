-- ===================================================================
-- E2E TEST ACCOUNTS - tworzy 3 konta dla Codexa / testow E2E
-- Uruchom RAZ w Supabase SQL Editor.
-- Po uruchomieniu:
--   - Codex moze logowac sie 3 osobnymi mailami i sprawdzac kazda role
--   - Email confirmation pomijane (email_confirmed_at = now())
--   - Konta maja stale role (admin/supplier/buyer), nie trzeba przelaczac
-- ===================================================================

-- Bezpieczne tworzenie - jesli konto juz istnieje, pomijamy
do $$
declare
  admin_id uuid;
  supplier_id uuid;
  buyer_id uuid;
begin
  -- =================== ADMIN ===================
  if not exists (select 1 from auth.users where email = 'codex.admin@freshmarket.test') then
    admin_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      admin_id, 'authenticated', 'authenticated',
      'codex.admin@freshmarket.test',
      crypt('CodexAdmin2026!', gen_salt('bf')),
      now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), admin_id,
      jsonb_build_object('sub', admin_id::text, 'email', 'codex.admin@freshmarket.test', 'email_verified', true, 'phone_verified', false),
      'email', admin_id::text, now(), now(), now()
    );
    update profiles set role = 'admin', name = 'Codex Admin', email = 'codex.admin@freshmarket.test' where id = admin_id;
  end if;

  -- =================== SUPPLIER (Food Market) ===================
  if not exists (select 1 from auth.users where email = 'codex.supplier@freshmarket.test') then
    supplier_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      supplier_id, 'authenticated', 'authenticated',
      'codex.supplier@freshmarket.test',
      crypt('CodexSupplier2026!', gen_salt('bf')),
      now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), supplier_id,
      jsonb_build_object('sub', supplier_id::text, 'email', 'codex.supplier@freshmarket.test', 'email_verified', true, 'phone_verified', false),
      'email', supplier_id::text, now(), now(), now()
    );
    update profiles set
      role = 'supplier',
      name = 'Codex Supplier',
      email = 'codex.supplier@freshmarket.test',
      company_id = '11111111-1111-1111-1111-111111111111'  -- Food Market
    where id = supplier_id;
  end if;

  -- =================== BUYER (Biedronka, retailer 100) ===================
  if not exists (select 1 from auth.users where email = 'codex.buyer@freshmarket.test') then
    buyer_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      buyer_id, 'authenticated', 'authenticated',
      'codex.buyer@freshmarket.test',
      crypt('CodexBuyer2026!', gen_salt('bf')),
      now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), buyer_id,
      jsonb_build_object('sub', buyer_id::text, 'email', 'codex.buyer@freshmarket.test', 'email_verified', true, 'phone_verified', false),
      'email', buyer_id::text, now(), now(), now()
    );
    update profiles set
      role = 'buyer',
      name = 'Codex Buyer Biedronka',
      email = 'codex.buyer@freshmarket.test',
      retailer_id = 100  -- Biedronka
    where id = buyer_id;
  end if;
end $$;

-- Sprawdz wynik
select
  u.email,
  p.role::text as rola,
  p.name,
  case
    when p.role = 'buyer' then 'retailer ' || coalesce(p.retailer_id::text, 'BRAK')
    when p.role = 'supplier' then 'company ' || coalesce(p.company_id::text, 'BRAK')
    else '—'
  end as przypisanie
from auth.users u
left join profiles p on p.id = u.id
where u.email like 'codex.%@freshmarket.test'
order by p.role;
