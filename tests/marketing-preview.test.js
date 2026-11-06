// [feat/marketing-activation][review Codexa P1 #3] Podgląd po zatwierdzeniu czyta ZAMROŻONĄ, kompletną treść
// kampanii (frozen_content) — zmiana domyślnego szablonu w kodzie nie zmienia podglądu zatwierdzonej kampanii.
// W szkicu: treść z edytora (body.content) > zapisana > domyślna.
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
import { handler } from "../netlify/functions/marketing-preview.js";
import { DEFAULT_CONTENT, defaultContent } from "../netlify/functions/_shared/marketing-templates.js";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const req = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer fake" }, body: JSON.stringify(body) });
const call = async (body) => { const r = await handler(req(body)); return { status: r.statusCode, body: JSON.parse(r.body) }; };

beforeEach(() => {
  state.env = { supabaseUrl: "https://fake.test", supabaseAnonKey: "anon", supabaseServiceRoleKey: "svc", b2bAppUrl: "https://b2b.test" };
  state.user = { auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) } };
  state.service = { from: () => { const q = {}; for (const k of ["select", "eq"]) q[k] = () => q; q.maybeSingle = async () => ({ data: { id: "admin", role: "admin", active: true }, error: null }); return q; } };
  state.rows = [{ company_id: "c1", company_name: "Sad Kowalski", profile_id: "p1", email: "op@kowalski.test", locale: "pl", segment: "start_with_credits", template_key: "credits_no_proposal", eligible: true, in_audience: true, base_ok: true, exclusions: [], warnings: [], snapshot: { credits_remaining: 5, credits_available: 5, reserved: 0, expiring_credits: 5, nearest_expiry: "2026-12-27" } }];
  state.campaign = { id: CAMP, status: "draft", template_key: "credits_no_proposal", content: {}, content_version: 1, frozen_content: null, reply_to: "preconnect@test.pl" };
});

describe("logo w podglądzie", () => {
  it("podgląd osadza logo jako data URI (ramka sandbox nie pobierze obrazka z localhost), bez adresu /brand/ w treści; układ 2 = zielone, układ 1 = białe", async () => {
    state.campaign = { ...state.campaign, layout_version: 2, photo_id: null, frozen_photo: null };
    let r = await call({ campaign_id: CAMP, company_id: "c1", locale: "pl" });
    expect(r.status).toBe(200); expect(r.body.logo_inline).toBe(true);
    expect(r.body.html.match(/src="data:image\/png;base64,/g)).toHaveLength(2); // nagłówek + stopka
    expect(r.body.html).not.toContain("/brand/fm-email-logo");
    state.campaign = { ...state.campaign, layout_version: 1 };
    r = await call({ campaign_id: CAMP, company_id: "c1", locale: "pl" });
    expect(r.status).toBe(200); expect(r.body.html.match(/src="data:image\/png;base64,/g)).toHaveLength(2);
  });
});

describe("podgląd a zamrożona treść", () => {
  it("zatwierdzona kampania: podgląd z frozen_content, nawet gdy domyślny szablon w kodzie się zmienił; szkic bez treści: domyślny", async () => {
    const orig = DEFAULT_CONTENT.credits_no_proposal.pl.subject;
    try {
      const frozen = defaultContent("credits_no_proposal");
      state.campaign = { ...state.campaign, status: "approved", frozen_content: frozen, frozen_content_version: 1 };
      DEFAULT_CONTENT.credits_no_proposal.pl.subject = "NOWY SZABLON {{credits}}";
      let r = await call({ campaign_id: CAMP, company_id: "c1", locale: "pl" });
      expect(r.status).toBe(200);
      expect(r.body.subject).toBe("Daj się poznać sieciom handlowym — masz 5 kredytów w PreConnect");
      expect(r.body.meta.customContent).toBe(true); // treść przekazana jawnie = zamrożona
      // szkic bez zapisanej treści → aktualny domyślny szablon (tu: zmieniony)
      state.campaign = { ...state.campaign, status: "draft", frozen_content: null };
      r = await call({ campaign_id: CAMP, company_id: "c1", locale: "pl" });
      expect(r.body.subject).toBe("NOWY SZABLON 5 kredytów");
    } finally {
      DEFAULT_CONTENT.credits_no_proposal.pl.subject = orig;
    }
  });
  it("szkic: treść z edytora (niezapisana) ma pierwszeństwo przed zapisaną; niepoprawna → 422", async () => {
    state.campaign.content = { pl: { subject: "ZAPISANA", body: "b", cta: "c" }, en: { subject: "s", body: "b", cta: "c" } };
    let r = await call({ campaign_id: CAMP, company_id: "c1", locale: "pl" });
    expect(r.body.subject).toBe("ZAPISANA");
    r = await call({ campaign_id: CAMP, company_id: "c1", locale: "pl", content: { pl: { subject: "Z EDYTORA {{credits_n}}", body: "b", cta: "c" }, en: { subject: "s", body: "b", cta: "c" } } });
    expect(r.body.subject).toBe("Z EDYTORA 5");
    r = await call({ campaign_id: CAMP, company_id: "c1", content: { pl: { subject: "<x>", body: "b", cta: "c" }, en: { subject: "s", body: "b", cta: "c" } } });
    expect(r.status).toBe(422); expect(r.body.error).toBe("content_invalid");
  });
});
