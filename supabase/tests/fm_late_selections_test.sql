-- Test only: new temporary local database; transaction rolled back.
begin;
create temp table ids(k text primary key, v uuid);
insert into ids select k, gen_random_uuid() from unnest(array['admin','buyer','other','supplier','co','inactive']) k;
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
 raise exception 'FAIL: accepted forbidden write: %',stmt;
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',k||'@late.test','',now(),now(),now(),
case k when 'admin' then '{"role":"admin"}'::jsonb else '{}'::jsonb end,'{}'::jsonb from ids where k in ('admin','buyer','other','supplier');
insert into public.companies(id,name,fm_b2b_enabled,account_status,fm_b2b_tier,fm_b2b_packages)
values (pg_temp.id('co'),'Late test company',true,'active','business',1),
(pg_temp.id('inactive'),'Inactive company',false,'suspended','business',1);
insert into public.retailers(id,name,active,fm26_active,fm26_chain_id) values
(990801,'Late A',true,true,'late-a'),(990802,'Late B',true,true,'late-b');
update public.profiles set role='admin' where id=pg_temp.id('admin');
update public.profiles set role='buyer',retailer_id=990801,fm26_active=true where id=pg_temp.id('buyer');
update public.profiles set role='buyer',retailer_id=990802,fm26_active=true where id=pg_temp.id('other');
update public.profiles set role='supplier',company_id=pg_temp.id('co') where id=pg_temp.id('supplier');
insert into public.fm_settings(algo_phase,event_date) select 'matching','2026-09-24' where not exists(select 1 from public.fm_settings);
update public.fm_settings set algo_phase='matching';
insert into public.fm_plan_private(id,schedule) values (1,'{"res":{"sentinel":{"m":["late-a"]}}}'::jsonb)
on conflict(id) do update set schedule=excluded.schedule;
-- Unrelated input sentinel. The late flow must never modify it or its source/audit entries.
insert into public.company_target_retailers(company_id,retailer_id,priority,note) values (pg_temp.id('co'),990801,1000,'chain:late-a');
create temp table main_before as select
 (select coalesce(jsonb_agg(to_jsonb(t) order by company_id,retailer_id),'[]') from public.company_target_retailers t) targets,
 (select coalesce(jsonb_agg(to_jsonb(t) order by retailer_id,supplier_company_id),'[]') from public.fm_resps t) responses,
 (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.fm_plan_private t) plan,
 (select coalesce(jsonb_agg(to_jsonb(t) order by entity,company_id,retailer_id),'[]') from public.fm_decision_sources t) sources;

select pg_temp.login('buyer'); set local role authenticated;
select pg_temp.ok(not public.fm_late_selection_allowed(990801),'closed by default');
select pg_temp.denied(format('insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone) values (990801,%L,''want'')',pg_temp.id('co')::text));
select pg_temp.denied('insert into public.fm_late_selection_access values (990801,true)');
reset role;
select pg_temp.login('admin'); set local role authenticated;
insert into public.fm_late_selection_access values (990801,true)
on conflict(retailer_id) do update set enabled=excluded.enabled;
reset role;
-- Fresh buyer session reads persisted access.
select pg_temp.login('buyer'); set local role authenticated;
select pg_temp.ok(public.fm_late_selection_allowed(990801),'own access persisted');
select pg_temp.ok(not public.fm_late_selection_allowed(990802),'other retailer forbidden');
insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone)
values (990801,pg_temp.id('co')::text,'want')
on conflict(retailer_id,supplier_legacy_id) do update set zone=excluded.zone;
insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone)
values (990801,pg_temp.id('co')::text,'chance')
on conflict(retailer_id,supplier_legacy_id) do update set zone=excluded.zone;
select pg_temp.ok((select count(*)=1 and min(zone)='chance' from public.fm_late_resps),'own upsert round trip');
select pg_temp.denied(format('insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone) values (990802,%L,''want'')',pg_temp.id('co')::text));
select pg_temp.denied('update public.fm_late_resps set retailer_id=990802');
select pg_temp.denied('update public.fm_late_resps set zone=''remove''');
select pg_temp.denied('insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone) values (990801,''nonexistent'',''want'')');
select pg_temp.denied(format('insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone) values (990801,%L,''want'')',pg_temp.id('inactive')::text));
reset role;
select pg_temp.login('other'); set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.fm_late_resps),'other buyer cannot read requests');
select pg_temp.ok((select count(*)=0 from public.fm_late_selection_access),'other buyer cannot read access');
reset role;
select pg_temp.login('supplier'); set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.fm_late_resps),'supplier cannot read requests');
select pg_temp.denied(format('insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone) values (990801,%L,''want'')',pg_temp.id('co')::text));
reset role;
set local role anon;
select pg_temp.denied('select * from public.fm_late_resps');
select pg_temp.denied('select * from public.fm_late_selection_access');
reset role;
select pg_temp.login('admin'); set local role authenticated;
select pg_temp.ok((select count(*)=1 from public.fm_late_resps),'admin sees buyer request');
update public.fm_late_selection_access set enabled=false where retailer_id=990801;
reset role;
select pg_temp.login('buyer'); set local role authenticated;
select pg_temp.ok((select count(*)=1 from public.fm_late_resps),'history retained after close');
select pg_temp.denied(format('insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone) values (990801,%L,''want'') on conflict(retailer_id,supplier_legacy_id) do update set zone=excluded.zone',pg_temp.id('co')::text));
delete from public.fm_late_resps where retailer_id=990801;
select pg_temp.ok((select count(*)=1 from public.fm_late_resps),'closed delete returns no rows; existing choice retained');
reset role;
select pg_temp.login('admin'); set local role authenticated;
update public.fm_late_selection_access set enabled=true where retailer_id=990801;
update public.fm_settings set algo_phase='published';
reset role;
select pg_temp.login('buyer'); set local role authenticated;
select pg_temp.ok(not public.fm_late_selection_allowed(990801),'published phase closes writes despite enabled flag');
select pg_temp.denied(format('insert into public.fm_late_resps(retailer_id,supplier_legacy_id,zone) values (990801,%L,''want'') on conflict(retailer_id,supplier_legacy_id) do update set zone=excluded.zone',pg_temp.id('co')::text));
reset role;
select pg_temp.login('admin'); set local role authenticated;
update public.fm_settings set algo_phase='preferences_open';
reset role;
select pg_temp.login('buyer'); set local role authenticated;
select pg_temp.ok(not public.fm_late_selection_allowed(990801),'preferences phase does not use late requests');
reset role;
select pg_temp.login('admin'); set local role authenticated;
update public.fm_settings set algo_phase='matching';
reset role;
select pg_temp.login('buyer'); set local role authenticated;
delete from public.fm_late_resps where retailer_id=990801;
select pg_temp.ok((select count(*)=0 from public.fm_late_resps),'open delete works');
reset role;
select pg_temp.ok((select targets=(select coalesce(jsonb_agg(to_jsonb(t) order by company_id,retailer_id),'[]') from public.company_target_retailers t)
 and responses=(select coalesce(jsonb_agg(to_jsonb(t) order by retailer_id,supplier_company_id),'[]') from public.fm_resps t)
 and plan=(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.fm_plan_private t)
 and sources=(select coalesce(jsonb_agg(to_jsonb(t) order by entity,company_id,retailer_id),'[]') from public.fm_decision_sources t)
 from main_before),'all main preferences, responses, plan and source rows unchanged');
select 'PASS: persisted access, role isolation, phase gates, buyer upsert/delete, main data unchanged' result;
rollback;
