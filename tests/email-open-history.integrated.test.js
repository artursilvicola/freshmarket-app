// Test ZINTEGROWANY: prawdziwy webhook + prawdziwe markLegacySendsSeen + prawdziwe RPC
// rozliczeń (mark_legacy_send_seen → charge_legacy_send_first_seen) na PRAWDZIWYM
// Postgresie (PGlite) z CAŁYM łańcuchem migracji repo. Udawane: poczta (fetch) i cienki
// shim PostgREST (.from()/.rpc() → SQL; typy argumentów RPC czytane z pg_proc).
//
// Uruchamia się tylko z PGLITE_PATH (PGlite nie jest zależnością repo):
//   PGLITE_PATH=/sciezka/do/node_modules/@electric-sql/pglite/dist/index.js npx vitest run tests/email-open-history.integrated.test.js
// Bez PGLITE_PATH jest POMIJANY i mówi o tym w raporcie — nie udaje, że przeszedł.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

const PGLITE_PATH = process.env.PGLITE_PATH;
const state = vi.hoisted(() => ({ supa: null }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.supa }));
const SECRET_B64 = Buffer.from("tajne-integracja").toString("base64");
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => ({ supabaseUrl: "https://fake.test", supabaseAnonKey: "anon", supabaseServiceRoleKey: "svc", resendApiKey: "fake", b2bAppUrl: "https://fake.test", resendWebhookSecret: "whsec_" + Buffer.from("tajne-integracja").toString("base64") }),
  missingEnvNames: () => [], envErrorPayload: () => ({}),
}));
import { handler as webhook } from "../netlify/functions/resend-webhook.js";
import { markLegacySendsSeen } from "../netlify/functions/_shared/legacy-send-seen.js";
import { processPendingEvents } from "../netlify/functions/_shared/email-events.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?pgcrypto"?\s*;/gi, "")
  .replace(/create extension if not exists "?pg_trgm"?\s*;/gi, "")
  .replace(/create extension if not exists "?citext"?\s*;/gi, "");

const ADMIN = "11111111-1111-4111-8111-111111111111", ANNA = "22222222-2222-4222-8222-222222222222", BARTEK = "33333333-3333-4333-8333-333333333333";
const COMPANY = "44444444-4444-4444-8444-444444444444", OWNER = "55555555-5555-4555-8555-555555555555";
const env = { supabaseUrl: "https://fake.test", supabaseServiceRoleKey: "svc", resendApiKey: "fake", b2bAppUrl: "https://fake.test" };

let db, argTypes, mails, failures;

function makeSupa() {
  return {
    from(table) {
      const q = { _cols: "*", _w: [], _order: null, _limit: null };
      const b = {
        select(cols) { q._cols = cols || "*"; return b; },
        eq(c, v) { q._w.push([c, "=", v]); return b; },
        in(c, v) { q._w.push([c, "in", v]); return b; },
        contains(c, v) { q._w.push([c, "@>", JSON.stringify(v)]); return b; },
        order(c, o) { q._order = `${c} ${o?.ascending === false ? "desc" : "asc"}`; return b; },
        limit(n) { q._limit = n; return b; },
        async _run() {
          const params = []; const where = q._w.map(([c, op, v]) => {
            if (op === "in") { params.push(v); return `${c} = any($${params.length})`; }
            if (op === "@>") { params.push(v); return `${c} @> $${params.length}::jsonb`; }
            params.push(v); return `${c} = $${params.length}`;
          });
          const cols = q._cols === "*" ? "*" : q._cols.split(",").map((s) => s.trim()).filter((s) => s && !s.includes("(")).join(", ");
          const sql = `select ${cols} from public.${table}${where.length ? " where " + where.join(" and ") : ""}${q._order ? " order by " + q._order : ""}${q._limit ? " limit " + q._limit : ""}`;
          try { const r = await db.query(sql, params); return { data: r.rows, error: null }; }
          catch (e) { return { data: null, error: { message: e.message } }; }
        },
        async maybeSingle() { const r = await b._run(); return { data: r.data ? (r.data[0] ?? null) : null, error: r.error }; },
        then(res, rej) { return b._run().then(res, rej); },
      };
      return b;
    },
    async rpc(name, args = {}) {
      const left = failures.get(name) || 0;
      if (left > 0) { failures.set(name, left - 1); return { data: null, error: { message: `symulowana awaria ${name}` } }; }
      const types = argTypes.get(name);
      if (!types) return { data: null, error: { code: "PGRST202", message: `brak funkcji ${name}` } };
      const keys = Object.keys(args).filter((k) => types.has(k));
      const binding = keys.map((k, i) => `${k} => $${i + 1}::${types.get(k)}`).join(", ");
      const values = keys.map((k) => { const v = args[k]; return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v; });
      try {
        // RETURNS TABLE / SETOF → lista wierszy (jak PostgREST); skalar/jsonb → wartość
        const r = types.retset
          ? await db.query(`select * from public.${name}(${binding})`, values)
          : await db.query(`select public.${name}(${binding}) as r`, values);
        return { data: types.retset ? r.rows : (r.rows[0]?.r ?? null), error: null };
      }
      catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    },
  };
}

function signed(body, { id, ts = Math.floor(Date.now() / 1000) }) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET_B64, "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
  return { httpMethod: "POST", headers: { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": "v1," + sig }, body: raw };
}
const opened = (emailId, at = "2026-10-22T10:00:00.000Z") => ({ type: "email.opened", created_at: at, data: { email_id: emailId, to: ["x@example.invalid"] } });
const call = async (ev) => { const r = await webhook(ev); return { status: r.statusCode, body: JSON.parse(r.body) }; };
const used = async () => (await db.query(`select qty_used from public.packages where company_id = $1`, [COMPANY])).rows[0].qty_used;
const send = async (id) => (await db.query(`select status, data from public.legacy_sends where legacy_id = $1`, [id])).rows[0];
const link = (msg, buyer, email, ids) => db.query(`select public.record_legacy_send_message($1,1,$2::uuid,$3,$4::bigint[],now(),$5,'pl') as r`, [msg, buyer, email, ids, "key-" + msg]);

describe.skipIf(!PGLITE_PATH)("historia otwarć — zintegrowany (prawdziwy SQL + prawdziwe rozliczenia)", () => {
  beforeAll(async () => {
    const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
    db = new PGlite();
    await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
    const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) await db.exec(patch(read("supabase/migrations/" + f)));
    argTypes = new Map();
    for (const row of (await db.query(`select p.proname, p.proretset, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows) {
      const m = new Map();
      for (const part of String(row.args || "").split(",").map((s) => s.trim()).filter(Boolean)) { const [name, ...type] = part.split(/\s+/); m.set(name, type.join(" ")); }
      m.retset = !!row.proretset;
      if (!argTypes.has(row.proname) || m.size > argTypes.get(row.proname).size) argTypes.set(row.proname, m);
    }
    state.supa = makeSupa();
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      mails.push({ url: String(url), body: JSON.parse(init?.body || "{}"), key: init?.headers?.["Idempotency-Key"] || null });
      return { ok: true, status: 200, json: async () => ({ id: "resend-" + mails.length }), text: async () => "" };
    }));
  }, 120_000);
  afterAll(async () => { vi.unstubAllGlobals(); if (db) await db.close(); });

  beforeEach(async () => {
    mails = []; failures = new Map();
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    await db.exec(`
      truncate public.legacy_send_messages, public.legacy_send_email_events, public.legacy_send_app_reads,
               public.legacy_sends, public.legacy_offers, public.wallet_tx, public.packages cascade;
      delete from public.profiles where id in ('${ADMIN}','${ANNA}','${BARTEK}','${OWNER}');
      delete from auth.users where id in ('${ADMIN}','${ANNA}','${BARTEK}','${OWNER}');
      insert into auth.users (id, email) values
        ('${ADMIN}', 'admin@example.invalid'), ('${ANNA}', 'anna@example.invalid'),
        ('${BARTEK}', 'bartek@example.invalid'), ('${OWNER}', 'dostawca@example.invalid');
      delete from public.companies where id = '${COMPANY}';
      delete from public.retailers where id in (1,2);
      insert into public.retailers (id, name, country) values (1, 'Sieć testowa', 'PL'), (2, 'Inna sieć', 'PL');
      insert into public.companies (id, name, legacy_supplier_id, country) values ('${COMPANY}', 'Dostawca testowy', 'sup-1', 'PL');
      -- trigger na auth.users tworzy profil automatycznie (jak na produkcji) → upsert
      insert into public.profiles (id, role, name, email, active, retailer_id, company_id) values
        ('${ADMIN}', 'admin', 'Admin', 'admin@example.invalid', true, null, null),
        ('${ANNA}', 'buyer', 'Anna Kupiec', 'anna@example.invalid', true, 1, null),
        ('${BARTEK}', 'buyer', 'Bartek Kupiec', 'bartek@example.invalid', true, 1, null),
        ('${OWNER}', 'supplier', 'Dostawca', 'dostawca@example.invalid', true, null, '${COMPANY}')
      on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email,
        active = excluded.active, retailer_id = excluded.retailer_id, company_id = excluded.company_id;
      insert into public.packages (company_id, plan, qty_total, qty_used, expires_at, purchased_at) values ('${COMPANY}', 'std_5', 5, 0, current_date + 30, now());
      insert into public.legacy_offers (legacy_id, supplier_legacy_id, status, data) values (77, 'sup-1', 'active', '{"title":"Awokado"}'), (78, 'sup-1', 'active', '{"title":"Banany"}');
      insert into public.legacy_sends (legacy_id, supplier_legacy_id, offer_legacy_id, retailer_id, status, data) values
        (101, 'sup-1', 77, 1, 'sent', '{"supplierId":"sup-1","offerId":77,"status":"sent"}'),
        (102, 'sup-1', 78, 1, 'sent', '{"supplierId":"sup-1","offerId":78,"status":"sent"}'),
        (103, 'sup-1', 77, 1, 'sent', '{"supplierId":"sup-1","offerId":77,"status":"sent"}'),
        (104, 'sup-1', 78, 1, 'unread_expired', '{"supplierId":"sup-1","offerId":78,"status":"unread_expired"}');
    `);
  });

  it("dwóch kupców jednej sieci, ten sam zestaw: dwa maile, JEDNO pobranie kredytu per propozycja", async () => {
    await link("m-anna", ANNA, "anna@example.invalid", [101, 102]);
    await link("m-bartek", BARTEK, "bartek@example.invalid", [101, 102]);
    const a = await call(signed(opened("m-anna"), { id: "svix-a" }));
    expect(a.status).toBe(200); expect(a.body.status).toBe("processed");
    expect(await used()).toBe(2);
    const b = await call(signed(opened("m-bartek", "2026-10-22T11:00:00Z"), { id: "svix-b" }));
    expect(b.status).toBe(200);
    expect(await used()).toBe(2);                                        // drugi kupiec nie pobiera drugi raz
    expect(b.body.results.every((r) => r.billing?.alreadyCharged)).toBe(true);
    expect((await send(101)).status).toBe("opened");
    expect((await send(103)).status).toBe("sent");                       // nie była w żadnym mailu — nietknięta
    expect((await db.query("select count(*)::int as n from public.legacy_send_email_events where status='processed'")).rows[0].n).toBe(2);
    expect(mails.length).toBe(1);                                        // jedno powiadomienie dostawcy
  });

  it("powtórzenie webhooka i równoczesne otwarcia: historia bez dubli, jedno rozliczenie", async () => {
    await link("m1", ANNA, "anna@example.invalid", [101]);
    const ev = signed(opened("m1"), { id: "svix-dup" });
    await Promise.all([call(ev), call(ev), call(signed(opened("m1", "2026-10-22T10:00:05Z"), { id: "svix-2" }))]);
    const r = await call(ev);
    expect(r.body.duplicate).toBe(true);
    expect(await used()).toBe(1);
    expect((await db.query("select count(*)::int as n from public.legacy_send_email_events")).rows[0].n).toBe(2);
  });

  it("odczyt w aplikacji PRZED mailem, potem otwarcie maila: jedno pobranie, wejście przypisane do kupca", async () => {
    const app = await markLegacySendsSeen({ supaSvc: state.supa, env, legacyIds: [101], channel: "app_detail", allowedRetailerId: 1, notifySupplier: true, readerProfileId: BARTEK, readerRole: "buyer" });
    expect(app.results[0].billing.charged).toBe(true);
    expect(app.results[0].appRead?.ok).toBe(true);
    expect(await used()).toBe(1);
    await link("m1", ANNA, "anna@example.invalid", [101]);
    const r = await call(signed(opened("m1"), { id: "svix-after" }));
    expect(r.status).toBe(200);
    expect(await used()).toBe(1);                                        // mail po odczycie nie pobiera drugi raz
    expect((await send(101)).status).toBe("read");                       // e-mail nie cofa statusu read
    const reads = (await db.query("select buyer_profile_id, channel from public.legacy_send_app_reads where legacy_id=101")).rows;
    expect(reads).toEqual([{ buyer_profile_id: BARTEK, channel: "app_detail" }]);
  });

  it("otwarcie maila, potem wejście innego kupca: jedno pobranie, oba ślady osobno w historii admina", async () => {
    await link("m1", ANNA, "anna@example.invalid", [101]);
    await call(signed(opened("m1"), { id: "svix-1" }));
    const app = await markLegacySendsSeen({ supaSvc: state.supa, env, legacyIds: [101], channel: "app_list", allowedRetailerId: 1, notifySupplier: true, readerProfileId: BARTEK, readerRole: "buyer" });
    expect(app.results[0].billing.alreadyCharged).toBe(true);
    expect(await used()).toBe(1);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);
    const hist = (await db.query("select public.admin_retailer_email_history(1) as r")).rows[0].r;
    expect(hist.messages).toHaveLength(1); expect(hist.messages[0].open_count).toBe(1);
    expect(hist.app_reads).toHaveLength(1); expect(hist.app_reads[0].buyer_name).toBe("Bartek Kupiec");
  });

  it("zdarzenie PRZED powiązaniem: orphan bez rozliczenia; po powiązaniu przetworzone", async () => {
    const r1 = await call(signed(opened("m-early"), { id: "svix-early" }));
    expect(r1.body.status).toBe("orphan");
    expect(await used()).toBe(0);
    const rec = (await link("m-early", ANNA, "anna@example.invalid", [101])).rows[0].r;
    expect(rec.pending_events).toHaveLength(1);
    const out = await processPendingEvents({ supaSvc: state.supa, env, legacyIds: [101], pendingEvents: rec.pending_events });
    expect(out[0].status).toBe("processed");
    expect(await used()).toBe(1);
  });

  // [review 22.10] maile sprzed wdrożenia historii per kupiec: brak powiązania, ale legacy_sends zna message_id
  it("mail sprzed wdrożenia (legacy_sends.resend_message_id, bez powiązania): rozliczony jak dotąd, powiązanie dopisane z kupcem po adresie", async () => {
    await db.query(`update public.legacy_sends set resend_message_id = 'm-old' where legacy_id in (101, 102)`);
    const r = await call(signed({ type: "email.opened", created_at: "2026-10-22T10:00:00.000Z", data: { email_id: "m-old", to: ["Anna@example.invalid"] } }, { id: "svix-old" }));
    expect(r.status).toBe(200); expect(r.body.status).toBe("processed"); expect(r.body.linked_from_legacy_sends).toBe(true);
    expect(await used()).toBe(2);
    expect((await send(101)).status).toBe("opened"); expect((await send(103)).status).toBe("sent");
    const m = (await db.query(`select buyer_profile_id, to_email, legacy_ids, send_key from public.legacy_send_messages where resend_message_id = 'm-old'`)).rows[0];
    expect(m).toMatchObject({ buyer_profile_id: ANNA, to_email: "anna@example.invalid", send_key: "fallback:m-old" });
    expect(m.legacy_ids.map(Number)).toEqual([101, 102]);
    expect((await db.query(`select status from public.legacy_send_email_events where event_id = 'svix-old'`)).rows[0].status).toBe("processed");
    // ta sama dostawa jeszcze raz: duplikat, zero zmian
    const r2 = await call(signed({ type: "email.opened", created_at: "2026-10-22T10:00:00.000Z", data: { email_id: "m-old", to: ["Anna@example.invalid"] } }, { id: "svix-old" }));
    expect(r2.body.duplicate).toBe(true); expect(await used()).toBe(2);
  });

  it("mail sprzed wdrożenia z id tylko w data.resendMessageIds (najstarszy zapis): też rozliczony", async () => {
    await db.query(`update public.legacy_sends set data = data || '{"resendMessageIds":["m-json","m-json-b"]}' where legacy_id = 103`);
    const r = await call(signed(opened("m-json"), { id: "svix-json" }));
    expect(r.body.status).toBe("processed"); expect(await used()).toBe(1);
    expect((await send(103)).status).toBe("opened");
  });

  it("otwarcie, gdy wiersz jest jeszcze `approved` (batch w toku): 500 + error; po oznaczeniu `sent` ponowienie rozlicza raz", async () => {
    await db.query(`update public.legacy_sends set status = 'approved' where legacy_id = 101`);
    await link("m1", ANNA, "anna@example.invalid", [101, 102]);
    const ev = signed(opened("m1"), { id: "svix-approved" });
    const r1 = await call(ev);
    expect(r1.status).toBe(500); expect(r1.body.error).toBe("not_yet_marked_sent");
    expect((await db.query(`select status, last_error from public.legacy_send_email_events where event_id = 'svix-approved'`)).rows[0]).toMatchObject({ status: "error" });
    expect(await used()).toBe(1);                                 // 102 było sent
    await db.query(`update public.legacy_sends set status = 'sent' where legacy_id = 101`);
    const r2 = await call(ev);
    expect(r2.status).toBe(200); expect(await used()).toBe(2);
    expect((await db.query(`select status from public.legacy_send_email_events where event_id = 'svix-approved'`)).rows[0].status).toBe("processed");
  });

  it("wygasła propozycja: zdarzenie zapisane, bez obciążenia i bez wznowienia", async () => {
    await link("m1", ANNA, "anna@example.invalid", [104]);
    const r = await call(signed(opened("m1"), { id: "svix-exp" }));
    expect(r.status).toBe(200); expect(r.body.results[0].status).toBe("skipped");
    expect(await used()).toBe(0);
    expect((await send(104)).status).toBe("unread_expired");
  });

  it("mail niezwiązany z propozycjami (logowanie): orphan, zero obciążeń", async () => {
    const r = await call(signed({ type: "email.opened", created_at: "2026-10-22T10:00:00Z", data: { email_id: "m-login", subject: "Link logowania" } }, { id: "svix-login" }));
    expect(r.body.status).toBe("orphan"); expect(await used()).toBe(0);
  });

  it("awaria bazy przy zapisie zdarzenia → 500 i nic nie rozliczone; po naprawie to samo zdarzenie przechodzi", async () => {
    await link("m1", ANNA, "anna@example.invalid", [101]);
    failures.set("ingest_legacy_send_email_event", 1);
    const ev = signed(opened("m1"), { id: "svix-db" });
    const r1 = await call(ev);
    expect(r1.status).toBe(500); expect(await used()).toBe(0);
    const r2 = await call(ev);
    expect(r2.status).toBe(200); expect(await used()).toBe(1);
  });

  it("przejściowy błąd rozliczenia → error + 500; ponowienie Svixa kończy, bez dubla", async () => {
    await link("m1", ANNA, "anna@example.invalid", [101, 102]);
    failures.set("mark_legacy_send_seen", 1);                            // pierwsza propozycja pada, druga przechodzi
    const ev = signed(opened("m1"), { id: "svix-partial" });
    const r1 = await call(ev);
    expect(r1.status).toBe(500);
    expect(await used()).toBe(1);
    const r2 = await call(ev);
    expect(r2.status).toBe(200);
    expect(await used()).toBe(2);                                        // dorozliczona pierwsza, druga NIE podwójnie
    expect((await db.query("select status from public.legacy_send_email_events where event_id='svix-partial'")).rows[0].status).toBe("processed");
  });

  it("RLS: kupiec nie widzi tabel historii, admin widzi", async () => {
    await link("m1", ANNA, "anna@example.invalid", [101]);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [BARTEK]);
    await db.exec("set role authenticated");
    expect((await db.query("select count(*)::int as n from public.legacy_send_messages")).rows[0].n).toBe(0);
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);
    await db.exec("set role authenticated");
    expect((await db.query("select count(*)::int as n from public.legacy_send_messages")).rows[0].n).toBe(1);
    await db.exec("reset role");
  });
});

describe.skipIf(!!PGLITE_PATH)("historia otwarć — zintegrowany", () => {
  it.skip("POMINIĘTY: brak PGLITE_PATH — test zintegrowany nie został wykonany", () => {});
});
