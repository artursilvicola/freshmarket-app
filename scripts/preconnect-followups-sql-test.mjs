// Local PostgreSQL only; disposable database. No network mail services.
import pg from 'pg';
import {readdirSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const cfg={host:'127.0.0.1',port:54329,user:'postgres',password:'pw'};
const name='preconnect_followups_'+Date.now();
const root=new pg.Client({...cfg,database:'postgres'});let db,other,created=false;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
const CO='22222222-2222-4222-8222-222222222222';
const SID='33333333-3333-4333-8333-333333333333';
const delivery=(c,ids=[991001],retailer=1)=>c.query('select public.mark_legacy_sends_retailer_emailed($1,$2,$3,1,$4) result',[ids,retailer,['msg-test'],'2026-09-28T07:00:00Z']);
const seen=c=>c.query('select public.mark_legacy_send_seen($1,$2,$3) result',[SID,CO,'app_detail']);
try {
  await root.connect();await root.query('create database '+name);created=true;
  db=new pg.Client({...cfg,database:name});other=new pg.Client({...cfg,database:name});await db.connect();await other.connect();
  await db.query(read('supabase/tests/000_supabase_shim.sql'));
  for(const f of migrations) await db.query('begin;'+read('supabase/migrations/'+f)+';commit;');
  for(const f of migrations.filter(f=>/retailer_email_delivery_merge|restrict_service_credit_functions/.test(f))) await db.query(read('supabase/migrations/'+f));
  const signatures=['mark_legacy_sends_retailer_emailed(bigint[],integer,text[],integer,timestamptz)','purchase_package(uuid,text,numeric,text,text)','allocate_proforma_number(integer)','claim_due_expiry_reminders(integer)','claim_due_inactivity_warnings(integer)'];
  for(const sig of signatures){
    const {rows:[acl]}=await db.query("select has_function_privilege('anon',$1,'execute') a,has_function_privilege('authenticated',$1,'execute') b,has_function_privilege('service_role',$1,'execute') s",['public.'+sig]);
    assert.deepEqual(acl,{a:false,b:false,s:true});
  }
  // Actual invocations, not just catalog checks; no privileged anonymous RPC.
  for(const role of ['anon','authenticated']){
    await other.query('set role '+role);
    for(const sql of ["select public.purchase_package(null,'std_5')","select public.allocate_proforma_number(2026)","select public.claim_due_expiry_reminders(0)","select public.claim_due_inactivity_warnings(0)","select public.mark_legacy_sends_retailer_emailed(array[991001]::bigint[],1,array['m'],1)"])
      await assert.rejects(other.query(sql),e=>e.code==='42501');
    await other.query('reset role');
  }
  await db.query(`insert into public.companies(id,name,account_status,preconnect_enabled,legacy_supplier_id) values('${CO}','Local test','active',true,'test-followup');
    insert into public.packages(company_id,plan,qty_total,qty_used,price_paid,currency,expires_at,source) values('${CO}','std_5',5,0,0,'EUR','2099-12-31','purchase');
    insert into public.legacy_sends(id,legacy_id,supplier_legacy_id,retailer_id,status,data) values('${SID}',991001,'test-followup',1,'sent','{"inEmailBasket":true,"resendBuyerEmails":["private@example.test"],"supplierSeenNotifiedAt":"old"}');`);
  // Deterministic overlap: read/charge holds the row while delivery waits.
  await db.query('begin');await seen(db);
  const pending=delivery(other);await db.query('commit');await pending;
  let {rows:[row]}=await db.query('select status,data from public.legacy_sends where id=$1',[SID]);
  assert.equal(row.status,'read');assert.equal(row.data.billingStatus,'charged');assert.ok(row.data.chargeTxId);assert.ok(row.data.seenAt);assert.equal(row.data.supplierSeenNotifiedAt,'old');assert.equal(row.data.inEmailBasket,false);assert.equal(row.data.resendBuyerEmails,undefined);assert.equal(row.data.mailingSentAt,'2026-09-28');
  const snapshot=JSON.stringify(row);await delivery(db);assert.equal(JSON.stringify((await db.query('select status,data from public.legacy_sends where id=$1',[SID])).rows[0]),snapshot);
  // Atomic batch: if any row is missing / belongs elsewhere nothing is changed.
  await assert.rejects(delivery(db,[991001,999999]),e=>e.code==='22023');await assert.rejects(delivery(db,[991001],2),e=>e.code==='22023');
  assert.equal(JSON.stringify((await db.query('select status,data from public.legacy_sends where id=$1',[SID])).rows[0]),snapshot);
  await db.query("update public.legacy_sends set status='unread_expired',data=data||'{\"daysLeft\":0}'::jsonb where id=$1",[SID]);await delivery(db);
  row=(await db.query('select status,data from public.legacy_sends where id=$1',[SID])).rows[0];assert.equal(row.status,'unread_expired');assert.equal(row.data.daysLeft,0);assert.equal(row.data.billingStatus,'charged');
  // Opposite order: delivery is committed just before read/charge.
  await db.query("update public.legacy_sends set status='sent',data='{}'::jsonb,resend_message_id=null where id=$1",[SID]);
  await db.query('begin');await delivery(db);const reading=seen(other);await db.query('commit');await reading;
  row=(await db.query('select status,data from public.legacy_sends where id=$1',[SID])).rows[0];assert.equal(row.status,'read');assert.equal(row.data.billingStatus,'charged');assert.deepEqual(row.data.resendMessageIds,['msg-test']);
  // Real service-role execution succeeds with RLS, no SECURITY DEFINER needed.
  await other.query('set role service_role');await delivery(other);await other.query('reset role');
  console.log('PASS: migrations twice, ACL invocations, both concurrent orders, read/charge/notification preservation, repeat, atomic rollback, expiry and service role');
} finally {
  await other?.end();await db?.end();if(created)await root.query('drop database '+name+' with (force)');await root.end();
}
