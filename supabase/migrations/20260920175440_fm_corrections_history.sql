-- Draft + immutable history are committed atomically. No automatic publication/matching.
-- Rollback: retain these tables/history and restore previous frontend; export the latest
-- draft before rollback. Old frontend cannot read this draft or undo its history.
begin;
create schema if not exists fm_corrections_private;
revoke all on schema fm_corrections_private from public, anon;
grant usage on schema fm_corrections_private to authenticated;

create table if not exists public.fm_correction_drafts (
 id smallint primary key check(id=1), revision bigint not null,
 schedule jsonb not null, approved boolean not null default false,
 plan_base jsonb, updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.fm_correction_history (
 id uuid primary key, revision bigint not null unique,
 action text not null check(action in ('initialize','swap','move','undo','rebuild','load_approved','approve','unlock')),
 details jsonb not null, request jsonb not null, before_schedule jsonb, after_schedule jsonb not null,
 actor_id uuid, actor_name text not null, created_at timestamptz not null default now()
);
alter table public.fm_correction_drafts enable row level security;
alter table public.fm_correction_history enable row level security;
revoke all on public.fm_correction_drafts, public.fm_correction_history from public, anon, authenticated;
grant select on public.fm_correction_drafts, public.fm_correction_history to authenticated;
drop policy if exists fmcd_admin_read on public.fm_correction_drafts;
create policy fmcd_admin_read on public.fm_correction_drafts for select to authenticated using ((select public.is_admin()));
drop policy if exists fmch_admin_read on public.fm_correction_history;
create policy fmch_admin_read on public.fm_correction_history for select to authenticated using ((select public.is_admin()));

-- Rebuild derived structures from the queue, preserving scoring and unrelated metadata.
create or replace function fm_corrections_private.reindex(p jsonb, q jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare rr jsonb:='{}'; nn jsonb:='{}'; cc jsonb:=coalesce(p->'cs','{}'); oo jsonb:='{}';
 s text; c text; item jsonb; pos bigint; matches jsonb; numbers jsonb;
begin
 if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(p->'res') is distinct from 'object' then
   raise exception 'fm_correction_invalid_plan'; end if;
 for c,item in select * from jsonb_each(q) loop
   if jsonb_typeof(item) is distinct from 'array' then raise exception 'fm_correction_invalid_plan'; end if;
   if exists(select 1 from jsonb_array_elements(item) x where x <> 'null'::jsonb and (jsonb_typeof(x)<>'string' or not (p->'res' ? (x#>>'{}')))) then
     raise exception 'fm_correction_unknown_supplier'; end if;
   if exists(select 1 from jsonb_array_elements_text(item) x where x is not null group by x having count(*)>1) then
     raise exception 'fm_correction_duplicate'; end if;
   cc:=jsonb_set(cc,array[c],coalesce(cc->c,'{}') || jsonb_build_object('n',(select count(*) from jsonb_array_elements_text(item) x where x is not null),
     'list',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements_text(item) x where x is not null)),true);
 end loop;
 for s in select jsonb_object_keys(p->'res') loop
   matches:='[]'; numbers:='{}';
   for c,item in select * from jsonb_each(q) loop
     for pos in select ordinality from jsonb_array_elements_text(item) with ordinality x(sid,ordinality) where sid=s loop
       matches:=matches||to_jsonb(c); numbers:=numbers||jsonb_build_object(c,pos);
       if p->'overrides'->s ? c then oo:=jsonb_set(oo,array[s],coalesce(oo->s,'{}')||jsonb_build_object(c,p->'overrides'->s->c),true); end if;
     end loop;
   end loop;
   rr:=rr||jsonb_build_object(s,(p->'res'->s)||jsonb_build_object('m',matches));
   nn:=nn||jsonb_build_object(s,numbers);
 end loop;
 return p||jsonb_build_object('cq',q,'res',rr,'nums',nn,'cs',cc,'overrides',oo);
end $$;
revoke all on function fm_corrections_private.reindex(jsonb,jsonb) from public,anon,authenticated;

create or replace function fm_corrections_private.commit_change(
 p_expected_revision bigint,p_request_id uuid,p_action text,p_schedule jsonb,p_details jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.fm_correction_drafts%rowtype; h public.fm_correction_history%rowtype;
 old jsonb; next jsonb; q jsonb; a text; b text; ca text; cb text; pa int; pb int;
 phase text; details jsonb:='{}'; label jsonb; live jsonb; actor text; rev bigint;
 rejected jsonb:='[]'; placement record; sid text; cid text; company_name text; chain_name text;
 request jsonb:=jsonb_build_object('revision',p_expected_revision,'action',p_action,'schedule',p_schedule,'details',p_details);
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'fm_correction_admin_only' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'fm_correction_request_id_required'; end if;
 perform pg_advisory_xact_lock(20260920,310);
 select * into d from public.fm_correction_drafts where id=1 for update;
 -- Idempotent retry after an uncertain network result never applies the same operation twice.
 select * into h from public.fm_correction_history where id=p_request_id;
 if found then
   if h.actor_id is distinct from auth.uid() or h.request is distinct from request then raise exception 'fm_correction_request_mismatch'; end if;
   return to_jsonb(d);
 end if;
 select algo_phase into phase from public.fm_settings order by updated_at desc nulls last limit 1 for share;
 if coalesce(phase,'') not in ('matching','algorithm','corrections') then raise exception 'fm_correction_phase_locked'; end if;
 if coalesce(d.revision,0) is distinct from p_expected_revision then raise exception 'fm_correction_conflict'; end if;
 select schedule into live from public.fm_plan_private where id=1 for update;
 old:=d.schedule; next:=old;
 if p_action='initialize' then
   if d.id is not null then raise exception 'fm_correction_conflict'; end if;
   next:=fm_corrections_private.reindex(p_schedule,p_schedule->'cq');
   d.approved:=false; d.plan_base:=live;
 elsif d.id is null then raise exception 'fm_correction_not_initialized';
 elsif p_action='unlock' then
   if not d.approved then raise exception 'fm_correction_no_change'; end if;
   d.approved:=false;
 elsif d.approved then raise exception 'fm_correction_approved_locked';
 elsif p_action in ('swap','move') then
   ca:=p_details->'from'->>'cid'; cb:=p_details->'to'->>'cid';
   pa:=(p_details->'from'->>'pos')::int; pb:=(p_details->'to'->>'pos')::int;
   q:=old->'cq';
   if ca is null or cb is null or not(q ? ca) or not(q ? cb) or pa is null or pb is null or pa<0 or pb<0 or pa>10000 or pb>10000 then
     raise exception 'fm_correction_invalid_cell'; end if;
   a:=q->ca->>pa; b:=q->cb->>pb;
   if a is null or a is not distinct from b or (ca=cb and pa=pb) then raise exception 'fm_correction_no_change'; end if;
   if (p_action='swap') is distinct from (b is not null) then raise exception 'fm_correction_conflict'; end if;
   if a is distinct from (p_details->'from'->>'sid') or b is distinct from (p_details->'to'->>'sid') then raise exception 'fm_correction_conflict'; end if;
   -- Pad a target empty cell explicitly; jsonb_set otherwise appends instead of preserving holes.
   while jsonb_array_length(q->cb)<=pb loop q:=jsonb_set(q,array[cb],(q->cb)||'null'::jsonb); end loop;
   q:=jsonb_set(q,array[ca,pa::text],coalesce(to_jsonb(b),'null'::jsonb));
   q:=jsonb_set(q,array[cb,pb::text],to_jsonb(a));
   next:=fm_corrections_private.reindex(old,q);
   -- Increasing a chain's meeting count may not exceed its configured capacity.
   if cb<>ca and b is null and (next->'cs'->cb->>'cap') is not null
      and (next->'cs'->cb->>'n')::int>(next->'cs'->cb->>'cap')::int then raise exception 'fm_correction_capacity'; end if;
   for placement in select a s,cb c union all select b,ca where b is not null loop
     sid:=placement.s; cid:=placement.c;
     select co.name,r.name into company_name,chain_name from public.companies co cross join public.retailers r
       where (co.id::text=sid or co.legacy_fm_id=sid) and r.fm26_chain_id=cid limit 1;
     if ca<>cb and exists(select 1 from public.fm_resps fr join public.companies co on co.id=fr.supplier_company_id
       join public.retailers r on r.id=fr.retailer_id where (co.id::text=sid or co.legacy_fm_id=sid) and r.fm26_chain_id=cid and fr.zone='remove') then
       rejected:=rejected||jsonb_build_array(jsonb_build_object('sid',sid,'cid',cid,'company',coalesce(company_name,sid),'chain',coalesce(chain_name,cid)));
       next:=jsonb_set(next,array['overrides',sid],coalesce(next->'overrides'->sid,'{}')||jsonb_build_object(cid,'manually_added_despite_buyer_rejection'),true);
     end if;
   end loop;
   if rejected<>'[]'::jsonb and coalesce((p_details->>'accept_rejections')::boolean,false) is not true then raise exception 'fm_correction_rejection_confirmation'; end if;
   details:=jsonb_build_object('from',jsonb_build_object('cid',ca,'pos',pa,'sid',a),'to',jsonb_build_object('cid',cb,'pos',pb,'sid',b),'rejections',rejected);
   -- Freeze names in the history, so later profile renaming does not erase context.
   foreach label in array array[details->'from',details->'to'] loop
     select name into company_name from public.companies co where co.id::text=label->>'sid' or co.legacy_fm_id=label->>'sid' limit 1;
     select name into chain_name from public.retailers r where r.fm26_chain_id=label->>'cid' limit 1;
     details:=jsonb_set(details,array[case when label=details->'from' then 'from' else 'to' end],label||jsonb_build_object('company',company_name,'chain',coalesce(chain_name,label->>'cid')));
   end loop;
 elsif p_action='undo' then
   select * into h from public.fm_correction_history x
     where action in ('swap','move','rebuild','load_approved')
       and not exists(select 1 from public.fm_correction_history u where u.action='undo' and u.details->>'undo_of'=x.id::text)
     order by revision desc limit 1;
   if h.id is null or h.id::text is distinct from p_details->>'undo_of' or h.after_schedule is distinct from old then raise exception 'fm_correction_undo_conflict'; end if;
   next:=h.before_schedule; details:=jsonb_build_object('undo_of',h.id,'undo_revision',h.revision,'original',h.details);
 elsif p_action='rebuild' then
   next:=fm_corrections_private.reindex(p_schedule,p_schedule->'cq');
 elsif p_action='load_approved' then
   if live is null then raise exception 'fm_correction_no_approved_plan'; end if;
   next:=fm_corrections_private.reindex(live,live->'cq'); d.plan_base:=live;
 elsif p_action='approve' then
   if live is distinct from d.plan_base then raise exception 'fm_correction_plan_changed'; end if;
   insert into public.fm_plan_private(id,schedule,updated_at,updated_by) values(1,next,clock_timestamp(),auth.uid())
     on conflict(id) do update set schedule=excluded.schedule,updated_at=excluded.updated_at,updated_by=excluded.updated_by
       where public.fm_plan_private.schedule is not distinct from d.plan_base;
   if not found then raise exception 'fm_correction_plan_changed'; end if;
   d.approved:=true; d.plan_base:=next;
 else raise exception 'fm_correction_invalid_action';
 end if;
 if next is null then raise exception 'fm_correction_invalid_plan'; end if;
 if p_action in ('rebuild','load_approved') and old=next then raise exception 'fm_correction_no_change'; end if;
 rev:=coalesce(d.revision,0)+1;
 select coalesce(nullif(name,''),id::text) into actor from public.profiles where id=auth.uid();
 insert into public.fm_correction_history(id,revision,action,details,request,before_schedule,after_schedule,actor_id,actor_name)
   values(p_request_id,rev,p_action,details,request,old,next,auth.uid(),coalesce(actor,auth.uid()::text));
 insert into public.fm_correction_drafts(id,revision,schedule,approved,plan_base,updated_at,updated_by)
   values(1,rev,next,coalesce(d.approved,false),d.plan_base,clock_timestamp(),auth.uid())
   on conflict(id) do update set revision=excluded.revision,schedule=excluded.schedule,approved=excluded.approved,
     plan_base=excluded.plan_base,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning * into d;
 return to_jsonb(d);
end $$;
revoke all on function fm_corrections_private.commit_change(bigint,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function fm_corrections_private.commit_change(bigint,uuid,text,jsonb,jsonb) to authenticated;
create or replace function public.fm_commit_correction(p_expected_revision bigint,p_request_id uuid,p_action text,p_schedule jsonb default null,p_details jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select fm_corrections_private.commit_change(p_expected_revision,p_request_id,p_action,p_schedule,p_details);
$$;
revoke all on function public.fm_commit_correction(bigint,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.fm_commit_correction(bigint,uuid,text,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
