import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const options = { host: "127.0.0.1", port: 54329, user: "postgres", password: "pw" };
const name = `fm_company_desc_audit_${Date.now()}`;
const root = new pg.Client({ ...options, database: "postgres" });
const sessions = [];
let admin;
let created = false;
let passed = 0;
const ok = label => { passed += 1; console.log(`PASS ${label}`); };
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = "supabase/migrations/20260918070934_company_description_audit.sql";

try {
  await root.connect();
  await root.query(`create database ${name}`);
  created = true;
  admin = new pg.Client({ ...options, database: name });
  await admin.connect();
  await admin.query(read("supabase/tests/000_supabase_shim.sql"));
  for (const file of readdirSync(new URL("../supabase/migrations", import.meta.url)).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    await admin.query(read(`supabase/migrations/${file}`));
  }
  await admin.query(`begin;${read("supabase/migrations/20260917120519_fm_payment_date_guard.sql")}commit;`);
  await admin.query(read("supabase/migrations/20260917124901_admin_fm_payment_date.sql"));
  await admin.query(read(migration));
  await admin.query(read(migration));
  ok("full migration chain and description-audit reapply");

  const ids = (await admin.query("select gen_random_uuid() supplier, gen_random_uuid() admin_user, gen_random_uuid() company")).rows[0];
  for (const [id, role] of [[ids.supplier, "supplier"], [ids.admin_user, "admin"]]) {
    await admin.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [id, `${role}@local.invalid`]);
    await admin.query("update profiles set role=$2,active=true where id=$1", [id, role]);
  }
  await admin.query("insert into companies(id,name,description,description_short) values($1,'LOCAL DESCRIPTION TEST','Polski opis','Polski skrót')", [ids.company]);
  await admin.query("update profiles set company_id=$1 where id=$2", [ids.company, ids.supplier]);

  const session = async uid => {
    const client = new pg.Client({ ...options, database: name });
    await client.connect();
    sessions.push(client);
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)", [JSON.stringify({ sub: uid, role: "authenticated" }), uid]);
    await client.query("set local role authenticated");
    return client;
  };
  const snapshot = async () => (await admin.query(`select jsonb_build_object(
    'company',(select jsonb_build_object('description',description,'description_short',description_short,'description_en',description_en,'description_short_en',description_short_en) from companies where id=$1),
    'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]') from audit_log a where action='security_company_description_changed' and entity_id=$2)
  ) value`, [ids.company, ids.company])).rows[0].value;

  const supplier = await session(ids.supplier);
  await supplier.query("update companies set description_en='English description',description_short_en='English short' where id=$1", [ids.company]);
  await supplier.query("commit");
  const afterSupplier = await snapshot();
  assert.equal(afterSupplier.audit.length, 1);
  assert.equal(afterSupplier.audit[0].user_id, ids.supplier);
  assert.equal(afterSupplier.audit[0].meta.before.description, "Polski opis");
  assert.equal(afterSupplier.audit[0].meta.after.description_en, "English description");
  ok("supplier write creates trusted actor and before/after audit");

  const noOp = await session(ids.supplier);
  await noOp.query("update companies set description_en=description_en where id=$1", [ids.company]);
  await noOp.query("commit");
  assert.equal((await snapshot()).audit.length, 1);
  ok("unchanged descriptions create no audit row");

  const forged = await session(ids.supplier);
  await assert.rejects(
    forged.query("insert into audit_log(user_id,action,entity,entity_id) values($1,'security_company_description_changed','company',$2)", [ids.supplier, ids.company]),
    error => error.code === "42501",
  );
  await forged.query("rollback");
  ok("client cannot forge reserved description audit");

  const direct = await session(ids.supplier);
  await assert.rejects(
    direct.query("select audit_company_description_change()"),
    error => error.code === "42501",
  );
  await direct.query("rollback");
  ok("trigger function cannot be called directly by client");

  const baseline = await snapshot();
  await admin.query("alter table audit_log add constraint fail_desc_audit check(action<>'security_company_description_changed') not valid");
  const failed = await session(ids.admin_user);
  await assert.rejects(
    failed.query("update companies set description='Zmiana do wycofania' where id=$1", [ids.company]),
    error => error.code === "23514",
  );
  await failed.query("rollback");
  assert.deepEqual(await snapshot(), baseline);
  await admin.query("alter table audit_log drop constraint fail_desc_audit");
  ok("audit failure rolls back company description update");

  console.log(JSON.stringify({ passed, scope: "local isolated database only" }));
} finally {
  for (const client of sessions) {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  if (admin) await admin.end();
  if (created) await root.query(`drop database ${name}`);
  await root.end();
}
