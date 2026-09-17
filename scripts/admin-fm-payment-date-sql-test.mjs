import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import pg from "pg";

// Dedicated temporary database on local PostgreSQL; no production URL accepted.
const options={host:"127.0.0.1",port:54329,user:"postgres",password:"pw"};
const name=`fm_payment_editor_test_${Date.now()}`;
const root=new pg.Client({...options,database:"postgres"});
let admin; let created=false; let passed=0;
const sessions=[];
const ok=label=>{passed++;console.log(`PASS ${label}`);};
const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
const migration="supabase/migrations/20260917124901_admin_fm_payment_date.sql";
try {
  await root.connect(); await root.query(`create database ${name}`); created=true;
  admin=new pg.Client({...options,database:name}); await admin.connect();
  await admin.query(read("supabase/tests/000_supabase_shim.sql"));
  for(const file of readdirSync(new URL("../supabase/migrations",import.meta.url)).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort()) {
    await admin.query(read(`supabase/migrations/${file}`));
  }
  await admin.query(`begin;${read("supabase/migrations/20260917120519_fm_payment_date_guard.sql")}commit;`);
  await admin.query(read(migration));
  await admin.query(read(migration));
  ok("full migration chain and payment editor reapply");
  const ids=(await admin.query("select gen_random_uuid() as co,gen_random_uuid() as admin,gen_random_uuid() as supplier,gen_random_uuid() as buyer")).rows[0];
  for(const role of ["admin","supplier","buyer"]) {
    await admin.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')",[ids[role],`${role}@local.invalid`]);
    await admin.query("update profiles set role=$2,active=true where id=$1",[ids[role],role]);
  }
  await admin.query("insert into companies(id,name,fm_b2b_enabled,account_status,fm_b2b_packages,fm_b2b_tier,fm_payment_date) values($1,'LOCAL PAYMENT TEST',true,'active',2,'premium','2026-09-17')",[ids.co]);
  await admin.query("update profiles set company_id=$1 where id=$2",[ids.co,ids.supplier]);
  const session=async uid=>{
    const c=new pg.Client({...options,database:name});await c.connect();sessions.push(c);
    await c.query("begin");
    if(uid) {
      await c.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({sub:uid,role:"authenticated"}),uid]);
      await c.query("set local role authenticated");
    } else await c.query("set local role anon");
    return c;
  };
  const rpc=(c,date,expected)=>c.query("select admin_set_fm_payment_date($1,$2::date,$3::date) as result",[ids.co,date,expected]);
  const snapshot=async()=> (await admin.query(`select jsonb_build_object('company',(select to_jsonb(c) from companies c where id=$1),
    'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]') from audit_log a where action='fm_inputs_payment_date_changed')) as value`,[ids.co])).rows[0].value;
  const before=await snapshot();
  const a=await session(ids.admin);
  const saved=(await rpc(a,"2026-05-19","2026-09-17")).rows[0].result;
  assert.equal(saved.fm_payment_date,"2026-05-19"); await a.query("commit");
  const after=await snapshot(); assert.equal(after.audit.length,1);
  assert.equal(after.audit[0].user_id,ids.admin);
  assert.deepEqual(after.audit[0].meta,{before:"2026-09-17",after:"2026-05-19"});
  for(const key of Object.keys(before.company).filter(k=>!["fm_payment_date","updated_at"].includes(k))) assert.deepEqual(after.company[key],before.company[key]);
  ok("admin date-only write + atomic trusted before/after actor audit");
  const noOp=await session(ids.admin);await rpc(noOp,"2026-05-19","2026-05-19");await noOp.query("commit");
  assert.deepEqual(await snapshot(),after);ok("unchanged date creates no audit and no update");
  for(const [label,uid,date,expected,code] of [
    ["supplier denied",ids.supplier,"2026-05-01","2026-05-19","42501"],
    ["buyer denied",ids.buyer,"2026-05-01","2026-05-19","42501"],
    ["anonymous denied",null,"2026-05-01","2026-05-19","42501"],
    ["stale expected date rejected",ids.admin,"2026-05-01","2026-09-17","40001"],
    ["null rejected",ids.admin,null,"2026-05-19","22023"],
    ["infinity rejected",ids.admin,"infinity","2026-05-19","22023"],
    ["invalid calendar date rejected",ids.admin,"2026-02-30","2026-05-19","22008"],
  ]) {
    const c=await session(uid);await assert.rejects(rpc(c,date,expected),e=>e.code===code);
    await c.query("rollback");assert.deepEqual(await snapshot(),after);ok(label);
  }
  const supplier=await session(ids.supplier);
  await supplier.query("update companies set fm_payment_date='1900-01-01' where id=$1",[ids.co]);
  const own=(await supplier.query("select fm_payment_date::text as date from companies where id=$1",[ids.co])).rows[0];
  assert.equal(own.date,"2026-05-19");
  await supplier.query("rollback");assert.deepEqual(await snapshot(),after);ok("supplier direct update cannot backdate or add date audit");
  for(const [label,setup,restore] of [
    ["disabled B2B rejected","update companies set fm_b2b_enabled=false","update companies set fm_b2b_enabled=true"],
    ["inactive admin rejected",`update profiles set active=false where id='${ids.admin}'`,`update profiles set active=true where id='${ids.admin}'`],
  ]) {
    await admin.query(setup);const baseline=await snapshot();const c=await session(ids.admin);
    await assert.rejects(rpc(c,"2026-05-01","2026-05-19"));await c.query("rollback");
    assert.deepEqual(await snapshot(),baseline);await admin.query(restore);ok(label);
  }
  const beforeAuditFailure=await snapshot();
  await admin.query("alter table audit_log add constraint test_audit_failure check(action<>'fm_inputs_payment_date_changed') not valid");
  const failedAudit=await session(ids.admin);await assert.rejects(rpc(failedAudit,"2026-05-01","2026-05-19"),e=>e.code==="23514");
  await failedAudit.query("rollback");assert.deepEqual(await snapshot(),beforeAuditFailure);
  await admin.query("alter table audit_log drop constraint test_audit_failure");ok("audit failure rolls back the date update");
  const c1=await session(ids.admin),c2=await session(ids.admin);
  await rpc(c1,"2026-06-01","2026-05-19");
  let finished=false;
  const pending=rpc(c2,"2026-07-01","2026-05-19").then(()=>({success:true}),error=>({error})).finally(()=>{finished=true;});
  await new Promise(r=>setTimeout(r,150));assert.equal(finished,false);
  await c1.query("commit");const outcome=await pending;assert.equal(outcome.error?.code,"40001");assert.equal(outcome.error.detail,"2026-06-01");
  await c2.query("rollback");assert.equal((await snapshot()).audit.length,2);ok("two admins serialize; stale second write cannot overwrite the first");
  console.log(JSON.stringify({passed,scope:"local isolated database only"}));
} finally {
  for(const c of sessions) {await c.query("rollback").catch(()=>{});await c.end();}
  if(admin) await admin.end();
  if(created) await root.query(`drop database ${name}`);
  await root.end();
}
