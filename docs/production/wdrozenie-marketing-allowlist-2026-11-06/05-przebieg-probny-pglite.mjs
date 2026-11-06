import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const root = process.argv[2];
const read = (p) => readFileSync(path.join(root, p), "utf8");
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?(pgcrypto|pg_trgm|citext)"?\s*;/gi, "");
const { PGlite } = await import(pathToFileURL(path.resolve(process.env.PGLITE_PATH)).href);
const db = new PGlite();
await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) await db.exec(patch(read("supabase/migrations/" + f)));
// PGlite nie ma pgcrypto (na prod jest): atrapy tylko do przebiegu próbnego
await db.exec(`create or replace function public.gen_salt(text) returns text language sql as $f$ select 'dryrun-salt' $f$;
  create or replace function public.crypt(text, text) returns text language sql as $f$ select md5($1 || $2) $f$;
  create table if not exists auth.identities (id uuid primary key, user_id uuid, identity_data jsonb, provider text, provider_id text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);`);
const dir = "docs/production/wdrozenie-marketing-allowlist-2026-11-06/";
// kolizja: adres już należy do INNEGO konta → ma być pominięty, nie nadpisany
await db.exec(`insert into auth.users (id, email) values ('99999999-9999-4999-8999-999999999999','artur.silvicola@gmail.com')`);
await db.exec(read(dir + "03-konta-probne.sql"));
const r1 = (await db.query(`select u.id::text as id, u.email, p.role::text as role, p.locale, p.active, c.name, c.account_status, c.preconnect_enabled from auth.users u left join public.profiles p on p.id=u.id left join public.companies c on c.id=p.company_id where lower(u.email) in ('spiker.artur@gmail.com','artur.silvicola@gmail.com') order by u.email`)).rows;
console.log("po 03:", JSON.stringify(r1, null, 1));
const pl = r1.find((r) => r.email === "spiker.artur@gmail.com"); const en = r1.find((r) => r.email === "artur.silvicola@gmail.com");
console.log(pl && pl.role === "supplier" && pl.locale === "pl" && pl.active === true && pl.account_status === "active" && pl.preconnect_enabled === true ? "ok  PL utworzony poprawnie" : "FAIL PL");
// profil z rolą supplier/pl założył trigger handle_new_user przy moim INSERT kolizyjnym; skrypt 03 ma NIE dotknąć konta: brak firmy, brak nazwy
console.log(en && en.id === "99999999-9999-4999-8999-999999999999" && en.name === null && en.account_status === null ? "ok  EN: istniejące konto NIE nadpisane (pominięte, bez firmy)" : "FAIL EN kolizja: " + JSON.stringify(en));
// idempotencja
await db.exec(read(dir + "03-konta-probne.sql"));
console.log((await db.query(`select count(*)::int as n from auth.users where lower(email)='spiker.artur@gmail.com'`)).rows[0].n === 1 ? "ok  idempotentny (1 konto PL)" : "FAIL duplikat");
// silnik: firma nie jest 'test_account' po nazwie
console.log(!/^zzz test/i.test(pl.name) ? "ok  nazwa nie podpada pod wykluczenie ZZZ TEST" : "FAIL nazwa");
// 04
await db.exec(read(dir + "04-po-probie.sql"));
const r2 = (await db.query(`select p.active, c.account_status, c.preconnect_enabled from public.profiles p join public.companies c on c.id=p.company_id where p.id='d0ffee00-0000-4000-8000-000000000001'`)).rows[0];
console.log(r2 && r2.active === false && r2.account_status === "suspended" && r2.preconnect_enabled === false ? "ok  04 zawiesza firmę i operatora" : "FAIL 04 " + JSON.stringify(r2));
// 02 kontrola działa składniowo
const k = (await db.query(read(dir + "02-kontrola-przed-i-po.sql"))).rows; console.log("02 kontrola:", k.map((r) => r.co + " = " + r.n).join(" | "));
await db.close();
