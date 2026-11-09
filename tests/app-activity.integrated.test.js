// [feat/admin-activity] Test ZINTEGROWANY na prawdziwym Postgresie (PGlite) z CAŁYM łańcuchem
// migracji repo: wyłącznik w bazie, dziennik wejść (record_app_visit), deduplikacja 30 min,
// podgląd admina, uprawnienia (RLS + EXECUTE), raport i zdarzenia liczone według własnych dat,
// stronicowanie, retencja 12 miesięcy oraz brak wpływu na kredyty, statusy propozycji
// i odczyty widoczne dostawcy.
//
//   PGLITE_PATH=/sciezka/do/node_modules/@electric-sql/pglite/dist/index.js npx vitest run tests/app-activity.integrated.test.js
// Bez PGLITE_PATH test jest POMIJANY (i widać to w raporcie). Prawdziwa równoległość (osobne
// połączenia) — scripts/app-activity-concurrency-check.mjs na bazie testowej.
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
const NOV = ["2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"];

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
const report = async (uid, [from, to] = ["2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z"]) =>
  (await as(uid, "select public.admin_activity_report($1::timestamptz, $2::timestamptz) as r", [from, to])).rows[0].r;
const events = async (uid, [from, to] = ["2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z"], ids = null, limit = 1000, offset = 0) =>
  (await as(uid, "select public.admin_activity_events($1::timestamptz, $2::timestamptz, $3::uuid[], $4, $5) as r", [from, to, ids, limit, offset])).rows[0].r;
const visits = async (uid) => (await q("select * from public.app_visits where profile_id = $1 order by id", [uid])).rows;
const byId = (r) => Object.fromEntries(r.accounts.map((a) => [a.profile_id, a]));
const kinds = (evs, uid) => evs.filter((e) => e.profile_id === uid).map((e) => `${e.kind}:${e.source ?? ""}`).sort();

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
  }, 180_000);
  afterAll(async () => { if (db) await db.close(); });

  beforeEach(async () => {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    await db.exec(`
      truncate public.app_visits, public.app_activity_test_accounts,
               public.legacy_send_messages, public.legacy_send_email_events, public.legacy_send_app_reads,
               public.marketing_email_events, public.marketing_messages, public.marketing_campaigns,
               public.legacy_sends, public.legacy_offers, public.wallet_tx, public.packages cascade;
      update public.app_activity_settings set enabled = true, collecting_since = null where id;
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
        active = excluded.active, retailer_id = excluded.retailer_id, company_id = excluded.company_id, last_active_at = null;
      insert into public.packages (company_id, plan, qty_total, qty_used, expires_at, purchased_at) values ('${COMPANY}', 'std_5', 5, 1, current_date + 30, now());
      insert into public.legacy_offers (legacy_id, supplier_legacy_id, status, data) values (77, 'sup-1', 'active', '{"title":"Awokado"}');
      insert into public.legacy_sends (legacy_id, supplier_legacy_id, offer_legacy_id, retailer_id, status, data) values
        (101, 'sup-1', 77, 1, 'opened', '{"supplierId":"sup-1","offerId":77,"status":"opened"}');
    `);
  });

  it("migracja zostawia zapis WYŁĄCZONY; wyłączony moduł nic nie zapisuje nawet przy bezpośrednim RPC", async () => {
    const fresh = read("supabase/migrations/20261109120000_app_activity.sql");
    expect(fresh).toMatch(/insert into public\.app_activity_settings \(id, enabled\) values \(true, false\) on conflict \(id\) do nothing/);
    await q("update public.app_activity_settings set enabled = false where id");
    expect(await visit(ANNA)).toEqual({ recorded: false, reason: "disabled" });
    expect(await visit(OWNER)).toEqual({ recorded: false, reason: "disabled" });
    expect((await one("select count(*)::int as n from public.app_visits")).n).toBe(0);
    expect((await report(ADMIN)).meta).toMatchObject({ enabled: false, collecting_since: null });
    // skrypty przełącznika z pakietu: wyłączna blokada modułu w transakcji; zapis — współdzielona
    const dir = "docs/production/wdrozenie-aktywnosc-2026-11-09/";
    await db.exec(read(dir + "03-wlaczenie-zapisu.sql").split("-- kontrola:")[0]);
    expect((await visit(ANNA)).recorded).toBe(true);
    await db.exec(read(dir + "04-wylaczenie-zapisu.sql"));
    expect(await visit(ANNA)).toEqual({ recorded: false, reason: "disabled" });
    expect(read(dir + "04-wylaczenie-zapisu.sql")).toMatch(/begin;\s*select pg_advisory_xact_lock\(hashtextextended\('app_activity:switch', 0\)\);[\s\S]*update public\.app_activity_settings[\s\S]*commit;/);
    const def = (await one("select pg_get_functiondef('public.record_app_visit()'::regprocedure) as d")).d;
    expect(def.indexOf("pg_advisory_xact_lock_shared(hashtextextended('app_activity:switch'")).toBeGreaterThan(-1);
    expect(def.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(def.indexOf("app_activity_settings"));   // blokada przed odczytem przełącznika
    await q("delete from public.app_visits");
    // ponowne zastosowanie migracji (idempotencja) nie włącza zapisu ani nie kasuje ustawień
    await q("update public.app_activity_settings set enabled = true where id");
    await db.exec(patch(fresh));
    expect((await one("select enabled from public.app_activity_settings")).enabled).toBe(true);
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
    expect(res.filter((r) => r.new_visit)).toHaveLength(1);
    const rows = await visits(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "supplier", company_id: COMPANY, retailer_id: null, hit_count: 6 });
  });

  it("przerwa dłuższa niż 30 min = nowa wizyta", async () => {
    await visit(ANNA);
    await q("update public.app_visits set started_at = now() - interval '40 minutes', last_seen_at = now() - interval '31 minutes' where profile_id = $1", [ANNA]);
    expect((await visit(ANNA)).new_visit).toBe(true);
    expect(await visits(ANNA)).toHaveLength(2);
  });

  it("admin (także w podglądzie cudzego konta) i brak sesji: nic nie jest zapisywane", async () => {
    expect(await visit(ADMIN)).toEqual({ recorded: false, reason: "not_participant" });
    expect(await visit(null)).toEqual({ recorded: false, reason: "no_session" });
    expect((await one("select count(*)::int as n from public.app_visits")).n).toBe(0);
  });

  it("uprawnienia: tylko admin czyta; zapis wyłącznie przez RPC; funkcje pomocnicze niedostępne", async () => {
    await visit(ANNA);
    await expect(as(ANNA, `insert into public.app_visits (profile_id, role) values ('${BARTEK}', 'buyer')`)).rejects.toThrow(/permission denied/);
    await expect(as(ANNA, "update public.app_visits set hit_count = 99")).rejects.toThrow(/permission denied/);
    await expect(as(ANNA, "update public.app_activity_settings set enabled = false")).rejects.toThrow(/permission denied/);
    expect((await as(ANNA, "select count(*)::int as n from public.app_visits")).rows[0].n).toBe(0);           // RLS
    expect((await as(ANNA, "select count(*)::int as n from public.app_activity_settings")).rows[0].n).toBe(0);
    await expect(report(ANNA)).rejects.toThrow(/tylko administrator/);
    await expect(events(OWNER)).rejects.toThrow(/tylko administrator/);
    await expect(report(OWNER)).rejects.toThrow(/tylko administrator/);                   // dostawca nie widzi raportu
    await expect(events(ANNA)).rejects.toThrow(/tylko administrator/);
    await expect(as(OWNER, "select public.admin_set_activity_test_account($1::uuid, true)", [ANNA])).rejects.toThrow(/tylko administrator/);
    for (const fn of ["public.purge_app_visits()", "public.app_activity_event_rows(now() - interval '1 day', now(), null)", "public.app_activity_period(null, null)"]) {
      await expect(as(ADMIN, `select * from ${fn}`)).rejects.toThrow(/permission denied/);
    }
    const priv = await one(`select
      has_function_privilege('anon', 'public.record_app_visit()', 'execute') as a,
      has_function_privilege('anon', 'public.admin_activity_report(timestamptz, timestamptz)', 'execute') as b,
      has_function_privilege('anon', 'public.admin_activity_events(timestamptz, timestamptz, uuid[], integer, integer)', 'execute') as c,
      has_function_privilege('service_role', 'public.purge_app_visits()', 'execute') as d,
      has_table_privilege('service_role', 'public.app_visits', 'insert') as e`);
    expect(priv).toEqual({ a: false, b: false, c: false, d: false, e: false });
    expect((await as(ADMIN, "select count(*)::int as n from public.app_visits")).rows[0].n).toBe(1);          // admin czyta
  });

  it("raport: wejścia, maile PreConnect i marketingowe, wyświetlenia, konta testowe, pole sprzed dziennika", async () => {
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
      update public.profiles set last_active_at = '2026-06-07T09:42:20Z' where id in ('${ANNA}','${OWNER}');
      update public.profiles set last_active_at = '2026-11-02T13:25:00Z' where id = '${BARTEK}';
    `);
    await as(ADMIN, "select public.admin_set_activity_test_account($1::uuid, true, 'konto do prób')", [BARTEK]);
    const r = await report(ADMIN);
    const acc = byId(r);
    expect(acc[ADMIN]).toBeUndefined();                                                   // admin poza raportem
    expect(acc[ANNA]).toMatchObject({ role: "buyer", retailer_name: "Sieć testowa", visits: 1, emails_sent: 1, emails_delivered: 1, emails_opened: 1, proposals_viewed: 0, is_test: false, legacy_last_active_shared: 2 });
    expect(new Date(acc[ANNA].last_opened_at).toISOString()).toBe("2026-11-04T08:00:00.000Z");
    expect(acc[BARTEK]).toMatchObject({ visits: 0, last_visit_at: null, emails_sent: 1, emails_opened: 0, proposals_viewed: 1, is_test: true, test_note: "konto do prób", legacy_last_active_shared: 1 });
    expect(acc[OWNER]).toMatchObject({ role: "supplier", company_name: "Sad Przykładowy", visits: 1, emails_sent: 1, emails_delivered: 1, emails_opened: 0 });
    expect(acc[ANNA]).not.toHaveProperty("legacy_last_active_kind");                      // bez wnioskowania o pochodzeniu
    expect(r.meta).toMatchObject({ enabled: true, retention_months: 12, dedupe_minutes: 30 });
    expect(r).not.toHaveProperty("events");

    const ev = (await events(ADMIN)).events;
    expect(kinds(ev, ANNA)).toEqual(["email_delivered:preconnect", "email_opened:preconnect", "email_opened:preconnect", "email_sent:preconnect", "visit:"]);
    expect(kinds(ev, BARTEK)).toEqual(["app_view_first:preconnect", "app_view_last:preconnect", "email_sent:preconnect"]);   // zignorowane otwarcie pominięte
    expect(kinds(ev, OWNER)).toEqual(["email_delivered:marketing", "email_sent:marketing", "visit:"]);   // wiadomość testowa pominięta
    expect(JSON.stringify(ev)).not.toMatch(/"ip"|token|anna@example\.invalid/);           // bez IP, tokenów i adresów w szczegółach
    // podsumowanie i oś czasu z tego samego źródła
    for (const uid of [ANNA, BARTEK, OWNER]) expect(acc[uid].events).toBe(ev.filter((e) => e.profile_id === uid).length);

    await as(ADMIN, "select public.admin_set_activity_test_account($1::uuid, false)", [BARTEK]);
    expect(byId(await report(ADMIN))[BARTEK].is_test).toBe(false);
    await expect(as(ADMIN, "select public.admin_set_activity_test_account($1::uuid, true)", [ADMIN])).rejects.toThrow(/nie jest kupcem ani dostawcą/);
  });

  it("każde zdarzenie liczone według własnej daty (wysyłka przed okresem, otwarcie po okresie)", async () => {
    await db.exec(`
      insert into public.legacy_send_messages (resend_message_id, retailer_id, buyer_profile_id, to_email, legacy_ids, sent_at) values
        ('sep', 1, '${ANNA}', 'anna@example.invalid', '{101}', '2026-09-20T09:00:00Z'),
        ('oct', 1, '${ANNA}', 'anna@example.invalid', '{101}', '2026-10-30T09:00:00Z');
      insert into public.legacy_send_email_events (event_id, resend_message_id, event_type, occurred_at, payload, status) values
        ('s1', 'sep', 'email.opened', '2026-11-05T10:00:00Z', '{}', 'processed'),
        ('o1', 'oct', 'email.delivered', '2026-10-30T09:00:04Z', '{}', 'processed'),
        ('o2', 'oct', 'email.opened', '2026-12-02T10:00:00Z', '{}', 'processed');
    `);
    const nov = byId(await report(ADMIN, NOV))[ANNA];
    expect(nov).toMatchObject({ emails_sent: 0, emails_delivered: 0, emails_opened: 1 });   // wrześniowa wysyłka, listopadowe otwarcie
    const oct = byId(await report(ADMIN, ["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"]))[ANNA];
    expect(oct).toMatchObject({ emails_sent: 1, emails_delivered: 1, emails_opened: 0 });   // grudniowe otwarcie poza październikiem
    expect(kinds((await events(ADMIN, NOV)).events, ANNA)).toEqual(["email_opened:preconnect"]);
    // filtr „tylko konta ze zdarzeniem” bazuje na liczbie zdarzeń w okresie
    expect(nov.events).toBe(1);
  });

  it("wyświetlenia propozycji: przerwa między pierwszym a ostatnim odczytem nie tworzy odczytu w okresie", async () => {
    await q(`insert into public.legacy_send_app_reads (legacy_id, buyer_profile_id, reader_role, channel, first_read_at, last_read_at, read_count)
             values (101, '${BARTEK}', 'buyer', 'app_list', '2026-11-01T10:00:00Z', '2026-11-10T10:00:00Z', 7)`);
    const gap = ["2026-11-04T00:00:00Z", "2026-11-07T00:00:00Z"];
    expect(byId(await report(ADMIN, gap))[BARTEK]).toMatchObject({ proposals_viewed: 0, events: 0 });
    expect((await events(ADMIN, gap)).events).toEqual([]);
    const lateRange = ["2026-11-09T00:00:00Z", "2026-11-11T00:00:00Z"];
    expect(byId(await report(ADMIN, lateRange))[BARTEK]).toMatchObject({ proposals_viewed: 1 });
    expect(kinds((await events(ADMIN, lateRange)).events, BARTEK)).toEqual(["app_view_last:preconnect"]);
  });

  it("zdarzenia: filtr kont i stronicowanie bez gubienia i dublowania", async () => {
    const vals = Array.from({ length: 25 }, (_, i) => `('v${i}', 1, '${i % 2 ? ANNA : BARTEK}', 'x@example.invalid', '{101}', '2026-11-0${1 + (i % 9)}T0${i % 10}:00:00Z')`).join(",");
    await q(`insert into public.legacy_send_messages (resend_message_id, retailer_id, buyer_profile_id, to_email, legacy_ids, sent_at) values ${vals}`);
    const all = await events(ADMIN, NOV, null, 1000, 0);
    expect(all.total).toBe(25);
    const pages = [];
    for (let off = 0; off < all.total; off += 7) pages.push(...(await events(ADMIN, NOV, null, 7, off)).events);
    expect(pages).toHaveLength(25);
    expect(pages.map((e) => e.detail.message)).toEqual(all.events.map((e) => e.detail.message));
    expect(new Set(pages.map((e) => e.detail.message)).size).toBe(25);
    const onlyAnna = await events(ADMIN, NOV, [ANNA], 1000, 0);
    expect(onlyAnna.total).toBe(12);
    expect(onlyAnna.events.every((e) => e.profile_id === ANNA)).toBe(true);
    expect((await events(ADMIN, NOV, null, 999999, 0)).limit).toBe(50000);                // górny limit jednego wywołania
    // licznik i lista z jednej migawki: funkcja STABLE (wspólny obraz danych w obrębie wywołania)
    expect((await one("select provolatile from pg_proc where proname = 'admin_activity_events'")).provolatile).toBe("s");
  });

  it("ostatnie wejście: tylko faktycznie zapisany czas, bez tworzenia czasu na granicy okresu", async () => {
    await q(`insert into public.app_visits (profile_id, role, retailer_id, started_at, last_seen_at, hit_count)
             values ('${ANNA}', 'buyer', 1, '2026-11-05T10:00:00Z', '2026-11-05T10:20:00Z', 3)`);
    const at = async (to) => new Date(byId(await report(ADMIN, ["2026-11-01T00:00:00Z", to]))[ANNA].last_visit_at).toISOString();
    expect(await at("2026-11-05T10:10:00Z")).toBe("2026-11-05T10:00:00.000Z");            // granica w trakcie wizyty → początek
    expect(await at("2026-11-05T10:30:00Z")).toBe("2026-11-05T10:20:00.000Z");            // po wizycie → ostatnie wczytanie
    expect(byId(await report(ADMIN, ["2026-11-01T00:00:00Z", "2026-11-05T09:00:00Z"]))[ANNA].last_visit_at).toBeNull();
  });

  it("okres raportu: walidacja i wejście poza okresem nie jest liczone", async () => {
    await visit(ANNA);
    await expect(report(ADMIN, ["2025-01-01T00:00:00Z", "2026-06-01T00:00:00Z"])).rejects.toThrow(/366 dni/);
    await expect(events(ADMIN, ["2026-06-01T00:00:00Z", "2026-05-01T00:00:00Z"])).rejects.toThrow(/przed końcem/);
    const past = await report(ADMIN, ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]);
    expect(byId(past)[ANNA]).toMatchObject({ visits: 0, last_visit_at: null, events: 0 });
  });

  it("retencja 12 miesięcy: stare wizyty usuwane przy nowym wejściu, przy raporcie i przez purge_app_visits", async () => {
    const old = (iv) => q(`insert into public.app_visits (profile_id, role, retailer_id, started_at, last_seen_at) values ('${BARTEK}', 'buyer', 1, now() - interval '${iv}', now() - interval '${iv}')`);
    await old("13 months"); await old("11 months");
    await visit(ANNA);
    expect((await visits(BARTEK)).length).toBe(1);
    await old("400 days");
    await report(ADMIN);
    expect((await visits(BARTEK)).length).toBe(1);
    await old("500 days");
    // stare rekordy rejestrów poczty, odczytów i rozliczeń NIE podlegają retencji dziennika wejść
    await db.exec(`
      insert into public.legacy_send_messages (resend_message_id, retailer_id, buyer_profile_id, to_email, legacy_ids, sent_at)
      values ('stary', 1, '${ANNA}', 'anna@example.invalid', '{101}', now() - interval '3 years');
      insert into public.legacy_send_email_events (event_id, resend_message_id, event_type, occurred_at, received_at, payload, status)
      values ('stare', 'stary', 'email.opened', now() - interval '3 years', now() - interval '3 years', '{}', 'processed');
      insert into public.legacy_send_app_reads (legacy_id, buyer_profile_id, reader_role, channel, first_read_at, last_read_at)
      values (101, '${ANNA}', 'buyer', 'app_list', now() - interval '3 years', now() - interval '3 years');
      insert into public.packages (company_id, plan, qty_total, qty_used, expires_at, purchased_at) values ('${COMPANY}', 'std_5', 5, 5, current_date - 700, now() - interval '3 years');
    `);
    const before = await fingerprint();
    expect((await one("select public.purge_app_visits() as n")).n).toBe(1);                // jak zadanie pg_cron (właściciel)
    expect((await visits(BARTEK)).length).toBe(1);
    expect(await fingerprint()).toEqual(before);
    expect(read("supabase/migrations/20261109120000_app_activity.sql").match(/delete from public\.\w+/g)).toEqual(["delete from public.app_visits", "delete from public.app_activity_test_accounts"]);
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
    await events(ADMIN, [new Date(Date.now() - 7 * 864e5).toISOString(), new Date(Date.now() + 60e3).toISOString()]);
    expect(await fingerprint()).toEqual(before);
    expect((await one("select qty_used from public.packages where company_id = $1", [COMPANY])).qty_used).toBe(1);
    expect((await one("select status from public.legacy_sends where legacy_id = 101")).status).toBe("opened");
  });
});
