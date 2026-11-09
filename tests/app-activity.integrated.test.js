// [feat/admin-activity] Test ZINTEGROWANY na prawdziwym Postgresie (PGlite) z CAŁYM łańcuchem
// migracji repo: dziennik wejść (record_app_visit), deduplikacja 30 min, podgląd admina,
// uprawnienia (RLS + EXECUTE), raport admin_activity_report z rejestrami maili, retencja
// 12 miesięcy oraz brak wpływu na kredyty, statusy propozycji i odczyty widoczne dostawcy.
//
//   PGLITE_PATH=/sciezka/do/node_modules/@electric-sql/pglite/dist/index.js npx vitest run tests/app-activity.integrated.test.js
// Bez PGLITE_PATH test jest POMIJANY (i widać to w raporcie).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const PGLITE_PATH = process.env.PGLITE_PATH;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?pgcrypto"?\s*;/gi, "")
  .replace(/create extension if not exists "?pg_trgm"?\s*;/gi, "")
  .replace(/create extension if not exists "?citext"?\s*;/gi, "");

const ADMIN = "11111111-1111-4111-8111-111111111111", ANNA = "22222222-2222-4222-8222-222222222222";
const BARTEK = "33333333-3333-4333-8333-333333333333", OWNER = "55555555-5555-4555-8555-555555555555";
const COMPANY = "44444444-4444-4444-8444-444444444444", CAMPAIGN = "66666666-6666-4666-8666-666666666666";
const ALL = [ADMIN, ANNA, BARTEK, OWNER];

let db;
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// Wywołanie jako zalogowany użytkownik (rola authenticated + sub z JWT), jak przez PostgREST.
async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  await db.exec("set role authenticated");
  try { return await db.query(sql, params); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const visit = async (uid) => (await as(uid, "select public.record_app_visit() as r")).rows[0].r;
const report = async (uid, from = "2026-01-01T00:00:00Z", to = "2026-12-31T00:00:00Z") =>
  (await as(uid, "select public.admin_activity_report($1::timestamptz, $2::timestamptz) as r", [from, to])).rows[0].r;
const visits = async (uid) => (await q("select * from public.app_visits where profile_id = $1 order by id", [uid])).rows;

// Odcisk tabel rozliczeń i rejestrów, których moduł NIE może zmieniać.
const GUARDED = ["packages", "wallet_tx", "legacy_sends", "legacy_send_app_reads", "legacy_send_messages",
  "legacy_send_email_events", "marketing_messages", "marketing_email_events", "marketing_campaigns"];
async function fingerprint() {
  const out = {};
  for (const t of GUARDED) out[t] = (await one(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from public.${t} x`)).h;
  out.profiles = (await one(`select md5(string_agg(p.id || ':' || coalesce(p.last_active_at::text,'') || ':' || coalesce(p.updated_at::text,''), '|' order by p.id)) as h from public.profiles p`)).h;
  return out;
}

describe.skipIf(!PGLITE_PATH)("Aktywność — dziennik wejść i raport admina (prawdziwy SQL)", () => {
  beforeAll(async () => {
    const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
    db = new PGlite();
    await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
    const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) await db.exec(patch(read("supabase/migrations/" + f)));
    // idempotencja: ponowne zastosowanie migracji modułu nie psuje stanu
    await db.exec(patch(read("supabase/migrations/20261109120000_app_activity.sql")));
  }, 180_000);
  afterAll(async () => { if (db) await db.close(); });

  beforeEach(async () => {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    await db.exec(`
      truncate public.app_visits, public.app_activity_test_accounts, public.app_activity_settings,
               public.legacy_send_messages, public.legacy_send_email_events, public.legacy_send_app_reads,
               public.marketing_email_events, public.marketing_messages, public.marketing_campaigns,
               public.legacy_sends, public.legacy_offers, public.wallet_tx, public.packages cascade;
      delete from public.profiles where id in (${ALL.map((x) => `'${x}'`).join(",")});
      delete from auth.users where id in (${ALL.map((x) => `'${x}'`).join(",")});
      insert into auth.users (id, email) values ('${ADMIN}','admin@example.invalid'), ('${ANNA}','anna@example.invalid'),
        ('${BARTEK}','bartek@example.invalid'), ('${OWNER}','dostawca@example.invalid');
      delete from public.companies where id = '${COMPANY}';
      delete from public.retailers where id in (1);
      insert into public.retailers (id, name, country) values (1, 'Sieć testowa', 'PL');
      insert into public.companies (id, name, legacy_supplier_id, country) values ('${COMPANY}', 'Sad Przykładowy', 'sup-1', 'PL');
      insert into public.profiles (id, role, name, email, active, retailer_id, company_id) values
        ('${ADMIN}', 'admin', 'Admin', 'admin@example.invalid', true, null, null),
        ('${ANNA}', 'buyer', 'Anna Kupiec', 'anna@example.invalid', true, 1, null),
        ('${BARTEK}', 'buyer', 'Bartek Kupiec', 'bartek@example.invalid', true, 1, null),
        ('${OWNER}', 'supplier', 'Jan Dostawca', 'dostawca@example.invalid', true, null, '${COMPANY}')
      on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email,
        active = excluded.active, retailer_id = excluded.retailer_id, company_id = excluded.company_id;
      insert into public.packages (company_id, plan, qty_total, qty_used, expires_at, purchased_at) values ('${COMPANY}', 'std_5', 5, 1, current_date + 30, now());
      insert into public.legacy_offers (legacy_id, supplier_legacy_id, status, data) values (77, 'sup-1', 'active', '{"title":"Awokado"}');
      insert into public.legacy_sends (legacy_id, supplier_legacy_id, offer_legacy_id, retailer_id, status, data) values
        (101, 'sup-1', 77, 1, 'opened', '{"supplierId":"sup-1","offerId":77,"status":"opened"}');
    `);
  });

  it("kupiec: pierwsze wejście zapisane po stronie serwera, kolejne w ciągu 30 min scalone", async () => {
    const a = await visit(ANNA);
    expect(a).toMatchObject({ recorded: true, new_visit: true });
    const b = await visit(ANNA);
    expect(b).toMatchObject({ recorded: true, new_visit: false, visit_id: a.visit_id });
    const rows = await visits(ANNA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "buyer", retailer_id: 1, company_id: null, hit_count: 2 });
    expect((await one("select collecting_since is not null as ok from public.app_activity_settings")).ok).toBe(true);
  });

  it("kilka kart / równoległe żądania: jedna wizyta", async () => {
    const res = await Promise.all(Array.from({ length: 6 }, () => visit(OWNER)));
    expect(res.every((r) => r.recorded)).toBe(true);
    expect(res.filter((r) => r.new_visit)).toHaveLength(1);
    const rows = await visits(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "supplier", company_id: COMPANY, retailer_id: null, hit_count: 6 });
  });

  it("przerwa dłuższa niż 30 min = nowa wizyta", async () => {
    await visit(ANNA);
    await q("update public.app_visits set started_at = now() - interval '40 minutes', last_seen_at = now() - interval '31 minutes' where profile_id = $1", [ANNA]);
    const r = await visit(ANNA);
    expect(r.new_visit).toBe(true);
    expect(await visits(ANNA)).toHaveLength(2);
  });

  it("admin (także w podglądzie cudzego konta) i brak sesji: nic nie jest zapisywane", async () => {
    expect(await visit(ADMIN)).toEqual({ recorded: false, reason: "not_participant" });
    expect(await visit(null)).toEqual({ recorded: false, reason: "no_session" });
    expect((await one("select count(*)::int as n from public.app_visits")).n).toBe(0);
  });

  it("uprawnienia: kupiec nie zapisze wizyty ręcznie, nie czyta dziennika ani raportu; anon nie wywoła zapisu", async () => {
    await visit(ANNA);
    await expect(as(ANNA, `insert into public.app_visits (profile_id, role) values ('${BARTEK}', 'buyer')`)).rejects.toThrow(/permission denied/);
    await expect(as(ANNA, "update public.app_visits set hit_count = 99")).rejects.toThrow(/permission denied/);
    expect((await as(ANNA, "select count(*)::int as n from public.app_visits")).rows[0].n).toBe(0);           // RLS
    expect((await as(ANNA, "select count(*)::int as n from public.app_activity_test_accounts")).rows[0].n).toBe(0);
    await expect(report(ANNA)).rejects.toThrow(/tylko administrator/);
    await expect(as(OWNER, "select public.admin_set_activity_test_account($1::uuid, true)", [ANNA])).rejects.toThrow(/tylko administrator/);
    await expect(as(ANNA, "select public.purge_app_visits()")).rejects.toThrow(/permission denied/);
    const anonExec = await one("select has_function_privilege('anon', 'public.record_app_visit()', 'execute') as a, has_function_privilege('anon', 'public.admin_activity_report(timestamptz, timestamptz)', 'execute') as b");
    expect(anonExec).toEqual({ a: false, b: false });
    expect((await as(ADMIN, "select count(*)::int as n from public.app_visits")).rows[0].n).toBe(1);          // admin czyta
  });

  it("raport admina: wejścia, maile PreConnect i marketingowe, wyświetlenia propozycji, konta testowe", async () => {
    await visit(ANNA); await visit(OWNER);
    await db.exec(`
      insert into public.legacy_send_messages (resend_message_id, retailer_id, buyer_profile_id, to_email, legacy_ids, sent_at)
      values ('pc-anna', 1, '${ANNA}', 'anna@example.invalid', '{101}', '2026-11-03T09:20:00Z'),
             ('pc-bartek', 1, '${BARTEK}', 'bartek@example.invalid', '{101}', '2026-11-03T09:21:00Z');
      insert into public.legacy_send_email_events (event_id, resend_message_id, event_type, occurred_at, payload, status) values
        ('e1', 'pc-anna', 'email.delivered', '2026-11-03T09:20:05Z', '{}', 'processed'),
        ('e2', 'pc-anna', 'email.opened',    '2026-11-03T10:00:00Z', '{}', 'processed'),
        ('e3', 'pc-anna', 'email.opened',    '2026-11-04T08:00:00Z', '{}', 'processed'),
        ('e4', 'pc-bartek', 'email.opened',  '2026-11-03T11:00:00Z', '{}', 'ignored');
      insert into public.legacy_send_app_reads (legacy_id, buyer_profile_id, reader_role, channel, first_read_at, last_read_at, read_count)
      values (101, '${BARTEK}', 'buyer', 'app_detail', '2026-11-05T12:00:00Z', '2026-11-06T12:00:00Z', 3);
      insert into public.marketing_campaigns (id, name, template_key) values ('${CAMPAIGN}', 'Aktywacja listopad', 'start_with_credits');
      insert into public.marketing_messages (campaign_id, company_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, is_test, state, resend_message_id, sent_at) values
        ('${CAMPAIGN}', '${COMPANY}', '${OWNER}', 'dostawca@example.invalid', 'Temat', '<p>x</p>', 'x', 'h1', 'mk-1', false, 'accepted', 'mk-owner', '2026-11-06T07:50:00Z'),
        ('${CAMPAIGN}', '${COMPANY}', '${OWNER}', 'zespol@example.invalid', 'Temat', '<p>x</p>', 'x', 'h2', 'mk-test-1', true, 'accepted', 'mk-test', '2026-11-06T07:40:00Z');
      insert into public.marketing_email_events (event_id, resend_message_id, event_type, occurred_at, payload, status) values
        ('m1', 'mk-owner', 'email.delivered', '2026-11-06T07:50:03Z', '{}', 'processed'),
        ('m2', 'mk-test', 'email.opened', '2026-11-06T07:45:00Z', '{}', 'processed');
    `);
    // pole sprzed dziennika: 5 kont z identyczną wartością = ustawienie zbiorcze 042
    await q(`update public.profiles set last_active_at = '2026-06-07T09:42:20Z' where id in ('${ANNA}','${OWNER}')`);
    await db.exec(`
      delete from public.profiles where email like 'w_@example.invalid';
      delete from auth.users where email like 'w_@example.invalid';
      insert into auth.users (id, email) select ('77777777-7777-4777-8777-00000000000' || g)::uuid, 'w' || g || '@example.invalid' from generate_series(1, 3) g;
      insert into public.profiles (id, role, name, email, active, last_active_at)
        select ('77777777-7777-4777-8777-00000000000' || g)::uuid, 'supplier', 'wypełniacz ' || g, 'w' || g || '@example.invalid', true, '2026-06-07T09:42:20Z' from generate_series(1, 3) g
      on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email, last_active_at = excluded.last_active_at;`);
    await q(`update public.profiles set last_active_at = '2026-11-02T13:25:00Z' where id = '${BARTEK}'`);

    await as(ADMIN, "select public.admin_set_activity_test_account($1::uuid, true, 'konto do prób')", [BARTEK]);
    const r = await report(ADMIN);
    const acc = Object.fromEntries(r.accounts.map((a) => [a.profile_id, a]));
    expect(acc[ADMIN]).toBeUndefined();                                                   // admin poza raportem
    expect(acc[ANNA]).toMatchObject({ role: "buyer", retailer_name: "Sieć testowa", visits: 1, emails_sent: 1, emails_delivered: 1, emails_opened: 1, proposals_viewed: 0, is_test: false, legacy_last_active_kind: "bulk_set" });
    expect(acc[BARTEK]).toMatchObject({ visits: 0, last_visit_at: null, emails_sent: 1, emails_opened: 0, proposals_viewed: 1, is_test: true, test_note: "konto do prób", legacy_last_active_kind: "app" });
    expect(acc[OWNER]).toMatchObject({ role: "supplier", company_name: "Sad Przykładowy", visits: 1, emails_sent: 1, emails_delivered: 1, emails_opened: 0 });
    expect(r.meta).toMatchObject({ retention_months: 12, dedupe_minutes: 30, events_truncated: false });
    expect(r.meta.collecting_since).toBeTruthy();

    const kinds = (uid) => r.events.filter((e) => e.profile_id === uid).map((e) => `${e.kind}:${e.source ?? ""}`).sort();
    expect(kinds(ANNA)).toEqual(["email_delivered:preconnect", "email_opened:preconnect", "email_opened:preconnect", "email_sent:preconnect", "visit:"]);
    expect(kinds(BARTEK)).toEqual(["app_view:preconnect", "email_sent:preconnect"]);       // zignorowane otwarcie nie liczy się
    expect(kinds(OWNER)).toEqual(["email_delivered:marketing", "email_sent:marketing", "visit:"]);   // wiadomość testowa pominięta
    expect(r.events.some((e) => e.detail?.ip || e.detail?.token)).toBe(false);

    // zdjęcie oznaczenia
    await as(ADMIN, "select public.admin_set_activity_test_account($1::uuid, false)", [BARTEK]);
    expect((await report(ADMIN)).accounts.find((a) => a.profile_id === BARTEK).is_test).toBe(false);
    await expect(as(ADMIN, "select public.admin_set_activity_test_account($1::uuid, true)", [ADMIN])).rejects.toThrow(/nie jest kupcem ani dostawcą/);
  });

  it("okres raportu: walidacja i wejście poza okresem nie jest liczone", async () => {
    await visit(ANNA);
    await expect(report(ADMIN, "2025-01-01T00:00:00Z", "2026-06-01T00:00:00Z")).rejects.toThrow(/366 dni/);
    await expect(report(ADMIN, "2026-06-01T00:00:00Z", "2026-05-01T00:00:00Z")).rejects.toThrow(/przed końcem/);
    const past = await report(ADMIN, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
    expect(past.accounts.find((a) => a.profile_id === ANNA).visits).toBe(0);
    expect(past.events).toEqual([]);
  });

  it("retencja 12 miesięcy: stare wizyty usuwane przy nowym wejściu i przez purge_app_visits", async () => {
    await q(`insert into public.app_visits (profile_id, role, retailer_id, started_at, last_seen_at) values
      ('${BARTEK}', 'buyer', 1, now() - interval '13 months', now() - interval '13 months'),
      ('${BARTEK}', 'buyer', 1, now() - interval '11 months', now() - interval '11 months')`);
    await visit(ANNA);
    expect((await visits(BARTEK)).length).toBe(1);
    await q(`insert into public.app_visits (profile_id, role, retailer_id, started_at, last_seen_at) values
      ('${BARTEK}', 'buyer', 1, now() - interval '400 days', now() - interval '400 days')`);
    await db.exec("set role service_role");
    try { expect((await one("select public.purge_app_visits() as n")).n).toBe(1); }
    finally { await db.exec("reset role"); }
    expect((await visits(BARTEK)).length).toBe(1);
  });

  it("brak wpływu na kredyty, statusy propozycji, odczyty dostawcy i pole ostatniej aktywności", async () => {
    await db.exec(`
      insert into public.legacy_send_messages (resend_message_id, retailer_id, buyer_profile_id, to_email, legacy_ids, sent_at)
      values ('pc-anna', 1, '${ANNA}', 'anna@example.invalid', '{101}', now());
      insert into public.legacy_send_email_events (event_id, resend_message_id, event_type, occurred_at, payload, status)
      values ('e1', 'pc-anna', 'email.opened', now(), '{}', 'processed');
      insert into public.legacy_send_app_reads (legacy_id, buyer_profile_id, reader_role, channel) values (101, '${ANNA}', 'buyer', 'app_list');
    `);
    const before = await fingerprint();
    for (const uid of [ANNA, ANNA, BARTEK, OWNER, ADMIN]) await visit(uid);
    await as(ADMIN, "select public.admin_set_activity_test_account($1::uuid, true)", [BARTEK]);
    await report(ADMIN);
    await report(ADMIN, new Date(Date.now() - 7 * 864e5).toISOString(), new Date().toISOString());
    expect(await fingerprint()).toEqual(before);
    expect((await one("select qty_used from public.packages where company_id = $1", [COMPANY])).qty_used).toBe(1);
    expect((await one("select status from public.legacy_sends where legacy_id = 101")).status).toBe("opened");
  });
});
