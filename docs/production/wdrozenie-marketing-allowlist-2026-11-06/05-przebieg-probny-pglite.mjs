#!/usr/bin/env node
// Przebieg próbny skryptów 02/03/04 na PRAWDZIWYM Postgresie (PGlite) z pełnym łańcuchem migracji repo — wersja 2
// (review Codexa P2: każda kontrola to ASERCJA; nieudana przerywa skrypt kodem wyjścia 1).
//
//   PGLITE_PATH=<...>/@electric-sql/pglite/dist/index.js node docs/production/wdrozenie-marketing-allowlist-2026-11-06/05-przebieg-probny-pglite.mjs <katalog repo>
//   ... --self-test-fail   → celowo nieudana asercja: oczekiwany kod wyjścia 1 (kontrola mechanizmu)
//
// Scenariusze (każdy konflikt ma przerwać CAŁĄ transakcję skryptu 03 bez zmian):
//   A. zajęty UUID firmy (inna nazwa)            → wyjątek, nic nie utworzone
//   B. zajęty UUID użytkownika (inny adres)      → wyjątek, nic nie utworzone
//   C. adres zajęty przez konto o innym UUID     → wyjątek, nic nie utworzone (nie „pominięcie”)
//   D. czysta baza                               → 2 kompletne konta; ponowienie idempotentne (1 konto / adres)
//   E. 04 na obcych wierszach pod naszym UUID    → wyjątek, nic nie zmienione
//   E2. 04 przy ZAMIENIONYCH firmach operatorów  → wyjątek, nic nie zmienione (review 52fc873 P2)
//   E3. 04 przy company_id = NULL               → wyjątek, nic nie zmienione
//   E4. 04 gdy adres próbny istnieje pod innym UUID → wyjątek, nic nie zmienione
//   F. 04 na potwierdzonych kontach              → końcowy stan KAŻDEGO konta: operator active=false, firma suspended + preconnect off
//   G. 02 kontrola wykonuje się i pokazuje nową sygnaturę claim
// Ograniczenie (Codex): PGlite nie ma pgcrypto ani prawdziwego auth Supabase — atrapy gen_salt/crypt
// i tabela auth.identities tylko do przebiegu; działanie LOGOWANIA sprawdzić osobno po utworzeniu kont na prod.
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : process.cwd();
const selfTestFail = process.argv.includes("--self-test-fail");
const PGLITE_PATH = process.env.PGLITE_PATH;
if (!PGLITE_PATH) { console.error("Brak PGLITE_PATH — nie uruchomiono."); process.exit(2); }

let checks = 0;
function assert(cond, msg) {
  checks += 1;
  if (!cond) throw new Error("ASERCJA NIEUDANA: " + msg);
  console.log("  ok   " + msg);
}
if (selfTestFail) { try { assert(false, "celowo nieudana asercja (self-test)"); } catch (e) { console.error(e.message); process.exit(1); } }

const read = (p) => readFileSync(path.join(root, p), "utf8");
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?(pgcrypto|pg_trgm|citext)"?\s*;/gi, "");
const dir = "docs/production/wdrozenie-marketing-allowlist-2026-11-06/";
const C1 = "c0ffee00-0000-4000-8000-000000000001", C2 = "c0ffee00-0000-4000-8000-000000000002";
const U1 = "d0ffee00-0000-4000-8000-000000000001", U2 = "d0ffee00-0000-4000-8000-000000000002";
const E1 = "spiker.artur@gmail.com", E2 = "artur.silvicola@gmail.com";

const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
const db = new PGlite();
await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) await db.exec(patch(read("supabase/migrations/" + f)));
// PGlite nie ma pgcrypto (na prod jest) ani auth.identities w shimie: atrapy tylko do przebiegu próbnego
await db.exec(`create or replace function public.gen_salt(text) returns text language sql as $f$ select 'dryrun-salt' $f$;
  create or replace function public.crypt(text, text) returns text language sql as $f$ select md5($1 || $2) $f$;
  create table if not exists auth.identities (id uuid primary key, user_id uuid, identity_data jsonb, provider text, provider_id text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);`);

const q = async (sql, params) => (await db.query(sql, params)).rows;
const snapshot = async () => JSON.stringify({
  companies: await q(`select id::text, name, account_status, preconnect_enabled from public.companies where id in ($1,$2) order by id`, [C1, C2]),
  users: await q(`select id::text, email from auth.users where id in ($1,$2) or lower(email) in ($3,$4) order by id`, [U1, U2, E1, E2]),
  profiles: await q(`select id::text, email, role::text, company_id::text, active from public.profiles where id in ($1,$2) or lower(email) in ($3,$4) order by id`, [U1, U2, E1, E2]),
});
/** uruchamia skrypt SQL i oczekuje wyjątku z danym tekstem; po błędzie wycofuje otwartą transakcję; stan ma być NIEZMIENIONY */
async function expectAbort(file, rx, label) {
  const before = await snapshot();
  let err = null;
  try { await db.exec(read(dir + file)); } catch (e) { err = e; }
  try { await db.exec("rollback"); } catch { /* brak otwartej transakcji */ }
  assert(err && rx.test(err.message), `${label}: przerwane wyjątkiem (${err ? err.message.slice(0, 90) : "BRAK WYJĄTKU"})`);
  assert((await snapshot()) === before, `${label}: stan bazy bez zmian`);
}

// ── A. zajęty UUID firmy ──────────────────────────────────────────────────────
console.log("A. zajęty UUID firmy (inna nazwa)");
await db.exec(`insert into public.companies (id, name, country) values ('${C1}', 'Prawdziwa Firma Sp. z o.o.', 'PL')`);
await expectAbort("03-konta-probne.sql", /UUID firmy .* zajęty/, "A");
assert((await q(`select name from public.companies where id=$1`, [C1]))[0].name === "Prawdziwa Firma Sp. z o.o.", "A: obca firma nietknięta");
await db.exec(`delete from public.companies where id = '${C1}'`);

// ── B. zajęty UUID użytkownika ────────────────────────────────────────────────
console.log("B. zajęty UUID użytkownika (inny adres)");
await db.exec(`insert into auth.users (id, email) values ('${U2}', 'ktos.inny@example.invalid')`);
await expectAbort("03-konta-probne.sql", /UUID użytkownika .* zajęty/, "B");
assert((await q(`select email from auth.users where id=$1`, [U2]))[0].email === "ktos.inny@example.invalid", "B: obce konto nietknięte");
await db.exec(`delete from public.profiles where id = '${U2}'; delete from auth.users where id = '${U2}'`);

// ── C. adres zajęty przez inne konto ──────────────────────────────────────────
console.log("C. adres próbny należy do konta o innym UUID");
await db.exec(`insert into auth.users (id, email) values ('99999999-9999-4999-8999-999999999999', '${E2}')`);
await expectAbort("03-konta-probne.sql", /adres .* należy już do innego konta/, "C");
assert((await q(`select count(*)::int as n from auth.users where id in ($1,$2)`, [U1, U2]))[0].n === 0, "C: żadne konto próbne nie powstało");
await db.exec(`delete from public.profiles where id = '99999999-9999-4999-8999-999999999999'; delete from auth.users where id = '99999999-9999-4999-8999-999999999999'`);

// ── D. czysta baza → 2 konta; ponowienie idempotentne ─────────────────────────
console.log("D. czysta baza");
await db.exec(read(dir + "03-konta-probne.sql"));
const rows = await q(`select u.id::text as id, u.email, p.role::text as role, p.locale, p.active, c.id::text as cid, c.name, c.account_status, c.preconnect_enabled
  from auth.users u join public.profiles p on p.id=u.id join public.companies c on c.id=p.company_id where u.id in ($1,$2) order by u.email`, [U1, U2]);
assert(rows.length === 2, "D: 2 kompletne konta (user + profil + firma)");
const en = rows.find((r) => r.email === E2), pl = rows.find((r) => r.email === E1);
assert(pl && pl.id === U1 && pl.role === "supplier" && pl.locale === "pl" && pl.active === true && pl.cid === C1 && pl.account_status === "active" && pl.preconnect_enabled === true, "D: PL = supplier/pl/active, firma C1 active+preconnect");
assert(en && en.id === U2 && en.role === "supplier" && en.locale === "en" && en.active === true && en.cid === C2, "D: EN = supplier/en/active, firma C2");
assert(!/^zzz test/i.test(pl.name) && !/^zzz test/i.test(en.name), "D: nazwy nie podpadają pod wykluczenie „ZZZ TEST”");
assert((await q(`select count(*)::int as n from auth.identities where user_id in ($1,$2)`, [U1, U2]))[0].n === 2, "D: 2 tożsamości email");
await db.exec(read(dir + "03-konta-probne.sql"));
assert((await q(`select count(*)::int as n from auth.users where lower(email) in ($1,$2)`, [E1, E2]))[0].n === 2, "D: ponowienie idempotentne (nadal 2 konta, bez duplikatów)");
assert((await q(`select count(*)::int as n from auth.identities where user_id in ($1,$2)`, [U1, U2]))[0].n === 2, "D: ponowienie nie dubluje tożsamości");

// ── E. 04 na obcych wierszach pod naszym UUID ────────────────────────────────
console.log("E. 04: profil pod naszym UUID przepięty do obcej firmy");
await db.exec(`insert into public.companies (id, name, country) values ('e0000000-0000-4000-8000-00000000000e', 'Obca firma', 'PL');
  update public.profiles set company_id = 'e0000000-0000-4000-8000-00000000000e' where id = '${U1}'`);
await expectAbort("04-po-probie.sql", /KONFLIKT: profil/, "E");
assert((await q(`select account_status from public.companies where id=$1`, [C1]))[0].account_status === "active", "E: firma próbna nadal active (nic nie zawieszono)");
await db.exec(`update public.profiles set company_id = '${C1}' where id = '${U1}'; delete from public.companies where id = 'e0000000-0000-4000-8000-00000000000e'`);

// ── E2. 04 przy ZAMIENIONYCH firmach operatorów (review 52fc873 P2) ──────────
console.log("E2. 04: operatorzy z zamienionymi firmami");
await db.exec(`update public.profiles set company_id = '${C2}' where id = '${U1}'; update public.profiles set company_id = '${C1}' where id = '${U2}'`);
await expectAbort("04-po-probie.sql", /KONFLIKT: profil .* zamienione przypisanie/, "E2");
const swapped = await q(`select p.active, c.account_status from public.profiles p join public.companies c on c.id = p.company_id where p.id in ($1,$2)`, [U1, U2]);
assert(swapped.length === 2 && swapped.every((r) => r.active === true && r.account_status === "active"), "E2: obaj operatorzy aktywni, obie firmy active (nic nie zawieszono)");
await db.exec(`update public.profiles set company_id = '${C1}' where id = '${U1}'; update public.profiles set company_id = '${C2}' where id = '${U2}'`);

// ── E3. 04 przy company_id = NULL ─────────────────────────────────────────────
console.log("E3. 04: profil bez firmy (NULL)");
await db.exec(`update public.profiles set company_id = null where id = '${U2}'`);
await expectAbort("04-po-probie.sql", /KONFLIKT: profil/, "E3");
assert((await q(`select account_status from public.companies where id in ($1,$2) and account_status = 'active'`, [C1, C2])).length === 2, "E3: obie firmy nadal active");
await db.exec(`update public.profiles set company_id = '${C2}' where id = '${U2}'`);

// ── E4. 04 gdy adres próbny istnieje pod innym UUID ──────────────────────────
console.log("E4. 04: adres próbny pod innym UUID");
await db.exec(`insert into auth.users (id, email) values ('88888888-8888-4888-8888-888888888888', 'SPIKER.ARTUR@gmail.com')`);
let e4 = null; try { await db.exec(read(dir + "04-po-probie.sql")); } catch (e) { e4 = e; } try { await db.exec("rollback"); } catch {}
assert(e4 && /KONFLIKT/.test(e4.message), `E4: przerwane wyjątkiem (${e4 ? e4.message.slice(0, 80) : "BRAK"})`);
assert((await q(`select count(*)::int as n from public.profiles where id in ($1,$2) and active`, [U1, U2]))[0].n === 2, "E4: operatorzy nadal aktywni (nic nie zmienione)");
await db.exec(`delete from public.profiles where id = '88888888-8888-4888-8888-888888888888'; delete from auth.users where id = '88888888-8888-4888-8888-888888888888'`);

// ── F. 04 na potwierdzonych kontach — stan KAŻDEGO konta ─────────────────────
console.log("F. 04 na potwierdzonych kontach");
await db.exec(read(dir + "04-po-probie.sql"));
for (const [uid, email, cid, cname] of [[U1, E1, C1, "Próba marketingu PL (Artur)"], [U2, E2, C2, "Marketing trial EN (Artur)"]]) {
  const st = (await q(`select u.email, p.active, p.role::text as role, c.id::text as cid, c.name, c.account_status, c.preconnect_enabled
    from auth.users u join public.profiles p on p.id = u.id join public.companies c on c.id = p.company_id where u.id = $1`, [uid]))[0];
  assert(st && st.email === email && st.role === "supplier" && st.active === false && st.cid === cid && st.name === cname && st.account_status === "suspended" && st.preconnect_enabled === false,
    `F: ${email} → operator active=false, firma „${cname}” suspended + preconnect off`);
}
assert((await q(`select count(*)::int as n from public.companies where account_status = 'suspended'`))[0].n === 2, "F: żadna inna firma nie została zawieszona");
assert((await q(`select count(*)::int as n from public.profiles where active is false`))[0].n === 2, "F: żaden inny profil nie został dezaktywowany");

// ── G. 02 kontrola ───────────────────────────────────────────────────────────
console.log("G. 02 kontrola");
const k = await q(read(dir + "02-kontrola-przed-i-po.sql"));
const get = (co) => (k.find((r) => r.co === co) || {}).n;
assert(get("liczba sygnatur") === "1" && get("sygnatura z p_allowed_emails text[]") === "1", "G: jedna sygnatura claim z p_allowed_emails text[]");
assert(get("service_role ma EXECUTE na nowej sygnaturze") === "1" && get("authenticated bez EXECUTE") === "1", "G: uprawnienia claim (service_role tak, authenticated nie)");

await db.close();
console.log(`\nWSZYSTKO OK — ${checks} asercji`);
