-- Isolated regression fixture; always rolled back.
begin;
create temp table ids(k text primary key,v uuid);
insert into ids select k,gen_random_uuid() from unnest(array['admin','buyer','supplier','co','newco','group']) k;
grant all on ids to authenticated,anon;
create function pg_temp.id(k text) returns uuid language sql as $$select v from ids where ids.k=$1$$;
create function pg_temp.ok(v boolean,msg text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL: %',msg;end if;end$$;
create function pg_temp.fails(sql text,msg text) returns void language plpgsql as $$begin
 begin execute sql;exception when others then if position(msg in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'FAIL accepted: %',sql;
end$$;
create function pg_temp.login(k text) returns void language plpgsql as $$begin perform set_config('request.jwt.claim.sub',pg_temp.id(k)::text,true);end$$;
create function pg_temp.add_at(cid text,pos int,sid text default 'a') returns jsonb language sql as $$
 select public.fm_commit_correction((select revision from public.fm_correction_drafts),gen_random_uuid(),'add',null,jsonb_build_object('to',jsonb_build_object('cid',$1,'pos',$2,'sid',$3)))
$$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) select v,k||'@add.test','{}','{}' from ids where k in ('admin','buyer','supplier');
insert into public.companies(id,name,legacy_fm_id,account_status,fm_b2b_enabled,fm_b2b_packages)
 values(pg_temp.id('co'),'Company Alpha','a','active',true,1),(pg_temp.id('newco'),'New company','new','active',true,1);
insert into public.retailers(id,name,active,fm26_active,fm26_chain_id) select 990710+n,'Retailer '||n,true,true,'ch'||n from generate_series(1,6) n;
update public.profiles set role='admin' where id=pg_temp.id('admin');
update public.profiles set role='buyer',retailer_id=990715 where id=pg_temp.id('buyer');
update public.profiles set role='supplier',company_id=pg_temp.id('co') where id=pg_temp.id('supplier');
insert into public.fm_settings(algo_phase) select 'matching' where not exists(select 1 from public.fm_settings);
update public.fm_settings set algo_phase='matching';
insert into public.fm_queue_groups(id,event_date,retailer_id,meetings_per_station) values(pg_temp.id('group'),'2026-09-24',990715,2);
insert into public.fm_stations(queue_group_id) values(pg_temp.id('group'));
create temp table state(k text primary key,v jsonb); grant all on state to authenticated;
insert into state values('base','{"cq":{"ch1":["a"],"ch2":[null,null,"a"],"ch3":[null,null,null,null,"a"],"ch4":[null,null,null,null,null,null,"a"],"ch5":["b"],"ch6":[]},"res":{"a":{"m":[],"r":{"ch1":6000}},"b":{"m":[],"r":{}}},"nums":{},"cs":{"ch5":{"cap":999}},"metadata":{"keep":true}}');
select pg_temp.login('admin');set local role authenticated;
select public.fm_commit_correction(0,gen_random_uuid(),'initialize',(select v from state where k='base'));
insert into state select 'before',schedule from public.fm_correction_drafts;
select pg_temp.fails($q$select pg_temp.add_at('ch5',0)$q$,'fm_correction_occupied');
select pg_temp.fails($q$select pg_temp.add_at('ch1',8)$q$,'fm_correction_duplicate');
select pg_temp.fails($q$select pg_temp.add_at('ch5',6)$q$,'fm_correction_gap');
select pg_temp.fails($q$select pg_temp.add_at('ch5',7)$q$,'fm_correction_gap');
select pg_temp.fails($q$select pg_temp.add_at('unknown',8)$q$,'fm_correction_invalid_cell');
select pg_temp.fails($q$select pg_temp.add_at('ch5',-1)$q$,'fm_correction_invalid_cell');
select pg_temp.fails($q$select pg_temp.add_at('ch5',8,'unknown')$q$,'fm_correction_supplier_ineligible');
-- Prevent a UUID alias from bypassing duplicate/count checks for a legacy ID.
select pg_temp.fails(format('select pg_temp.add_at(''ch5'',8,%L)',pg_temp.id('co')::text),'fm_correction_supplier_ineligible');
reset role;
update public.companies set account_status='suspended' where id=pg_temp.id('co');
set local role authenticated;
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_supplier_ineligible');
reset role;update public.companies set account_status='active' where id=pg_temp.id('co');
update public.retailers set fm26_active=false where id=990715;
set local role authenticated;
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_chain_inactive');
reset role;update public.retailers set fm26_active=true where id=990715;
insert into public.fm_resps(retailer_id,supplier_company_id,zone) values(990715,pg_temp.id('co'),'remove');
set local role authenticated;
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_buyer_rejected');
reset role;delete from public.fm_resps where retailer_id=990715;
create temp table inputs_before as select
 (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.company_target_retailers x) targets,
 (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.fm_resps x) responses,
 (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.fm_decision_sources x) sources,
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.fm_plan_private x) approved;
set local role authenticated;
select public.fm_commit_correction(1,'00000000-0000-0000-0000-000000009901','add',null,'{"to":{"cid":"ch5","pos":8,"sid":"a","company":"forged"}}');
select pg_temp.ok((select schedule->'cq'=jsonb_set((select v->'cq' from state where k='before'),'{ch5}','["b",null,null,null,null,null,null,null,"a"]') from public.fm_correction_drafts),'exactly one cell added, original four meetings and other suppliers unchanged');
select pg_temp.ok((select jsonb_array_length(schedule->'res'->'a'->'m')=5 and schedule->'nums'->'a'->>'ch5'='9' and schedule->'cs'->'ch5'->>'n'='2' and schedule->'cs'->'ch5'->>'cap'='2' and schedule->'res'->'a'->'r'->>'ch1'='6000' from public.fm_correction_drafts),'4→5; derived values refreshed; live capacity beats forged snapshot; scores preserved');
select pg_temp.ok((select details->'to'->>'company'='Company Alpha' and details->'to'->>'chain'='Retailer 5' and details->>'before_count'='4' and details->>'after_count'='5' and details->>'supplier_limit'='5' and actor_id=pg_temp.id('admin') from public.fm_correction_history where revision=2),'immutable authoritative add history with author/counts');
select public.fm_commit_correction(1,'00000000-0000-0000-0000-000000009901','add',null,'{"to":{"cid":"ch5","pos":8,"sid":"a","company":"forged"}}');
select pg_temp.ok((select revision=2 from public.fm_correction_drafts),'duplicate request does not add twice');
select pg_temp.fails($q$select public.fm_commit_correction(1,gen_random_uuid(),'add',null,'{"to":{"cid":"ch6","pos":10,"sid":"new"}}')$q$,'fm_correction_conflict');
select pg_temp.fails($q$select pg_temp.add_at('ch6',10)$q$,'fm_correction_supplier_limit');
select pg_temp.fails($q$select pg_temp.add_at('ch5',10,'new')$q$,'fm_correction_capacity');
select public.fm_commit_correction(2,gen_random_uuid(),'undo',null,'{"undo_of":"00000000-0000-0000-0000-000000009901"}');
select pg_temp.ok((select schedule=(select v from state where k='before') from public.fm_correction_drafts),'undo restores exact schedule including the hole, scores and metadata');
-- Unconfigured retailer falls back to 60; company absent from draft can get a first meeting.
select pg_temp.add_at('ch6',10,'new');
select pg_temp.ok((select schedule->'res'->'new'->'m'='["ch6"]' and schedule->'nums'->'new'->>'ch6'='11' and schedule->'cq'->'ch6'->>9 is null from public.fm_correction_drafts),'new company 0→1 and correct padding');
-- Configured zero active stations is closed, never a fallback to 60.
reset role;update public.fm_stations set active=false where queue_group_id=pg_temp.id('group');set local role authenticated;
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_capacity');
reset role;update public.fm_stations set active=true where queue_group_id=pg_temp.id('group');set local role authenticated;
-- Lower agreed limits (nine for a three-package supplier) cannot be exceeded.
reset role;update public.companies set fm_b2b_packages=3 where id=pg_temp.id('co');set local role authenticated;
select public.fm_commit_correction((select revision from public.fm_correction_drafts),gen_random_uuid(),'rebuild',
 jsonb_build_object('cq',(select jsonb_object_agg('q'||i,jsonb_build_array('a')) from generate_series(1,9) i)||'{"ch5":["b"]}'::jsonb,
 'res','{"a":{"m":[],"r":{}},"b":{"m":[],"r":{}}}'::jsonb,'meeting_limits','{"a":9}'::jsonb));
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_supplier_limit');
select public.fm_commit_correction((select revision from public.fm_correction_drafts),gen_random_uuid(),'rebuild',(select v||'{"meeting_limits":{"a":null}}'::jsonb from state where k='before'));
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_limit_invalid');
select public.fm_commit_correction((select revision from public.fm_correction_drafts),gen_random_uuid(),'rebuild',(select v from state where k='before'));
-- Published plan and all matching inputs have stayed untouched.
reset role;
select pg_temp.ok((select targets=(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.company_target_retailers x)
 and responses=(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.fm_resps x)
 and sources=(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.fm_decision_sources x)
 and approved=(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.fm_plan_private x) from inputs_before),'no preferences, responses, decision sources or approved plan changes');
set local role authenticated;
select public.fm_commit_correction((select revision from public.fm_correction_drafts),gen_random_uuid(),'approve');
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_approved_locked');
select public.fm_commit_correction((select revision from public.fm_correction_drafts),gen_random_uuid(),'unlock');
update public.fm_settings set algo_phase='published';
select pg_temp.fails($q$select pg_temp.add_at('ch5',8)$q$,'fm_correction_phase_locked');
reset role;select pg_temp.login('buyer');set local role authenticated;
select pg_temp.fails($q$select public.fm_commit_correction(1,gen_random_uuid(),'add',null,'{}')$q$,'fm_correction_admin_only');
select pg_temp.ok((select count(*)=0 from public.fm_correction_history),'buyer cannot read history');
reset role;select pg_temp.login('supplier');set local role authenticated;
select pg_temp.fails($q$select public.fm_commit_correction(1,gen_random_uuid(),'add',null,'{}')$q$,'fm_correction_admin_only');
reset role;set local role anon;
select pg_temp.fails($q$select public.fm_commit_correction(1,gen_random_uuid(),'add',null,'{}')$q$,'permission denied');
reset role;
select 'PASS: add 4→5, exact cells, live constraints, idempotence, undo, lower limits, unchanged inputs, admin only' result;
rollback;
