// [feat/marketing-photos] Kampania + zdjęcie: create = układ 2 ze zdjęciem z rotacji (albo bez, z ostrzeżeniem),
// set_photo tylko w szkicu / tylko ready / podbija content_version / warunkowo po wersji, approve zamraża frozen_photo
// (adres HTTPS, alt/podpis PL/EN) i renderuje wiadomości ze zdjęciem; zdjęcie wyłączone w międzyczasie = 409;
// ponowienie approve nie zmienia zamrożenia; get zwraca zdjęcie (zamrożone po zatwierdzeniu).
import { beforeEach, describe, it, expect, vi } from "vitest";

const state = vi.hoisted(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: (_url, key) => key === "anon" ? state.user : state.service }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => state.env,
  missingEnvNames: (cfg, keys) => keys.filter((k) => !cfg[k]), envErrorPayload: (fn, missing) => ({ error: "env", fn, missing }),
}));
vi.mock("../netlify/functions/_shared/marketing-data.js", () => ({
  loadCampaign: async () => state.campaign,
  computeCandidates: async () => ({ snapshot_at: "2026-11-06T10:00:00Z", today: "2026-11-06", rows: state.rows, summary: {} }),
}));
import { handler } from "../netlify/functions/marketing-campaign.js";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const URL1 = "https://fake.supabase.co/storage/v1/object/public/marketing-photos/photos/ph-1/v1-abc.jpg";
const req = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer fake" }, body: JSON.stringify(body) });
const call = async (body) => { const r = await handler(req(body)); return { status: r.statusCode, body: JSON.parse(r.body) }; };
const row = (over = {}) => ({ company_id: "c1", company_name: "Sad Kowalski", profile_id: "p1", email: "op@kowalski.test", locale: "pl", segment: "start_with_credits", template_key: "credits_no_proposal", base_ok: true, in_audience: true, audience_reason: "q_credits_available_no_history", eligible: true, exclusions: [], warnings: [], snapshot: { credits_remaining: 5, credits_available: 5, reserved: 0, expiring_credits: 5, nearest_expiry: "2026-12-27" }, ...over });
const photoRow = (id, over = {}) => ({ id, title: "Rozmowy " + id, alt_pl: "Rozmowy przy stoliku", alt_en: "Table talks", caption_pl: "Zdjęcie archiwalne 2026", caption_en: "Archive photo 2026", kind: "authentic", year: 2026, status: "ready", current_version_id: "v-" + id, created_at: "2026-11-06T10:00:00Z", ...over });
const versionRow = (id) => ({ id: "v-" + id, photo_id: id, version_no: 1, public_url: URL1.replace("ph-1", id), width: 1200, height: 800, sha256: "s".repeat(64) });

beforeEach(() => {
  state.env = { supabaseUrl: "https://fake.supabase.co", supabaseAnonKey: "anon", supabaseServiceRoleKey: "svc", b2bAppUrl: "https://b2b.test", marketingUnsubscribeSecret: "sekret" };
  state.user = { auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) } };
  state.campaign = { id: CAMP, status: "draft", template_key: "credits_no_proposal", content: {}, content_version: 1, frozen_content: null, frozen_photo: null, layout_version: 2, photo_id: "ph-1", photo_version_id: "v-ph-1", reply_to: "preconnect@test.pl" };
  state.photos = [photoRow("ph-1"), photoRow("ph-2")]; state.versions = [versionRow("ph-1"), versionRow("ph-2")]; state.usage = [];
  state.rows = [row(), row({ company_id: "c2", company_name: "Inna", profile_id: "p2", email: "inna@test.pl", locale: "en" })];
  state.inserts = []; state.updates = []; state.campaignInserts = []; state.existing = {};
  state.service = {
    rpc: vi.fn(),
    from: vi.fn((table) => {
      const q = { _f: [], _ins: null, _upd: null };
      for (const k of ["select", "order", "limit", "in", "neq", "not"]) q[k] = () => q;
      q.eq = (c, v) => { q._f.push([c, v]); return q; };
      q.insert = (r) => { q._ins = r; return q; };
      q.update = (p) => { q._upd = p; return q; };
      const rows = () => table === "marketing_photos" ? state.photos : table === "marketing_photo_versions" ? state.versions : table === "marketing_photo_usage" ? state.usage : [];
      q.maybeSingle = async () => {
        if (table === "profiles") return { data: { id: "admin", role: "admin", active: true, locale: "pl" }, error: null };
        if (table === "marketing_photos" || table === "marketing_photo_versions") { const id = q._f.find(([c]) => c === "id")?.[1]; return { data: rows().find((r) => r.id === id) || null, error: null }; }
        if (table === "marketing_messages") { const key = q._f.find(([c]) => c === "idempotency_key")?.[1]; return { data: state.existing[key] || null, error: null }; }
        if (table === "marketing_campaigns" && q._ins) { state.campaignInserts.push(q._ins); return { data: { id: "new", content_version: 1, status: "draft", ...q._ins }, error: null }; }
        if (table === "marketing_campaigns" && q._upd) {
          state.updates.push({ patch: q._upd, filters: q._f });
          const ver = q._f.find(([c]) => c === "content_version")?.[1];
          if (ver != null && ver !== state.campaign.content_version) return { data: null, error: null };
          state.campaign = { ...state.campaign, ...q._upd };
          return { data: { ...state.campaign }, error: null };
        }
        return { data: null, error: null };
      };
      q.then = (res, rej) => {
        if (q._ins && table === "marketing_messages") { state.inserts.push(q._ins); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        let data = rows(); for (const [c, v] of q._f) data = data.filter((r) => String(r[c]) === String(v));
        return Promise.resolve({ data: [...data], error: null }).then(res, rej);
      };
      return q;
    }),
  };
});

describe("create", () => {
  it("nowa kampania: layout_version 2, zdjęcie z rotacji (nigdy niewysłane, najstarsze) + wersja; default_content w układzie 2; odpowiedź ze zdjęciem i powodem", async () => {
    const r = await call({ action: "create", template_key: "credits_no_proposal", reply_to: "a@b.pl" });
    expect(r.status).toBe(200);
    expect(state.campaignInserts[0]).toMatchObject({ layout_version: 2, photo_id: "ph-1", photo_version_id: "v-ph-1", content: {} });
    expect(r.body.default_content.pl.body).not.toContain("PreConnect pomaga zrobić pierwszy krok"); // krótka treść układu 2
    expect(r.body.photo).toMatchObject({ photo_id: "ph-1", version_id: "v-ph-1", url: URL1, alt_pl: "Rozmowy przy stoliku", frozen: false });
    expect(r.body.photo_pick).toMatchObject({ reason: "never_sent", photo_id: "ph-1", pool: 2, warnings: ["pool_small"] });
  });
  it("brak gotowych zdjęć: kampania bez zdjęcia (photo_id null) + ostrzeżenie no_ready_photos — nie blokuje tworzenia", async () => {
    state.photos = [photoRow("ph-1", { status: "pending" })];
    const r = await call({ action: "create", template_key: "selected_companies", name: "Ręczna" });
    expect(r.status).toBe(200);
    expect(state.campaignInserts[0]).toMatchObject({ layout_version: 2, photo_id: null, photo_version_id: null });
    expect(r.body.photo).toBeNull(); expect(r.body.photo_pick.reason).toBe("no_ready_photos");
  });
});

describe("set_photo", () => {
  it("wybór ready → photo_id + konkretna wersja, content_version +1 (warunkowo po wersji); zły expected_version → 409", async () => {
    let r = await call({ action: "set_photo", campaign_id: CAMP, photo_id: "ph-2", expected_version: 1 });
    expect(r.status).toBe(200);
    expect(state.updates[0].patch).toMatchObject({ photo_id: "ph-2", photo_version_id: "v-ph-2", content_version: 2, content_updated_by: "admin" });
    expect(state.updates[0].filters).toEqual(expect.arrayContaining([["status", "draft"], ["content_version", 1]]));
    expect(r.body.campaign.content_version).toBe(2); expect(r.body.photo.photo_id).toBe("ph-2");
    r = await call({ action: "set_photo", campaign_id: CAMP, photo_id: "ph-1", expected_version: 1 });
    expect(r.status).toBe(409); expect(r.body.error).toBe("content_version_conflict");
  });
  it("auto → propozycja z rotacji omija zdjęcie innej otwartej kampanii; null → świadomie bez zdjęcia; pending → 409; nieznane → 404", async () => {
    state.usage = [{ photo_id: "ph-1", campaign_id: "other", campaign_status: "draft", sent_count: 0 }];
    let r = await call({ action: "set_photo", campaign_id: CAMP, auto: true });
    expect(r.status).toBe(200); expect(r.body.campaign.photo_id).toBe("ph-2"); expect(r.body.photo_pick.reason).toBe("never_sent");
    r = await call({ action: "set_photo", campaign_id: CAMP, photo_id: null });
    expect(r.status).toBe(200); expect(r.body.campaign.photo_id).toBeNull(); expect(r.body.photo).toBeNull();
    state.photos[1].status = "pending";
    r = await call({ action: "set_photo", campaign_id: CAMP, photo_id: "ph-2" }); expect(r.status).toBe(409); expect(r.body.error).toBe("photo_not_ready");
    r = await call({ action: "set_photo", campaign_id: CAMP, photo_id: "nie-ma" }); expect(r.status).toBe(404);
  });
  it("po zatwierdzeniu → 409 photo_frozen; układ 1 → 409 layout_without_photo", async () => {
    state.campaign.status = "approved";
    let r = await call({ action: "set_photo", campaign_id: CAMP, photo_id: "ph-2" }); expect(r.status).toBe(409); expect(r.body.error).toBe("photo_frozen");
    state.campaign.status = "draft"; state.campaign.layout_version = 1;
    r = await call({ action: "set_photo", campaign_id: CAMP, photo_id: "ph-2" }); expect(r.status).toBe(409); expect(r.body.error).toBe("layout_without_photo");
  });
});

describe("approve — zamrożenie zdjęcia", () => {
  it("pierwsze zamrożenie zapisuje frozen_photo (HTTPS, alt/podpis PL/EN, wersja) obok frozen_content układu 2; wiadomości PL/EN renderowane ze zdjęciem i krótką treścią; snapshot ma photo_version_id", async () => {
    const r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1" }, { company_id: "c2" }], content_version: 1 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.approved).toBe(2); expect(r.body.layout_version).toBe(2); expect(r.body.photo).toEqual({ photo_id: "ph-1", version_id: "v-ph-1", url: URL1 });
    const freeze = state.updates[0].patch;
    expect(freeze.frozen_photo).toMatchObject({ photo_id: "ph-1", version_id: "v-ph-1", version_no: 1, url: URL1, width: 1200, height: 800, alt_pl: "Rozmowy przy stoliku", alt_en: "Table talks", caption_pl: "Zdjęcie archiwalne 2026", caption_en: "Archive photo 2026" });
    expect(freeze.frozen_content.pl.body).not.toContain("PreConnect pomaga zrobić pierwszy krok"); // treść układu 2
    expect(state.inserts).toHaveLength(2);
    const pl = state.inserts.find((m) => m.locale === "pl"), en = state.inserts.find((m) => m.locale === "en");
    expect(pl.html).toContain(`src="${URL1}"`); expect(pl.html).toContain('alt="Rozmowy przy stoliku"'); expect(pl.html).toContain("Zdjęcie archiwalne 2026");
    expect(en.html).toContain('alt="Table talks"'); expect(en.html).toContain("Archive photo 2026"); expect(en.html).toContain("The first step towards a new retail chain.");
    expect(pl.html).toContain("fm-email-logo-green.png"); expect(pl.html).not.toContain("linear-gradient");
    expect(pl.snapshot).toMatchObject({ layout_version: 2, photo_id: "ph-1", photo_version_id: "v-ph-1" });
  });
  it("zdjęcie wyłączone w międzyczasie → 409 photo_not_ready, nic nie zamrożone, 0 wiadomości; zdjęcie bez pliku → 409 photo_missing", async () => {
    state.photos[0].status = "disabled";
    let r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1" }], content_version: 1 });
    expect(r.status).toBe(409); expect(r.body.error).toBe("photo_not_ready"); expect(state.updates).toHaveLength(0); expect(state.inserts).toHaveLength(0);
    state.photos[0].status = "ready"; state.versions = [];
    r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1" }], content_version: 1 });
    expect(r.status).toBe(409); expect(r.body.error).toBe("photo_missing"); expect(state.inserts).toHaveLength(0);
  });
  it("kampania układu 2 bez zdjęcia (świadomie): zamraża frozen_photo = null i renderuje bez bloku zdjęcia", async () => {
    state.campaign.photo_id = null; state.campaign.photo_version_id = null;
    const r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1" }], content_version: 1 });
    expect(r.status).toBe(200); expect(r.body.photo).toBeNull();
    expect(state.updates[0].patch.frozen_photo).toBeNull();
    expect(state.inserts[0].html.match(/<img /g)).toHaveLength(2);
  });
  it("ponowne approve (dopisanie adresata) nie zmienia zamrożenia i renderuje z ZAMROŻONEGO zdjęcia, nawet gdy biblioteka wskazuje już inną wersję / zdjęcie wyłączone", async () => {
    const first = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1" }], content_version: 1 });
    expect(first.status).toBe(200);
    state.existing[`marketing:${CAMP}:p1`] = { id: "m1", state: "pending" };
    state.photos[0].status = "disabled"; state.photos[0].current_version_id = "v-nowa"; state.photos[0].alt_pl = "ZMIENIONY ALT";
    const second = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1" }, { company_id: "c2" }], content_version: 1 });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.approved).toBe(1); expect(second.body.skipped).toHaveLength(1);
    expect(state.updates[1].patch).toEqual({ status: "approved", snapshot_at: "2026-11-06T10:00:00Z" }); // bez ponownego zamrożenia
    const en = state.inserts[1];
    expect(en.html).toContain(`src="${URL1}"`); expect(en.html).not.toContain("ZMIENIONY ALT"); expect(en.html).toContain('alt="Table talks"');
  });
  it("stara kampania układu 1 zatwierdza się jak dotąd (bez zdjęcia, długa treść, ciemny nagłówek)", async () => {
    state.campaign = { ...state.campaign, layout_version: 1, photo_id: null, photo_version_id: null };
    const r = await call({ action: "approve", campaign_id: CAMP, recipients: [{ company_id: "c1" }], content_version: 1 });
    expect(r.status).toBe(200); expect(r.body.layout_version).toBe(1); expect(r.body.photo).toBeNull();
    expect(state.updates[0].patch.frozen_content.pl.body).toContain("PreConnect pomaga zrobić pierwszy krok");
    expect(state.inserts[0].html).toContain("linear-gradient");
  });
});

describe("get", () => {
  it("szkic: zdjęcie z wyboru (frozen=false); po zatwierdzeniu: zamrożone (frozen=true) niezależnie od biblioteki; default_content w układzie kampanii", async () => {
    let r = await call({ action: "get", campaign_id: CAMP });
    expect(r.status).toBe(200); expect(r.body.photo).toMatchObject({ photo_id: "ph-1", url: URL1, frozen: false, status: "ready" });
    expect(r.body.default_content.pl.body).not.toContain("PreConnect pomaga zrobić pierwszy krok");
    state.campaign.status = "approved"; state.campaign.frozen_photo = { photo_id: "ph-1", version_id: "v-ph-1", url: URL1, alt_pl: "Zamrożony", alt_en: "Frozen" };
    state.photos[0].alt_pl = "INNY";
    r = await call({ action: "get", campaign_id: CAMP });
    expect(r.body.photo).toMatchObject({ frozen: true, alt_pl: "Zamrożony" });
    state.campaign.layout_version = 1; state.campaign.frozen_photo = null; state.campaign.photo_id = null;
    r = await call({ action: "get", campaign_id: CAMP });
    expect(r.body.photo).toBeNull(); expect(r.body.default_content.pl.body).toContain("PreConnect pomaga zrobić pierwszy krok");
  });
});
