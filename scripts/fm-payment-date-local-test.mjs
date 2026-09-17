import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Isolated local database only; never load production credentials.
const require = createRequire('C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/.codex-tmp/b2b-audit-20260916/package.json');
const { Client, types } = require('pg');
types.setTypeParser(1082, value => value);
const backup = process.argv[2];
if (!backup) throw new Error('Pass the local reviewed input directory');
const input = JSON.parse(readFileSync(`${backup}/import-source.json`, 'utf8'));
const sql = readFileSync(`${backup}/import-approved-dates.sql`, 'utf8');
const migration = readFileSync(fileURLToPath(new URL('../supabase/migrations/20260917120519_fm_payment_date_guard.sql', import.meta.url)), 'utf8');
const db = `codex_payment_test_${Date.now()}`;
const options = { host: '127.0.0.1', port: 54329, user: 'postgres', password: 'pw', connectionTimeoutMillis: 3000 };
const root = new Client({ ...options, database: 'postgres' });
let c;
let created = false;
let passed = 0;
const pass = s => { passed++; console.log(`PASS ${s}`); };
try {
  await root.connect();
  await root.query(`CREATE DATABASE ${db}`);
  created = true;
  c = new Client({ ...options, database: db });
  await c.connect();
  await c.query(`
    create table public.companies(id uuid primary key,name text,country text,fm_b2b_packages int default 1,
      fm_b2b_tier text default 'business',fm_b2b_enabled boolean default false,account_status text default 'active',
      updated_at timestamptz default now(),description text default 'preserve');
    create table public.audit_log(id bigint generated always as identity primary key,user_id uuid,action text,entity text,entity_id text,meta jsonb);
    create table public.choices(company_id uuid,retailer_id integer,priority integer);
    create function public.is_admin() returns boolean language sql stable as $$
      select coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role'='admin'
    $$;
    create function public.fm_is_privileged_session() returns boolean language plpgsql stable as $$
    begin
      if current_user not in ('authenticated','anon') then return true; end if;
      return coalesce(public.is_admin(),false);
    end $$;
    grant usage on schema public to authenticated;
    grant select,insert,update on public.companies to authenticated;
  `);
  const seed = async () => {
    await c.query('truncate public.companies, public.choices, public.audit_log restart identity');
    const byId = new Map(input.rows.map(r => [r.company_id,r]));
    for (const id of input.active_company_ids) {
      const r = byId.get(id) || {name:'Hellenic Land - Saitis ABEE',country:'GR',packages:1};
      const currentName = id === '331dd4bd-1a0f-4eb4-ba87-ac8b3c7e49c9' ? 'Fresh Roots' : r.name;
      await c.query(`insert into companies(id,name,country,fm_b2b_packages,fm_b2b_enabled) values($1,$2,$3,$4,true)`,[id,currentName,r.country,r.packages]);
      await c.query('insert into choices values($1,101,1000)',[id]);
    }
  };
  await seed();
  await c.query(`begin; ${migration} commit;`);
  assert.equal((await c.query("select count(*)::int n from companies where fm_payment_date=date '2026-09-17'")).rows[0].n,106);
  pass('column default for existing and future companies');
  const state = async () => (await c.query(`select jsonb_build_object(
    'companies',(select jsonb_agg(to_jsonb(c) order by id) from companies c),
    'choices',(select jsonb_agg(to_jsonb(c) order by company_id) from choices c),
    'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from audit_log a)) as value`)).rows[0].value;
  const before = await state();
  await c.query(sql);
  const after = await state();
  assert.equal(after.audit.length,106);
  assert.deepEqual(after.choices,before.choices);
  for (const r of after.companies) {
    const date = input.rows.find(s=>s.company_id===r.id)?.payment_date || '2026-09-17';
    assert.equal(r.fm_payment_date,date);
    const old = before.companies.find(s=>s.id===r.id);
    for (const key of Object.keys(r).filter(k=>!['fm_payment_date','updated_at'].includes(k))) assert.deepEqual(r[key],old[key]);
    const a=after.audit.find(a=>a.entity_id===r.id);
    assert.equal(a.meta.after,date);
    assert.equal(a.meta.before,'2026-09-17');
  }
  pass('105 source dates + 1 fallback, audit, no unrelated data changes');
  assert.equal(after.companies.find(r => r.id === '331dd4bd-1a0f-4eb4-ba87-ac8b3c7e49c9').name, 'Fresh Roots');
  const nameAudit = after.audit.find(r => r.entity_id === '331dd4bd-1a0f-4eb4-ba87-ac8b3c7e49c9');
  assert.equal(nameAudit.meta.source_company_name, 'Fresh roots');
  assert.equal(nameAudit.meta.current_company_name, 'Fresh Roots');
  pass('reviewed capitalization change retained, original source name retained in audit');
  await c.query(`begin; ${migration} commit;`);
  assert.deepEqual(await state(),after);
  pass('migration reapply preserves imported dates');
  try { await c.query(sql); assert.fail('repeat import succeeded'); }
  catch (e) { await c.query('rollback'); assert.match(e.message,/already applied/); }
  assert.deepEqual(await state(),after);
  pass('repeat import fails without changes');
  const id = input.rows[0].company_id;
  await c.query('begin; set local role authenticated');
  await c.query("select set_config('request.jwt.claims','{\"role\":\"supplier\"}',true)");
  await c.query("update companies set fm_payment_date='1900-01-01',description='ordinary edit' where id=$1",[id]);
  let row=(await c.query('select * from companies where id=$1',[id])).rows[0];
  assert.equal(row.fm_payment_date,input.rows[0].payment_date);
  assert.equal(row.description,'ordinary edit');
  await c.query("update companies set fm_payment_date=null where id=$1",[id]);
  row=(await c.query('select * from companies where id=$1',[id])).rows[0];
  assert.equal(row.fm_payment_date,input.rows[0].payment_date);
  await c.query("insert into companies(id,name,fm_payment_date) values('00000000-0000-0000-0000-000000000099','LOCAL TEST','1900-01-01')");
  assert.equal((await c.query("select fm_payment_date from companies where name='LOCAL TEST'")).rows[0].fm_payment_date,'2026-09-17');
  await c.query('rollback');
  pass('supplier cannot set/clear/backdate date; normal profile edits still work');
  await c.query('begin; set local role authenticated');
  await c.query("select set_config('request.jwt.claims','{\"role\":\"admin\"}',true)");
  await c.query("update companies set fm_payment_date='2026-05-01' where id=$1",[id]);
  assert.equal((await c.query('select fm_payment_date from companies where id=$1',[id])).rows[0].fm_payment_date,'2026-05-01');
  await c.query('rollback');
  pass('authorized admin can set date');
  for (const [label,mutation] of [
    ['unreviewed company name', "update companies set name='Unreviewed rename' where id=$1"],
    ['changed packages',"update companies set fm_b2b_packages=5 where id=$1"],
    ['changed existing date',"update companies set fm_payment_date='2026-01-01' where id=$1"],
    ['changed participant set',"update companies set fm_b2b_enabled=false where id=$1"],
  ]) {
    await seed();
    await c.query(mutation,[id]);
    const beforeFailure=await state();
    let error;
    try { await c.query(sql); } catch(e) {error=e;await c.query('rollback');}
    assert.ok(error,label);
    assert.deepEqual(await state(),beforeFailure);
    pass(`atomic STOP: ${label}`);
  }
  console.log(JSON.stringify({passed,scope:'isolated local PostgreSQL; no production access'}));
} finally {
  if(c) await c.end();
  if(created) await root.query(`drop database ${db}`);
  await root.end();
}
