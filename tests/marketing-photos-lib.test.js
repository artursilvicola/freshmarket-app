// [feat/marketing-photos] Czysta logika biblioteki zdjęć: prawdziwy format/wymiary z bajtów, limity wersji do maila,
// rotacja (nigdy niewysłane → najdawniej wysłane, omijanie 4 ostatnich wysyłających i innych otwartych kampanii,
// ostrzeżenie o małej puli, wybór ręczny), zamrożenie, odległość odcisków, ścieżki wersji.
import { describe, it, expect } from "vitest";
import { sniffImage, validateMailImage, pickPhoto, freezePhoto, validateFrozenPhoto, hammingHex, versionPath, publicObjectUrl, MAIL_IMAGE_LIMITS, ROTATION } from "../netlify/functions/_shared/marketing-photos.js";
import { jpegHeader, pngHeader, webpVp8Header } from "./fixtures/image-headers.js";

describe("sniffImage — format i wymiary z bajtów", () => {
  it("JPEG (SOF0 po APP0), PNG (IHDR), WebP VP8; śmieci i obcięte pliki → null", () => {
    expect(sniffImage(jpegHeader(1200, 800))).toEqual({ mime: "image/jpeg", width: 1200, height: 800 });
    expect(sniffImage(pngHeader(900, 600))).toEqual({ mime: "image/png", width: 900, height: 600 });
    expect(sniffImage(webpVp8Header(1000, 667))).toEqual({ mime: "image/webp", width: 1000, height: 667 });
    expect(sniffImage(Buffer.from("GIF89a" + "x".repeat(40)))).toBeNull();
    expect(sniffImage(Buffer.from("<html><body>nie obraz</body></html>".padEnd(60, " ")))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(40)]))).toBeNull(); // EOI bez SOF
  });
});

describe("validateMailImage — limity wersji do maila", () => {
  it("1200×800 JPEG ~100 KB zgodny z deklaracją → OK", () => {
    const r = validateMailImage(jpegHeader(1200, 800, 100_000), "image/jpeg");
    expect(r).toMatchObject({ ok: true, errors: [], info: { mime: "image/jpeg", width: 1200, height: 800 } });
    expect(r.info.bytes).toBeGreaterThan(100_000);
  });
  it("deklaracja PNG a bajty JPEG → format_mismatch; za duży plik; za duże/za małe wymiary; złe proporcje; śmieci", () => {
    expect(validateMailImage(jpegHeader(1200, 800), "image/png").errors).toContain("format_mismatch");
    expect(validateMailImage(jpegHeader(1200, 800, MAIL_IMAGE_LIMITS.maxBytes + 10), "image/jpeg").errors).toContain("too_large");
    expect(validateMailImage(jpegHeader(2400, 1600), "image/jpeg").errors).toContain("dimensions_too_large");
    expect(validateMailImage(jpegHeader(500, 333), "image/jpeg").errors).toContain("dimensions_too_small");
    expect(validateMailImage(jpegHeader(800, 800), "image/jpeg").errors).toContain("aspect_ratio"); // kwadrat
    expect(validateMailImage(jpegHeader(1200, 300), "image/jpeg").errors).toEqual(expect.arrayContaining(["aspect_ratio"])); // 4:1
    expect(validateMailImage(Buffer.from("x".repeat(3000)), "image/jpeg")).toEqual({ ok: false, errors: ["format_unrecognized"], info: null });
  });
});

describe("pickPhoto — rotacja", () => {
  const P = (id, over = {}) => ({ id, status: "ready", current_version_id: "v-" + id, created_at: `2026-11-0${id.slice(-1)}T00:00:00Z`, ...over });
  const U = (photo_id, campaign_id, over = {}) => ({ photo_id, campaign_id, campaign_status: "sent", sent_count: 10, first_sent_at: "2026-10-01T10:00:00Z", last_sent_at: "2026-10-01T11:00:00Z", approved_at: "2026-10-01T09:00:00Z", ...over });
  it("brak gotowych zdjęć → null z ostrzeżeniem; pending/disabled/bez pliku nie wchodzą do puli", () => {
    const r = pickPhoto({ photos: [P("p1", { status: "pending" }), P("p2", { status: "disabled" }), P("p3", { current_version_id: null })], usage: [] });
    expect(r.photo).toBeNull(); expect(r.reason).toBe("no_ready_photos"); expect(r.warnings).toContain("no_ready_photos"); expect(r.pool).toBe(0);
  });
  it("nigdy niewysłane najpierw (najstarsze wgranie), potem najdawniej wysłane", () => {
    const photos = [P("p1"), P("p2"), P("p3"), P("p4"), P("p5"), P("p6")];
    const usage = [U("p1", "c1", { first_sent_at: "2026-09-01T10:00:00Z", last_sent_at: "2026-09-01T10:00:00Z" }), U("p2", "c2", { first_sent_at: "2026-08-01T10:00:00Z", last_sent_at: "2026-08-01T10:00:00Z" })];
    const r = pickPhoto({ photos, usage });
    expect(r.photo.id).toBe("p3"); expect(r.reason).toBe("never_sent"); expect(r.warnings).toEqual([]);
    // wszystkie wysyłały: najdawniej wysłane (p2 z sierpnia) — ale p1/p2 są w 2 ostatnich wysyłających → bierze najstarsze spoza nich
    const all = [U("p1", "c1", { first_sent_at: "2026-09-01T10:00:00Z", last_sent_at: "2026-09-01T10:00:00Z" }), U("p2", "c2", { first_sent_at: "2026-08-01T10:00:00Z", last_sent_at: "2026-08-01T10:00:00Z" }), U("p3", "c3", { first_sent_at: "2026-07-01T10:00:00Z", last_sent_at: "2026-07-01T10:00:00Z" }), U("p4", "c4", { first_sent_at: "2026-06-01T10:00:00Z", last_sent_at: "2026-06-01T10:00:00Z" }), U("p5", "c5", { first_sent_at: "2026-05-01T10:00:00Z", last_sent_at: "2026-05-01T10:00:00Z" }), U("p6", "c6", { first_sent_at: "2026-04-01T10:00:00Z", last_sent_at: "2026-04-01T10:00:00Z" })];
    const r2 = pickPhoto({ photos, usage: all });
    expect(r2.photo.id).toBe("p6"); expect(r2.reason).toBe("oldest_sent");
    expect(r2.ranked.slice(0, 2).map((x) => x.photo_id)).toEqual(["p6", "p5"]);
    expect(r2.ranked.filter((x) => x.recent).map((x) => x.photo_id).sort()).toEqual(["p1", "p2", "p3", "p4"]); // 4 ostatnie wysyłające
  });
  it("omija zdjęcia z 4 ostatnich kampanii, które FAKTYCZNIE wysyłały (sent_count>0); kampania bez wysyłek nie liczy się jako „ostatnia”", () => {
    const photos = [P("p1"), P("p2"), P("p3"), P("p4"), P("p5")];
    const usage = [U("p1", "c1", { first_sent_at: "2026-10-04T10:00:00Z" }), U("p2", "c2", { first_sent_at: "2026-10-03T10:00:00Z" }), U("p3", "c3", { first_sent_at: "2026-10-02T10:00:00Z" }), U("p4", "c4", { first_sent_at: "2026-10-01T10:00:00Z" }),
      U("p5", "c5", { campaign_status: "closed", sent_count: 0, first_sent_at: null, last_sent_at: null })]; // zamknięta bez wysyłki
    const r = pickPhoto({ photos, usage });
    expect(r.photo.id).toBe("p5"); expect(r.reason).toBe("never_sent");
  });
  it("gdy KAŻDE zdjęcie jest w 4 ostatnich wysyłających → bierze najdawniej wysłane z ostrzeżeniem all_recent + pool_small", () => {
    const photos = [P("p1"), P("p2")];
    const usage = [U("p1", "c1", { first_sent_at: "2026-10-04T10:00:00Z", last_sent_at: "2026-10-04T10:00:00Z" }), U("p2", "c2", { first_sent_at: "2026-10-03T10:00:00Z", last_sent_at: "2026-10-03T10:00:00Z" })];
    const r = pickPhoto({ photos, usage });
    expect(r.photo.id).toBe("p2"); expect(r.reason).toBe("recent_fallback");
    expect(r.warnings).toEqual(expect.arrayContaining(["pool_small", "all_recent"]));
  });
  it("zdjęcie przypisane do INNEJ otwartej kampanii schodzi niżej; własna kampania (excludeCampaignId) nie liczy się", () => {
    const photos = [P("p1"), P("p2"), P("p3"), P("p4"), P("p5")];
    const usage = [U("p1", "draft-x", { campaign_status: "draft", sent_count: 0, first_sent_at: null, last_sent_at: null }), U("p2", "appr-y", { campaign_status: "approved", sent_count: 0, first_sent_at: null, last_sent_at: null })];
    const r = pickPhoto({ photos, usage });
    expect(r.photo.id).toBe("p3");
    const own = pickPhoto({ photos: [P("p1")], usage: [U("p1", "mine", { campaign_status: "draft", sent_count: 0, first_sent_at: null, last_sent_at: null })], excludeCampaignId: "mine" });
    expect(own.photo.id).toBe("p1"); expect(own.warnings).not.toContain("all_assigned_elsewhere");
    const other = pickPhoto({ photos: [P("p1")], usage: [U("p1", "theirs", { campaign_status: "draft", sent_count: 0, first_sent_at: null, last_sent_at: null })], excludeCampaignId: "mine" });
    expect(other.photo.id).toBe("p1"); expect(other.reason).toBe("assigned_elsewhere_fallback"); expect(other.warnings).toContain("all_assigned_elsewhere");
  });
  it("wybór ręczny: zdjęcie ready → reason manual; pending → ostrzeżenie manual_not_ready i rotacja", () => {
    const photos = [P("p1"), P("p2", { status: "pending" }), P("p3")];
    expect(pickPhoto({ photos, usage: [], preferPhotoId: "p3" })).toMatchObject({ photo: { id: "p3" }, reason: "manual" });
    const r = pickPhoto({ photos, usage: [], preferPhotoId: "p2" });
    expect(r.photo.id).toBe("p1"); expect(r.warnings).toContain("manual_not_ready");
  });
  it("stałe rotacji: 4 ostatnie wysyłające, ostrzeżenie poniżej 5 gotowych", () => {
    expect(ROTATION).toEqual({ avoidRecentSending: 4, minPoolWarning: 5 });
    expect(pickPhoto({ photos: [P("p1"), P("p2"), P("p3"), P("p4"), P("p5")], usage: [] }).warnings).toEqual([]);
    expect(pickPhoto({ photos: [P("p1"), P("p2"), P("p3"), P("p4")], usage: [] }).warnings).toEqual(["pool_small"]);
  });
});

describe("freezePhoto / validateFrozenPhoto", () => {
  const photo = { id: "ph", title: "Rozmowy 2026", alt_pl: "Rozmowy przy stoliku", alt_en: "Table talks", caption_pl: "Zdjęcie archiwalne 2026", caption_en: null, kind: "authentic", year: 2026 };
  const version = { id: "ver", version_no: 1, public_url: "https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/ph/v1-abc.jpg", width: 1200, height: 800, sha256: "ab".repeat(32) };
  it("zamraża id, wersję, adres HTTPS, alt/podpis PL/EN, wymiary; brak zdjęcia → null; http → błąd", () => {
    const f = freezePhoto(photo, version);
    expect(f).toMatchObject({ photo_id: "ph", version_id: "ver", version_no: 1, url: version.public_url, width: 1200, height: 800, alt_pl: "Rozmowy przy stoliku", alt_en: "Table talks", caption_pl: "Zdjęcie archiwalne 2026", caption_en: null, kind: "authentic", year: 2026 });
    expect(f.frozen_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(validateFrozenPhoto(f)).toEqual([]);
    expect(freezePhoto(null, version)).toBeNull();
    expect(() => freezePhoto(photo, { ...version, public_url: "http://x/y.jpg" })).toThrow("photo_url_not_https");
    expect(validateFrozenPhoto({ ...f, alt_en: "" })).toEqual(["alt_missing"]);
    expect(validateFrozenPhoto({ url: "https://x/y.jpg" })).toEqual(["ids_missing", "alt_missing"]);
    expect(validateFrozenPhoto(null)).toEqual(["missing"]);
  });
});

describe("odciski i ścieżki", () => {
  it("hammingHex: ciągi bitów i hex, różne długości → null", () => {
    expect(hammingHex("0".repeat(64), "0".repeat(63) + "1")).toBe(1);
    expect(hammingHex("f".repeat(16), "0".repeat(16))).toBe(64);
    expect(hammingHex("0".repeat(64), "0".repeat(16))).toBe(0); // hex 16 znaków = 64 bity zer
    expect(hammingHex("abc", "0".repeat(64))).toBeNull();
  });
  it("versionPath: photos/<id>/v<n>-<sha12>.<ext>; publicObjectUrl koduje segmenty", () => {
    expect(versionPath("ph-1", 2, "abcdef0123456789ff", "image/jpeg")).toBe("photos/ph-1/v2-abcdef012345.jpg");
    expect(versionPath("ph-1", 1, "abcdef0123456789ff", "image/png")).toBe("photos/ph-1/v1-abcdef012345.png");
    expect(publicObjectUrl("https://x.supabase.co/", "marketing-photos", "photos/a b/v1.jpg")).toBe("https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/a%20b/v1.jpg");
  });
});
