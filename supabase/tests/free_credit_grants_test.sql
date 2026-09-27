-- Test only: temporary local database; transaction rolled back.
-- [feat/free-credit-grants] admin_grant_free_credits / mark_credit_grant_seen / company_capacity pule
begin;
create temp table ids(k text primary key, v uuid);
insert into ids select k, gen_random_uuid() from unnest(array['admin','supplier','supplier2','co','co2','ghost']) k;
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
create function pg_temp.fails(stmt text, code text, msg text) returns void language plpgsql as $$
begin
 begin execute stmt; exception when others then
   if sqlstate = code then return; end if;
   raise exception 'FAIL: % — oczekiwano %, dostano % (%)', msg, code, sqlstate, sqlerrm;
 end;
 raise exception 'FAIL: % — instrukcja przeszła', msg;
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',k||'@grants.test','',now(),now(),now(),
case k when 'admin' then '{"role":"admin"}'::jsonb else '{}'::jsonb end,'{}'::jsonb from ids where k in ('admin','supplier','supplier2');
insert into public.companies(id,name,account_status,preconnect_enabled) values
 (pg_temp.id('co'),'Grants test company A','active',true),
 (pg_temp.id('co2'),'Grants test company B','active',true);
update public.profiles set role='admin' where id=pg_temp.id('admin');
update public.profiles set role='supplier',company_id=pg_temp.id('co') where id=pg_temp.id('supplier');
update public.profiles set role='supplier',company_id=pg_temp.id('co2') where id=pg_temp.id('supplier2');

-- ── schemat ──
select pg_temp.ok((select count(*)=8 from information_schema.columns where table_schema='public' and table_name='packages'
  and column_name in ('source','grant_reason','grant_message','grant_note','granted_by','granted_at','grant_batch_id','grant_seen_at')),'packages ma kolumny przyznania');
select pg_temp.ok((select active=false and price_eur=0 from public.package_plans where id='grant'),'plan katalogowy grant nieaktywny i darmowy');
select pg_temp.ok((select count(*)=6 from information_schema.columns where table_schema='public' and table_name='company_capacity'
  and column_name in ('qty_remaining_free','qty_remaining_paid','qty_total_free','qty_total_paid','free_expiry','paid_expiry')),'company_capacity ma kolumny pul');
select pg_temp.ok((select reloptions::text like '%security_invoker=true%' from pg_class where relname='company_capacity'),'company_capacity zachowuje security_invoker');

-- stary wiersz zakupu: DEFAULT source = purchase, bez klasyfikacji po cenie zero
insert into public.packages(company_id,plan,qty_total,qty_used,price_paid,currency,expires_at,payment_ref)
values (pg_temp.id('co'),'std_1',1,0,0,'EUR',current_date+30,'legacy-zero-price-row');
select pg_temp.ok((select source='purchase' from public.packages where payment_ref='legacy-zero-price-row'),'stary wiersz z ceną 0 pozostaje purchase');

-- constrainty spójności
select pg_temp.fails($q$insert into public.packages(company_id,plan,qty_total,price_paid,expires_at,source) values ((select v from ids where k='co'),'grant',1,0,current_date+10,'grant')$q$,'23514','grant bez powodu/partii odrzucony');
select pg_temp.fails($q$insert into public.packages(company_id,plan,qty_total,price_paid,expires_at,grant_reason) values ((select v from ids where k='co'),'std_1',1,0,current_date+10,'gift')$q$,'23514','purchase z powodem odrzucony');
select pg_temp.fails($q$insert into public.packages(company_id,plan,qty_total,price_paid,expires_at,source) values ((select v from ids where k='co'),'std_1',1,0,current_date+10,'bonus')$q$,'23514','nieznane źródło odrzucone');

-- ── uprawnienia: dostawca nie przyznaje ──
select pg_temp.login('supplier'); set local role authenticated;
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'gift','supplier-try-00000001')$q$,'42501','dostawca nie może przyznać kredytów');
select pg_temp.denied($q$insert into public.package_grant_batches(idempotency_key,created_by,qty,reason,expires_at,company_ids,company_count) values ('x-00000001',(select v from ids where k='supplier'),1,'gift',current_date+1,array[(select v from ids where k='co')],1)$q$);
reset role;

-- ── admin: walidacje ──
select pg_temp.login('admin'); set local role authenticated;
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],0,'gift','k-qty0-00000001')$q$,'22023','qty 0 odrzucone');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],101,'gift','k-qty101-0000001')$q$,'22023','qty 101 odrzucone');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'bonus','k-reason-0000001')$q$,'22023','nieznany powód odrzucony');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='ghost')],1,'gift','k-ghost-00000001')$q$,'22023','nieistniejąca firma odrzucona');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'gift','k-exp-000000001',null,null,current_date)$q$,'22023','ważność = dziś odrzucona');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'gift','short')$q$,'22023','za krótki klucz idempotencji odrzucony');
select pg_temp.fails($q$select public.admin_grant_free_credits('{}'::uuid[],1,'gift','k-empty-00000001')$q$,'22023','pusta lista firm odrzucona');
select pg_temp.ok((select count(*)=0 from public.package_grant_batches),'nieudane próby nie zostawiają partii');

-- ── admin: przyznanie 2 kredytów dwóm firmom, domyślna ważność 3 miesiące ──
create temp table res as select public.admin_grant_free_credits(
  array[(select v from ids where k='co'),(select v from ids where k='co2'),(select v from ids where k='co')],  -- duplikat firmy w wejściu
  2,'compensation','batch-A-00000001','Rekompensata za odwołane spotkania','notatka wewnętrzna') as r;
select pg_temp.ok((select (r->>'created')::int=2 and (r->>'already_done')::boolean=false and (r->>'company_count')::int=2 from res),'partia A: 2 firmy, 2 wiersze, duplikat wejścia zdeduplikowany');
select pg_temp.ok((select (r->>'expires_at')::date = (current_date + interval '3 months')::date from res),'domyślna ważność = 3 miesiące od dziś');
select pg_temp.ok((select count(*)=2 from public.packages where source='grant' and plan='grant' and qty_total=2 and qty_used=0 and price_paid=0
   and grant_reason='compensation' and grant_message='Rekompensata za odwołane spotkania' and grant_note='notatka wewnętrzna'
   and granted_by=pg_temp.id('admin') and granted_at is not null and grant_batch_id=(select (r->>'batch_id')::uuid from res)
   and expires_at=(current_date + interval '3 months')::date and payment_ref like 'grant:%'),'wiersze packages partii A kompletne');
select pg_temp.ok((select count(*)=2 from public.wallet_tx where type='adjustment' and amount=0 and meta->>'kind'='free_credit_grant'
   and (meta->>'qty')::int=2 and meta->>'reason'='compensation'),'wallet_tx: ślad przyznania per firma');
select pg_temp.ok((select count(*)=1 from public.package_grant_batches where idempotency_key='batch-A-00000001' and company_count=2 and qty=2),'historia partii zapisana');

-- ── idempotencja: ten sam klucz → nic nie dopisuje ──
create temp table res2 as select public.admin_grant_free_credits(
  array[(select v from ids where k='co'),(select v from ids where k='co2')],2,'compensation','batch-A-00000001','inna treść','inna notatka') as r;
select pg_temp.ok((select (r->>'already_done')::boolean=true and (r->>'created')::int=0 and r->>'batch_id'=(select r->>'batch_id' from res) from res2),'powtórka klucza zwraca pierwszą partię');
select pg_temp.ok((select count(*)=2 from public.packages where source='grant'),'powtórka nie dopisała pakietów');
select pg_temp.ok((select count(*)=2 from public.wallet_tx where meta->>'kind'='free_credit_grant'),'powtórka nie dopisała wallet_tx');
select pg_temp.ok((select count(*)=1 from public.package_grant_batches),'powtórka nie dopisała partii');

-- ── jawna data ważności ──
create temp table res3 as select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'promotion','batch-B-00000001',null,null,current_date+400) as r;
select pg_temp.ok((select (r->>'created')::int=1 and (r->>'expires_at')::date=current_date+400 from res3),'jawna data ważności honorowana');

-- ── company_capacity: pule ──
select pg_temp.ok((select qty_remaining_free=3 and qty_total_free=3 and qty_remaining_paid=1 and qty_total_paid=1
   and free_expiry=(current_date + interval '3 months')::date and paid_expiry=current_date+30
   from public.company_capacity where id=pg_temp.id('co')),'company_capacity rozbija firmę A na pule');
select pg_temp.ok((select qty_remaining_free=2 and qty_remaining_paid=0 and paid_expiry is null from public.company_capacity where id=pg_temp.id('co2')),'company_capacity firma B: tylko bezpłatne');
select pg_temp.ok((select qty_remaining=4 and qty_total=4 from public.company_capacity where id=pg_temp.id('co')),'company_capacity: sumy jak dotąd');
reset role;

-- zużycie kredytu z puli bezpłatnej (jak legacy-send-seen) → free spada, paid bez zmian
update public.packages set qty_used=qty_used+1 where company_id=pg_temp.id('co') and source='grant' and qty_total=2;
select pg_temp.ok((select qty_remaining_free=2 and qty_remaining_paid=1 from public.company_capacity where id=pg_temp.id('co')),'po zużyciu: free 2, paid 1');

-- ── dostawca: widzi własne przyznanie, zamyka powiadomienie tylko u siebie ──
select pg_temp.login('supplier'); set local role authenticated;
select pg_temp.ok((select count(*)=2 from public.packages where source='grant' and grant_seen_at is null),'dostawca A widzi swoje 2 nieprzeczytane przyznania');
select pg_temp.ok((select count(*)=0 from public.packages where company_id=pg_temp.id('co2')),'dostawca A nie widzi pakietów firmy B');
select pg_temp.ok((select count(*)=0 from public.package_grant_batches),'dostawca nie widzi historii partii');
select pg_temp.ok((select public.mark_credit_grant_seen((select id from public.packages where company_id=pg_temp.id('co') and source='grant' and grant_batch_id=(select (r->>'batch_id')::uuid from res)))),'dostawca A zamyka powiadomienie');
select pg_temp.ok((select public.mark_credit_grant_seen((select id from public.packages where company_id=pg_temp.id('co2') and source='grant')) = false),'dostawca A nie zamyka powiadomienia firmy B');
select pg_temp.ok((select public.mark_credit_grant_seen((select id from public.packages where payment_ref='legacy-zero-price-row')) = false),'zakupu nie da się oznaczyć jako przyznanie');
reset role;
select pg_temp.ok((select grant_seen_at is not null from public.packages where company_id=pg_temp.id('co') and source='grant' and grant_batch_id=(select (r->>'batch_id')::uuid from res)),'grant_seen_at ustawione dla firmy A');
select pg_temp.ok((select grant_seen_at is null from public.packages where company_id=pg_temp.id('co2') and source='grant'),'grant_seen_at firmy B nietknięte');

-- ── admin widzi historię, anon nic ──
select pg_temp.login('admin'); set local role authenticated;
select pg_temp.ok((select count(*)=2 from public.package_grant_batches),'admin widzi 2 partie');
select pg_temp.denied($q$delete from public.package_grant_batches$q$);
select pg_temp.denied($q$update public.package_grant_batches set qty=99$q$);
reset role;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','',true);
set local role anon;
select pg_temp.denied('select * from public.package_grant_batches');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'gift','anon-try-00000001')$q$,'42501','anon nie przyznaje');
reset role;

select 'PASS: free credit grants — źródło/powód na pakiecie, 3 miesiące domyślnie, idempotencja partii, RLS historii, pule w company_capacity, potwierdzenie u dostawcy' result;
rollback;
