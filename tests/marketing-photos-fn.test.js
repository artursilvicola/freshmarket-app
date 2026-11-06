// [feat/marketing-photos] Funkcja marketing-photos: wgranie (prawdziwy format/wymiary/rozmiar z bajtów, duplikaty
// oryginału/pliku/kadru, plik nigdy nie nadpisywany, nowa wersja = nowa ścieżka, status pending), zatwierdzenie,
// wyłączenie (bez kasowania), metadane bez HTML, propozycja z rotacji, lista z użyciem i ostrzeżeniem o puli.
// Review Codexa P1/P2: upload trafia do PRYWATNEGO bucketa (bez adresu), publikacja dopiero przy zatwierdzeniu KONKRETNEJ
// wersji (kopia pod niezmienny adres, sha256 sprawdzony); nowy kadr nie dziedziczy zatwierdzenia poprzedniego.
import { beforeEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { jpegHeader } from "./fixtures/image-headers.js";

const state = vi.hoisted(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: (_url, key) => key === "anon" ? state.user : state.service }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => state.env,
  missingEnvNames: (cfg, keys) => keys.filter((k) => !cfg[k]), envErrorPayload: (fn, missing) => ({ error: "env", fn, missing }),
}));
import { handler } from "../netlify/functions/marketing-photos.js";

const req = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer fake" }, body: JSON.stringify(body) });
const call = async (body) => { const r = await handler(req(body)); return { status: r.statusCode, body: JSON.parse(r.body) }; };
const META = { title: "Rozmowy B2B 2026", alt_pl: "Rozmowy przy stoliku", alt_en: "Talks at a table", caption_pl: "Zdjęcie archiwalne 2026", kind: "authentic", source: "Drive 2026/0131", rights: "KJOW", categories: ["rozmowy B2B"], year: 2026 };
const b64 = (buf) => buf.toString("base64");

beforeEach(() => {
  state.env = { supabaseUrl: "https://fake.supabase.co", supabaseAnonKey: "anon", supabaseServiceRoleKey: "svc", b2bAppUrl: "https://b2b.test" };
  state.user = { auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) } };
  state.photos = []; state.versions = []; state.usage = []; state.uploads = []; state.updates = []; state.objects = {}; state.removed = []; state.signed = []; state.failPhotoUpdateOnce = false;
  let seq = 0;
  state.service = {
    storage: { from: (bucket) => ({
      upload: async (path, bytes, opts) => { const k = bucket + "/" + path; state.uploads.push({ bucket, path, bytes: bytes.length, opts }); if (state.objects[k]) return { error: { message: "The resource already exists" } }; state.objects[k] = Buffer.from(bytes); return { data: { path }, error: null }; },
      download: async (path) => { const b = state.objects[bucket + "/" + path]; return b ? { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null } : { data: null, error: { message: "Object not found" } }; },
      createSignedUrls: async (paths, ttl) => { state.signed.push({ bucket, paths, ttl }); return { data: paths.map((p) => ({ path: p, signedUrl: `https://fake.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=SIGNED`, error: null })), error: null }; },
      remove: async (paths) => { for (const p of paths) { state.removed.push(bucket + "/" + p); delete state.objects[bucket + "/" + p]; } return { data: [], error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    }) },
    from: vi.fn((table) => {
      const q = { _f: [], _ins: null, _upd: null };
      for (const k of ["select", "order", "limit", "in", "neq", "not"]) q[k] = () => q;
      q.eq = (c, v) => { q._f.push([c, v]); return q; };
      q.is = (c, v) => { q._is = [c, v]; return q; };
      q.insert = (r) => { q._ins = r; return q; };
      q.update = (p) => { q._upd = p; return q; };
      const rows = () => table === "marketing_photos" ? state.photos : table === "marketing_photo_versions" ? state.versions : table === "marketing_photo_usage" ? state.usage : [];
      q.maybeSingle = async () => {
        if (table === "profiles") return { data: { id: "admin", role: "admin", active: true }, error: null };
        if (q._ins) { const row = { id: `${table}-${++seq}`, created_at: new Date(2026, 10, 6, 10, seq).toISOString(), ...q._ins }; rows().push(row); return { data: row, error: null }; }
        if (q._upd) { if (table === "marketing_photos" && state.failPhotoUpdateOnce) { state.failPhotoUpdateOnce = false; return { data: null, error: { message: "connection reset" } }; } const id = q._f.find(([c]) => c === "id")?.[1]; const row = rows().find((r) => r.id === id); if (!row) return { data: null, error: null }; if (q._is && (row[q._is[0]] ?? null) !== q._is[1]) return { data: null, error: null }; Object.assign(row, q._upd); state.updates.push({ table, id, patch: q._upd }); return { data: { ...row }, error: null }; }
        const id = q._f.find(([c]) => c === "id")?.[1]; return { data: rows().find((r) => r.id === id) || null, error: null };
      };
      q.then = (res, rej) => { let data = rows(); for (const [c, v] of q._f) data = data.filter((r) => String(r[c]) === String(v)); return Promise.resolve({ data: [...data], error: null }).then(res, rej); };
      return q;
    }),
  };
});

describe("upload", () => {
  it("[P1] poprawny JPEG 1200×800 → plik TYLKO w prywatnym buckecie (upsert false), wersja 1 bez public_url, zdjęcie pending bez approved_version_id", async () => {
    const r = await call({ action: "upload", ...META, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 80_000)), source_sha256: "a".repeat(64), dhash: "0".repeat(64), source_name: "0131.jpg", source_bytes: 5_000_000 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.new_photo).toBe(true); expect(r.body.awaiting_approval).toBe(true);
    expect(r.body.photo).toMatchObject({ status: "pending", title: META.title, alt_en: META.alt_en, source_sha256: "a".repeat(64), dhash: "0".repeat(64), year: 2026, categories: ["rozmowy B2B"] });
    expect(r.body.photo.current_version_id).toBe(r.body.version.id);
    expect(r.body.photo.approved_version_id ?? null).toBeNull();
    expect(r.body.version).toMatchObject({ version_no: 1, mime: "image/jpeg", width: 1200, height: 800, storage_bucket: "marketing-photos-pending", public_url: null });
    expect(r.body.version.published_at ?? null).toBeNull();
    expect(r.body.version.storage_path).toMatch(/^photos\/marketing_photos-1\/v1-[0-9a-f]{12}\.jpg$/);
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]).toMatchObject({ bucket: "marketing-photos-pending", opts: { contentType: "image/jpeg", cacheControl: "31536000", upsert: false } });
    expect(Object.keys(state.objects).filter((k) => k.startsWith("marketing-photos/"))).toHaveLength(0); // nic w publicznym
    expect(r.body.source).toMatchObject({ sha256: "a".repeat(64), name: "0131.jpg", bytes: 5_000_000 });
  });
  it("[P1] zatwierdzenie wersji publikuje plik pod TĄ SAMĄ ścieżką w publicznym buckecie (sha256 zweryfikowany), ustawia public_url/published_at i approved_version_id, usuwa kopię prywatną", async () => {
    const up = await call({ action: "upload", ...META, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 80_000)) });
    const r = await call({ action: "approve", photo_id: up.body.photo.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.published).toBe(true);
    expect(r.body.photo).toMatchObject({ status: "ready", approved_version_id: up.body.version.id, approved_by: "admin" });
    expect(r.body.version).toMatchObject({ id: up.body.version.id, storage_bucket: "marketing-photos", public_url: `https://fake.supabase.co/storage/v1/object/public/marketing-photos/${up.body.version.storage_path}`, published_by: "admin" });
    expect(r.body.version.published_at).toBeTruthy();
    expect(state.objects["marketing-photos/" + up.body.version.storage_path]).toBeTruthy();
    expect(state.removed).toEqual(["marketing-photos-pending/" + up.body.version.storage_path]);
    // drugi approve tej samej wersji → 409; zatwierdzenie zdjęcia bez pliku → 409
    expect((await call({ action: "approve", photo_id: up.body.photo.id })).body.error).toBe("version_already_approved");
    // niezgodny sha256 bajtów (plik podmieniony w prywatnym buckecie) → publikacja zatrzymana, nic nie opublikowane
    const up2 = await call({ action: "upload", ...META, title: "Drugi", mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 70_000)), source_sha256: "b".repeat(64) });
    state.objects["marketing-photos-pending/" + up2.body.version.storage_path] = Buffer.from(jpegHeader(1200, 800, 71_000));
    const bad = await call({ action: "approve", photo_id: up2.body.photo.id });
    expect(bad.status).toBe(500); expect(bad.body.detail).toMatch(/sha256 mismatch/);
    expect(state.objects["marketing-photos/" + up2.body.version.storage_path]).toBeUndefined();
    expect(state.photos[1].status).toBe("pending"); expect(state.photos[1].approved_version_id ?? null).toBeNull();
  });
  it("deklaracja PNG a bajty JPEG → 422 format_mismatch; za duży → 422; HTML zamiast obrazu → 422; nieznany mime → 415; brak alt → 422; HTML w tytule → 422", async () => {
    const base = { action: "upload", ...META, mime: "image/png", data_base64: b64(jpegHeader(1200, 800)) };
    let r = await call(base); expect(r.status).toBe(422); expect(r.body.errors).toContain("format_mismatch");
    r = await call({ ...base, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 400_000)) }); expect(r.status).toBe(422); expect(r.body.errors).toContain("too_large");
    r = await call({ ...base, mime: "image/jpeg", data_base64: b64(Buffer.from("<html>".padEnd(3000, "x"))) }); expect(r.status).toBe(422); expect(r.body.errors).toEqual(["format_unrecognized"]);
    r = await call({ ...base, mime: "image/gif" }); expect(r.status).toBe(415);
    r = await call({ ...base, mime: "image/jpeg", alt_en: "" }); expect(r.status).toBe(422); expect(r.body.errors).toContain("alt_en_required");
    r = await call({ ...base, mime: "image/jpeg", title: "<b>x</b>" }); expect(r.status).toBe(422); expect(r.body.errors).toContain("title_html_not_allowed");
    expect(state.uploads).toHaveLength(0);
    expect(state.photos).toHaveLength(0);
  });
  it("duplikat oryginału (source_sha256) → 409; ten sam plik → 409; bliźniaczy kadr (dHash ≤ 6) → 409 similar_exists, allow_similar przepuszcza", async () => {
    const first = await call({ action: "upload", ...META, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 50_000)), source_sha256: "a".repeat(64), dhash: "0".repeat(64) });
    expect(first.status).toBe(200);
    let r = await call({ action: "upload", ...META, title: "Inny tytuł", mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 60_000)), source_sha256: "a".repeat(64) });
    expect(r.status).toBe(409); expect(r.body.error).toBe("duplicate_source"); expect(r.body.photo_id).toBe(first.body.photo.id);
    r = await call({ action: "upload", ...META, title: "Ten sam plik", mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 50_000)), source_sha256: "b".repeat(64) });
    expect(r.status).toBe(409); expect(r.body.error).toBe("duplicate_file");
    r = await call({ action: "upload", ...META, title: "Bliźniak", mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 801, 50_000)), source_sha256: "c".repeat(64), dhash: "0".repeat(60) + "1111" });
    expect(r.status).toBe(409); expect(r.body.error).toBe("similar_exists"); expect(r.body.similar[0]).toMatchObject({ photo_id: first.body.photo.id, distance: 4 });
    r = await call({ action: "upload", ...META, title: "Bliźniak", mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 801, 50_000)), source_sha256: "c".repeat(64), dhash: "0".repeat(60) + "1111", allow_similar: true });
    expect(r.status).toBe(200);
    expect(state.photos).toHaveLength(2); expect(state.uploads).toHaveLength(2);
  });
  it("[P2] zatwierdzenie v1 → upload v2: v2 prywatna pod NOWĄ ścieżką, zdjęcie zostaje ready z approved_version_id = v1 (rotacja na v1), v2 czeka; approve v2 przełącza", async () => {
    const first = await call({ action: "upload", ...META, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 50_000)) });
    await call({ action: "approve", photo_id: first.body.photo.id });
    const r = await call({ action: "upload", ...META, photo_id: first.body.photo.id, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 70_000)) });
    expect(r.status).toBe(200); expect(r.body.new_photo).toBe(false); expect(r.body.awaiting_approval).toBe(true);
    expect(r.body.version).toMatchObject({ version_no: 2, storage_bucket: "marketing-photos-pending", public_url: null });
    expect(r.body.version.storage_path).not.toBe(first.body.version.storage_path);
    expect(state.versions).toHaveLength(2);
    expect(state.photos[0]).toMatchObject({ status: "ready", current_version_id: r.body.version.id, approved_version_id: first.body.version.id });
    expect(state.uploads.map((u) => u.opts.upsert)).toEqual([false, false, false]); // 2× pending + 1× publikacja v1
    // lista: approved_version = v1 (z adresem), pending_version = v2; rotacja (suggest) zwraca zdjęcie z wersją v1
    let l = await call({ action: "list" });
    expect(l.body.photos[0].approved_version.id).toBe(first.body.version.id); expect(l.body.photos[0].pending_version.id).toBe(r.body.version.id); expect(l.body.pending_versions).toBe(1);
    let sg = await call({ action: "suggest" });
    expect(sg.body.photo.id).toBe(first.body.photo.id); expect(sg.body.photo.approved_version.id).toBe(first.body.version.id);
    // v1 w publicznym nietknięta; v2 wciąż tylko w prywatnym
    expect(state.objects["marketing-photos/" + first.body.version.storage_path]).toBeTruthy();
    expect(state.objects["marketing-photos/" + r.body.version.storage_path]).toBeUndefined();
    // zatwierdzenie v2 → publikacja v2, approved_version_id = v2, v1 zostaje opublikowana (stare maile działają)
    const ap = await call({ action: "approve", photo_id: first.body.photo.id, version_id: r.body.version.id });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect(state.photos[0].approved_version_id).toBe(r.body.version.id);
    expect(state.objects["marketing-photos/" + r.body.version.storage_path]).toBeTruthy();
    expect(state.objects["marketing-photos/" + first.body.version.storage_path]).toBeTruthy();
    expect(state.versions[0].public_url).toContain(first.body.version.storage_path);
    l = await call({ action: "list" }); expect(l.body.photos[0].pending_version).toBeNull(); expect(l.body.photos[0].approved_version.version_no).toBe(2);
    // wersja innego zdjęcia → 404
    const other = await call({ action: "upload", ...META, title: "Inne", mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 90_000)), source_sha256: "c".repeat(64) });
    expect((await call({ action: "approve", photo_id: first.body.photo.id, version_id: other.body.version.id })).status).toBe(404);
  });
  it("[review 3/P2] lista daje administratorowi PODGLĄD kadru oczekującego: podpisany adres z prywatnego bucketa (10 min), nigdy publiczny; preview_version to samo dla jednej wersji", async () => {
    const up = await call({ action: "upload", ...META, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 50_000)) });
    const l = await call({ action: "list" });
    const row = l.body.photos[0];
    expect(row.approved_version).toBeNull();
    expect(row.pending_version.preview).toMatchObject({ signed: true, url: `https://fake.supabase.co/storage/v1/object/sign/marketing-photos-pending/${up.body.version.storage_path}?token=SIGNED` });
    expect(row.pending_version.preview.expires_at).toBeTruthy();
    expect(state.signed).toEqual([{ bucket: "marketing-photos-pending", paths: [up.body.version.storage_path], ttl: 600 }]);
    const pv = await call({ action: "preview_version", version_id: up.body.version.id });
    expect(pv.status).toBe(200); expect(pv.body).toMatchObject({ version_no: 1, published: false, signed: true }); expect(pv.body.url).toContain("/sign/marketing-photos-pending/");
    expect((await call({ action: "preview_version", version_id: "nie-ma" })).status).toBe(404);
    // po zatwierdzeniu: podgląd = stały adres publiczny, bez podpisu
    await call({ action: "approve", photo_id: up.body.photo.id });
    const pv2 = await call({ action: "preview_version", version_id: up.body.version.id });
    expect(pv2.body).toMatchObject({ published: true, signed: false, url: `https://fake.supabase.co/storage/v1/object/public/marketing-photos/${up.body.version.storage_path}` });
    expect((await call({ action: "list" })).body.photos[0].pending_version).toBeNull();
  });
  it("[review 3/P2] przerwane zatwierdzenie (plik opublikowany, zapis approved_version_id padł): wersja nadal oczekująca z flagą published, ten sam approve ponawia BEZ drugiej publikacji", async () => {
    const up = await call({ action: "upload", ...META, mime: "image/jpeg", data_base64: b64(jpegHeader(1200, 800, 50_000)) });
    state.failPhotoUpdateOnce = true;
    const broken = await call({ action: "approve", photo_id: up.body.photo.id });
    expect(broken.status).toBe(500);
    // stan po awarii: plik publiczny, wiersz wersji opublikowany, zdjęcie nadal pending bez approved_version_id
    expect(state.objects["marketing-photos/" + up.body.version.storage_path]).toBeTruthy();
    expect(state.versions[0].published_at).toBeTruthy();
    expect(state.photos[0].status).toBe("pending"); expect(state.photos[0].approved_version_id ?? null).toBeNull();
    const l = await call({ action: "list" });
    expect(l.body.photos[0].pending_version).toMatchObject({ id: up.body.version.id, published: true });
    expect(l.body.photos[0].pending_version.preview).toMatchObject({ signed: false, url: expect.stringContaining("/public/marketing-photos/") });
    expect(l.body.photos[0].approved_version).toBeNull();
    const uploadsBefore = state.uploads.length;
    const retry = await call({ action: "approve", photo_id: up.body.photo.id });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.published).toBe(false); // publikacja idempotentna — nic nie wgrywa drugi raz
    expect(state.uploads.length).toBe(uploadsBefore);
    expect(state.photos[0]).toMatchObject({ status: "ready", approved_version_id: up.body.version.id });
    expect((await call({ action: "list" })).body.photos[0].pending_version).toBeNull();
  });
});

describe("approve / disable / enable / update / suggest / list", () => {
  const seed = (over = {}) => {
    const n = state.photos.length + 1;
    const p = { id: "ph-" + n, title: "T", alt_pl: "A", alt_en: "B", status: "pending", current_version_id: "v-" + n, approved_version_id: null, created_at: "2026-11-06T10:00:00Z", categories: [], ...over };
    const ready = p.status !== "pending";
    if (ready && p.approved_version_id === null) p.approved_version_id = p.current_version_id;
    const bytes = jpegHeader(1200, 800, 40_000 + n);
    const path = `photos/${p.id}/v1-${"ab".repeat(6)}.jpg`;
    state.photos.push(p);
    if (p.current_version_id) {
      state.versions.push({ id: p.current_version_id, photo_id: p.id, version_no: 1, storage_bucket: ready ? "marketing-photos" : "marketing-photos-pending", storage_path: path, public_url: ready ? "https://fake.supabase.co/storage/v1/object/public/marketing-photos/" + path : null, published_at: ready ? "2026-11-06T10:00:00Z" : null, width: 1200, height: 800, bytes: bytes.length, mime: "image/jpeg", sha256: createHash("sha256").update(bytes).digest("hex") });
      state.objects[(ready ? "marketing-photos" : "marketing-photos-pending") + "/" + path] = bytes;
    }
    return p;
  };
  it("approve: pending → ready z approved_by/at; drugi approve → 409; disable → disabled (plik i wersje nietknięte); enable → ready; zdjęcie bez pliku nie da się zatwierdzić", async () => {
    const p = seed();
    let r = await call({ action: "approve", photo_id: p.id });
    expect(r.status).toBe(200); expect(r.body.photo).toMatchObject({ status: "ready", approved_by: "admin" }); expect(r.body.photo.approved_at).toBeTruthy();
    r = await call({ action: "approve", photo_id: p.id }); expect(r.status).toBe(409); expect(r.body.error).toBe("version_already_approved");
    r = await call({ action: "disable", photo_id: p.id }); expect(r.status).toBe(200); expect(r.body.photo).toMatchObject({ status: "disabled", disabled_by: "admin" });
    expect(state.versions).toHaveLength(1); expect(state.uploads).toHaveLength(1); // jedyny zapis = publikacja przy approve; disable nic nie dotyka
    r = await call({ action: "enable", photo_id: p.id }); expect(r.status).toBe(200); expect(r.body.photo.status).toBe("ready"); expect(r.body.photo.disabled_at).toBeNull();
    // wyłączone zdjęcie: approve wymaga wcześniejszego włączenia; enable zdjęcia bez zatwierdzonej wersji → 409
    await call({ action: "disable", photo_id: p.id });
    r = await call({ action: "approve", photo_id: p.id }); expect(r.status).toBe(409); expect(r.body.error).toBe("photo_disabled");
    const pend = seed(); await call({ action: "disable", photo_id: pend.id });
    r = await call({ action: "enable", photo_id: pend.id }); expect(r.status).toBe(409); expect(r.body.error).toBe("photo_without_approved_version");
    const noFile = seed({ current_version_id: null });
    r = await call({ action: "approve", photo_id: noFile.id }); expect(r.status).toBe(409); expect(r.body.error).toBe("photo_without_file");
    r = await call({ action: "approve", photo_id: "nie-ma" }); expect(r.status).toBe(404);
  });
  it("update: metadane (alt/podpis/kategorie/rok/notatka), bez HTML, bez dotykania pliku i statusu", async () => {
    const p = seed({ status: "ready" });
    let r = await call({ action: "update", photo_id: p.id, alt_pl: "Nowy alt", caption_en: "Archive photo 2026", categories: ["rozmowy B2B", "stoisko"], year: 2025, review_note: "zapas" });
    expect(r.status).toBe(200); expect(r.body.photo).toMatchObject({ status: "ready", alt_pl: "Nowy alt", alt_en: "B", caption_en: "Archive photo 2026", categories: ["rozmowy B2B", "stoisko"], year: 2025, review_note: "zapas", current_version_id: "v-1", approved_version_id: "v-1" });
    r = await call({ action: "update", photo_id: p.id, caption_pl: "<img src=x>" }); expect(r.status).toBe(422); expect(r.body.errors).toContain("caption_pl_html_not_allowed");
    r = await call({ action: "update", photo_id: p.id, year: 1999 }); expect(r.status).toBe(422); expect(r.body.errors).toContain("year_invalid");
  });
  it("suggest: rotacja z użycia (nigdy niewysłane najpierw, omija ostatnie wysyłające); list: użycie per zdjęcie + ostrzeżenie o małej puli", async () => {
    const a = seed({ status: "ready" }), b = seed({ status: "ready" }), c = seed({ status: "pending" });
    state.usage = [{ photo_id: a.id, campaign_id: "c1", campaign_status: "sent", sent_count: 12, first_sent_at: "2026-10-01T10:00:00Z", last_sent_at: "2026-10-01T11:00:00Z" }, { photo_id: b.id, campaign_id: "c2", campaign_status: "draft", sent_count: 0, first_sent_at: null, last_sent_at: null }];
    let r = await call({ action: "suggest", campaign_id: "c2" });
    expect(r.status).toBe(200); expect(r.body.photo.id).toBe(b.id); expect(r.body.reason).toBe("never_sent"); expect(r.body.pool).toBe(2); expect(r.body.warnings).toContain("pool_small");
    r = await call({ action: "suggest", campaign_id: "c9" }); // a = ostatnio wysyłało (silniejsze omijanie), b = przypisane do innej otwartej (słabsze) → b
    expect(r.body.photo.id).toBe(b.id); expect(r.body.reason).toBe("assigned_elsewhere_fallback"); expect(r.body.warnings).toContain("all_assigned_elsewhere");
    r = await call({ action: "list" });
    expect(r.status).toBe(200); expect(r.body.ready_count).toBe(2); expect(r.body.warnings).toEqual(["pool_small"]); expect(r.body.public_read).toBe(true);
    const row = r.body.photos.find((p) => p.id === a.id);
    expect(row.usage).toEqual({ campaigns: 1, sent_campaigns: 1, last_sent_at: "2026-10-01T11:00:00Z", open_assignments: 0 });
    expect(row.approved_version.public_url).toMatch(/^https:\/\//);
    expect(r.body.photos.find((p) => p.id === c.id).approved_version).toBeNull(); // pending: bez publicznego adresu
    expect(r.body.photos.find((p) => p.id === b.id).usage.open_assignments).toBe(1);
    expect(r.body.photos.find((p) => p.id === c.id).status).toBe("pending");
    r = await call({ action: "usage", photo_id: a.id }); expect(r.body.usage).toHaveLength(1);
  });
  it("tylko admin; nieznana akcja → 400", async () => {
    state.service.from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "u", role: "supplier", active: true } }) }) }) }));
    expect((await call({ action: "list" })).status).toBe(403);
  });
});
