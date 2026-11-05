// [feat/marketing-activation] Kampania: create tylko z grupą odbiorców, update_content (walidacja, tylko szkic, reset),
// approve = świeży odczyt, tylko kwalifikujący się DO GRUPY, JEDEN insert kompletnej wiadomości z treścią kampanii
// (id losowane przed zapisem → link wypisu), brak zgody → 422, istniejący wiersz → pominięty. Review Codexa #5.
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
import { DEFAULT_CONTENT, defaultContent } from "../netlify/functions/_shared/marketing-templates.js";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const req = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer fake" }, body: JSON.stringify(body) });
const call = async (body) => { const r = await handler(req(body)); return { status: r.statusCode, body: JSON.parse(r.body) }; };
const row = (over = {}) => ({ company_id: "c1", company_name: "Sad Kowalski", profile_id: "p1", email: "op@kowalski.test", locale: "pl", segment: "start_with_credits", template_key: "credits_no_proposal", base_ok: true, in_audience: true, audience_reason: "q_credits_available_no_history", eligible: true, exclusions: [], warnings: [], snapshot: { credits_remaining: 5, credits_available: 5, reserved: 0, expiring_credits: 5, nearest_expiry: "2026-12-27" }, ...over });

beforeEach(() => {
  state.env = { supabaseUrl: "https://fake.test", supabaseAnonKey: "anon", supabaseServiceRoleKey: "svc", b2bAppUrl: "https://b2b.test", marketingUnsubscribeSecret: "sekret" };
  state.user = { auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) } };
  state.campaign = { id: CAMP, status: "draft", template_key: "credits_no_proposal", content: {}, content_version: 1, frozen_content: null, reply_to: "preconnect@test.pl" };
  state.freezeRows = 1; state.failInsertAt = 0; state.failInsert = false;
  state.rows = [row(), row({ company_id: "c2", company_name: "Inna", profile_id: "p2", email: "inna@test.pl" })];
  state.inserts = []; state.updates = []; state.campaignInserts = []; state.existing = {};
  state.service = {
    rpc: vi.fn(),
    from: vi.fn((table) => {
      const q = { _f: [], _ins: null, _upd: null };
      for (const k of ["select", "order", "limit", "in", "neq"]) q[k] = () => q;
      q.eq = (c, v) => { q._f.push([c, v]); return q; };
      q.insert = (r) => { q._ins = r; return q; };
      q.update = (p) => { q._upd = p; return q; };
      q.maybeSingle = async () => {
        if (table === "profiles") return { data: { id: "admin", role: "admin", active: true, locale: "pl" }, error: null };
        if (table === "marketing_messages") { const key = q._f.find(([c]) => c === "idempotency_key")?.[1]; return { data: state.existing[key] || null, error: null }; }
        if (table === "marketing_campaigns" && q._ins) { state.campaignInserts.push(q._ins); return { data: { id: "new", ...q._ins }, error: null }; }
        if (table === "marketing_campaigns" && q._upd) {
          state.updates.push(q._upd);
          const ver = q._f.find(([c]) => c === "content_version")?.[1];
          if (state.freezeRows === 0 || (ver != null && ver !== state.campaign.content_version)) return { data: null, error: null }; // 0 wierszy = równoległa edycja / zamknięcie
          return { data: { ...state.campaign, ...q._upd }, error: null };
        }
        return { data: null, error: null };
      };
      q.then = (res, rej) => {
        if (q._ins && table === "marketing_messages") { state.inserts.push(q._ins); const n = state.inserts.length; const fail = state.failInsert || (state.failInsertAt && n === state.failInsertAt); return Promise.resolve({ data: null, error: fail ? { message: "db down" } : null }).then(res, rej); }
        if (q._upd && table === "marketing_campaigns") { state.updates.push(q._upd); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      };
      return q;
    }),
  };
});

describe("create / update_content", () => {
  it("create tylko z grupą odbiorców (stare klucze odrzucane), treść pusta = domyślna; zwraca default_content", async () => {
    const r = await call({ action: "create", name: "Listopad", template_key: "credits_expiring", reply_to: "A@B.pl" });
    expect(r.status).toBe(200);
    expect(state.campaignInserts[0]).toMatchObject({ name: "Listopad", template_key: "credits_expiring", content: {}, reply_to: "a@b.pl", created_by: "admin" });
    expect(state.campaignInserts[0]).not.toHaveProperty("target_categories");
    expect(r.body.default_content.pl.cta).toBe("Przygotuj propozycję");
    expect((await call({ action: "create", name: "X", template_key: "start_with_credits" })).status).toBe(400);
    expect((await call({ action: "create", name: "X", template_key: "sprzedaz" })).status).toBe(400);
    expect((await call({ action: "create", name: "", template_key: "credits_expiring" })).status).toBe(400);
  });
  it("update_content: walidacja bez HTML → 422 z listą; poprawna → zapis tylko 3 pól per język; {} = reset; poza szkicem → 409", async () => {
    const bad = { pl: { subject: "<b>x</b>", body: "ok", cta: "ok" }, en: { subject: "ok", body: "{{nope}}", cta: "ok" } };
    let r = await call({ action: "update_content", campaign_id: CAMP, content: bad });
    expect(r.status).toBe(422); expect(r.body.errors).toEqual(expect.arrayContaining(["pl.subject.html_not_allowed", "en.body.unknown_placeholder:nope"]));
    expect(state.updates).toHaveLength(0);
    const good = { pl: { subject: "T {{company}}", body: "B", cta: "C", extra: "x" }, en: { subject: "T", body: "B", cta: "C" } };
    r = await call({ action: "update_content", campaign_id: CAMP, content: good });
    expect(r.status).toBe(200);
    expect(state.updates[0].content).toEqual({ pl: { subject: "T {{company}}", body: "B", cta: "C" }, en: { subject: "T", body: "B", cta: "C" } });
    expect(state.updates[0].content_updated_by).toBe("admin");
    expect(state.updates[0].content_version).toBe(2); // wersja rośnie przy każdym zapisie
    r = await call({ action: "update_content", campaign_id: CAMP, content: {} });
    expect(r.status).toBe(200); expect(r.body.reset).toBe(true); expect(state.updates[1].content).toEqual({});
    state.campaign.status = "approved";
    r = await call({ action: "update_content", campaign_id: CAMP, content: good });
    expect(r.status).toBe(409); expect(r.body.error).toBe("content_frozen");
  });
});

describe("approve", () => {
  it("zapisuje KOMPLETNĄ wiadomość jednym insertem: id, zamrożona treść z linkiem wypisu dla TEGO id, hash, klucz, snapshot z nazwą firmy i powodem kwalifikacji", async () => {
    const r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "regulamin 1.0 — potwierdzone 4.11" }] });
    expect(r.status).toBe(200);
    expect(r.body.approved).toBe(1);
    expect(state.inserts).toHaveLength(1);
    const m = state.inserts[0];
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.state).toBe("pending");
    expect(m.payload_hash).toBe(payloadHash({ subject: m.subject, html: m.html, text: m.text_body }));
    expect(m.html).toContain(`marketing-unsubscribe?m=${m.id}&amp;t=`);
    expect(m.subject).toBe("Daj się poznać sieciom handlowym — masz 5 kredytów w PreConnect"); // {{credits}} = credits_available
    expect(m.idempotency_key).toBe(`marketing:${CAMP}:p1`);
    expect(m.consent_source).toBe("regulamin 1.0 — potwierdzone 4.11");
    expect(m.snapshot).toMatchObject({ company_name: "Sad Kowalski", snapshot_at: "2026-11-04T10:00:00Z", template_key: "credits_no_proposal", audience_reason: "q_credits_available_no_history", custom_content: false });
    // [P1 #2] zamrożenie PRZED wiadomościami: jedyny update kampanii, z frozen_content i wersją
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ status: "approved", snapshot_at: "2026-11-04T10:00:00Z", frozen_content_version: 1 });
    expect(state.updates[0].frozen_content).toEqual(defaultContent("credits_no_proposal")); // PEŁNA treść, nie {}
    expect(m.snapshot.content_version).toBe(1);
    expect(r.body.content_version).toBe(1);
  });
  it("własna treść kampanii trafia do zamrożonej wiadomości (temat i treść z edytora, stopka stała)", async () => {
    state.campaign.content = { pl: { subject: "Własny temat {{credits_n}}", body: "Własna treść {{company}}.", cta: "Idź" }, en: { subject: "Own", body: "Own body", cta: "Go" } };
    const r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(200);
    const m = state.inserts[0];
    expect(m.subject).toBe("Własny temat 5");
    expect(m.html).toContain("Własna treść Sad Kowalski.");
    expect(m.html).toContain("Wypisz się z informacji o PreConnect");
    expect(m.snapshot.custom_content).toBe(true);
    state.campaign.content = { pl: { subject: "<x>", body: "b", cta: "c" }, en: { subject: "s", body: "b", cta: "c" } };
    expect((await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] })).status).toBe(422);
  });
  it("brak źródła zgody → 422; poza grupą → 422 not_in_audience z powodem; wykluczony bazowo → not_eligible", async () => {
    let r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "" }] });
    expect(r.status).toBe(422); expect(r.body.problems[0].reason).toBe("consent_source_missing");
    state.rows[0] = row({ eligible: false, in_audience: false, audience_reason: "b_has_sends" });
    r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(422); expect(r.body.problems[0]).toMatchObject({ reason: "not_in_audience", audience_reason: "b_has_sends" });
    state.rows[0] = row({ eligible: false, base_ok: false, exclusions: ["suppressed"] });
    r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(422); expect(r.body.problems[0]).toMatchObject({ reason: "not_eligible", exclusions: ["suppressed"] });
    expect(state.inserts).toHaveLength(0);
  });
  it("istniejący wiersz (powtórne approve) jest pomijany, nie dublowany; błąd insertu nie zostawia wiersza w połowie", async () => {
    state.existing[`marketing:${CAMP}:p1`] = { id: "old", state: "accepted" };
    const r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }, { company_id: "c2", consent_source: "lista" }] });
    expect(r.body.approved).toBe(1); expect(r.body.skipped[0]).toMatchObject({ company_id: "c1", message_id: "old" });
    state.inserts.length = 0; state.failInsert = true;
    const r2 = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c2", consent_source: "lista" }] });
    expect(r2.status).toBe(500);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].subject).not.toBe("(rendering)");
  });
  it("bez sekretu wypisu nie da się zatwierdzić; nie-admin → 403", async () => {
    state.env.marketingUnsubscribeSecret = "";
    const r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(500); expect(r.body.error).toBe("unsubscribe_secret_missing");
    state.service.from = vi.fn(() => { const q = {}; for (const k of ["select", "eq"]) q[k] = () => q; q.maybeSingle = async () => ({ data: { role: "supplier", active: true } }); return q; });
    expect((await call({ action: "list" })).status).toBe(403);
  });
});

describe("[review Codexa P1] wersja treści i atomowe zamrożenie", () => {
  it("approve bez content_version → 400; z inną wersją niż w bazie (edycja w drugim oknie) → 409, zero zapisów", async () => {
    let r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(400); expect(r.body.error).toBe("content_version_required");
    state.campaign.content_version = 2;
    r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(409); expect(r.body).toMatchObject({ error: "content_version_mismatch", current: 2, sent: 1 });
    expect(state.inserts).toHaveLength(0); expect(state.updates).toHaveLength(0);
  });
  it("update_content z nieaktualną expected_version → 409 bez zapisu; równoległa edycja w trakcie approve (0 wierszy z warunkowego UPDATE) → 409 campaign_changed, zero wiadomości", async () => {
    const good = { pl: { subject: "T", body: "B", cta: "C" }, en: { subject: "T", body: "B", cta: "C" } };
    let r = await call({ action: "update_content", campaign_id: CAMP, content: good, expected_version: 7 });
    expect(r.status).toBe(409); expect(r.body.error).toBe("content_version_conflict"); expect(state.updates).toHaveLength(0);
    state.freezeRows = 0; // ktoś zapisał treść / zamknął kampanię między odczytem a zamrożeniem
    r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(409); expect(r.body.error).toBe("campaign_changed");
    expect(state.inserts).toHaveLength(0);
  });
  it("awaria drugiego zapisu → kampania już zatwierdzona z zamrożoną treścią → edycja 409 → ponowienie pomija pierwszą i tworzy drugą Z TEJ SAMEJ zamrożonej wersji", async () => {
    state.campaign.content = { pl: { subject: "WERSJA A {{credits_n}}", body: "A", cta: "A" }, en: { subject: "A", body: "A", cta: "A" } };
    state.failInsertAt = 2;
    let r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }, { company_id: "c2", consent_source: "lista" }] });
    expect(r.status).toBe(500);
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0].subject).toBe("WERSJA A 5");
    // zamrożenie nastąpiło PRZED wiadomościami — utrwalamy je jak baza
    expect(state.updates[0]).toMatchObject({ status: "approved", frozen_content_version: 1 });
    expect(state.updates[0].frozen_content.pl.subject).toBe("WERSJA A {{credits_n}}");
    state.campaign = { ...state.campaign, ...state.updates[0] };
    // próba edycji po awarii: treść zamrożona (status approved) → 409
    r = await call({ action: "update_content", campaign_id: CAMP, content: { pl: { subject: "WERSJA B", body: "B", cta: "B" }, en: { subject: "B", body: "B", cta: "B" } } });
    expect(r.status).toBe(409); expect(r.body.error).toBe("content_frozen");
    // nawet gdyby „content" zdryfował (np. ręczna zmiana w bazie), ponowienie renderuje z frozen_content
    state.campaign.content = { pl: { subject: "WERSJA B", body: "B", cta: "B" }, en: { subject: "B", body: "B", cta: "B" } };
    state.existing[`marketing:${CAMP}:p1`] = { id: "m1", state: "pending" };
    state.inserts.length = 0; state.failInsertAt = 0;
    r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }, { company_id: "c2", consent_source: "lista" }] });
    expect(r.status).toBe(200);
    expect(r.body.skipped[0]).toMatchObject({ company_id: "c1", message_id: "m1" });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].company_id).toBe("c2");
    expect(state.inserts[0].subject).toBe("WERSJA A 5"); // ta sama zamrożona wersja, nie B
    expect(state.inserts[0].snapshot.content_version).toBe(1);
    // ponowne zatwierdzenie nie zamraża drugi raz (frozen_content zostaje)
    expect(state.updates.at(-1)).not.toHaveProperty("frozen_content");
  });
});

describe("[review Codexa P1 #3] domyślny szablon jest zamrażany jako pełna treść", () => {
  it("domyślna kampania → zamrożenie pełnej treści → awaria drugiego zapisu → zmiana szablonu w kodzie → ponowienie: OBIE wiadomości mają pierwotny szablon", async () => {
    const orig = DEFAULT_CONTENT.credits_no_proposal.pl.subject;
    try {
      state.failInsertAt = 2;
      let r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }, { company_id: "c2", consent_source: "lista" }] });
      expect(r.status).toBe(500);
      const frozen = state.updates[0].frozen_content;
      expect(frozen.pl.subject).toBe(orig);
      expect(frozen.en.subject).toBe(DEFAULT_CONTENT.credits_no_proposal.en.subject);
      expect(Object.keys(frozen.pl).sort()).toEqual(["body", "cta", "subject"]);
      expect(state.inserts[0].subject).toBe("Daj się poznać sieciom handlowym — masz 5 kredytów w PreConnect");
      expect(state.inserts[0].snapshot.custom_content).toBe(false);
      state.campaign = { ...state.campaign, ...state.updates[0] };
      // „nowa wersja aplikacji" zmienia domyślny szablon w kodzie
      DEFAULT_CONTENT.credits_no_proposal.pl.subject = "NOWY SZABLON {{credits}} — nie może trafić do tej kampanii";
      state.existing[`marketing:${CAMP}:p1`] = { id: "m1", state: "pending" };
      state.inserts.length = 0; state.failInsertAt = 0;
      r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }, { company_id: "c2", consent_source: "lista" }] });
      expect(r.status).toBe(200);
      expect(state.inserts).toHaveLength(1);
      expect(state.inserts[0].company_id).toBe("c2");
      expect(state.inserts[0].subject).toBe("Daj się poznać sieciom handlowym — masz 5 kredytów w PreConnect"); // pierwotny szablon
      expect(state.inserts[0].html).not.toContain("NOWY SZABLON");
      expect(state.updates.at(-1)).not.toHaveProperty("frozen_content"); // nie zamraża drugi raz
    } finally {
      DEFAULT_CONTENT.credits_no_proposal.pl.subject = orig;
    }
  });
  it("stare zamrożenie {} (sprzed poprawki) jest traktowane jak brak zamrożenia i uzupełniane pełną treścią", async () => {
    state.campaign = { ...state.campaign, status: "approved", frozen_content: {}, frozen_content_version: 1 };
    const r = await call({ action: "approve", campaign_id: CAMP, content_version: 1, recipients: [{ company_id: "c1", consent_source: "lista" }] });
    expect(r.status).toBe(200);
    expect(state.updates[0].frozen_content).toEqual(defaultContent("credits_no_proposal"));
  });
});
