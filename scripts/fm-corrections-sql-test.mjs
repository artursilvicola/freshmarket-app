import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const opts={host:"127.0.0.1",port:54329,user:"postgres",password:"pw"};
const name="fm_corrections_test_"+Date.now();
const root=new pg.Client({...opts,database:"postgres"});
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
let db,created=false;
try{
 await root.connect(); await root.query("create database "+name);created=true;
 db=new pg.Client({...opts,database:name}); await db.connect();
 await db.query(read("supabase/tests/000_supabase_shim.sql"));
 const files=readdirSync(new URL("../supabase/migrations",import.meta.url)).filter(f=>f.endsWith(".sql")).sort();
 for(const f of files)await db.query("begin;"+read("supabase/migrations/"+f)+";commit;");
 await db.query(read("supabase/migrations/20260921105735_fm_correction_add.sql"));
 const res=await db.query(read("supabase/tests/fm_corrections_test.sql"));
 console.log(res.map(r=>r.rows?.[0]?.result).filter(Boolean).join("\n"));
 const added=await db.query(read("supabase/tests/fm_corrections_add_test.sql"));
 console.log(added.map(r=>r.rows?.[0]?.result).filter(Boolean).join("\n"));
 console.log("PASS all migrations from empty database; new migration twice; ROLLBACK");
 // Two real authenticated sessions race on the same revision. Exactly one may commit.
 const admin=randomUUID();
 await db.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,'race@corrections.test','{}','{}')",[admin]);
 await db.query("update public.profiles set role='admin' where id=$1",[admin]);
 await db.query("insert into public.fm_settings(algo_phase) values('matching')");
 const clients=[new pg.Client({...opts,database:name}),new pg.Client({...opts,database:name})];
 try {
   for(const client of clients){await client.connect();await client.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);await client.query("set role authenticated");}
   const base={cq:{one:['a','b',null]},res:{a:{m:['one'],r:{}},b:{m:['one'],r:{}}},cs:{one:{cap:2}}};
   await clients[0].query("select public.fm_commit_correction(0,$1,'initialize',$2::jsonb)",[randomUUID(),JSON.stringify(base)]);
   const change={from:{cid:'one',pos:0,sid:'a'},to:{cid:'one',pos:1,sid:'b'}};
   const race=await Promise.allSettled(clients.map((c,i)=>c.query("select public.fm_commit_correction(1,$1,$2,null,$3::jsonb)",[randomUUID(),i === 0 ? "swap" : "remove",JSON.stringify(i === 0 ? change : {from:change.from})])));
   assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
   assert.match(race.find(r=>r.status==='rejected').reason.message,/fm_correction_conflict/);
   const count=await db.query("select (select count(*)::int from public.fm_correction_history) n,revision,schedule from public.fm_correction_drafts");
   assert.equal(count.rows[0].n,2);assert.equal(count.rows[0].revision,'2');assert.deepEqual(count.rows[0].schedule.cq.one,race[0].status === 'fulfilled' ? ['b','a',null] : [null,'b',null]);
   console.log('PASS simultaneous swap/removal from two admins: one commit, one conflict, no lost update');
   // Two different eligible firms competing for a single empty cell.
   for(const sid of ['freshA','freshB'])await db.query("insert into public.companies(name,legacy_fm_id,account_status,fm_b2b_enabled) values($1,$1,'active',true)",[sid]);
   await db.query("insert into public.retailers(id,name,active,fm26_active,fm26_chain_id) values(990799,'Race retailer',true,true,'one')");
   const additions=await Promise.allSettled(clients.map((c,i)=>c.query("select public.fm_commit_correction(2,$1,'add',null,$2::jsonb)",[randomUUID(),JSON.stringify({to:{cid:'one',pos:5,sid:i?'freshB':'freshA'}})])));
   assert.equal(additions.filter(r=>r.status==='fulfilled').length,1);
   assert.match(additions.find(r=>r.status==='rejected').reason.message,/fm_correction_conflict/);
   const afterAdd=(await db.query('select schedule,revision from public.fm_correction_drafts')).rows[0];
   assert.equal(afterAdd.revision,'3');
   assert.equal(afterAdd.schedule.cq.one[5],additions[0].status==='fulfilled'?'freshA':'freshB');
   assert.deepEqual(afterAdd.schedule.cq.one.slice(0,3),count.rows[0].schedule.cq.one);
   console.log('PASS simultaneous additions: one commit, one conflict, existing meetings unchanged');
 } finally { await Promise.all(clients.map(c=>c.end())); }
 if(process.argv.includes("--advisors")) {
   // Local test database only; the normal test does not need a CLI or network.
   const uri=`postgresql://postgres:pw@127.0.0.1:54329/${name}?sslmode=disable`;
   const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`npx --yes supabase db advisors --db-url '${uri}' --type security --level warn`],{stdio:"inherit"});
   if(result.error)throw result.error;
   if(result.status!==0)throw new Error(`Local advisors exited ${result.status}`);
 }
}catch(e){console.error(e);process.exitCode=1;}
finally{await db?.end();if(created)await root.query("drop database "+name+" with (force)");await root.end();}
