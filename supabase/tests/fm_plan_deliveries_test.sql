-- Test only: temporary local database; transaction rolled back.
begin;
create temp table ids(k text primary key, v uuid);
insert into ids select k, gen_random_uuid() from unnest(array['admin','buyer','supplier','co']) k;
grant all on ids to authenticated, anon;
create function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k=key $$;
create function pg_temp.login(key text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', coalesce(pg_temp.id(key)::text,''), true);
 perform set_config('request.jwt.claims', json_build_object('sub',pg_temp.id(key),'role','authenticated')::text,true);
end $$;
create function pg_temp.ok(test boolean,msg text) returns void language plpgsql as $$
begin if not coalesce(test,false) then raise exception 'FAIL: %',msg; end if; end $$;
create function pg_temp.denied(stmt text) returns void language plpgsql as $$
begin
 begin execute stmt; exception when insufficient_privilege then return; end;
 raise exception 'FAIL: accepted forbidden statement: %',stmt;
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',k||'@deliveries.test','',now(),now(),now(),
case k when 'admin' then '{"role":"admin"}'::jsonb else '{}'::jsonb end,'{}'::jsonb from ids where k in ('admin','buyer','supplier');
insert into public.companies(id,name,fm_b2b_enabled,account_status,fm_b2b_tier,fm_b2b_packages)
values (pg_temp.id('co'),'Deliveries test company',true,'active','business',1);
insert into public.retailers(id,name,active,fm26_active,fm26_chain_id) values (990821,'Deliveries A',true,true,'deliv-a');
update public.profiles set role='admin' where id=pg_temp.id('admin');
update public.profiles set role='buyer',retailer_id=990821,fm26_active=true where id=pg_temp.id('buyer');
update public.profiles set role='supplier',company_id=pg_temp.id('co') where id=pg_temp.id('supplier');

-- service role path (funkcja Netlify) = właściciel tabeli w teście lokalnym
insert into public.fm_plan_deliveries(kind,target_id,email,plan_updated_at,status,sent_by)
values ('supplier',pg_temp.id('co')::text,'a@deliveries.test','2026-09-22T10:00:00Z','sent',pg_temp.id('admin'));
-- UNIQUE: ten sam adresat w tej samej wersji planu nie może dostać drugiego wiersza
do $$ begin
 begin
  insert into public.fm_plan_deliveries(kind,target_id,email,plan_updated_at)
  values ('supplier',(select v from ids where k='co')::text,'a@deliveries.test','2026-09-22T10:00:00Z');
  raise exception 'FAIL: duplicate delivery accepted';
 exception when unique_violation then null; end;
end $$;
-- nowa wersja planu = nowy wiersz dozwolony
insert into public.fm_plan_deliveries(kind,target_id,email,plan_updated_at)
values ('supplier',pg_temp.id('co')::text,'a@deliveries.test','2026-09-22T11:00:00Z');
do $$ begin
 begin
  insert into public.fm_plan_deliveries(kind,target_id,email,plan_updated_at,status) values ('chain','1','x@deliveries.test',now(),'bogus');
  raise exception 'FAIL: invalid status accepted';
 exception when check_violation then null; end;
end $$;

select pg_temp.login('admin'); set local role authenticated;
select pg_temp.ok((select count(*)=2 from public.fm_plan_deliveries),'admin reads delivery history');
select pg_temp.ok((select count(*)=1 from information_schema.columns where table_schema='public' and table_name='fm_plan_deliveries' and column_name='idempotency_key'),'idempotency_key column present');
select pg_temp.ok((select count(*)=1 from storage.buckets where id='fm-plan-cards' and public=false),'private bucket fm-plan-cards present');
select pg_temp.denied($q$insert into public.fm_plan_deliveries(kind,target_id,email,plan_updated_at) values ('chain','990821','b@deliveries.test',now())$q$);
select pg_temp.denied($q$update public.fm_plan_deliveries set status='sent'$q$);
select pg_temp.denied($q$delete from public.fm_plan_deliveries$q$);
reset role;
select pg_temp.login('buyer'); set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.fm_plan_deliveries),'buyer sees no deliveries');
select pg_temp.denied($q$insert into public.fm_plan_deliveries(kind,target_id,email,plan_updated_at) values ('chain','990821','b@deliveries.test',now())$q$);
reset role;
select pg_temp.login('supplier'); set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.fm_plan_deliveries),'supplier sees no deliveries');
reset role;
set local role anon;
select pg_temp.denied('select * from public.fm_plan_deliveries');
reset role;
select 'PASS: deliveries ledger — unique per recipient and plan version, admin read only, no writes for authenticated, anon denied' result;
rollback;
