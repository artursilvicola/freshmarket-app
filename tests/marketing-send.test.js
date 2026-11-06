// [feat/marketing-activation] Wysyłka: flaga, claim z rejestru, zamrożona treść pod stałym
// kluczem, wyniki accepted/rejected/uncertain, odzyskanie po przerwaniu, test na alias.
// Poczta = atrapa fetch (żaden prawdziwy mail nie wychodzi z testów).
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";

const state = vi.hoisted(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: (_url, key) => key === "anon" ? state.user : state.service }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => state.env,
  missingEnvNames: (cfg, keys) => keys.filter((k) => !cfg[k]), envErrorPayload: (fn, missing) => ({ error: "env", fn, missing }),
}));
import { handler } from "../netlify/functions/marketing-send.js";
import { payloadHash, sendMarketingMail, allowedBySendAllowlist, sendAllowlistActive } from "../netlify/functions/_shared/marketing-mailer.js";
import { DEFAULT_CONTENT, defaultContent } from "../netlify/functions/_shared/marketing-templates.js";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const frozen = (id, over = {}) => {
  const subject = "Masz 5 kredytów", html = "<p>H</p>", text_body = "T";
  return { id, campaign_id: CAMP, company_id: "c1", profile_id: "p" + id, to_email: `op${id}@test.pl`, locale: "pl", segment: "start_with_credits",
    consent_source: "lista", snapshot: { company_name: "Sad Kowalski", credits_remaining: 5, nearest_expiry: "2026-12-27", snapshot_at: "2026-11-04T10:00:00Z" },
    subject, html, text_body, payload_hash: payloadHash({ subject, html, text: text_body }), idempotency_key: `marketing:${CAMP}:p${id}`, is_test: false, state: "pending", attempts: 0, ...over };
};
const req = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer fake" }, body: JSON.stringify(body) });

function service() {
  const db = state.db;
  return {
    auth: {},
    rpc: vi.fn(async (name, args) => {
      if (name === "marketing_claim_messages") {
        if (db.failClaim) return { data: null, error: { message: "claim down" } };
        const rows = db.messages.filter((m) => m.campaign_id === args.p_campaign_id && !m.is_test && (m.state === "pending" || (m.state === "claimed" && m.lease_expired))).slice(0, args.p_limit);
        for (const m of rows) { m.state = "claimed"; m.attempts += 1; m.lease_expired = false; }
        return { data: rows.map((m) => ({ ...m })), error: null };
      }
      if (name === "marketing_precheck_message") {
        if (db.failPrecheck) return { data: null, error: { message: "precheck down" } };
        const m = db.messages.find((x) => x.id === args.p_message_id);
        if (!m) return { data: { ok: false, reason: "not_found" }, error: null };
        if (m.state !== "claimed") return { data: { ok: false, reason: "not_claimed" }, error: null };
        if (m.is_test) return { data: { ok: true, test: true }, error: null };
        if ((db.suppressed || []).includes(m.to_email)) { m.state = "suppressed"; return { data: { ok: false, reason: "suppressed" }, error: null }; }
        return { data: { ok: true }, error: null };
      }
      if (name === "marketing_record_result") {
        if (db.failRecord) return { data: null, error: { message: "record down" } };
        const m = db.messages.find((x) => x.id === args.p_message_id);
        if (!m) return { data: { ok: false, reason: "not_found" }, error: null };
        if (m.state === "suppressed" && args.p_state === "accepted" && !m.resend_message_id) { m.resend_message_id = args.p_resend_message_id; m.sent_at = "now"; return { data: { ok: true, state: "suppressed", sent_before_unsubscribe: true }, error: null }; }
        if (m.state !== "claimed") return { data: { ok: false, reason: "not_claimed", state: m.state }, error: null };
        if (args.p_state === "accepted") { m.state = "accepted"; m.resend_message_id = args.p_resend_message_id; }
        else if (args.p_state === "rejected") { m.state = "rejected"; m.last_error = args.p_error; }
        else { m.state = "claimed"; m.last_error = args.p_error; }
        db.results.push({ id: args.p_message_id, state: args.p_state, err: args.p_error });
        return { data: { ok: true }, error: null };
      }
      return { data: null, error: { message: "unknown rpc " + name } };
    }),
    from: vi.fn((table) => {
      const q = { _f: [], _upd: null, _ins: null };
      for (const k of ["select", "order", "limit"]) q[k] = () => q;
      q.eq = (c, v) => { q._f.push([c, v]); return q; };
      q.in = (c, v) => { q._f.push([c, v]); return q; };
      q.update = (patch) => { q._upd = patch; return q; };
      q.insert = (row) => { q._ins = row; return q; };
      const rows = () => {
        if (table === "profiles") return [state.admin];
        if (table === "marketing_campaigns") return [db.campaign];
        if (table === "marketing_messages") return db.messages.filter((m) => q._f.every(([c, v]) => Array.isArray(v) ? v.includes(m[c]) : m[c] === v));
        return [];
      };
      q.maybeSingle = async () => {
        if (q._ins && table === "marketing_messages") { const row = { attempts: 0, ...q._ins, id: q._ins.id || ("t-" + (db.messages.length + 1)) }; if (db.messages.some((m) => m.idempotency_key === row.idempotency_key)) return { data: null, error: { message: "duplicate key value violates unique constraint" } }; db.messages.push(row); return { data: row, error: null }; }
        return { data: rows()[0] ?? null, error: null };
      };
      q.then = (res, rej) => {
        if (q._upd && table === "marketing_campaigns") { Object.assign(db.campaign, q._upd); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        if (table === "marketing_messages" && db.failLeft) return Promise.resolve({ data: null, error: { message: "read down" } }).then(res, rej);
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      };
      return q;
    }),
  };
}

beforeEach(() => {
  state.env = { supabaseUrl: "https://fake.test", supabaseAnonKey: "anon", supabaseServiceRoleKey: "svc", resendApiKey: "fake", b2bAppUrl: "https://b2b.test", marketingSendEnabled: true, marketingUnsubscribeSecret: "sekret" };
  state.admin = { id: "admin", role: "admin", active: true, locale: "pl", email: "admin@test.pl" };
  state.user = { auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) } };
  state.db = { campaign: { id: CAMP, status: "approved", reply_to: "preconnect@test.pl", template_key: "start_with_credits" }, messages: [frozen("m1"), frozen("m2")], results: [] };
  state.service = service();
  state.fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => { state.fetchCalls.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: "resend-" + state.fetchCalls.length }), { status: 200 }); }));
});
afterEach(() => vi.unstubAllGlobals());

const call = async (body) => { const r = await handler(req(body)); return { status: r.statusCode, body: JSON.parse(r.body) }; };

describe("bramki", () => {
  it("bez flagi MARKETING_SEND_ENABLED nic nie wychodzi — także test", async () => {
    state.env.marketingSendEnabled = false;
    expect((await call({ campaign_id: CAMP, mode: "batch" })).status).toBe(403);
    expect((await call({ campaign_id: CAMP, mode: "test", test_to: "zespol@test.pl", message_id: "m1" })).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.service.rpc).not.toHaveBeenCalled();
  });
  it("nie-admin → 403 przed jakimkolwiek odczytem", async () => {
    state.admin.role = "supplier";
    expect((await call({ campaign_id: CAMP })).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("kampania niezatwierdzona → 409", async () => {
    state.db.campaign.status = "draft";
    const r = await call({ campaign_id: CAMP });
    expect(r.status).toBe(409); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("batch z rejestru", () => {
  it("wysyła ZAMROŻONĄ treść pod stałym kluczem, z tagiem kind=marketing i nagłówkami wypisu; zapisuje wynik", async () => {
    const r = await call({ campaign_id: CAMP, mode: "batch" });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toMatchObject({ claimed: 2, accepted: 2, rejected: 0, uncertain: 0 });
    expect(r.body.done).toBe(true);
    expect(state.db.campaign.status).toBe("sent");
    const first = state.fetchCalls[0];
    expect(first.init.headers["Idempotency-Key"]).toBe(`marketing:${CAMP}:pm1`);
    expect(first.body.subject).toBe("Masz 5 kredytów");
    expect(first.body.tags).toEqual(expect.arrayContaining([{ name: "kind", value: "marketing" }]));
    expect(first.body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(first.body.headers["List-Unsubscribe"]).toMatch(/marketing-unsubscribe\?m=m1&t=/);
    expect(first.body.reply_to).toBe("preconnect@test.pl");
    expect(state.db.messages.map((m) => m.state)).toEqual(["accepted", "accepted"]);
    // marketing nie woła żadnego RPC rozliczeń
    for (const [name] of state.service.rpc.mock.calls) expect(name).toMatch(/^marketing_/);
  });
  it("zmieniona treść po zatwierdzeniu (hash się nie zgadza) → rejected bez wysyłki", async () => {
    state.db.messages[0].html = "<p>zmienione</p>";
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome.rejected).toBe(1); expect(r.body.outcome.accepted).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.db.results.find((x) => x.id === "m1")).toMatchObject({ state: "rejected", err: "payload_hash_mismatch" });
  });
  it("poczta odrzuca ładunek (422) → rejected; timeout/5xx → uncertain, wiersz zostaje claimed", async () => {
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ message: "bad" }), { status: 422 }))
         .mockImplementationOnce(async () => new Response("", { status: 503 }));
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome).toMatchObject({ rejected: 1, uncertain: 1, accepted: 0 });
    expect(state.db.messages[1].state).toBe("claimed");
    expect(r.body.done).toBe(false);
    expect(state.db.campaign.status).toBe("sending");
  });
  it("odzyskanie po przerwaniu: zajęty wiersz z wygasłą dzierżawą idzie ponownie pod TYM SAMYM kluczem", async () => {
    state.db.messages[0].state = "claimed"; state.db.messages[0].lease_expired = true; state.db.messages[0].attempts = 1;
    state.db.messages.splice(1, 1);
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome.accepted).toBe(1);
    expect(state.fetchCalls[0].init.headers["Idempotency-Key"]).toBe(`marketing:${CAMP}:pm1`);
    expect(state.db.messages[0].attempts).toBe(2);
  });
  it("błąd zapisu wyniku po akceptacji poczty → uncertain (nie druga wysyłka, nie „sukces”)", async () => {
    state.db.failRecord = true;
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome.uncertain).toBe(2); expect(r.body.outcome.accepted).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(r.body.details[0].error).toMatch(/record_failed/);
  });
  it("[review #2] wypis w trakcie partii: precheck tuż przed wysyłką zatrzymuje ten mail, reszta idzie", async () => {
    // suppresja pojawia się PO zajęciu partii (symulacja: precheck widzi ją dopiero przy drugim wierszu)
    state.db.suppressed = ["opm2@test.pl"];
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome).toMatchObject({ claimed: 2, accepted: 1, skipped: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.fetchCalls[0].body.to).toEqual(["opm1@test.pl"]);
    expect(state.db.messages[1].state).toBe("suppressed");
    expect(r.body.details[1]).toMatchObject({ result: "skipped", reason: "suppressed" });
  });
  it("[review #2] awaria precheck → wiersz pominięty (zostaje claimed do odzyskania), bez maila", async () => {
    state.db.failPrecheck = true;
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome.skipped).toBe(2); expect(fetch).not.toHaveBeenCalled();
    expect(state.db.messages.every((m) => m.state === "claimed")).toBe(true);
  });
  it("[review #6] błąd odczytu pozostałych NIE zamyka kampanii jako wysłanej", async () => {
    state.db.failLeft = true;
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome.accepted).toBe(2);
    expect(r.body.done).toBe(false); expect(r.body.remaining).toBeNull(); expect(r.body.warning).toMatch(/remaining_unknown/);
    expect(state.db.campaign.status).toBe("sending");
  });
  it("[r3 #1] wypis w trakcie żądania do Resend: potwierdzenie przyjęcia zapisane, wiersz zostaje suppressed, nie liczy się jako „sukces bez śladu”", async () => {
    fetch.mockImplementationOnce(async () => { state.db.messages[0].state = "suppressed"; return new Response(JSON.stringify({ id: "resend-x" }), { status: 200 }); });
    const r = await call({ campaign_id: CAMP });
    expect(state.db.messages[0]).toMatchObject({ state: "suppressed", resend_message_id: "resend-x", sent_at: "now" });
    expect(r.body.details[0]).toMatchObject({ result: "accepted", sent_before_unsubscribe: true });
    expect(r.body.outcome.accepted).toBe(2);
  });
  it("[r3 #1] baza odmawia zapisu wyniku (ok:false) → uncertain, nie accepted", async () => {
    fetch.mockImplementationOnce(async () => { state.db.messages[0].state = "rejected"; return new Response(JSON.stringify({ id: "resend-y" }), { status: 200 }); });
    const r = await call({ campaign_id: CAMP });
    expect(r.body.outcome.uncertain).toBe(1);
    expect(r.body.details[0]).toMatchObject({ result: "uncertain", error: "record_refused:not_claimed", resend_message_id: "resend-y" });
  });
  it("awaria claim → 500, bez maili", async () => {
    state.db.failClaim = true;
    expect((await call({ campaign_id: CAMP })).status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("test na alias zespołu", () => {
  it("osobny wiersz is_test z własnym kluczem; dwuklik w tej samej minucie = jedna wiadomość; zły adres → 400", async () => {
    const r1 = await call({ campaign_id: CAMP, mode: "test", test_to: "Zespol@Test.pl", message_id: "m1" });
    expect(r1.status).toBe(200); expect(r1.body.test).toBe(true);
    const t = state.db.messages.find((m) => m.is_test);
    expect(t.to_email).toBe("zespol@test.pl");
    expect(t.subject).toMatch(/^\[TEST\] Masz 5 kredytów PreConnect/);
    expect(t.idempotency_key).toMatch(/^marketing-test:m1:zespol@test\.pl:/);
    expect(state.fetchCalls[0].body.to).toEqual(["zespol@test.pl"]);
    // [review #1] własny link i nagłówek wypisu — żaden nie wskazuje na wiersz prawdziwego adresata (m1)
    expect(t.id).not.toBe("m1");
    expect(t.html).toContain(`marketing-unsubscribe?m=${t.id}&amp;t=`);
    expect(t.html).not.toContain("marketing-unsubscribe?m=m1&");
    expect(state.fetchCalls[0].body.headers["List-Unsubscribe"]).toMatch(new RegExp(`marketing-unsubscribe\\?m=${t.id}&t=`));
    expect(state.fetchCalls[0].body.headers["List-Unsubscribe"]).not.toContain("m=m1&");
    expect(state.fetchCalls[0].body.html).toBe(t.html);
    expect(t.payload_hash).toBe(payloadHash({ subject: t.subject, html: t.html, text: t.text_body }));
    const r2 = await call({ campaign_id: CAMP, mode: "test", test_to: "zespol@test.pl", message_id: "m1" });
    expect(r2.body.duplicate).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.db.messages.filter((m) => !m.is_test).every((m) => m.state === "pending")).toBe(true);
    expect((await call({ campaign_id: CAMP, mode: "test", test_to: "zly", message_id: "m1" })).status).toBe(400);
  });
});

describe("token wypisu", () => {
  it("jest HMAC po id wiadomości, inny sekret = inny token", async () => {
    const { unsubscribeToken, verifyUnsubscribeToken } = await import("../netlify/functions/_shared/marketing-mailer.js");
    const t = unsubscribeToken("sekret", "m1");
    expect(verifyUnsubscribeToken("sekret", "m1", t)).toBe(true);
    expect(verifyUnsubscribeToken("inny", "m1", t)).toBe(false);
    expect(verifyUnsubscribeToken("sekret", "m2", t)).toBe(false);
    expect(t).toBe(crypto.createHmac("sha256", "sekret").update("m1").digest("base64url"));
  });
});

describe("[review Codexa P1 #3] mail testowy renderuje z zamrożonej treści kampanii", () => {
  it("frozen_content (kompletna treść domyślna z chwili zatwierdzenia) wygrywa ze zmienionym szablonem w kodzie i z bieżącym content", async () => {
    const orig = DEFAULT_CONTENT.start_with_credits.pl.subject;
    try {
      state.db.campaign.frozen_content = defaultContent("start_with_credits");
      state.db.campaign.content = { pl: { subject: "BIEŻĄCA", body: "b", cta: "c" }, en: { subject: "s", body: "b", cta: "c" } };
      DEFAULT_CONTENT.start_with_credits.pl.subject = "NOWY SZABLON {{credits}}";
      const r = await call({ campaign_id: CAMP, mode: "test", test_to: "zespol@test.pl", message_id: "m1" });
      expect(r.status).toBe(200);
      const t = state.db.messages.find((m) => m.is_test);
      expect(t.subject).toBe("[TEST] Masz 5 kredytów PreConnect — najbliższy mailing do kupców 1 grudnia 2026");
      expect(t.html).not.toContain("NOWY SZABLON");
      expect(t.html).not.toContain("BIEŻĄCA");
    } finally {
      DEFAULT_CONTENT.start_with_credits.pl.subject = orig;
    }
  });
});

describe("lista dozwolonych adresów — MARKETING_SEND_ALLOWLIST (próba na prawdziwych kontach, Codex 06.11)", () => {
  it("batch: z aktywną listą idzie TYLKO adres z listy; inne wiersze pominięte (reason allowlist), zostają claimed, bez żądania do Resend; kampania nie kończy się jako wysłana", async () => {
    state.env.marketingSendAllowlist = ["opm1@test.pl"];
    const r = await call({ campaign_id: CAMP, mode: "batch" });
    expect(r.status).toBe(200);
    expect(r.body.allowlist).toEqual({ active: true, blocked: 1 });
    expect(r.body.outcome).toMatchObject({ claimed: 2, accepted: 1, skipped: 1, rejected: 0, uncertain: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.fetchCalls[0].body.to).toEqual(["opm1@test.pl"]);
    const m2 = state.db.messages.find((m) => m.id === "m2");
    expect(m2.state).toBe("claimed"); // zostaje do odzyskania po zdjęciu listy
    expect(r.body.details.find((d) => d.id === "m2")).toMatchObject({ result: "skipped", reason: "allowlist" });
    expect(r.body.remaining).toBe(1); expect(r.body.done).toBe(false);
    expect(state.db.campaign.status).toBe("sending");
  });
  it("batch: porównanie bez względu na wielkość liter i spacje; lista pusta = bez ograniczenia", async () => {
    state.env.marketingSendAllowlist = [" OpM1@Test.pl ".trim().toLowerCase(), "opm2@test.pl"];
    const r = await call({ campaign_id: CAMP, mode: "batch" });
    expect(r.body.allowlist).toEqual({ active: true, blocked: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    state.db = { campaign: { id: CAMP, status: "approved", reply_to: null, template_key: "start_with_credits" }, messages: [frozen("m3")], results: [] };
    state.service = service(); state.fetchCalls.length = 0; fetch.mockClear();
    state.env.marketingSendAllowlist = [];
    const r2 = await call({ campaign_id: CAMP, mode: "batch" });
    expect(r2.body.allowlist).toEqual({ active: false, blocked: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("test: adres spoza listy → 403 test_to_not_allowed bez wiersza i bez maila; adres z listy → wysyłka", async () => {
    state.env.marketingSendAllowlist = ["spiker.artur@gmail.com", "artur.silvicola@gmail.com"];
    const bad = await call({ campaign_id: CAMP, mode: "test", test_to: "zespol@test.pl", message_id: "m1" });
    expect(bad.status).toBe(403); expect(bad.body.error).toBe("test_to_not_allowed");
    expect(fetch).not.toHaveBeenCalled();
    expect(state.db.messages.some((m) => m.is_test)).toBe(false);
    const ok = await call({ campaign_id: CAMP, mode: "test", test_to: "Spiker.Artur@gmail.com", message_id: "m1" });
    expect(ok.status).toBe(200); expect(ok.body.test).toBe(true);
    expect(state.fetchCalls[0].body.to).toEqual(["spiker.artur@gmail.com"]);
  });
  it("lista nie zastępuje flagi: bez MARKETING_SEND_ENABLED nadal 403 send_disabled, nawet dla adresu z listy", async () => {
    state.env.marketingSendEnabled = false; state.env.marketingSendAllowlist = ["spiker.artur@gmail.com"];
    const r = await call({ campaign_id: CAMP, mode: "test", test_to: "spiker.artur@gmail.com", message_id: "m1" });
    expect(r.status).toBe(403); expect(r.body.error).toBe("send_disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("druga zapora w transporcie: sendMarketingMail z adresem spoza listy → uncertain allowlist_blocked, żadnego żądania", async () => {
    const env = { resendApiKey: "fake", marketingSendAllowlist: ["spiker.artur@gmail.com"] };
    const fetchImpl = vi.fn();
    const r = await sendMarketingMail({ env, message: { id: "x", to_email: "ktos@firma.pl", subject: "s", html: "h", text_body: "t", idempotency_key: "k", campaign_id: CAMP }, unsubscribeUrl: "https://b2b.test/u", fetchImpl });
    expect(r).toEqual({ status: "uncertain", error: "allowlist_blocked" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sendAllowlistActive(env)).toBe(true);
    expect(allowedBySendAllowlist(env, "SPIKER.ARTUR@gmail.com ")).toBe(true);
    expect(allowedBySendAllowlist({ marketingSendAllowlist: [] }, "ktos@firma.pl")).toBe(true);
    expect(allowedBySendAllowlist({}, "ktos@firma.pl")).toBe(true);
  });
});
