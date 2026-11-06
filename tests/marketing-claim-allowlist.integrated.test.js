// [feat/marketing-activation] Regresja review Codexa 10a0c6a P2 na PRAWDZIWYM Postgresie (PGlite,
// pełny łańcuch migracji repo): filtr MARKETING_SEND_ALLOWLIST działa w `marketing_claim_messages`
// PRZED zajęciem wiersza — wiersz spoza listy nie dostaje attempts ani first_claim_at (okno 23 h nie
// rusza), po zdjęciu listy idzie normalnie; historia wierszy już zajętych nie jest resetowana.
//   PGLITE_PATH=<...>/@electric-sql/pglite/dist/index.js npx vitest run tests/marketing-claim-allowlist.integrated.test.js
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const patchSql = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?pgcrypto"?\s*;/gi, "")
  .replace(/create extension if not exists "?pg_trgm"?\s*;/gi, "")
  .replace(/create extension if not exists "?citext"?\s*;/gi, "");

const ADMIN = "11111111-1111-4111-8111-111111111111", COMPANY = "44444444-4444-4444-8444-444444444444";
const OWNERS = ["55555555-5555-4555-8555-555555555551", "55555555-5555-4555-8555-555555555552", "55555555-5555-4555-8555-555555555553", "55555555-5555-4555-8555-555555555554"];

describe.skipIf(!process.env.PGLITE_PATH)("marketing_claim_messages + p_allowed_emails (PostgreSQL)", () => {
  it("[P2] wiersze spoza listy nie są zajmowane (pending, attempts 0, first_claim_at null); po zdjęciu listy idą normalnie; {} = nikt; stara historia nietknięta", async () => {
    const { PGlite } = await import(/* @vite-ignore */ pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    try {
      await db.exec(patchSql(read("supabase/tests/000_supabase_shim.sql")));
      const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) await db.exec(patchSql(read("supabase/migrations/" + f)));
      expect(files).toContain("20261106100000_marketing_claim_allowlist.sql");
      // tylko JEDNA sygnatura funkcji (stara 4-argumentowa usunięta — inaczej wywołanie byłoby niejednoznaczne)
      const sigs = (await db.query("select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='marketing_claim_messages'")).rows;
      expect(sigs.map((r) => r.a)).toEqual(["p_campaign_id uuid, p_limit integer, p_lease_seconds integer, p_window_seconds integer, p_allowed_emails text[]"]);

      await db.exec(`
        insert into auth.users (id, email) values ('${ADMIN}','admin@example.invalid'), ${OWNERS.map((o, i) => `('${o}','o${i}@example.invalid')`).join(",")} on conflict do nothing;
        insert into public.companies (id, name, legacy_supplier_id, country) values ('${COMPANY}','Dostawca testowy','sup-1','PL') on conflict do nothing;
        insert into public.profiles (id, role, name, email, active, company_id) values
          ('${ADMIN}','admin','Admin','admin@example.invalid',true,null),
          ${OWNERS.map((o, i) => `('${o}','supplier','Operator ${i}','o${i}@example.invalid',true,'${COMPANY}')`).join(",")}
        on conflict (id) do update set role = excluded.role, email = excluded.email, company_id = excluded.company_id, active = true;`);
      const camp = (await db.query(`insert into public.marketing_campaigns (name, template_key, created_by) values ('Lista', 'selected_companies', $1) returning id`, [ADMIN])).rows[0].id;
      const msg = async (profile, email) => (await db.query(
        `insert into public.marketing_messages (campaign_id, company_id, profile_id, to_email, locale, segment, consent_source, subject, html, text_body, payload_hash, idempotency_key)
         values ($1::uuid,$2::uuid,$3::uuid,$4,'pl','manual','regulamin','S','<p>H</p>','T','hash',$5) returning id`,
        [camp, COMPANY, profile, email, `marketing:${camp}:${profile}`])).rows[0].id;
      const allowed = await msg(OWNERS[0], "Spiker.Artur@gmail.com "); // wielkość liter i spacja — SQL normalizuje
      const other = await msg(OWNERS[1], "prawdziwy.dostawca@example.invalid");
      const mixed = await msg(OWNERS[2], "artur.silvicola@gmail.com");
      // wiersz zajęty 25 h temu (dzierżawa wygasła) — historia ma zostać: po zdjęciu listy → needs_review, nie reset
      const stale = await msg(OWNERS[3], "stary@example.invalid");
      await db.query(`update public.marketing_messages set state='claimed', attempts=1, first_claim_at=now()-interval '25 hours', claimed_at=now()-interval '25 hours', lease_until=now()-interval '24 hours' where id=$1`, [stale]);

      const row = async (id) => (await db.query(`select state, attempts, first_claim_at, lease_until from public.marketing_messages where id=$1`, [id])).rows[0];
      const claim = async (list) => (await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800, $2)`, [camp, list])).rows.map((r) => r.id);

      // 1) lista z dwoma adresami próbnymi → zajęte tylko one; reszta NIETKNIĘTA
      expect((await claim(["spiker.artur@gmail.com", "artur.silvicola@gmail.com"])).sort()).toEqual([allowed, mixed].sort());
      expect(await row(allowed)).toMatchObject({ state: "claimed", attempts: 1 }); expect((await row(allowed)).first_claim_at).not.toBeNull();
      expect(await row(other)).toMatchObject({ state: "pending", attempts: 0, first_claim_at: null, lease_until: null });
      expect(await row(stale)).toMatchObject({ state: "claimed", attempts: 1 }); // spoza listy: nie dotknięty, nie needs_review
      // 2) ponowny claim z listą: zajęte mają dzierżawę → nic; wiersz spoza listy nadal nietknięty
      expect(await claim(["spiker.artur@gmail.com", "artur.silvicola@gmail.com"])).toEqual([]);
      expect(await row(other)).toMatchObject({ state: "pending", attempts: 0, first_claim_at: null });
      // 3) „upływ 24 h” podczas ograniczenia: wiersz pominięty nie ma first_claim_at, więc okno nie ruszyło
      await db.query(`update public.marketing_messages set created_at = now() - interval '25 hours' where id=$1`, [other]);
      // 4) pusta lista = nikt (nie „wszyscy”)
      expect(await claim([])).toEqual([]);
      expect(await row(other)).toMatchObject({ state: "pending", attempts: 0 });
      // 5) zdjęcie ograniczenia (null): pominięty wiersz idzie normalnie (pierwsze zajęcie TERAZ, attempts 1),
      //    a stary wiersz z historią sprzed 25 h → needs_review (historia nie zresetowana)
      expect(await claim(null)).toEqual([other]);
      const o = await row(other);
      expect(o).toMatchObject({ state: "claimed", attempts: 1 }); expect(o.first_claim_at).not.toBeNull();
      expect(new Date(o.first_claim_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(await row(stale)).toMatchObject({ state: "needs_review", attempts: 1 });
      // 6) wywołanie 4-argumentowe (stare skrypty) nadal działa = bez ograniczenia
      expect((await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp])).rows).toEqual([]);
      // 7) uprawnienia: authenticated bez EXECUTE na nowej sygnaturze
      await db.exec("set role authenticated");
      await expect(db.query(`select public.marketing_claim_messages($1, 1, 1, 1, null)`, [camp])).rejects.toThrow(/permission denied/i);
      await db.exec("reset role");
    } finally { await db.close(); }
  }, 120000);
});
