// [feat/marketing-activation] Router webhooka: zdarzenie z tagiem kind=marketing idzie do
// rejestru marketingowego; bez tagu — stara ścieżka bez zmian. Odbicie → suppresja.
// Krytyczna regresja: zdarzenie marketingowe NIGDY nie woła ingest/mark_legacy_send_seen.
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const state = vi.hoisted(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.supa }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => ({ supabaseUrl: "https://fake.test", supabaseServiceRoleKey: "svc", resendWebhookSecret: "whsec_" + Buffer.from("tajne").toString("base64"), resendApiKey: "fake", b2bAppUrl: "https://fake.test" }),
  missingEnvNames: () => [], envErrorPayload: () => ({}),
}));
vi.mock("../netlify/functions/_shared/supplier-read-notify.js", () => ({ notifySupplierOffersRead: vi.fn(async () => ({ ok: true, status: "sent", notifications: [] })) }));
import { handler } from "../netlify/functions/resend-webhook.js";
import { isMarketingEvent } from "../netlify/functions/_shared/marketing-events.js";

function signed(body, id = "evt-1") {
  const raw = JSON.stringify(body); const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", Buffer.from("tajne")).update(`${id}.${ts}.${raw}`).digest("base64");
  return { httpMethod: "POST", headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": "v1," + sig }, body: raw };
}

beforeEach(() => {
  state.calls = [];
  state.supa = {
    rpc: vi.fn(async (name, args) => {
      state.calls.push([name, args]);
      if (name === "marketing_ingest_email_event") return state.failMarketing ? { data: null, error: { message: "no function" } } : { data: { duplicate: false, status: "processed", suppressed: args.p_event_type === "email.bounced" }, error: null };
      if (name === "ingest_legacy_send_email_event") return { data: { duplicate: false, status: "orphan" }, error: null };
      if (name === "finish_legacy_send_email_event") return { data: null, error: null };
      return { data: null, error: null };
    }),
    from: vi.fn(() => { const q = {}; for (const k of ["select", "eq", "in", "contains", "limit"]) q[k] = () => q; q.maybeSingle = async () => ({ data: null, error: null }); q.then = (r) => Promise.resolve({ data: [], error: null }).then(r); return q; }),
  };
  state.failMarketing = false;
});

const mk = (type, tags, extra = {}) => ({ type, created_at: "2026-11-04T10:00:00.000Z", data: { email_id: "resend-m1", to: ["op@test.pl"], tags, ...extra } });

describe("rozpoznanie tagu", () => {
  it("tablica tagów lub obiekt; brak/inny tag = nie marketing", () => {
    expect(isMarketingEvent({ data: { tags: [{ name: "kind", value: "marketing" }] } })).toBe(true);
    expect(isMarketingEvent({ data: { tags: { kind: "marketing" } } })).toBe(true);
    expect(isMarketingEvent({ data: { tags: [{ name: "fm2026", value: "x" }] } })).toBe(false);
    expect(isMarketingEvent({ data: {} })).toBe(false);
    expect(isMarketingEvent(null)).toBe(false);
  });
});

describe("routing", () => {
  it("email.opened z tagiem marketing → rejestr marketingowy, ZERO wywołań ingest/rozliczeń legacy", async () => {
    const r = await handler(signed(mk("email.opened", [{ name: "kind", value: "marketing" }])));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, marketing: true });
    const names = state.calls.map(([n]) => n);
    expect(names).toEqual(["marketing_ingest_email_event"]);
    expect(names).not.toContain("ingest_legacy_send_email_event");
    expect(names).not.toContain("mark_legacy_send_seen");
    expect(state.calls[0][1]).toMatchObject({ p_event_id: "evt-1", p_resend_message_id: "resend-m1", p_event_type: "email.opened" });
  });
  it("email.bounced z tagiem → suppresja zgłoszona w odpowiedzi", async () => {
    const r = await handler(signed(mk("email.bounced", [{ name: "kind", value: "marketing" }], { bounce: { message: "550" } })));
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, marketing: true });
    expect(state.calls[0][0]).toBe("marketing_ingest_email_event");
  });
  it("bez tagu → stara ścieżka (ingest legacy), marketing nietknięty", async () => {
    const r = await handler(signed(mk("email.opened", undefined)));
    expect(r.statusCode).toBe(200);
    const names = state.calls.map(([n]) => n);
    expect(names).toContain("ingest_legacy_send_email_event");
    expect(names).not.toContain("marketing_ingest_email_event");
  });
  it("inny tag (fm2026) → stara ścieżka", async () => {
    await handler(signed(mk("email.delivered", [{ name: "fm2026", value: "plan" }])));
    expect(state.calls.map(([n]) => n)).toContain("ingest_legacy_send_email_event");
    expect(state.calls.map(([n]) => n)).not.toContain("marketing_ingest_email_event");
  });
  it("moduł cofnięty (brak RPC) → 200 ignored, bez 500, legacy nietknięte", async () => {
    state.failMarketing = true;
    const r = await handler(signed(mk("email.opened", [{ name: "kind", value: "marketing" }])));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ignored: "marketing_ingest_failed" });
    expect(state.calls.map(([n]) => n)).not.toContain("ingest_legacy_send_email_event");
  });
});
