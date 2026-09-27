-- Test only: temporary local database; transaction rolled back.
-- [feat/free-credit-grants v2] admin_grant_free_credits / mark_credit_grant_seen /
-- charge_legacy_send_first_seen / company_capacity pule / notatka tylko w partii
begin;
create temp table ids(k text primary key, v uuid);
insert into ids select k, gen_random_uuid() from unnest(array['admin','supplier','supplier2','co','co2','ghost','send1','send2','send3','send4']) k;
grant all on ids to authenticated, anon;
create function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k=key $$;
create function pg_temp.login(key text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', coalesce(pg_temp.id(key)::text,''), true);
 perform set_config('request.jwt.claims', json_build_object('sub',pg_temp.id(key),'role','authenticated')::text,true);
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','',true);
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
insert into public.companies(id,name,account_status,preconnect_enabled,legacy_supplier_id) values
 (pg_temp.id('co'),'Grants test company A','active',true,'legacy-co-a'),
 (pg_temp.id('co2'),'Grants test company B','active',true,'legacy-co-b');
update public.profiles set role='admin' where id=pg_temp.id('admin');
update public.profiles set role='supplier',company_id=pg_temp.id('co') where id=pg_temp.id('supplier');
update public.profiles set role='supplier',company_id=pg_temp.id('co2') where id=pg_temp.id('supplier2');

-- ── schemat ──
select pg_temp.ok((select count(*)=7 from information_schema.columns where table_schema='public' and table_name='packages'
  and column_name in ('source','grant_reason','grant_message','granted_by','granted_at','grant_batch_id','grant_seen_at')),'packages ma kolumny przyznania');
select pg_temp.ok((select count(*)=0 from information_schema.columns where table_schema='public' and table_name='packages' and column_name='grant_note'),'packages NIE ma kolumny notatki (P1 Codex)');
select pg_temp.ok((select active=false and price_eur=0 from public.package_plans where id='grant'),'plan katalogowy grant nieaktywny i darmowy');
select pg_temp.ok((select count(*)=6 from information_schema.columns where table_schema='public' and table_name='company_capacity'
  and column_name in ('qty_remaining_free','qty_remaining_paid','qty_total_free','qty_total_paid','free_expiry','paid_expiry')),'company_capacity ma kolumny pul');
select pg_temp.ok((select reloptions::text like '%security_invoker=true%' from pg_class where relname='company_capacity'),'company_capacity zachowuje security_invoker');
select pg_temp.ok((select public.business_today('2026-09-27T22:30:00Z') = date '2026-09-28' and public.business_today('2026-09-27T21:30:00Z') = date '2026-09-27'),'business_today: 22:30 UTC 27.09 = 28.09 w Warszawie');
select pg_temp.ok((select pg_get_viewdef('public.company_capacity'::regclass) like '%business_today()%' and pg_get_viewdef('public.company_capacity'::regclass) not like '%current_date%'),'company_capacity liczy po dniu biznesowym, nie current_date');

-- stary wiersz zakupu: DEFAULT source = purchase, bez klasyfikacji po cenie zero
insert into public.packages(company_id,plan,qty_total,qty_used,price_paid,currency,expires_at,payment_ref)
values (pg_temp.id('co'),'std_1',1,0,0,'EUR',current_date+30,'legacy-zero-price-row');
select pg_temp.ok((select source='purchase' from public.packages where payment_ref='legacy-zero-price-row'),'stary wiersz z ceną 0 pozostaje purchase');

-- constrainty spójności
select pg_temp.fails($q$insert into public.packages(company_id,plan,qty_total,price_paid,expires_at,source) values ((select v from ids where k='co'),'grant',1,0,current_date+10,'grant')$q$,'23514','grant bez powodu/partii odrzucony');
select pg_temp.fails($q$insert into public.packages(company_id,plan,qty_total,price_paid,expires_at,grant_reason) values ((select v from ids where k='co'),'std_1',1,0,current_date+10,'gift')$q$,'23514','purchase z powodem odrzucony');
select pg_temp.fails($q$insert into public.packages(company_id,plan,qty_total,price_paid,expires_at,source) values ((select v from ids where k='co'),'std_1',1,0,current_date+10,'bonus')$q$,'23514','nieznane źródło odrzucone');

-- ── uprawnienia: dostawca nie przyznaje, nie rozlicza ──
select pg_temp.login('supplier'); set local role authenticated;
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'gift','supplier-try-00000001')$q$,'42501','dostawca nie może przyznać kredytów');
select pg_temp.denied($q$insert into public.package_grant_batches(idempotency_key,created_by,qty,reason,expires_at,company_ids,company_count) values ('x-00000001',(select v from ids where k='supplier'),1,'gift',current_date+1,array[(select v from ids where k='co')],1)$q$);
select pg_temp.denied($q$select public.charge_legacy_send_first_seen((select v from ids where k='send1'),(select v from ids where k='co'))$q$);
select pg_temp.denied($q$select public.mark_legacy_send_seen((select v from ids where k='send1'),(select v from ids where k='co'),'app_list')$q$);
select pg_temp.denied($q$select public.mark_legacy_sends_supplier_notified(array[990001]::bigint[],'app_list',1)$q$);
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
  array[(select v from ids where k='co2'),(select v from ids where k='co'),(select v from ids where k='co')],  -- duplikat + inna kolejność
  2,'compensation','batch-A-00000001','Rekompensata za odwołane spotkania','notatka wewnętrzna') as r;
select pg_temp.ok((select (r->>'created')::int=2 and (r->>'already_done')::boolean=false and (r->>'company_count')::int=2 from res),'partia A: 2 firmy, 2 wiersze, duplikat wejścia zdeduplikowany');
select pg_temp.ok((select (r->>'expires_at')::date = (public.business_today() + interval '3 months')::date from res),'domyślna ważność = 3 miesiące od dziś');
select pg_temp.ok((select count(*)=2 from public.packages where source='grant' and plan='grant' and qty_total=2 and qty_used=0 and price_paid=0
   and grant_reason='compensation' and grant_message='Rekompensata za odwołane spotkania'
   and granted_by=pg_temp.id('admin') and granted_at is not null and grant_batch_id=(select (r->>'batch_id')::uuid from res)
   and expires_at=(public.business_today() + interval '3 months')::date and payment_ref like 'grant:%'),'wiersze packages partii A kompletne');
select pg_temp.ok((select note='notatka wewnętrzna' from public.package_grant_batches where idempotency_key='batch-A-00000001'),'notatka wewnętrzna zapisana TYLKO w partii');
select pg_temp.ok((select count(*)=2 from public.wallet_tx where type='adjustment' and amount=0 and meta->>'kind'='free_credit_grant'
   and (meta->>'qty')::int=2 and meta->>'reason'='compensation'),'wallet_tx: ślad przyznania per firma');
select pg_temp.ok((select count(*)=1 from public.package_grant_batches where idempotency_key='batch-A-00000001' and company_count=2 and qty=2),'historia partii zapisana');

-- ── idempotencja: ten sam klucz + te same parametry (inna kolejność firm, spacje) → nic nie dopisuje ──
create temp table res2 as select public.admin_grant_free_credits(
  array[(select v from ids where k='co'),(select v from ids where k='co2')],2,'compensation','batch-A-00000001','  Rekompensata za odwołane spotkania ','notatka wewnętrzna') as r;
select pg_temp.ok((select (r->>'already_done')::boolean=true and (r->>'created')::int=0 and r->>'batch_id'=(select r->>'batch_id' from res) from res2),'powtórka klucza zwraca pierwszą partię');
select pg_temp.ok((select count(*)=2 from public.packages where source='grant'),'powtórka nie dopisała pakietów');
select pg_temp.ok((select count(*)=2 from public.wallet_tx where meta->>'kind'='free_credit_grant'),'powtórka nie dopisała wallet_tx');
select pg_temp.ok((select count(*)=1 from public.package_grant_batches),'powtórka nie dopisała partii');
-- powtórka BEZ jawnej daty (front wysyła null przy domyślnej) → też zgodna
select pg_temp.ok((select (public.admin_grant_free_credits(array[(select v from ids where k='co'),(select v from ids where k='co2')],2,'compensation','batch-A-00000001','Rekompensata za odwołane spotkania','notatka wewnętrzna',null)->>'already_done')::boolean),'powtórka z null expires zgodna');

-- ── ten sam klucz z INNYMI parametrami → błąd, nic nie dopisano (P2 Codex) ──
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co'),(select v from ids where k='co2')],3,'compensation','batch-A-00000001','Rekompensata za odwołane spotkania','notatka wewnętrzna')$q$,'22023','klucz z inną liczbą odrzucony');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],2,'compensation','batch-A-00000001','Rekompensata za odwołane spotkania','notatka wewnętrzna')$q$,'22023','klucz z inną listą firm odrzucony');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co'),(select v from ids where k='co2')],2,'gift','batch-A-00000001','Rekompensata za odwołane spotkania','notatka wewnętrzna')$q$,'22023','klucz z innym powodem odrzucony');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co'),(select v from ids where k='co2')],2,'compensation','batch-A-00000001','inna wiadomość','notatka wewnętrzna')$q$,'22023','klucz z inną wiadomością odrzucony');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co'),(select v from ids where k='co2')],2,'compensation','batch-A-00000001','Rekompensata za odwołane spotkania','notatka wewnętrzna',current_date+400)$q$,'22023','klucz z inną datą odrzucony');
select pg_temp.ok((select count(*)=2 from public.packages where source='grant') and (select count(*)=1 from public.package_grant_batches),'niezgodne powtórki nic nie dopisały');

-- ── jawna data ważności ──
create temp table res3 as select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'promotion','batch-B-00000001',null,null,current_date+400) as r;
select pg_temp.ok((select (r->>'created')::int=1 and (r->>'expires_at')::date=current_date+400 from res3),'jawna data ważności honorowana');

-- ── company_capacity: pule ──
select pg_temp.ok((select qty_remaining_free=3 and qty_total_free=3 and qty_remaining_paid=1 and qty_total_paid=1
   and free_expiry=(public.business_today() + interval '3 months')::date and paid_expiry=current_date+30
   from public.company_capacity where id=pg_temp.id('co')),'company_capacity rozbija firmę A na pule');
select pg_temp.ok((select qty_remaining_free=2 and qty_remaining_paid=0 and paid_expiry is null from public.company_capacity where id=pg_temp.id('co2')),'company_capacity firma B: tylko bezpłatne');
select pg_temp.ok((select qty_remaining=4 and qty_total=4 from public.company_capacity where id=pg_temp.id('co')),'company_capacity: sumy jak dotąd');
reset role;

-- ── rozliczanie przy pierwszym odczycie (service_role = właściciel w teście) ──
-- Firma A ma: purchase std_1 (1 kredyt, ważny +30 dni), grant 2 kredyty (+3 mies.), grant 1 kredyt (+400 dni).
insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values
 (pg_temp.id('send1'),990001,'legacy-co-a',1,'sent','{"supplierId":"legacy-co-a","price":"45"}'),
 (pg_temp.id('send2'),990002,'legacy-co-a',1,'sent','{"supplierId":"legacy-co-a"}'),
 (pg_temp.id('send3'),990003,'legacy-co-a',1,'sent','{"supplierId":"legacy-co-a","price":"abc"}'),
 (pg_temp.id('send4'),990004,'legacy-co-a',1,'sent','{"supplierId":"legacy-co-a"}');
select pg_temp.logout();
create temp table ch1 as select public.charge_legacy_send_first_seen(pg_temp.id('send1'),pg_temp.id('co'),'2026-09-27T10:00:00Z') as r;
select pg_temp.ok((select (r->>'charged')::boolean and r->>'billing_status'='charged' and r->>'package_source'='grant'
   and (r->>'package_id')::uuid=(select id from public.packages where source='grant' and company_id=pg_temp.id('co') and qty_total=2)
   and (r->>'charge_amount')::numeric=45 and r->>'charge_at'='2026-09-27T10:00:00.000Z' from ch1),'odczyt 1: bezpłatny z najbliższą ważnością (2-kredytowy, +3 mies.), mimo że zakup jest starszy i wygasa wcześniej');
select pg_temp.ok((select qty_used=1 from public.packages where source='grant' and company_id=pg_temp.id('co') and qty_total=2),'qty_used +1 na właściwym pakiecie');
select pg_temp.ok((select data->>'billingStatus'='charged' and data->>'packageSource'='grant' and (data->>'chargeTxId') is not null and data->>'supplierId'='legacy-co-a' from public.legacy_sends where id=pg_temp.id('send1')),'znacznik na wysyłce w tej samej transakcji, reszta data zachowana');
select pg_temp.ok((select count(*)=1 from public.wallet_tx where type='send_charge' and reference_id=pg_temp.id('send1') and meta->>'package_source'='grant' and (meta->>'amount_eur')::numeric=45),'wallet_tx send_charge z pulą');
-- powtórny odczyt tej samej wysyłki → already_charged, bez drugiego pobrania
create temp table ch1b as select public.charge_legacy_send_first_seen(pg_temp.id('send1'),pg_temp.id('co')) as r;
select pg_temp.ok((select (r->>'charged')::boolean=false and (r->>'already_charged')::boolean and r->>'billing_status'='charged' and r->>'package_source'='grant' from ch1b),'powtórny odczyt: already_charged');
select pg_temp.ok((select qty_used=1 from public.packages where source='grant' and company_id=pg_temp.id('co') and qty_total=2) and (select count(*)=1 from public.wallet_tx where type='send_charge'),'powtórny odczyt nic nie pobrał');
-- kolejne odczyty: 2. bezpłatny z tej samej puli, potem bezpłatny +400 dni, potem dopiero kupiony
select public.charge_legacy_send_first_seen(pg_temp.id('send2'),pg_temp.id('co'));
select pg_temp.ok((select qty_used=2 from public.packages where source='grant' and company_id=pg_temp.id('co') and qty_total=2),'odczyt 2: dobiera z tej samej bezpłatnej puli');
create temp table ch3 as select public.charge_legacy_send_first_seen(pg_temp.id('send3'),pg_temp.id('co')) as r;
select pg_temp.ok((select r->>'package_source'='grant' and (r->>'charge_amount')::numeric=0 from ch3) and (select qty_used=1 from public.packages where source='grant' and company_id=pg_temp.id('co') and qty_total=1),'odczyt 3: bezpłatny z dalszą ważnością przed kupionym; nienumeryczna cena = 0, bez błędu');
create temp table ch4 as select public.charge_legacy_send_first_seen(pg_temp.id('send4'),pg_temp.id('co')) as r;
select pg_temp.ok((select r->>'package_source'='purchase' and (r->>'charge_amount')::numeric=0 from ch4) and (select qty_used=1 from public.packages where payment_ref='legacy-zero-price-row'),'odczyt 4: dopiero teraz kupiony');
select pg_temp.ok((select qty_remaining=0 and qty_remaining_free=0 and qty_remaining_paid=0 from public.company_capacity where id=pg_temp.id('co')),'po 4 odczytach firma A bez kredytów');
-- brak kredytów → no_package_available, bez znacznika
insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values (gen_random_uuid(),990005,'legacy-co-a',1,'sent','{}');
select pg_temp.ok((select r->>'billing_status'='no_package_available' and (r->>'charged')::boolean=false from (select public.charge_legacy_send_first_seen((select id from public.legacy_sends where legacy_id=990005),pg_temp.id('co')) as r) x),'brak kredytów: no_package_available');
select pg_temp.ok((select data->>'billingStatus' is null from public.legacy_sends where legacy_id=990005),'bez kredytu brak znacznika na wysyłce');
select pg_temp.fails($q$select public.charge_legacy_send_first_seen(gen_random_uuid(),(select v from ids where k='co'))$q$,'P0002','nieistniejąca wysyłka');

-- ── mark_legacy_send_seen: „odczytano” + rozliczenie w jednej transakcji, scalanie tylko pól odczytu ──
-- firma B ma 2 bezpłatne kredyty (partia A); nowe wysyłki dla firmy B
insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values
 (gen_random_uuid(),990201,'legacy-co-b',1,'sent','{"supplierId":"legacy-co-b","custom":"keep-me"}'),
 (gen_random_uuid(),990202,'legacy-co-b',1,'sent','{}'),
 (gen_random_uuid(),990203,'legacy-co-b',1,'rejected','{}');
select pg_temp.fails($q$select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990201),(select v from ids where k='co2'),'sms')$q$,'22023','nieznany kanał odrzucony');
create temp table ms1 as select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990201),pg_temp.id('co2'),'app_list','2026-09-27T09:00:00Z') as r;
select pg_temp.ok((select (r->>'skipped')::boolean=false and r->>'previous_status'='sent' and r->>'status'='read'
   and r->'data'->>'seenAt'='2026-09-27T09:00:00.000Z' and r->'data'->>'readAt'='2026-09-27T09:00:00.000Z' and r->'data'->>'readType'='auto_buyer_preconnect_list'
   and r->'data'->>'seenChannel'='app_list' and r->'data'->>'custom'='keep-me' and r->'data'->>'billingStatus'='charged' and r->'data'->>'packageSource'='grant'
   and (r->'billing'->>'charged')::boolean and (r->>'supplier_notified_before')::boolean=false from ms1),'app_list: status read, pola odczytu, reszta JSON zachowana, rozliczone z bezpłatnych w tej samej transakcji');
select pg_temp.ok((select status='read' and data->>'status'='read' and email_opened_at is null from public.legacy_sends where legacy_id=990201),'kolumna status i data.status = read; email_opened_at nietknięte');
-- e-mail PO odczycie: nie cofa read, nie kasuje readAt, nie pobiera drugi raz, ustawia emailOpenedAt
create temp table ms2 as select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990201),pg_temp.id('co2'),'email','2026-09-27T09:05:00Z') as r;
select pg_temp.ok((select r->>'previous_status'='read' and r->>'status'='read' and r->'data'->>'readAt'='2026-09-27T09:00:00.000Z' and r->'data'->>'emailOpenedAt'='2026-09-27T09:05:00.000Z'
   and (r->'billing'->>'already_charged')::boolean and r->'billing'->>'billing_status'='charged' from ms2),'email po read: status zostaje read, readAt bez zmian, already_charged');
select pg_temp.ok((select email_opened_at='2026-09-27T09:05:00Z'::timestamptz and data->>'chargeTxId' is not null from public.legacy_sends where legacy_id=990201),'email_opened_at ustawione, znacznik rozliczenia nienaruszony');
select pg_temp.ok((select qty_used=1 from public.packages where company_id=pg_temp.id('co2') and source='grant'),'firma B: jedno pobranie po dwóch kanałach');
-- e-mail na 'sent' → 'opened'; bez firmy → company_not_found, bez znacznika rozliczenia
create temp table ms3 as select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990202),null,'email','2026-09-27T09:10:00Z') as r;
select pg_temp.ok((select r->>'status'='opened' and r->'billing'->>'billing_status'='company_not_found' and r->'data'->>'billingStatus'='company_not_found' and (r->'data'->>'chargeAt') is null from ms3),'email na sent: opened, company_not_found bez znacznika');
-- potem odczyt w aplikacji z firmą: opened → read, rozliczone; billingStatus nadpisany na charged
create temp table ms4 as select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990202),pg_temp.id('co2'),'app_detail','2026-09-27T09:20:00Z') as r;
select pg_temp.ok((select r->>'previous_status'='opened' and r->>'status'='read' and r->'data'->>'readType'='auto_buyer_open' and r->'data'->>'billingStatus'='charged' and (r->'billing'->>'charged')::boolean from ms4),'opened → read w aplikacji, rozliczone');
-- brak kredytów NIE nadpisuje 'charged' (to jest dokładnie scenariusz P1 Codexa, tym razem w bazie)
select pg_temp.ok((select r->'data'->>'billingStatus'='charged' and (r->'billing'->>'already_charged')::boolean from (select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990202),pg_temp.id('co2'),'app_list') as r) x),'kolejny odczyt nie zamienia charged na no_package_available');
select pg_temp.ok((select qty_used=2 from public.packages where company_id=pg_temp.id('co2') and source='grant'),'firma B: dwa pobrania za dwie propozycje, nie więcej');
-- status spoza listy → skipped, bez zmian
select pg_temp.ok((select (r->>'skipped')::boolean and r->>'reason'='status_rejected' from (select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990203),pg_temp.id('co2'),'app_list') as r) x),'rejected: skipped');
select pg_temp.ok((select status='rejected' and data='{}'::jsonb from public.legacy_sends where legacy_id=990203),'skipped nie dotyka wiersza');
select pg_temp.fails($q$select public.mark_legacy_send_seen(gen_random_uuid(),(select v from ids where k='co2'),'app_list')$q$,'P0002','nieistniejąca wysyłka (mark)');

-- ── mark_legacy_sends_supplier_notified: tylko 3 pola, na aktualnym wierszu, idempotentnie ──
-- 990201 jest rozliczony (charged, read, emailOpenedAt) — znacznik powiadomienia nie może niczego zdjąć
create temp table sn1 as select public.mark_legacy_sends_supplier_notified(array[990201,990202,990203]::bigint[],'app_list',2,'2026-09-27T09:30:00Z') as r;
select pg_temp.ok((select r=3 from sn1),'znacznik powiadomienia: 3 wiersze oznaczone');
select pg_temp.ok((select data->>'supplierNotifiedAt'='2026-09-27T09:30:00.000Z' and data->>'supplierNotifiedVia'='app_list' and (data->>'supplierNotifiedBatchSize')::int=2
   and data->>'billingStatus'='charged' and data->>'packageSource'='grant' and (data->>'chargeTxId') is not null and data->>'readAt'='2026-09-27T09:00:00.000Z'
   and data->>'emailOpenedAt'='2026-09-27T09:05:00.000Z' and data->>'custom'='keep-me' and status='read' from public.legacy_sends where legacy_id=990201),'powiadomienie nie kasuje rozliczenia, odczytu ani reszty JSON-u');
select pg_temp.ok((select data='{"supplierNotifiedAt":"2026-09-27T09:30:00.000Z","supplierNotifiedVia":"app_list","supplierNotifiedBatchSize":2}'::jsonb and status='rejected' from public.legacy_sends where legacy_id=990203),'na pustym JSON-ie tylko 3 pola; status nietknięty');
select pg_temp.ok((select public.mark_legacy_sends_supplier_notified(array[990201]::bigint[],'email',1,'2026-09-27T10:00:00Z')=0),'powtórka: 0 wierszy (już powiadomione)');
select pg_temp.ok((select data->>'supplierNotifiedAt'='2026-09-27T09:30:00.000Z' and data->>'supplierNotifiedVia'='app_list' from public.legacy_sends where legacy_id=990201),'powtórka nie zmienia pierwotnego znacznika');
select pg_temp.ok((select public.mark_legacy_sends_supplier_notified(array[]::bigint[],'email',1)=0 and public.mark_legacy_sends_supplier_notified(null,'email',1)=0),'pusta lista = 0');
-- rozliczenie PO powiadomieniu nadal działa (kolejność bez znaczenia): nowa wysyłka, najpierw powiadomienie, potem odczyt
insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values (gen_random_uuid(),990204,'legacy-co-b',1,'sent','{}');
select public.mark_legacy_sends_supplier_notified(array[990204]::bigint[],'app_list',1);
update public.packages set qty_total = qty_total + 1 where company_id=pg_temp.id('co2') and source='grant';
select pg_temp.ok((select (r->'billing'->>'charged')::boolean and (r->>'supplier_notified_before')::boolean and r->'data'->>'supplierNotifiedAt' is not null from (select public.mark_legacy_send_seen((select id from public.legacy_sends where legacy_id=990204),pg_temp.id('co2'),'app_list') as r) x),'odczyt po powiadomieniu: rozliczone, supplier_notified_before=true, znacznik powiadomienia zachowany');

-- ── dostawca: widzi własne przyznanie bez notatki, zamyka powiadomienie tylko u siebie ──
select pg_temp.login('supplier'); set local role authenticated;
select pg_temp.ok((select count(*)=2 from public.packages where source='grant' and grant_seen_at is null),'dostawca A widzi swoje 2 nieprzeczytane przyznania');
select pg_temp.ok((select count(*)=0 from public.packages where company_id=pg_temp.id('co2')),'dostawca A nie widzi pakietów firmy B');
select pg_temp.ok((select count(*)=0 from public.package_grant_batches),'dostawca nie widzi historii partii (ani notatek)');
select pg_temp.ok((select count(*)=0 from public.wallet_tx where meta::text like '%notatka wewnętrzna%') and (select count(*)=0 from public.packages where row_to_json(packages)::text like '%notatka wewnętrzna%'),'notatka wewnętrzna nie wycieka przez packages ani wallet_tx');
select pg_temp.ok((select public.mark_credit_grant_seen((select id from public.packages where company_id=pg_temp.id('co') and source='grant' and grant_batch_id=(select (r->>'batch_id')::uuid from res)))),'dostawca A zamyka powiadomienie');
select pg_temp.ok((select public.mark_credit_grant_seen((select id from public.packages where company_id=pg_temp.id('co2') and source='grant')) = false),'dostawca A nie zamyka powiadomienia firmy B');
select pg_temp.ok((select public.mark_credit_grant_seen((select id from public.packages where payment_ref='legacy-zero-price-row')) = false),'zakupu nie da się oznaczyć jako przyznanie');
reset role;
select pg_temp.ok((select grant_seen_at is not null from public.packages where company_id=pg_temp.id('co') and source='grant' and grant_batch_id=(select (r->>'batch_id')::uuid from res)),'grant_seen_at ustawione dla firmy A');
select pg_temp.ok((select grant_seen_at is null from public.packages where company_id=pg_temp.id('co2') and source='grant'),'grant_seen_at firmy B nietknięte');

-- ── admin widzi historię z notatką, anon nic ──
select pg_temp.login('admin'); set local role authenticated;
select pg_temp.ok((select count(*)=2 from public.package_grant_batches) and (select note='notatka wewnętrzna' from public.package_grant_batches where idempotency_key='batch-A-00000001'),'admin widzi 2 partie i notatkę');
select pg_temp.denied($q$delete from public.package_grant_batches$q$);
select pg_temp.denied($q$update public.package_grant_batches set qty=99$q$);
reset role;
select pg_temp.logout();
set local role anon;
select pg_temp.denied('select * from public.package_grant_batches');
select pg_temp.fails($q$select public.admin_grant_free_credits(array[(select v from ids where k='co')],1,'gift','anon-try-00000001')$q$,'42501','anon nie przyznaje');
select pg_temp.denied($q$select public.charge_legacy_send_first_seen((select v from ids where k='send1'),(select v from ids where k='co'))$q$);
reset role;

select 'PASS: free credit grants v4 — źródło/powód na pakiecie, notatka tylko w partii, dzień biznesowy, powtórka klucza zgodna/niezgodna, RLS, pule, atomowe rozliczenie, mark_legacy_send_seen scala tylko pola odczytu, znacznik powiadomienia scala tylko 3 pola' result;
rollback;
