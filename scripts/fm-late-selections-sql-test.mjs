import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { spawnSync } from "node:child_process";
const opts={host:"127.0.0.1",port:54329,user:"postgres",password:"pw"};
const name="fm_late_test_"+Date.now();
const root=new pg.Client({...opts,database:"postgres"});
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
let db,created=false;
try{
 await root.connect(); await root.query("create database "+name);created=true;
 db=new pg.Client({...opts,database:name}); await db.connect();
 await db.query(read("supabase/tests/000_supabase_shim.sql"));
 const files=readdirSync(new URL("../supabase/migrations",import.meta.url)).filter(f=>f.endsWith(".sql")).sort();
 for(const f of files)await db.query("begin;"+read("supabase/migrations/"+f)+";commit;");
 await db.query(read("supabase/migrations/20260920171936_fm_late_selections_access.sql"));
 const res=await db.query(read("supabase/tests/fm_late_selections_test.sql"));
 console.log(res.map(r=>r.rows?.[0]?.result).filter(Boolean).join("\n"));
 console.log("PASS all migrations from empty database; new migration twice; ROLLBACK");
 if(process.argv.includes("--advisors")) {
   // Local test database only; the normal test does not need a CLI or network.
   const uri=`postgresql://postgres:pw@127.0.0.1:54329/${name}?sslmode=disable`;
   const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`npx --yes supabase db advisors --db-url '${uri}' --type security --level warn`],{stdio:"inherit"});
   if(result.error)throw result.error;
   if(result.status!==0)throw new Error(`Local advisors exited ${result.status}`);
 }
}catch(e){console.error(e);process.exitCode=1;}
finally{await db?.end();if(created)await root.query("drop database "+name+" with (force)");await root.end();}
