// [feat/marketing-activation] Zatwierdzenie kampanii: świeży odczyt, JEDEN insert kompletnej
// wiadomości (id losowane przed zapisem → link wypisu w treści), brak zgody → 422,
// istniejący wiersz → pominięty (bez dubla). Review Codexa #5.
import { beforeEach, describe, it, expect, vi } from "vitest";

const state = vi.hoisted(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: (_url, key) => key === "anon" ? state.user : state.service }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => state.env,
  missingEnvNames: (cfg, keys) => keys.filter((k) => !cfg[k]), envErrorPayload: (fn, missing) => ({ error: "env", fn, missing }),
}));
vi.mock("../netlify/functions/_shared/marketing-data.js", () => ({
  loadCampaign: async () => state.campaign,
  computeCandidates: async () => ({ snapshot_at: "2026-11-04T10:00:00Z", today: "2026-11-04", rows: state.rows, summary: {} }),
}));
import { handler } from "../netlify/functions/marketing-campaign.js";
import { payloadHash } from "../netlify/functions/_shared/marketing-mailer.js";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const req = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer fake" }, body: JSON.stringify(body) });
const call = async (body) => { const r = await handler(req(body)); return { status: r.statusCode, body: JSON.parse(r.body) }; };
const row = (over = {}) => ({ company_id: "c1", company_name: "Sad Kowalski", profile_id: "p1", email: "op@kowalski.test", locale: "pl", segment: "start_with_credits", template_key: "start_with_credits", eligible: true, exclusions: [], warnings: [], match: { status: "n/a" }, snapshot: { credits_remaining: 5, nearest_expiry: "2026-12-27" }, ...over });

beforeEach(() => {
  state.env = { supabaseUrl: "https://fake.test", supabaseAnonKey: "anon", supabaseServiceRoleKey: "svc", b2bAppUrl: "https://b2b.test", marketingUnsubscribeSecret: "sekret" };
  state.user = { auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) } };
  state.campaign = { id: CAMP, status: "draft", template_key: "start_with_credits", reply_to: "preconnect@test.pl" };
  state.rows = [row(), row({ company_id: "c2", company_name: "Inna", profile_id: "p2", email: "inna@test.pl" })];
  state.inserts = []; state.updates = []; state.existing = {};
  state.service = {
    rpc: vi.fn(),
    from: vi.fn((table) => {
      const q = { _f: [], _ins: null, _upd: null };
      for (const k of ["select", "order", "limit"]) q[k] = () => q;
      q.eq = (c, v) => { q._f.push([c, v]); return q; };
      q.insert = (r) => { q._ins = r; return q; };
      q.update = (p) => { q._upd = p; return q; };
      q.maybeSingle = async () => {
        if (table === "profiles") return { data: { id: "admin", role: "admin", active: true, locale: "pl" }, error: null };
        if (table === "marketing_messages") { const key = q._f.find(([c]) => c === "idempotency_key")?.[1]; return { data: state.existing[key] || null, error: null }; }
        return { data: null, error: null };
      };
      q.then = (res, rej) => {
        if (q._ins && table === "marketing_messages") { state.inserts.push(q._ins); return Promise.resolve({ data: null, error: state.failInsert ? { message: "db down" } : null }).then(res, rej); }
        if (q._upd && table === "marketing_campaigns") { state.updates.push(q._upd); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      };
      return q;
    }),
  };
});

describe("approve", () => {
  it("zapisuje KOMPLETNĄ wiadomość jednym insertem: id, zamrożona treść z linkiem wypisu dla TEGO id, hash, klucz, snapshot z nazwą firmy", async () => {
    const r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1", consent_source: "regulamin 1.0 — potwierdzone 4.11" }] });
    expect(r.status).toBe(200);
    expect(r.body.approved).toBe(1);
    expect(state.inserts).toHaveLength(1);
    const m = state.inserts[0];
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.state).toBe("pending");
    expect(m.payload_hash).toBe(payloadHash({ subject: m.subject, html: m.html, text: m.text_body }));
    expect(m.payload_hash).not.toBe("pending");
    expect(m.html).toContain(`marketing-unsubscribe?m=${m.id}&amp;t=`);
    expect(m.idempotency_key).toBe(`marketing:${CAMP}:p1`);
    expect(m.consent_source).toBe("regulamin 1.0 — potwierdzone 4.11");
    expect(m.snapshot.company_name).toBe("Sad Kowalski");
    expect(m.snapshot.snapshot_at).toBe("2026-11-04T10:00:00Z");
    expect(state.service.from.mock.calls.filter(([t]) => t === "marketing_messages").length).toBeGreaterThan(0);
    expect(state.updates[0]).toMatchObject({ status: "approved", snapshot_at: "2026-11-04T10:00:00Z" });
  });
  it("brak źródła zgody → 422 i zero insertów; niekwalifikujący się → 422 z powodami", async () => {
    let r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1", consent_source: "" }] });
    expect(r.status).toBe(422); expect(r.body.problems[0].reason).toBe("consent_source_missing");
    state.rows[0].eligible = false; state.rows[0].exclusions = ["suppressed"];
    r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(422); expect(r.body.problems[0]).toMatchObject({ reason: "not_eligible", exclusions: ["suppressed"] });
    expect(state.inserts).toHaveLength(0);
  });
  it("istniejący wiersz (powtórne approve) jest pomijany, nie dublowany; błąd insertu nie zostawia wiersza w połowie", async () => {
    state.existing[`marketing:${CAMP}:p1`] = { id: "old", state: "accepted" };
    const r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1", consent_source: "lista" }, { company_id: "c2", consent_source: "lista" }] });
    expect(r.body.approved).toBe(1); expect(r.body.skipped[0]).toMatchObject({ company_id: "c1", message_id: "old" });
    state.inserts.length = 0; state.failInsert = true;
    const r2 = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c2", consent_source: "lista" }] });
    expect(r2.status).toBe(500);
    expect(state.inserts).toHaveLength(1); // jedna próba, kompletna treść — nic „(rendering)”
    expect(state.inserts[0].subject).not.toBe("(rendering)");
  });
  it("bez sekretu wypisu nie da się zatwierdzić", async () => {
    state.env.marketingUnsubscribeSecret = "";
    const r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(500); expect(r.body.error).toBe("unsubscribe_secret_missing");
  });
  it("create waliduje szablon i nazwę; nie-admin → 403", async () => {
    expect((await call({ action: "create", name: "X", template_key: "sprzedaz" })).status).toBe(400);
    expect((await call({ action: "create", name: "", template_key: "start_with_credits" })).status).toBe(400);
    state.service.from = vi.fn(() => { const q = {}; for (const k of ["select", "eq"]) q[k] = () => q; q.maybeSingle = async () => ({ data: { role: "supplier", active: true } }); return q; });
    expect((await call({ action: "list" })).status).toBe(403);
  });
});
