// [fix/admin-credits-display, review Codexa 10.11] Regresja: dwa pakiety z różnymi terminami ważności.
// Prawdziwy widok company_capacity (PGlite, pełny łańcuch migracji): qty_total sumuje ważne pakiety,
// pkg_expiry = NAJPÓŹNIEJSZY termin, a część kredytów wygasa wcześniej (paid_expiry = najbliższy).
// Nagłówek karty pokazuje tylko liczbę kredytów — bez daty sugerującej ważność całego salda.
//   PGLITE_PATH=…/pglite/dist/index.js npx vitest run tests/admin-credit-capacity.integrated.test.js
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { adminCreditUsage, adminCreditTotalLabel } from "../src/lib/admin-credit-usage.js";

const PGLITE_PATH = process.env.PGLITE_PATH;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?pgcrypto"?\s*;/gi, "")
  .replace(/create extension if not exists "?pg_trgm"?\s*;/gi, "")
  .replace(/create extension if not exists "?citext"?\s*;/gi, "");
const pl = JSON.parse(read("src/i18n/pl/legacy.json"));
const tPl = (key, opts = {}) => key.split(".").reduce((o, k) => o?.[k], pl).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ""));
const CO = "88888888-8888-4888-8888-888888888888";

let db;
describe.skipIf(!PGLITE_PATH)("company_capacity: dwa pakiety z różnymi terminami ważności", () => {
  beforeAll(async () => {
    const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
    db = new PGlite();
    await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
    for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) await db.exec(patch(read("supabase/migrations/" + f)));
    await db.exec(`
      insert into public.companies (id, name, legacy_supplier_id, country) values ('${CO}', 'Dwa terminy', 'sup-dwa', 'PL');
      insert into public.packages (company_id, plan, qty_total, qty_used, expires_at, purchased_at, source) values
        ('${CO}', 'std_5', 5, 1, public.business_today() + 50, now(), 'purchase'),
        ('${CO}', 'std_1', 2, 0, public.business_today() + 10, now(), 'purchase'),
        ('${CO}', 'std_1', 4, 0, public.business_today() - 1,  now(), 'purchase');   -- wygasły: nie liczy się
    `);
  }, 180_000);
  afterAll(async () => { if (db) await db.close(); });

  it("suma tylko ważnych pakietów, najpóźniejszy termin ≠ termin wszystkich kredytów; nagłówek bez daty", async () => {
    const c = (await db.query(`select qty_total, qty_used, qty_remaining, pkg_expiry::text as pkg_expiry, paid_expiry::text as paid_expiry,
                                      (public.business_today() + 50)::text as late, (public.business_today() + 10)::text as early
                                 from public.company_capacity where id = $1`, [CO])).rows[0];
    expect(c).toMatchObject({ qty_total: 7, qty_used: 1, qty_remaining: 6 });
    expect(c.pkg_expiry).toBe(c.late);          // widok podaje najpóźniejszy termin…
    expect(c.paid_expiry).toBe(c.early);        // …a część kredytów wygasa wcześniej
    const lim = { max: c.qty_total, used: c.qty_used, pkgExpiry: c.pkg_expiry };
    const label = adminCreditTotalLabel(tPl, lim);
    expect(label).toBe("Kredyty: 7");
    expect(label).not.toContain(c.late);
    expect(label).not.toContain(c.early);
    expect(adminCreditUsage(lim)).toEqual({ used: 1, max: 7, remaining: 6, pct: 14 });
  });
});
