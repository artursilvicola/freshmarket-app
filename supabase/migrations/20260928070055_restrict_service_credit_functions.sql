begin;
-- These four RPCs are used only by trusted Netlify service-role functions.
-- Earlier migrations revoked PUBLIC, but project default privileges also
-- granted EXECUTE directly to anon/authenticated, bypassing that restriction.
revoke all on function public.purchase_package(uuid,text,numeric,text,text) from public, anon, authenticated;
revoke all on function public.allocate_proforma_number(integer) from public, anon, authenticated;
revoke all on function public.claim_due_expiry_reminders(integer) from public, anon, authenticated;
revoke all on function public.claim_due_inactivity_warnings(integer) from public, anon, authenticated;
grant execute on function public.purchase_package(uuid,text,numeric,text,text) to service_role;
grant execute on function public.allocate_proforma_number(integer) to service_role;
grant execute on function public.claim_due_expiry_reminders(integer) to service_role;
grant execute on function public.claim_due_inactivity_warnings(integer) to service_role;
alter function public.purchase_package(uuid,text,numeric,text,text) set search_path = public, pg_temp;
commit;
