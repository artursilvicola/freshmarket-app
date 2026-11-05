import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

describe.skipIf(!process.env.PGLITE_PATH)("campaign names on PostgreSQL", () => {
  it("preserves old names and assigns unique numbers, Warsaw date and custom labels", async () => {
    const { PGlite } = await import(/* @vite-ignore */ pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role;
        create table marketing_campaigns(name text not null, template_key text not null,
          constraint marketing_campaigns_template_key_check check(template_key in ('no_valid_credits')));
        insert into marketing_campaigns values ('Existing name', 'no_valid_credits');`);
      await db.exec(readFileSync(new URL("../supabase/migrations/20261105170000_marketing_campaign_names.sql", import.meta.url), "utf8"));
      expect((await db.query("select name from marketing_campaigns")).rows[0].name).toBe("Existing name");
      const { rows } = await db.query(`insert into marketing_campaigns(name,template_key)
        values ('ignored','no_valid_credits'), ('  My selection  ','selected_companies')
        returning name, campaign_number`);
      const date = (await db.query("select to_char(current_timestamp at time zone 'Europe/Warsaw','DD.MM.YYYY') as date")).rows[0].date;
      expect(rows[0].name).toBe(`Brak ważnych kredytów | #${rows[0].campaign_number} | ${date}`);
      expect(rows[1].name).toBe(`My selection | #${rows[1].campaign_number} | ${date}`);
      expect(rows[0].campaign_number).not.toBe(rows[1].campaign_number);
      await expect(db.query("insert into marketing_campaigns values (' ', 'selected_companies')")).rejects.toThrow("Invalid campaign name");
      await db.exec("grant insert, select on marketing_campaigns to service_role; set role service_role;");
      expect((await db.query("insert into marketing_campaigns(name,template_key) values ('','credits_expiring') returning name")).rows[0].name).toContain("Kredyty niedługo wygasają | #");
    } finally { await db.close(); }
  }, 30000);
});
