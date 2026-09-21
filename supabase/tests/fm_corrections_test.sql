begin;
create temp table ids(k text primary key,v uuid);
insert into ids select k,gen_random_uuid() from unnest(array['admin','buyer','supplier','co']) k;
grant all on ids to authenticated,anon;
create function pg_temp.id(k text) returns uuid language sql as $$select v from ids where ids.k=$1$$;
create function pg_temp.ok(v boolean,msg text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL: %',msg;end if;end$$;
create function pg_temp.fails(sql text, msg text) returns void language plpgsql as $$begin
 begin execute sql; exception when others then if position(msg in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'FAIL accepted: %',sql;
end$$;
create function pg_temp.login(k text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.id(k)::text,true);
end$$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) select v,k||'@corrections.test','{}','{}' from ids where k<>'co';
insert into public.companies(id,name,legacy_fm_id,account_status,fm_b2b_enabled) values(pg_temp.id('co'),'Company A','a','active',true);
insert into public.retailers(id,name,active,fm26_active,fm26_chain_id) values(990701,'Retailer one',true,true,'one'),(990702,'Retailer two',true,true,'two');
update public.profiles set role='admin' where id=pg_temp.id('admin');
update public.profiles set role='buyer',retailer_id=990701 where id=pg_temp.id('buyer');
update public.profiles set role='supplier',company_id=pg_temp.id('co') where id=pg_temp.id('supplier');
insert into public.fm_settings(algo_phase) select 'matching' where not exists(select 1 from public.fm_settings);
update public.fm_settings set algo_phase='matching';
insert into public.fm_resps(retailer_id,supplier_company_id,zone) values(990702,pg_temp.id('co'),'remove');
create temp table input_before as select
 (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.company_target_retailers x) targets,
 (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.fm_resps x) responses;
create temp table state(k text primary key,v jsonb);
grant all on state to authenticated;
insert into state values('base','{"cq":{"one":["a","b",null],"two":["c",null,null]},"res":{"a":{"m":["one"],"r":{"one":4000}},"b":{"m":["one"],"r":{}},"c":{"m":["two"],"r":{}}},"nums":{},"cs":{"one":{"cap":2},"two":{"cap":2}}}');
select pg_temp.login('admin');set local role authenticated;
insert into state select 'draft',public.fm_commit_correction(0,'00000000-0000-0000-0000-000000000001','initialize',(select v from state where k='base'));
select pg_temp.ok((select count(*)=1 from public.fm_correction_history),'starting snapshot recorded');
select pg_temp.ok((select v->'schedule'->'nums'->'a'->>'one'='1' from state where k='draft'),'derived numbers consistent');
select pg_temp.fails('update public.fm_correction_history set actor_name=''forged''','permission denied');
select pg_temp.fails('delete from public.fm_correction_history','permission denied');
select pg_temp.fails('update public.fm_correction_drafts set revision=100','permission denied');

update state set v=public.fm_commit_correction(1,'00000000-0000-0000-0000-000000000002','swap',null,'{"from":{"cid":"one","pos":0,"sid":"a"},"to":{"cid":"one","pos":1,"sid":"b"}}') where k='draft';
select pg_temp.ok((select v->'schedule'->'cq'->'one'='["b","a",null]'::jsonb from state where k='draft'),'swap saved');
select pg_temp.ok((select details->'from'->>'company'='Company A' and actor_name<>'' from public.fm_correction_history where revision=2),'names and actor in immutable history');
select pg_temp.ok((select count(*)=0 from public.fm_plan_private),'draft edit does not approve plan');
-- Same request after an ambiguous response is idempotent.
select public.fm_commit_correction(1,'00000000-0000-0000-0000-000000000002','swap',null,'{"from":{"cid":"one","pos":0,"sid":"a"},"to":{"cid":"one","pos":1,"sid":"b"}}');
select pg_temp.ok((select revision=2 from public.fm_correction_drafts),'retry does not swap back');
select pg_temp.fails($q$select public.fm_commit_correction(1,'00000000-0000-0000-0000-000000000002','swap',null,'{}')$q$,'fm_correction_request_mismatch');
select pg_temp.fails($q$select public.fm_commit_correction(1,gen_random_uuid(),'swap',null,'{"from":{"cid":"one","pos":0,"sid":"a"},"to":{"cid":"one","pos":1,"sid":"b"}}')$q$,'fm_correction_conflict');
select public.fm_commit_correction(2,'00000000-0000-0000-0000-000000000003','undo',null,'{"undo_of":"00000000-0000-0000-0000-000000000002"}');
select pg_temp.ok((select schedule->'cq'->'one'='["a","b",null]'::jsonb from public.fm_correction_drafts),'undo restores exact queue');
select pg_temp.ok((select count(*)=3 from public.fm_correction_history),'undo preserves old entries');
select pg_temp.fails($q$select public.fm_commit_correction(3,gen_random_uuid(),'undo',null,'{"undo_of":"00000000-0000-0000-0000-000000000002"}')$q$,'fm_correction_undo_conflict');
-- Different retailers: rejection requires explicit confirmation on the server too.
select pg_temp.fails($q$select public.fm_commit_correction(3,gen_random_uuid(),'move',null,'{"from":{"cid":"one","pos":0,"sid":"a"},"to":{"cid":"two","pos":5,"sid":null}}')$q$,'fm_correction_rejection_confirmation');
select public.fm_commit_correction(3,'00000000-0000-0000-0000-000000000004','move',null,'{"from":{"cid":"one","pos":0,"sid":"a"},"to":{"cid":"two","pos":5,"sid":null},"accept_rejections":true}');
select pg_temp.ok((select schedule->'cq'->'two'='["c",null,null,null,null,"a"]'::jsonb and schedule->'nums'->'a'->>'two'='6' from public.fm_correction_drafts),'empty destination preserves holes and numbers');
select pg_temp.ok((select schedule->'overrides'->'a' ? 'two' from public.fm_correction_drafts),'override stored');
select pg_temp.fails($q$select public.fm_commit_correction(4,gen_random_uuid(),'move',null,'{"from":{"cid":"one","pos":1,"sid":"b"},"to":{"cid":"two","pos":4,"sid":null}}')$q$,'fm_correction_capacity');
select public.fm_commit_correction(4,'00000000-0000-0000-0000-000000000005','undo',null,'{"undo_of":"00000000-0000-0000-0000-000000000004"}');
select pg_temp.ok((select not (schedule->'overrides'->'a' ? 'two') or schedule->'overrides'->'a' is null from public.fm_correction_drafts),'undo restores override flags');
select pg_temp.ok((select revision=5 from public.fm_correction_drafts),'failed writes do not increase revision');

select public.fm_commit_correction(5,'00000000-0000-0000-0000-000000000006','approve');
select pg_temp.ok((select d.approved and d.schedule=p.schedule from public.fm_correction_drafts d cross join public.fm_plan_private p),'approve atomically saves and locks');
select pg_temp.fails($q$select public.fm_commit_correction(6,gen_random_uuid(),'move',null,'{}')$q$,'fm_correction_approved_locked');
select pg_temp.fails($q$select public.fm_commit_correction(6,gen_random_uuid(),'remove',null,'{}')$q$,'fm_correction_approved_locked');
select public.fm_commit_correction(6,'00000000-0000-0000-0000-000000000007','unlock');
-- Simulate an older client changing the approved plan outside the board.
update public.fm_plan_private set schedule=schedule||'{"old_client_marker":true}';
select pg_temp.fails($q$select public.fm_commit_correction(7,gen_random_uuid(),'approve')$q$,'fm_correction_plan_changed');
select public.fm_commit_correction(7,'00000000-0000-0000-0000-000000000008','load_approved');
select pg_temp.ok((select schedule->>'old_client_marker'='true' from public.fm_correction_drafts),'explicit load obtains current saved plan');
select public.fm_commit_correction(8,'00000000-0000-0000-0000-000000000009','rebuild',(select v from state where k='base'));
select pg_temp.ok((select not(schedule?'old_client_marker') from public.fm_correction_drafts),'rebuild is a recorded replacement');
select public.fm_commit_correction(9,'00000000-0000-0000-0000-000000000010','undo',null,'{"undo_of":"00000000-0000-0000-0000-000000000009"}');
select pg_temp.ok((select schedule->>'old_client_marker'='true' from public.fm_correction_drafts),'rebuild can be undone');

-- Removal is one exact cell, with no queue compaction, input changes or publication.
insert into state select 'before_remove',schedule from public.fm_correction_drafts;
insert into state select 'approved_before_remove',schedule from public.fm_plan_private;
select pg_temp.fails($q$select public.fm_commit_correction(10,gen_random_uuid(),'remove',null,'{"from":{"cid":"one","pos":0,"sid":"b"}}')$q$,'fm_correction_conflict');
select pg_temp.fails($q$select public.fm_commit_correction(10,gen_random_uuid(),'remove',null,'{"from":{"cid":"one","pos":2,"sid":"a"}}')$q$,'fm_correction_conflict');
select pg_temp.fails($q$select public.fm_commit_correction(10,gen_random_uuid(),'remove',null,'{"from":{"cid":"unknown","pos":0,"sid":"a"}}')$q$,'fm_correction_invalid_cell');
select pg_temp.fails($q$select public.fm_commit_correction(10,gen_random_uuid(),'remove',null,'{"from":{"cid":"one","pos":-1,"sid":"a"}}')$q$,'fm_correction_invalid_cell');
select public.fm_commit_correction(10,'00000000-0000-0000-0000-000000000011','remove',null,'{"from":{"cid":"one","pos":0,"sid":"a","company":"forged name"}}');
select pg_temp.ok((select schedule->'cq'->'one'='[null,"b",null]'::jsonb and schedule->'nums'->'b'->>'one'='2' and schedule->'cq'->'two'='["c",null,null]'::jsonb from public.fm_correction_drafts),'only one meeting removed, other queue positions unchanged');
select pg_temp.ok((select schedule->'nums'->'a'='{}'::jsonb and schedule->'res'->'a'->'m'='[]'::jsonb and schedule->'cs'->'one'->>'n'='1' and schedule->'cs'->'one'->'list'='["b"]'::jsonb and schedule->'res'->'a'->'r'->>'one'='4000' from public.fm_correction_drafts),'derived data updated, scoring preserved');
select pg_temp.ok((select action='remove' and details->'from'->>'company'='Company A' and details->'from'->>'chain'='Retailer one' and before_schedule=(select v from state where k='before_remove') from public.fm_correction_history where revision=11),'history freezes authoritative names and before snapshot');
select public.fm_commit_correction(10,'00000000-0000-0000-0000-000000000011','remove',null,'{"from":{"cid":"one","pos":0,"sid":"a","company":"forged name"}}');
select pg_temp.ok((select revision=11 from public.fm_correction_drafts),'retry never repeats removal');
select pg_temp.fails($q$select public.fm_commit_correction(10,gen_random_uuid(),'remove',null,'{"from":{"cid":"one","pos":1,"sid":"b"}}')$q$,'fm_correction_conflict');
select public.fm_commit_correction(11,'00000000-0000-0000-0000-000000000012','undo',null,'{"undo_of":"00000000-0000-0000-0000-000000000011"}');
select pg_temp.ok((select schedule=(select v from state where k='before_remove') from public.fm_correction_drafts),'undo removal restores exact full snapshot');
-- The same supplier at another retailer must remain; remove only this pair override.
select public.fm_commit_correction(12,'00000000-0000-0000-0000-000000000013','rebuild',(select jsonb_set(v,'{cq,two}','["c",null,"a"]')||'{"overrides":{"a":{"one":"test","two":"test"}}}'::jsonb from state where k='before_remove'));
insert into state select 'two_meetings',schedule from public.fm_correction_drafts;
select public.fm_commit_correction(13,'00000000-0000-0000-0000-000000000014','remove',null,'{"from":{"cid":"one","pos":0,"sid":"a"}}');
select pg_temp.ok((select schedule->'cq'->'two'='["c",null,"a"]'::jsonb and schedule->'res'->'a'->'m'='["two"]'::jsonb and schedule->'nums'->'a'='{"two":3}'::jsonb and schedule->'overrides'->'a'='{"two":"test"}'::jsonb from public.fm_correction_drafts),'other meeting and override survive removal');
select public.fm_commit_correction(14,'00000000-0000-0000-0000-000000000015','undo',null,'{"undo_of":"00000000-0000-0000-0000-000000000014"}');
select pg_temp.ok((select schedule=(select v from state where k='two_meetings') from public.fm_correction_drafts),'undo restores pair and its override');
select pg_temp.ok((select schedule=(select v from state where k='approved_before_remove') from public.fm_plan_private),'removal never writes approved plan');
update public.fm_settings set algo_phase='published';
select pg_temp.fails($q$select public.fm_commit_correction(15,gen_random_uuid(),'remove',null,'{}')$q$,'fm_correction_phase_locked');

select pg_temp.fails($q$select public.fm_commit_correction(10,gen_random_uuid(),'approve')$q$,'fm_correction_phase_locked');
reset role;
select pg_temp.login('buyer');set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.fm_correction_history),'buyer cannot read history');
select pg_temp.ok((select count(*)=0 from public.fm_correction_drafts),'buyer cannot read draft');
select pg_temp.fails($q$select public.fm_commit_correction(15,gen_random_uuid(),'remove',null,'{}')$q$,'fm_correction_admin_only');
reset role;
select pg_temp.login('supplier');set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.fm_correction_history),'supplier cannot read history');
select pg_temp.fails($q$select public.fm_commit_correction(15,gen_random_uuid(),'remove',null,'{}')$q$,'fm_correction_admin_only');
reset role;set local role anon;
select pg_temp.fails('select * from public.fm_correction_history','permission denied');
select pg_temp.fails($q$select public.fm_commit_correction(15,gen_random_uuid(),'remove',null,'{}')$q$,'permission denied');
reset role;
select pg_temp.ok((select targets=(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.company_target_retailers x)
 and responses=(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.fm_resps x) from input_before),'matching inputs unchanged');
select 'PASS: confirmation writes, swap/move/remove/undo, history, revisions, rejection, approval, roles, unchanged inputs' result;
rollback;
