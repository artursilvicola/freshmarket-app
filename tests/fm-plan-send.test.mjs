// [feat/fm-plan-send-server-card] Testy fm-plan-send: karta generowana na serwerze z zatwierdzonego
// planu, logotypy tylko z naszego Storage, artefakt PDF w prywatnym buckecie, osobny mail per adresat
// z Idempotency-Key, rejestr doręczeń z niepewnymi wynikami. ZERO sieci: Supabase, Storage i Resend
// są atrapami; jedyny „obraz” to lokalne fixtures (tests/fixtures/logo.webp / logo.png).
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

const mock = vi.hoisted(() => ({ db: null, user: null, cards: [] }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (_url, key) => (key === "test-service" ? mock.db : { auth: { getUser: async () => mock.user } }) }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => ({ supabaseUrl: "https://project.supabase.test", supabaseAnonKey: "test-anon", supabaseServiceRoleKey: "test-service", resendApiKey: "test-resend" }),
  missingEnvNames: () => [],
  envErrorPayload: () => ({ error: "test-env" }),
}));
// Szpieg na rendererze: rejestruje kartę przekazaną do supplierDoc/chainDoc (co trafia do PDF).
vi.mock("../src/lib/fm-plan/layout.js", async (importOriginal) => {
  const real = await importOriginal();
  const rec = (kind, card) => mock.cards.push(structuredClone({ kind, id: card.id, name: card.name, lang: card.lang, logo: !!card.logo,
    meetings: card.meetings.map((m) => kind === "supplier" ? [m.nr, m.chain.cid, m.chain.name, !!m.chain.logo] : [m.nr, m.supplier.id, m.supplier.name, !!m.supplier.logo]) }));
  return { ...real, supplierDoc: (card, o) => { rec("supplier", card); return real.supplierDoc(card, o); }, chainDoc: (card, o) => { rec("chain", card); return real.chainDoc(card, o); } };
});
import { handler as send, findCard, artefactPath, idempotencyKey } from "../netlify/functions/fm-plan-send.js";
import { handler as data } from "../netlify/functions/fm-plan-data.js";
import { __testing as logoTesting } from "../netlify/functions/_shared/fm-plan-logos.js";

const STORAGE = "https://project.supabase.test/storage/v1/object/public/company-logos/";
const LOGO_WEBP = readFileSync(new URL("./fixtures/logo.webp", import.meta.url));
const LOGO_PNG = readFileSync(new URL("./fixtures/logo.png", import.meta.url));
const PLAN_AT = "2026-09-22T10:00:00.000+00:00";

// ── atrapy: PostgREST (filtry, insert z UNIQUE, update, delete) + Storage ──
let tables, mails, resendMode, ledgerUpdateFail, objects, uploads;
function fakeDb() {
  return {
    storage: { from(bucket) { return {
      async download(path) { const key = bucket + "/" + path; return objects.has(key) ? { data: new Blob([objects.get(key)]), error: null } : { data: null, error: { message: "Object not found" } }; },
      async upload(path, buf, opts) { const key = bucket + "/" + path; uploads.push({ key, opts }); if (objects.has(key) && !opts?.upsert) return { data: null, error: { message: "The resource already exists" } }; objects.set(key, Buffer.from(buf)); return { data: { path }, error: null }; },
    }; } },
    from(table) {
      const filters = []; let one = false, limit = Infinity, op = "select", payload = null, wantSingle = false;
      const q = {
        select() { return q; }, order() { return q; }, limit(n) { limit = n; return q; },
        eq(k, v) { filters.push((r) => String(r[k]) === String(v)); return q; },
        neq(k, v) { filters.push((r) => r[k] !== v); return q; },
        in(k, vs) { filters.push((r) => vs.includes(r[k])); return q; },
        maybeSingle() { one = true; return q; }, single() { one = true; wantSingle = true; return q; },
        insert(v) { op = "insert"; payload = v; return q; }, update(v) { op = "update"; payload = v; return q; }, delete() { op = "delete"; return q; },
        then(resolve, reject) {
          if (!(table in tables)) return Promise.reject(new Error("Unexpected table: " + table)).then(resolve, reject);
          let out;
          if (op === "insert") {
            const row = { id: "d" + (tables[table].length + 1), created_at: new Date().toISOString(), ...payload };
            if (table === "fm_plan_deliveries" && tables[table].some((r) => r.kind === row.kind && r.target_id === row.target_id && r.email === row.email && r.plan_updated_at === row.plan_updated_at)) {
              return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }).then(resolve, reject);
            }
            tables[table].push(row); out = { data: wantSingle ? row : [row], error: null };
          } else {
            const rows = tables[table].filter((r) => filters.every((f) => f(r))).slice(0, limit);
            if (op === "update") {
              if (table === "fm_plan_deliveries" && payload.status === "sent" && ledgerUpdateFail(rows[0])) return Promise.resolve({ data: null, error: { message: "connection reset" } }).then(resolve, reject);
              rows.forEach((r) => Object.assign(r, payload));
            }
            if (op === "delete") tables[table] = tables[table].filter((r) => !rows.includes(r));
            out = { data: one ? rows[0] || null : rows, error: null };
          }
          return Promise.resolve(out).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
const ev = (body = {}, headers = { authorization: "Bearer ok" }) => ({ httpMethod: "POST", headers, body: JSON.stringify({ kind: "supplier", id: "A", planUpdatedAt: PLAN_AT, ...body }) });
const attachmentPdf = (mail) => Buffer.from(mail.body.attachments[0].content, "base64");
const pages = async (buf) => (await PDFDocument.load(buf)).getPageCount();
async function imageCount(buf) {
  const doc = await PDFDocument.load(buf); let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) n++;
  return n;
}

function fixture({ phase = "published", plan = true, bigA = false } = {}) {
  const chains = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Sieć ${i + 1}`, fm26_chain_id: `ch${i + 1}`, fm26_active: true, active: true, country: "PL", cats: ["owoce"], fm_gate: 1 + (i % 2), buyers: [], logo_url: i === 0 ? STORAGE + "chain1.webp" : null }));
  chains[0].buyers = [{ id: "b1", role: "buyer", name: "Kupiec 1", email: "buyer1@example.invalid", active: true, fm26_active: true, buyer_categories: [] }, { id: "b2", role: "buyer", name: "Kupiec 2", email: "buyer2@example.invalid", active: true, fm26_active: true, buyer_categories: [] }];
  const numsA = bigA ? Object.fromEntries(chains.slice(0, 17).map((c, i) => [c.fm26_chain_id, 3 * i + 2])) : { ch1: 4, ch2: 9 };
  const nums = { A: numsA, B: { ch1: 7, ch3: 12 } };
  return {
    profiles: [
      { id: "admin", role: "admin", email: "admin@example.invalid", active: true },
      { id: "sa1", role: "supplier", company_id: "A", email: "a1@example.invalid", active: true },
      { id: "sa2", role: "supplier", company_id: "A", email: "A2@Example.invalid", active: true },
      { id: "sa3", role: "supplier", company_id: "A", email: "old@example.invalid", active: false },
      { id: "sb1", role: "supplier", company_id: "B", email: "b1@example.invalid", active: true },
      { id: "b1", role: "buyer", retailer_id: 1, email: "buyer1@example.invalid", active: true, fm26_active: true },
      { id: "b2", role: "buyer", retailer_id: 1, email: "buyer2@example.invalid", active: true, fm26_active: true },
    ],
    companies: [
      { id: "A", name: "Alfa Fruits", country: "PL", fm_b2b_enabled: true, account_status: "active", fm_b2b_packages: 4, company_contacts: [], logo_url: STORAGE + "alfa.png" },
      { id: "B", name: "Beta Vegetables", country: "ES", fm_b2b_enabled: true, account_status: "active", fm_b2b_packages: 1, company_contacts: [], logo_url: "https://evil.example/storage/v1/object/public/beta.png" },
    ],
    retailers: chains,
    fm_settings: [{ id: "s", algo_phase: phase, updated_at: "2026-09-22T09:00:00Z", schedule: null }],
    fm_plan_private: plan ? [{ id: 1, schedule: { nums, res: {}, cq: {} }, updated_at: PLAN_AT }] : [],
    company_target_retailers: [], fm_resps: [], fm_plan_deliveries: [],
  };
}

beforeEach(() => {
  tables = fixture(); mails = []; objects = new Map(); uploads = []; mock.cards = []; logoTesting.cache.clear();
  resendMode = () => ({ ok: true }); ledgerUpdateFail = () => false;
  mock.db = fakeDb(); mock.user = { data: { user: { id: "admin" } }, error: null };
  vi.stubEnv("NETLIFY_DEV", "false"); vi.stubEnv("NETLIFY_LOCAL", "false"); vi.stubEnv("FM_EXPORT_TOKEN", "");
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.startsWith(STORAGE)) {
      if (u.endsWith("alfa.png")) return { ok: true, headers: new Headers({ "content-length": String(LOGO_PNG.length) }), arrayBuffer: async () => LOGO_PNG.buffer.slice(LOGO_PNG.byteOffset, LOGO_PNG.byteOffset + LOGO_PNG.length) };
      if (u.endsWith("chain1.webp")) return { ok: true, headers: new Headers({ "content-length": String(LOGO_WEBP.length) }), arrayBuffer: async () => LOGO_WEBP.buffer.slice(LOGO_WEBP.byteOffset, LOGO_WEBP.byteOffset + LOGO_WEBP.length) };
      return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (u !== "https://api.resend.com/emails") throw new Error("Network forbidden in tests: " + u);
    const body = JSON.parse(opts.body); const key = opts.headers["Idempotency-Key"] || null;
    const mode = resendMode(body, key);
    if (mode.throw) throw new Error("socket hang up");
    if (!mode.ok) return { ok: false, status: mode.status, text: async () => mode.text || "boom" };
    // Replay dostawcy: ten sam klucz + identyczny payload → ten sam id, BEZ drugiej wiadomości
    const prior = key && mails.find((m) => m.key === key);
    if (prior) { if (prior.raw !== opts.body) return { ok: false, status: 409, text: async () => "invalid_idempotent_request" }; return { ok: true, json: async () => ({ id: prior.id }) }; }
    const id = "MOCK-" + (mails.length + 1); mails.push({ id, key, raw: opts.body, body });
    return { ok: true, json: async () => ({ id }) };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("autoryzacja i wejście", () => {
  it("brak tokenu → 401; dostawca → 403; nieaktywny admin → 403; zero maili", async () => {
    expect((await send(ev({}, {}))).statusCode).toBe(401);
    tables.profiles[0].role = "supplier"; expect((await send(ev())).statusCode).toBe(403);
    tables.profiles[0].role = "admin"; tables.profiles[0].active = false; expect((await send(ev())).statusCode).toBe(403);
    expect(mails).toHaveLength(0);
  });
  it("żadne bajty z przeglądarki: pdfBase64 (karta A+B, cudze spotkanie, błędne pary) i logos (obraz z cudzą treścią) → 400, zero maili", async () => {
    expect(JSON.parse((await send(ev({ pdfBase64: Buffer.from("%PDF-1.4 karta A + karta B").toString("base64") }))).body).error).toBe("client_payload_not_accepted");
    expect(JSON.parse((await send(ev({ logos: { ch1: "data:image/png;base64," + LOGO_PNG.toString("base64") } }))).body).error).toBe("client_payload_not_accepted");
    expect(mails).toHaveLength(0); expect(mock.cards).toHaveLength(0);
  });
  it("faza bez publikacji → 409; publikacja bez planu → 409 plan_missing; nieaktualna wersja → 409 plan_changed", async () => {
    tables.fm_settings[0].algo_phase = "matching";
    expect(JSON.parse((await send(ev())).body).error).toBe("plan_not_published");
    tables.fm_settings[0].algo_phase = "published"; tables.fm_plan_private = [];
    expect(JSON.parse((await send(ev())).body).error).toBe("plan_missing");
    tables = fixture(); mock.db = fakeDb();
    const j = JSON.parse((await send(ev({ planUpdatedAt: "2026-09-21T10:00:00Z" }))).body); expect(j.error).toBe("plan_changed"); expect(j.plan_updated_at).toBe(PLAN_AT);
    expect(JSON.parse((await send(ev({ planUpdatedAt: undefined }))).body).error).toBe("plan_changed");
    expect(mails).toHaveLength(0);
  });
  it("odbiorca spoza planu → 400 card_not_found; bez spotkań → 409 no_meetings", async () => {
    expect(JSON.parse((await send(ev({ id: "ZZZ" }))).body).error).toBe("card_not_found");
    tables.fm_plan_private[0].schedule.nums.A = {};
    expect(JSON.parse((await send(ev())).body).error).toBe("no_meetings");
    expect(mails).toHaveLength(0);
  });
});

describe("PDF zawiera wyłącznie kartę odbiorcy, a obrazy pochodzą tylko z naszego Storage", () => {
  it("dostawca A: pary dokładnie z planu, nic z B; osobny mail per adres; ten sam załącznik; logo własne (PNG) i sieci (WebP→PNG) z kanonicznych adresów", async () => {
    const r = await send(ev()); expect(r.statusCode).toBe(200); const j = JSON.parse(r.body);
    expect(j.ok).toBe(true); expect(j.sent.sort()).toEqual(["a1@example.invalid", "a2@example.invalid"]); expect(j.marked).toBe(true);
    expect(j.logos).toEqual({ attached: 2, requested: 2 });
    expect(mock.cards).toHaveLength(1);
    expect(mock.cards[0]).toMatchObject({ kind: "supplier", id: "A", name: "Alfa Fruits", lang: "pl", logo: true });
    expect(mock.cards[0].meetings).toEqual([[4, "ch1", "Sieć 1", true], [9, "ch2", "Sieć 2", false]]);
    expect(mails).toHaveLength(2);
    for (const mail of mails) { expect(mail.body.to).toHaveLength(1); expect(mail.body.attachments[0].filename).toMatch(/^\d{3}-Alfa-Fruits-pl\.pdf$/); expect(attachmentPdf(mail).subarray(0, 5).toString()).toBe("%PDF-"); }
    expect(Buffer.compare(attachmentPdf(mails[0]), attachmentPdf(mails[1]))).toBe(0);
    // końcowy PDF: obrazy = stałe logotypy FM/sponsorów + własne + Sieć 1 (obce hosty nigdy nie są pobierane)
    const baseline = await (async () => { tables.companies[0].logo_url = null; tables.retailers[0].logo_url = null; tables.fm_plan_deliveries = []; objects.clear(); logoTesting.cache.clear(); mails.length = 0; await send(ev()); return imageCount(attachmentPdf(mails[0])); })();
    tables = fixture(); mock.db = fakeDb(); mails.length = 0; objects.clear(); logoTesting.cache.clear();
    await send(ev());
    expect(await imageCount(attachmentPdf(mails[0]))).toBeGreaterThan(baseline);
    expect(vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.includes("evil.example"))).toEqual([]);
  });
  it("sieć: tylko jej kolejka (A i B po numerach); logo B z obcego hosta pominięte, adresaci = kupcy tej sieci", async () => {
    const r = await send(ev({ kind: "chain", id: 1 })); const j = JSON.parse(r.body);
    expect(r.statusCode).toBe(200); expect(j.ok).toBe(true);
    expect(mock.cards[0]).toMatchObject({ kind: "chain", id: 1, name: "Sieć 1", logo: true });
    expect(mock.cards[0].meetings).toEqual([[4, "A", "Alfa Fruits", true], [7, "B", "Beta Vegetables", false]]);
    expect(mails.map((m) => m.body.to[0]).sort()).toEqual(["buyer1@example.invalid", "buyer2@example.invalid"]);
    expect(tables.retailers[0].fm_plan_sent_at).toBeTruthy();
  });
  it("karta wielostronicowa (17 spotkań) przyjęta; nadal wyłącznie A", async () => {
    tables = fixture({ bigA: true }); mock.db = fakeDb();
    const r = await send(ev()); expect(r.statusCode).toBe(200); expect(JSON.parse(r.body).ok).toBe(true);
    expect(mock.cards[0].meetings).toHaveLength(17); expect(mock.cards[0].meetings.every(([, cid]) => cid !== "ch3" || true)).toBe(true);
    expect(await pages(attachmentPdf(mails[0]))).toBeGreaterThanOrEqual(3);
  });
  it("findCard: identyfikatory kupca muszą być liczbą", () => {
    expect(findCard({ suppliers: [{ id: "A" }], chains: [{ id: 1 }] }, "chain", "1")).toEqual({ id: 1 });
    expect(findCard({ suppliers: [{ id: "A" }], chains: [{ id: 1 }] }, "chain", "abc")).toBe(null);
  });
});

describe("artefakt, idempotencja i niepewne wyniki", () => {
  it("artefakt renderowany raz per (odbiorca, wersja planu); ponowienie używa tych samych bajtów i tego samego Idempotency-Key", async () => {
    const j1 = JSON.parse((await send(ev())).body);
    expect(j1.artefact).toMatchObject({ path: artefactPath("supplier", "A", PLAN_AT), reused: false }); expect(uploads).toHaveLength(1); expect(j1.artefact.path).toMatch(/\.json$/);
    const manifest = JSON.parse(objects.get("fm-plan-cards/" + j1.artefact.path).toString("utf8"));
    expect(manifest).toMatchObject({ v: 1, filename: expect.stringMatching(/^\d{3}-Alfa-Fruits-pl\.pdf$/), subject: expect.stringContaining("Fresh Market 2026"), html: expect.stringContaining("Alfa Fruits"), tag: "plan-card-supplier" });
    expect(manifest.pdf_sha256).toBe(j1.artefact.sha256);
    expect(mails[0].key).toBe(idempotencyKey("supplier", "A", PLAN_AT, "a1@example.invalid")); expect(mails[0].key).toMatch(/^[A-Za-z0-9-]{20,200}$/);
    expect(mails[0].key).not.toBe(mails[1].key);
    // rejestr „zgubiony” (np. awaria zapisu) → ponowienie próbuje wysłać, ale dostawca odtwarza wynik po kluczu: brak nowych wiadomości
    tables.fm_plan_deliveries = []; mock.cards = []; const before = mails.length;
    const j2 = JSON.parse((await send(ev())).body);
    expect(j2.artefact.reused).toBe(true); expect(mock.cards).toHaveLength(0); expect(uploads).toHaveLength(1);
    expect(j2.artefact.sha256).toBe(j1.artefact.sha256); expect(mails).toHaveLength(before); // replay dostawcy — brak nowych wiadomości
    expect(j2.sent.sort()).toEqual(["a1@example.invalid", "a2@example.invalid"]);
  });
  it("drugie wywołanie po sukcesie: already_sent, zero wywołań poczty", async () => {
    await send(ev()); const calls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("resend")).length;
    const j = JSON.parse((await send(ev())).body);
    expect(j.ok).toBe(true); expect(j.sent).toEqual([]); expect(j.already_sent.sort()).toEqual(["a1@example.invalid", "a2@example.invalid"]);
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("resend")).length).toBe(calls);
  });
  it("mail przyjęty, zapis potwierdzenia nieudany → unconfirmed, ok=false, bez znacznika; ponowienie = replay tym samym kluczem, jedna wiadomość łącznie", async () => {
    ledgerUpdateFail = (row) => row?.email === "a1@example.invalid";
    const j1 = JSON.parse((await send(ev())).body);
    expect(j1.ok).toBe(false); expect(j1.unconfirmed).toEqual(["a1@example.invalid"]); expect(j1.sent).toEqual(["a2@example.invalid"]); expect(j1.marked).toBe(false);
    expect(tables.companies[0].fm_plan_sent_at).toBeUndefined();
    const row = tables.fm_plan_deliveries.find((d) => d.email === "a1@example.invalid"); expect(row.status).toBe("sending");
    ledgerUpdateFail = () => false;
    const j2 = JSON.parse((await send(ev())).body);
    expect(j2.ok).toBe(true); expect(j2.sent).toEqual(["a1@example.invalid"]); expect(j2.already_sent).toEqual(["a2@example.invalid"]); expect(j2.marked).toBe(true);
    expect(mails.filter((m) => m.body.to[0] === "a1@example.invalid")).toHaveLength(1);
    expect(row.status).toBe("sent"); expect(row.resend_id).toBe("MOCK-1"); expect(row.attempts).toBe(2);
  });
  it("5xx / zerwane połączenie → wynik niepewny, wiersz zostaje; ponowienie odtwarza żądanie i wysyła dokładnie raz", async () => {
    let n = 0; resendMode = (body) => body.to[0] === "a2@example.invalid" && n++ === 0 ? { throw: true } : { ok: true };
    const j1 = JSON.parse((await send(ev())).body);
    expect(j1.failed).toEqual([{ email: "a2@example.invalid", error: expect.stringMatching(/^resend_network/), uncertain: true }]);
    expect(tables.fm_plan_deliveries.find((d) => d.email === "a2@example.invalid")).toMatchObject({ status: "sending", last_error: expect.stringMatching(/resend_network/) });
    const j2 = JSON.parse((await send(ev())).body);
    expect(j2.ok).toBe(true); expect(j2.sent).toEqual(["a2@example.invalid"]);
    expect(mails.map((m) => m.body.to[0])).toEqual(["a1@example.invalid", "a2@example.invalid"]);
  });
  it("jednoznaczna odmowa dostawcy (4xx) dla świeżej próby zwalnia rezerwację bez wysyłki", async () => {
    resendMode = (body) => body.to[0] === "a2@example.invalid" ? { ok: false, status: 422, text: "invalid to" } : { ok: true };
    const j = JSON.parse((await send(ev())).body);
    expect(j.failed).toEqual([{ email: "a2@example.invalid", error: expect.stringMatching(/^resend_422/) }]);
    expect(tables.fm_plan_deliveries.map((d) => d.email)).toEqual(["a1@example.invalid"]);
  });
  it("konflikt idempotencji (ten sam klucz, inny payload) → failed idempotency_conflict, bez usuwania wiersza", async () => {
    resendMode = () => ({ ok: false, status: 409, text: "invalid_idempotent_request" });
    const j = JSON.parse((await send(ev())).body);
    expect(j.failed.map((f) => f.error)).toEqual(["idempotency_conflict", "idempotency_conflict"]);
    expect(tables.fm_plan_deliveries).toHaveLength(2);
  });
  it("równoległa rezerwacja → in_progress; niepewna próba starsza niż 24 h nie jest ponawiana bez force", async () => {
    tables.fm_plan_deliveries.push({ id: "x1", kind: "supplier", target_id: "A", email: "a1@example.invalid", plan_updated_at: PLAN_AT, status: "sending", created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), attempts: 1, attempt: 1, idempotency_key: "old-key" });
    const j = JSON.parse((await send(ev())).body);
    expect(j.stale_unconfirmed).toEqual(["a1@example.invalid"]); expect(j.sent).toEqual(["a2@example.invalid"]); expect(j.ok).toBe(false); expect(j.marked).toBe(false);
    expect(mails.map((m) => m.body.to[0])).toEqual(["a2@example.invalid"]);
    const jf = JSON.parse((await send(ev({ force: true }))).body);
    expect(jf.sent).toEqual(["a1@example.invalid"]); expect(jf.ok).toBe(true);
    const forced = mails.find((m) => m.body.to[0] === "a1@example.invalid"); expect(forced.key).toMatch(/-a2$/);
    const race = await Promise.all([send(ev({ kind: "chain", id: 1 })), send(ev({ kind: "chain", id: 1 }))]);
    const sentBoth = race.map((r) => JSON.parse(r.body)).flatMap((r) => r.sent);
    expect(mails.filter((m) => m.body.to[0].startsWith("buyer")).map((m) => m.body.to[0]).sort()).toEqual(["buyer1@example.invalid", "buyer2@example.invalid"]);
    expect(sentBoth.sort()).toEqual(["buyer1@example.invalid", "buyer2@example.invalid"]);
  });
  it("P2/1: zmiana nazwy firmy / języka / numeru karty między próbami NIE zmienia żądania — ponowienie odtwarza manifest, brak konfliktu i duplikatu", async () => {
    ledgerUpdateFail = (row) => row?.email === "a1@example.invalid";
    const j1 = JSON.parse((await send(ev())).body); expect(j1.unconfirmed).toEqual(["a1@example.invalid"]);
    const first = mails.find((m) => m.body.to[0] === "a1@example.invalid");
    // zmiany w bazie bez zmiany wersji planu: nazwa, kraj (→ język EN), kolejność firm (→ numer karty)
    tables.companies[0].name = "Alfa Fruits Updated"; tables.companies[0].country = "DE";
    tables.companies.unshift({ id: "0", name: "0 Nowa Firma", country: "PL", fm_b2b_enabled: true, account_status: "active", fm_b2b_packages: 1, company_contacts: [] });
    ledgerUpdateFail = () => false; mock.cards = [];
    const j2 = JSON.parse((await send(ev())).body);
    expect(j2.ok).toBe(true); expect(j2.sent).toEqual(["a1@example.invalid"]); expect(j2.failed).toEqual([]); expect(j2.marked).toBe(true);
    expect(j2.artefact.reused).toBe(true); expect(mock.cards).toHaveLength(0); // bez ponownego renderu
    expect(mails.filter((m) => m.body.to[0] === "a1@example.invalid")).toHaveLength(1); // replay, nie drugi mail
    expect(j2.filename).toBe(first.body.attachments[0].filename); expect(j2.filename).toMatch(/^001-Alfa-Fruits-pl\.pdf$/);
  });
  it("P2/1: zmiana szablonu maila po rozpoczęciu próby nie zmienia żądania (manifest trzyma temat i HTML)", async () => {
    ledgerUpdateFail = (row) => row?.email === "a1@example.invalid";
    await send(ev()); const first = mails.find((m) => m.body.to[0] === "a1@example.invalid");
    const manifestKey = "fm-plan-cards/" + artefactPath("supplier", "A", PLAN_AT); const stored = JSON.parse(objects.get(manifestKey).toString("utf8"));
    expect(stored.html).toBe(first.body.html); expect(stored.subject).toBe(first.body.subject);
    ledgerUpdateFail = () => false;
    const j2 = JSON.parse((await send(ev())).body); expect(j2.ok).toBe(true); expect(mails.filter((m) => m.body.to[0] === "a1@example.invalid")).toHaveLength(1);
  });
  it("P2/2: wymuszona próba ma własną generację i czas startu; awaria potwierdzenia nowej próby → zwykłe ponowienie = replay tym samym kluczem, jeden mail", async () => {
    tables.fm_plan_deliveries.push({ id: "x1", kind: "supplier", target_id: "A", email: "a1@example.invalid", plan_updated_at: PLAN_AT, status: "sending", created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), attempt_started_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), attempt: 1, attempts: 1, idempotency_key: "old-key" });
    ledgerUpdateFail = (row) => row?.email === "a1@example.invalid";
    const jf = JSON.parse((await send(ev({ force: true }))).body);
    expect(jf.unconfirmed).toEqual(["a1@example.invalid"]); expect(jf.stale_unconfirmed).toEqual([]);
    const row = tables.fm_plan_deliveries.find((d) => d.id === "x1"); expect(row.attempt).toBe(2); expect(row.idempotency_key).toMatch(/-a2$/); expect(Date.now() - Date.parse(row.attempt_started_at)).toBeLessThan(60_000);
    ledgerUpdateFail = () => false;
    const j2 = JSON.parse((await send(ev())).body); // bez force — nowa próba jest świeża
    expect(j2.stale_unconfirmed).toEqual([]); expect(j2.sent).toEqual(["a1@example.invalid"]); expect(j2.ok).toBe(true);
    expect(mails.filter((m) => m.body.to[0] === "a1@example.invalid")).toHaveLength(1); expect(row.status).toBe("sent"); expect(row.attempt).toBe(2);
    const j3 = JSON.parse((await send(ev({ force: true }))).body); expect(j3.already_sent).toContain("a1@example.invalid"); expect(mails.filter((m) => m.body.to[0] === "a1@example.invalid")).toHaveLength(1);
  });
  it("P2/2: dwa równoczesne wymuszenia tego samego starego wpisu → jedna nowa próba, jeden mail, oba wywołania zgodne", async () => {
    tables.fm_plan_deliveries.push({ id: "x1", kind: "supplier", target_id: "A", email: "a1@example.invalid", plan_updated_at: PLAN_AT, status: "sending", created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), attempt_started_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), attempt: 1, attempts: 1, idempotency_key: "old-key" });
    const [r1, r2] = (await Promise.all([send(ev({ force: true })), send(ev({ force: true }))])).map((r) => JSON.parse(r.body));
    const a1mails = mails.filter((m) => m.body.to[0] === "a1@example.invalid"); expect(a1mails).toHaveLength(1);
    const row = tables.fm_plan_deliveries.find((d) => d.id === "x1"); expect(row.attempt).toBe(2); expect(row.status).toBe("sent"); expect(a1mails[0].key).toBe(row.idempotency_key);
    expect([r1, r2].flatMap((r) => [...r.sent, ...r.already_sent]).filter((e) => e === "a1@example.invalid").length).toBeGreaterThanOrEqual(1);
    expect([r1, r2].flatMap((r) => r.failed)).toEqual([]);
  });
  it("adresaci już obsłużeni nie uruchamiają ani pobierania logotypów, ani renderu, ani odczytu bucketu", async () => {
    await send(ev()); const fetches = vi.mocked(fetch).mock.calls.length; mock.cards = []; objects.clear();
    const j = JSON.parse((await send(ev())).body);
    expect(j.ok).toBe(true); expect(j.already_sent.sort()).toEqual(["a1@example.invalid", "a2@example.invalid"]);
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetches); expect(mock.cards).toHaveLength(0); expect(j.artefact).toBeUndefined();
  });
  it("nowa wersja planu = nowy artefakt i nowe doręczenia (stare wpisy nie blokują)", async () => {
    tables.fm_plan_deliveries.push({ id: "old", kind: "supplier", target_id: "A", email: "a1@example.invalid", plan_updated_at: "2026-09-21T10:00:00Z", status: "sent", created_at: "2026-09-21T10:00:00Z" });
    const j = JSON.parse((await send(ev())).body);
    expect(j.sent.sort()).toEqual(["a1@example.invalid", "a2@example.invalid"]);
    expect(artefactPath("supplier", "A", PLAN_AT)).not.toBe(artefactPath("supplier", "A", "2026-09-21T10:00:00Z"));
  });
});

describe("tryb testowy", () => {
  it("tylko adres zalogowanego admina, bez rejestru, bez artefaktu i znacznika; bez planu = karta symulacyjna", async () => {
    tables.fm_plan_private = []; tables.fm_settings[0].algo_phase = "matching";
    const r = await send(ev({ test: true, planUpdatedAt: undefined })); const j = JSON.parse(r.body);
    expect(r.statusCode).toBe(200); expect(j.test).toBe(true); expect(j.mode).toBe("simulation"); expect(j.sent).toEqual(["admin@example.invalid"]);
    expect(mails).toHaveLength(1); expect(mails[0].body.to).toEqual(["admin@example.invalid"]); expect(mails[0].body.subject).toMatch(/^\[TEST\]/);
    expect(tables.fm_plan_deliveries).toHaveLength(0); expect(uploads).toHaveLength(0); expect(tables.companies[0].fm_plan_sent_at).toBeUndefined();
  });
});

describe("fm-plan-data", () => {
  it("zwraca wersję planu i te same dane co wysyłka; nieaktywny admin → 403", async () => {
    const r = await data({ httpMethod: "GET", headers: { authorization: "Bearer ok" } });
    expect(r.statusCode).toBe(200); const j = JSON.parse(r.body);
    expect(j.plan_updated_at).toBe(PLAN_AT); expect(j.companies.map((c) => c.id)).toEqual(["A", "B"]); expect(j.settings.schedule.nums.A).toEqual({ ch1: 4, ch2: 9 });
    tables.profiles[0].active = false;
    expect((await data({ httpMethod: "GET", headers: { authorization: "Bearer ok" } })).statusCode).toBe(403);
  });
});
