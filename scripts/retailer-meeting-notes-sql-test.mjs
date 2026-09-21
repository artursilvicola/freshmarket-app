import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
const options={host:'127.0.0.1',port:54329,user:'postgres',password:'pw'};
const name='meeting_notes_test_'+Date.now(),root=new pg.Client({...options,database:'postgres'});
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration='20260921150926_separate_fm_meeting_notes.sql';let db,created=false;
try{
 await root.connect();await root.query('create database '+name);created=true;
 db=new pg.Client({...options,database:name});await db.connect();await db.query(read('supabase/tests/000_supabase_shim.sql'));
 for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f<migration).sort())await db.query(read('supabase/migrations/'+f));
 await db.query("insert into public.retailers(id,name,supplier_requirements) values (113,'Polomarket','ONLINE od godz. 10:00'),(135,'Dobronom','ONLINE Spotkania godz. 10:00 - 13:00'),(120,'Spar','ONLINE Spotkania godz. 10:00 - 13:00'),(139,'Twoj','ONLINE Spotkania godz. 10:00 - 13:00'),(106,'Intermarche','Sieć nie importuje z Ekwadoru bananów'),(143,'Umai','Interested in fruit'),(999001,'Other','ONLINE orders only — purchasing requirement') on conflict(id) do update set supplier_requirements=excluded.supplier_requirements");
 const before=(await db.query('select * from public.retailers order by id')).rows;
 await db.query(read('supabase/migrations/'+migration));
 const after=(await db.query('select * from public.retailers order by id')).rows;
 for(const r of after){const old=before.find(b=>b.id===r.id);const {fm_meeting_note,fm_meeting_note_en,...unchanged}=r;
  if([113,135,120,139].includes(r.id)){assert.equal(r.supplier_requirements,null);assert.equal(fm_meeting_note,old.supplier_requirements);assert.ok(fm_meeting_note_en.startsWith('Online meetings'));unchanged.supplier_requirements=old.supplier_requirements;}
  else {assert.equal(fm_meeting_note,null);assert.equal(fm_meeting_note_en,null);}
  assert.deepEqual(unchanged,old);
 }
 await db.query(read('supabase/migrations/'+migration));assert.deepEqual((await db.query('select * from public.retailers order by id')).rows,after);
 await db.query("update public.retailers set fm_meeting_note='Edited by admin',supplier_requirements='New trade requirement' where id=113");
 await db.query(read('supabase/migrations/'+migration));const edited=(await db.query('select * from public.retailers where id=113')).rows[0];assert.equal(edited.fm_meeting_note,'Edited by admin');assert.equal(edited.supplier_requirements,'New trade requirement');
 console.log('PASS all prior migrations from empty DB; exactly four transfers; other requirements/fields unchanged; rerun idempotent; later edits preserved');
}finally{await db?.end();if(created)await root.query('drop database '+name+' with (force)');await root.end();}
