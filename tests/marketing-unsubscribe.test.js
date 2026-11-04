// [feat/marketing-activation] Wypis bez logowania: token HMAC po id wiadomości, adres z
// wiersza (nie z parametru), one-click POST, strona potwierdzenia, zły token → 400.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.supa }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => state.env,
  missingEnvNames: (cfg, keys) => keys.filter((k) => !cfg[k]), envErrorPayload: () => ({}),
}));
import { handler } from "../netlify/functions/marketing-unsubscribe.js";
import { unsubscribeToken } from "../netlify/functions/_shared/marketing-mailer.js";

const MSG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeEach(() => {
  state.env = { supabaseUrl: "https://fake.test", supabaseServiceRoleKey: "svc", marketingUnsubscribeSecret: "sekret" };
  state.suppressed = [];
  state.supa = {
    from: vi.fn(() => { const q = {}; for (const k of ["select", "eq"]) q[k] = () => q; q.maybeSingle = async () => ({ data: { id: MSG, to_email: "Op@Test.pl", locale: "pl", campaign_id: "camp", profile_id: "p1" }, error: null }); return q; }),
    rpc: vi.fn(async (name, args) => { state.suppressed.push([name, args]); return { data: { ok: true, email: "op@test.pl" }, error: null }; }),
  };
});
const ev = (method, qs, body = "") => ({ httpMethod: method, queryStringParameters: qs, body });

describe("wypis", () => {
  it("GET z poprawnym tokenem → strona potwierdzenia bez adresu e-mail; nic nie zapisuje", async () => {
    const r = await handler(ev("GET", { m: MSG, t: unsubscribeToken("sekret", MSG) }));
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Wypisz mnie");
    expect(r.body).not.toContain("op@test.pl");
    expect(state.suppressed).toEqual([]);
  });
  it("POST ze strony → suppresja z adresem z wiersza (lower), źródło page", async () => {
    const r = await handler(ev("POST", { m: MSG, t: unsubscribeToken("sekret", MSG) }, ""));
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Wypisano");
    expect(state.suppressed[0]).toEqual(["marketing_suppress_email", { p_email: "Op@Test.pl", p_reason: "unsubscribe", p_source: "page", p_campaign_id: "camp", p_profile_id: "p1" }]);
  });
  it("one-click (RFC 8058) → 200 text/plain, źródło one-click", async () => {
    const r = await handler(ev("POST", { m: MSG, t: unsubscribeToken("sekret", MSG) }, "List-Unsubscribe=One-Click"));
    expect(r.statusCode).toBe(200);
    expect(r.headers["Content-Type"]).toMatch(/text\/plain/);
    expect(state.suppressed[0][1].p_source).toBe("one-click");
  });
  it("zły token / zły id / inny sekret → 400 i brak zapisu", async () => {
    expect((await handler(ev("POST", { m: MSG, t: "zly" }))).statusCode).toBe(400);
    expect((await handler(ev("POST", { m: "nie-uuid", t: unsubscribeToken("sekret", "nie-uuid") }))).statusCode).toBe(400);
    expect((await handler(ev("POST", { m: MSG, t: unsubscribeToken("inny", MSG) }))).statusCode).toBe(400);
    expect(state.suppressed).toEqual([]);
  });
  it("brak sekretu w env → 500 (bez wycieku, bez zapisu)", async () => {
    state.env.marketingUnsubscribeSecret = "";
    expect((await handler(ev("POST", { m: MSG, t: "x" }))).statusCode).toBe(500);
    expect(state.suppressed).toEqual([]);
  });
});
