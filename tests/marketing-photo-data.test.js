// [feat/marketing-photos] Publikacja i cofanie publikacji wersji (review Codexa 3): publishVersion idempotentna (ponowienie po
// przerwanym zatwierdzeniu nie wgrywa drugi raz), unpublishVersion w kolejności PONAWIALNEJ (kopia → usunięcie publicznego →
// wiersz): nieudane usunięcie zostawia wiersz „published”, więc kolejne uruchomienie wraca do wersji; brak publicznego obiektu
// po wcześniejszej częściowej próbie → bajty z kopii prywatnej; niezgodny sha256 = STOP; Storage „usunęło” bez usunięcia = STOP.
import { beforeEach, describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { jpegHeader } from "./fixtures/image-headers.js";
import { publishVersion, unpublishVersion, previewUrls, isPublished, isNotFoundError, releaseUnpublish } from "../netlify/functions/_shared/marketing-photo-data.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
let st;
const fake = () => {
  st = { objects: {}, rows: [], removed: [], uploads: [], failRemove: false, removeNoop: false, failRowUpdate: false, signed: [], referenced: new Set(), downloadError: null, rpcCalls: [] };
  const storage = { from: (bucket) => ({
    upload: async (path, bytes, opts) => { const k = bucket + "/" + path; st.uploads.push({ bucket, path, opts }); if (st.objects[k]) return { error: { message: "The resource already exists" } }; st.objects[k] = Buffer.from(bytes); return { data: { path }, error: null }; },
    download: async (path) => { if (st.downloadError && st.downloadError.bucket === bucket) { const e = st.downloadError; if (e.once) st.downloadError = null; return { data: null, error: e.error }; } const b = st.objects[bucket + "/" + path]; return b ? { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null } : { data: null, error: { message: "Object not found", statusCode: "404", status: 400 } }; },
    remove: async (paths) => { if (st.failRemove) return { data: null, error: { message: "storage unavailable" } }; for (const p of paths) { st.removed.push(bucket + "/" + p); if (!st.removeNoop) delete st.objects[bucket + "/" + p]; } return { data: [], error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    createSignedUrls: async (paths, ttl) => { st.signed.push({ bucket, paths, ttl }); return { data: paths.map((p) => ({ path: p, signedUrl: `https://fake.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=T` })), error: null }; },
  }) };
  const from = (table) => {
    const q = { _f: [], _is: null, _notIs: null, _upd: null };
    q.update = (p) => { q._upd = p; return q; }; q.eq = (c, v) => { q._f.push([c, v]); return q; }; q.is = (c, v) => { q._is = [c, v]; return q; }; q.select = () => q;
    q.not = (c, op, v) => { q._notIs = [c, v]; return q; };
    q.maybeSingle = async () => {
      const found = st.rows.find((r) => r.id === q._f.find(([c]) => c === "id")?.[1]);
      if (!q._upd) return { data: found ? { ...found } : null, error: null }; // odczyt (loadPhotoVersion)
      if (st.failRowUpdate) return { data: null, error: { message: "db down" } };
      const row = found;
      if (!row || (q._is && (row[q._is[0]] ?? null) !== q._is[1]) || (q._notIs && (row[q._notIs[0]] ?? null) === q._notIs[1])) return { data: null, error: null };
      // trigger: cofnięcie publikacji wymaga zajęcia i braku użycia; po cofnięciu stan znika
      if (q._upd.published_at === null && row.published_at) { if (!row.unpublishing_at) return { data: null, error: { message: "unpublish requires a prior claim" } }; if (st.referenced.has(row.id)) return { data: null, error: { message: "published version is referenced" } }; q._upd = { ...q._upd, unpublishing_at: null, unpublishing_by: null }; }
      Object.assign(row, q._upd); return { data: { ...row }, error: null };
    };
    return q;
  };
  // RPC: atomowe zajęcie stanu (tylko opublikowana, nieużywana), ponowne zajęcie = sukces; zwolnienie
  const rpc = async (name, args) => {
    st.rpcCalls.push([name, args]);
    const row = st.rows.find((r) => r.id === args.p_version_id);
    if (name === "marketing_photo_version_claim_unpublish") { if (!row || !row.published_at || st.referenced.has(row.id)) return { data: false, error: null }; row.unpublishing_at = row.unpublishing_at || new Date().toISOString(); return { data: true, error: null }; }
    if (name === "marketing_photo_version_release_unpublish") { if (!row || !row.unpublishing_at || !row.published_at) return { data: false, error: null }; row.unpublishing_at = null; return { data: true, error: null }; }
    return { data: null, error: { message: "unknown rpc " + name } };
  };
  return { storage, from, rpc };
};
const seedPending = (id = "v1") => { const bytes = jpegHeader(1200, 800, 30_000); const path = `photos/ph/${id}-abc.jpg`; st.objects["marketing-photos-pending/" + path] = bytes; const row = { id, photo_id: "ph", version_no: 1, storage_bucket: "marketing-photos-pending", storage_path: path, public_url: null, published_at: null, mime: "image/jpeg", sha256: sha(bytes) }; st.rows.push(row); return row; };
const seedPublished = (id = "v1") => { const r = seedPending(id); const bytes = st.objects["marketing-photos-pending/" + r.storage_path]; delete st.objects["marketing-photos-pending/" + r.storage_path]; st.objects["marketing-photos/" + r.storage_path] = bytes; Object.assign(r, { storage_bucket: "marketing-photos", public_url: "https://fake.supabase.co/storage/v1/object/public/marketing-photos/" + r.storage_path, published_at: "2026-11-06T10:00:00Z" }); return r; };

let supa;
beforeEach(() => { supa = fake(); });

describe("publishVersion", () => {
  it("kopiuje bajty pod tę samą ścieżkę (sha256 sprawdzony), ustawia adres i published_at, usuwa kopię prywatną; drugie wywołanie = idempotentne bez wgrywania", async () => {
    const v = seedPending();
    const r = await publishVersion(supa, { ...v }, "admin");
    expect(r.published).toBe(true); expect(isPublished(r.version)).toBe(true);
    expect(r.version.public_url).toBe("https://fake.supabase.co/storage/v1/object/public/marketing-photos/" + v.storage_path);
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeTruthy(); expect(st.objects["marketing-photos-pending/" + v.storage_path]).toBeUndefined();
    const again = await publishVersion(supa, { ...st.rows[0] }, "admin");
    expect(again.published).toBe(false); expect(st.uploads).toHaveLength(1);
  });
  it("niezgodny sha256 → błąd, nic nie opublikowane; brak pliku prywatnego → błąd", async () => {
    const v = seedPending();
    st.objects["marketing-photos-pending/" + v.storage_path] = jpegHeader(1200, 800, 31_000);
    await expect(publishVersion(supa, { ...v })).rejects.toThrow(/sha256 mismatch/);
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeUndefined(); expect(st.rows[0].published_at).toBeNull();
    delete st.objects["marketing-photos-pending/" + v.storage_path];
    await expect(publishVersion(supa, { ...v })).rejects.toThrow(/download/);
  });
  it("plik już w publicznym (poprzednia próba padła przed zapisem wiersza) → ponowienie zapisuje wiersz bez drugiego wgrania", async () => {
    const v = seedPending();
    st.objects["marketing-photos/" + v.storage_path] = st.objects["marketing-photos-pending/" + v.storage_path];
    const r = await publishVersion(supa, { ...v }, "admin");
    expect(r.published).toBe(true); expect(st.rows[0].published_at).toBeTruthy(); expect(st.uploads).toHaveLength(1); // próba upsert:false → „exists” tolerowane
  });
});

describe("unpublishVersion — kolejność ponawialna (review Codexa 3)", () => {
  it("NAJPIERW atomowe zajęcie stanu w bazie, potem kopia do prywatnego → usunięcie publicznego → wiersz; po sukcesie plik tylko w prywatnym, public_url NULL, stan zwolniony", async () => {
    const v = seedPublished();
    const r = await unpublishVersion(supa, { ...v }, "admin");
    expect(r.unpublished).toBe(true);
    expect(st.rpcCalls[0]).toEqual(["marketing_photo_version_claim_unpublish", { p_version_id: "v1", p_by: "admin" }]);
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeUndefined(); expect(st.objects["marketing-photos-pending/" + v.storage_path]).toBeTruthy();
    expect(st.rows[0]).toMatchObject({ storage_bucket: "marketing-photos-pending", public_url: null, published_at: null, unpublishing_at: null });
  });
  it("[review 4/P1] kampania przypisała wersję po wstępnej kontroli skryptu → zajęcie odmówione, plik publiczny NIETKNIĘTY, wiersz bez zmian", async () => {
    const v = seedPublished();
    st.referenced.add(v.id); // wyścig: przypisanie między odczytem listy a sprzątaniem
    await expect(unpublishVersion(supa, { ...v })).rejects.toThrow(/claim refused/);
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeTruthy(); expect(st.removed).toEqual([]); expect(st.uploads).toEqual([]);
    expect(st.rows[0].published_at).toBe("2026-11-06T10:00:00Z"); expect(st.rows[0].unpublishing_at ?? null).toBeNull();
  });
  it("[review 4/P2] przejściowy 503 przy pobraniu publicznego → STOP (nie „brak pliku”), nic nie usunięte, stan zajęty zostaje do ponowienia; po ustąpieniu awarii ponowienie kończy sprzątanie", async () => {
    const v = seedPublished();
    st.objects["marketing-photos-pending/" + v.storage_path] = st.objects["marketing-photos/" + v.storage_path]; // kopia prywatna już istnieje (po wcześniejszej próbie)
    st.downloadError = { bucket: "marketing-photos", once: true, error: { message: "Service Unavailable", statusCode: "503", status: 503 } };
    await expect(unpublishVersion(supa, { ...v })).rejects.toThrow(/public object check failed/);
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeTruthy(); expect(st.removed).toEqual([]);
    expect(st.rows[0].published_at).toBeTruthy(); expect(st.rows[0].unpublishing_at).toBeTruthy();
    const r = await unpublishVersion(supa, { ...st.rows[0] });
    expect(r.unpublished).toBe(true); expect(st.objects["marketing-photos/" + v.storage_path]).toBeUndefined();
  });
  it("[review 4/P2] kontrola po usunięciu: 403/timeout zamiast not-found → STOP ze stanem zajętym (wiersz nadal published)", async () => {
    const v = seedPublished();
    // po remove kolejne download publicznego zwraca 403 (nie not-found) — kontrola musi się zatrzymać
    let removed = false;
    const base = supa.storage.from;
    supa.storage = { from: (bucket) => { const api = base(bucket); return { ...api,
      download: async (p) => (bucket === "marketing-photos" && removed) ? { data: null, error: { message: "Forbidden", statusCode: "403", status: 403 } } : api.download(p),
      remove: async (ps) => { removed = true; return api.remove(ps); } }; } };
    await expect(unpublishVersion(supa, { ...v })).rejects.toThrow(/storage check .*Forbidden/);
    expect(st.rows[0].published_at).toBeTruthy(); expect(st.rows[0].unpublishing_at).toBeTruthy();
  });
  it("cofnięcie publikacji bez zajęcia stanu (bezpośredni UPDATE) odrzuca trigger; releaseUnpublish zwalnia zajęty stan tylko po weryfikacji publicznego pliku", async () => {
    const v = seedPublished();
    const direct = await supa.from("marketing_photo_versions").update({ published_at: null, public_url: null }).eq("id", v.id).select().maybeSingle();
    expect(direct.error.message).toMatch(/prior claim/);
    st.rows[0].unpublishing_at = "2026-11-06T12:00:00Z";
    expect(await releaseUnpublish(supa, v.id)).toEqual({ released: true, restored: false }); expect(st.rows[0].unpublishing_at).toBeNull();
    expect((await releaseUnpublish(supa, v.id)).released).toBe(false);
  });
  it("[review 5/P2] --release po przebiegu „publiczny usunięty → zapis wiersza padł”: publiczny plik PRZYWRÓCONY z kopii prywatnej pod ten sam adres i zweryfikowany, dopiero potem zwolnienie", async () => {
    const v = seedPublished();
    st.rows[0].unpublishing_at = "2026-11-06T12:00:00Z";
    st.objects["marketing-photos-pending/" + v.storage_path] = st.objects["marketing-photos/" + v.storage_path];
    delete st.objects["marketing-photos/" + v.storage_path]; // stan po usunięciu publicznego i awarii zapisu
    const r = await releaseUnpublish(supa, v.id);
    expect(r).toEqual({ released: true, restored: true });
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeTruthy(); expect(st.rows[0].unpublishing_at).toBeNull();
    expect(st.uploads.at(-1)).toMatchObject({ bucket: "marketing-photos", path: v.storage_path, opts: { upsert: false } });
  });
  it("[review 5/P2] release ODMAWIA, gdy publicznego pliku nie ma i nie ma kopii prywatnej, gdy kopia ma zły sha256, gdy Storage odpowiada 503 — stan zostaje zajęty", async () => {
    const v = seedPublished();
    st.rows[0].unpublishing_at = "2026-11-06T12:00:00Z";
    delete st.objects["marketing-photos/" + v.storage_path];
    await expect(releaseUnpublish(supa, v.id)).rejects.toThrow(/no private copy to restore/);
    expect(st.rows[0].unpublishing_at).toBeTruthy();
    st.objects["marketing-photos-pending/" + v.storage_path] = jpegHeader(1200, 800, 31_000); // inne bajty
    await expect(releaseUnpublish(supa, v.id)).rejects.toThrow(/private copy sha256 mismatch/);
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeUndefined(); expect(st.rows[0].unpublishing_at).toBeTruthy();
    st.objects["marketing-photos/" + v.storage_path] = jpegHeader(1200, 800, 30_000);
    st.downloadError = { bucket: "marketing-photos", once: true, error: { message: "Service Unavailable", statusCode: "503", status: 503 } };
    await expect(releaseUnpublish(supa, v.id)).rejects.toThrow(/not a not-found/);
    expect(st.rows[0].unpublishing_at).toBeTruthy();
    // publiczny plik istnieje, ale ma inne bajty niż wiersz → odmowa
    st.objects["marketing-photos/" + v.storage_path] = jpegHeader(1200, 800, 32_000);
    await expect(releaseUnpublish(supa, v.id)).rejects.toThrow(/public object sha256 mismatch/);
    expect(st.rows[0].unpublishing_at).toBeTruthy();
    // wersja niezajęta → nic
    st.rows[0].unpublishing_at = null; st.objects["marketing-photos/" + v.storage_path] = jpegHeader(1200, 800, 30_000);
    expect((await releaseUnpublish(supa, v.id)).reason).toBe("not_claimed");
  });
  it("isNotFoundError: tylko jednoznaczny 404 / „Object not found”; 503, 403, 401, 408, 429 i puste → false", () => {
    expect(isNotFoundError({ message: "Object not found", statusCode: "404", status: 400 })).toBe(true);
    expect(isNotFoundError({ message: "not_found" })).toBe(true);
    expect(isNotFoundError({ status: 404, message: "x" })).toBe(true);
    for (const e of [{ message: "Service Unavailable", statusCode: "503" }, { message: "Forbidden", status: 403 }, { message: "not found", statusCode: "503" }, { message: "timeout" }, { message: "Unauthorized", status: 401 }, null, undefined]) expect(isNotFoundError(e)).toBe(false);
  });
  it("nieudane usunięcie publicznego pliku → błąd, wiersz ZOSTAJE published (kolejne uruchomienie wraca do wersji); ponowienie po naprawie kończy sprzątanie", async () => {
    const v = seedPublished();
    st.failRemove = true;
    await expect(unpublishVersion(supa, { ...v })).rejects.toThrow(/remove public object/);
    expect(st.rows[0].published_at).toBeTruthy(); expect(st.rows[0].public_url).toBeTruthy();
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeTruthy(); // nadal publiczny — i tak to raportujemy
    expect(st.objects["marketing-photos-pending/" + v.storage_path]).toBeTruthy(); // kopia prywatna już jest
    st.failRemove = false;
    const r = await unpublishVersion(supa, { ...st.rows[0] });
    expect(r.unpublished).toBe(true); expect(st.objects["marketing-photos/" + v.storage_path]).toBeUndefined(); expect(st.rows[0].public_url).toBeNull();
  });
  it("Storage odpowiada OK, ale obiekt publiczny nadal istnieje → błąd, wiersz nietknięty", async () => {
    const v = seedPublished();
    st.removeNoop = true;
    await expect(unpublishVersion(supa, { ...v })).rejects.toThrow(/still present/);
    expect(st.rows[0].published_at).toBeTruthy();
  });
  it("publiczny obiekt już usunięty, ale zapis wiersza padł wcześniej → ponowienie bierze bajty z kopii prywatnej i domyka wiersz", async () => {
    const v = seedPublished();
    st.objects["marketing-photos-pending/" + v.storage_path] = st.objects["marketing-photos/" + v.storage_path];
    delete st.objects["marketing-photos/" + v.storage_path];
    const r = await unpublishVersion(supa, { ...v });
    expect(r.unpublished).toBe(true); expect(st.removed).toEqual([]); expect(st.rows[0].public_url).toBeNull();
  });
  it("awaria zapisu wiersza po usunięciu publicznego → błąd; stan pośredni (plik tylko prywatny, wiersz published) domyka kolejne uruchomienie", async () => {
    const v = seedPublished();
    st.failRowUpdate = true;
    await expect(unpublishVersion(supa, { ...v })).rejects.toThrow(/db down/);
    expect(st.objects["marketing-photos/" + v.storage_path]).toBeUndefined(); expect(st.rows[0].published_at).toBeTruthy();
    st.failRowUpdate = false;
    expect((await unpublishVersion(supa, { ...st.rows[0] })).unpublished).toBe(true); expect(st.rows[0].public_url).toBeNull();
  });
  it("brak obiektu w obu bucketach → błąd bez zmiany wiersza; wersja nieopublikowana → nic", async () => {
    const v = seedPublished();
    delete st.objects["marketing-photos/" + v.storage_path];
    await expect(unpublishVersion(supa, { ...v })).rejects.toThrow(/missing in both buckets/);
    expect(st.rows[0].published_at).toBeTruthy();
    expect((await unpublishVersion(supa, seedPending("v2"))).unpublished).toBe(false);
  });
});

describe("previewUrls", () => {
  it("opublikowana → stały adres (bez podpisu); prywatna → podpisany adres z prywatnego bucketa z TTL 600 s i datą wygaśnięcia", async () => {
    const pub = seedPublished("vp"), pend = seedPending("vq");
    const m = await previewUrls(supa, [pub, pend, null]);
    expect(m.vp).toEqual({ url: pub.public_url, signed: false, expires_at: null });
    expect(m.vq).toMatchObject({ signed: true, url: `https://fake.supabase.co/storage/v1/object/sign/marketing-photos-pending/${pend.storage_path}?token=T` });
    expect(new Date(m.vq.expires_at).getTime()).toBeGreaterThan(Date.now() + 500_000);
    expect(st.signed).toEqual([{ bucket: "marketing-photos-pending", paths: [pend.storage_path], ttl: 600 }]);
    expect(await previewUrls(supa, [])).toEqual({});
  });
});
