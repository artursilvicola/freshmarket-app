-- 025 - minimum standard package is 5 sends
-- Keep existing historical orders/packages intact, but stop selling std_1.

update public.package_plans
set active = false,
    updated_at = now()
where id = 'std_1';

update public.package_plans
set active = true,
    updated_at = now()
where id = 'std_5';
