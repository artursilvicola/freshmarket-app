-- Production grants EXECUTE directly to anon through default privileges.
-- Revoking PUBLIC alone does not remove that direct grant. Keep the reviewed
-- login/admin/ownership checks, and remove anonymous access at the ACL layer.
begin;
revoke execute on function public.admin_grant_free_credits(uuid[], integer, text, text, text, text, date) from anon;
revoke execute on function public.mark_credit_grant_seen(uuid) from anon;
alter function public.business_today(timestamptz) set search_path = pg_catalog;
commit;
