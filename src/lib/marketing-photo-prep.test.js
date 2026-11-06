// [feat/marketing-photos] Czyste funkcje przygotowania zdjęcia w przeglądarce: kadr 3:2 z przesunięciem,
// dobór jakości pod limit, dHash 9×8, nagłówek pliku, kontrola źródła, formatowanie rozmiaru.
import { describe, it, expect } from "vitest";
import { cropRect, qualitySteps, pickQuality, dhashFromGray, sniffHeader, checkSource, fmtBytes, MAIL_PHOTO, QUALITY_STEPS } from "./marketing-photo-prep.js";

describe("cropRect — kadr 3:2", () => {
  it("poziome 3:2 → cały obraz; szerokie 16:9 → pełna wysokość, przesunięcie w poziomie; pionowe → pełna szerokość, przesunięcie w pionie", () => {
    expect(cropRect(1200, 800)).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 800, landscape: true });
    expect(cropRect(1920, 1080, 0)).toEqual({ sx: 0, sy: 0, sw: 1620, sh: 1080, landscape: true });
    expect(cropRect(1920, 1080, 1)).toEqual({ sx: 300, sy: 0, sw: 1620, sh: 1080, landscape: true });
    expect(cropRect(1920, 1080, 0.5)).toEqual({ sx: 150, sy: 0, sw: 1620, sh: 1080, landscape: true });
    expect(cropRect(2000, 3000, 0)).toEqual({ sx: 0, sy: 0, sw: 2000, sh: 1333, landscape: false });
    expect(cropRect(2000, 3000, 1)).toEqual({ sx: 0, sy: 1667, sw: 2000, sh: 1333, landscape: false });
    expect(cropRect(3000, 2000, 0.25)).toEqual({ sx: 0, sy: 0, sw: 3000, sh: 2000, landscape: true });
  });
  it("offset poza [0,1] i śmieci są przycinane; kadr nigdy nie wychodzi poza obraz", () => {
    for (const [w, h, o] of [[5000, 3333, -3], [4000, 6000, 9], [700, 700, "x"], [301, 200, 0.5]]) {
      const r = cropRect(w, h, o);
      expect(r.sx).toBeGreaterThanOrEqual(0); expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(w); expect(r.sy + r.sh).toBeLessThanOrEqual(h);
      expect(Math.abs(r.sw / r.sh - 1.5)).toBeLessThan(0.02);
    }
  });
});

describe("jakość JPEG", () => {
  it("qualitySteps schodzi od startu w dół; pickQuality bierze najwyższą jakość mieszczącą się w limicie, w ostateczności najniższą", () => {
    expect(qualitySteps()).toEqual([...QUALITY_STEPS]);
    expect(qualitySteps(0.8)).toEqual([0.78, 0.74, 0.7, 0.64, 0.58]);
    expect(pickQuality({ 0.86: 260_000, 0.82: 210_000, 0.78: 190_000, 0.74: 170_000 })).toBe(0.78);
    expect(pickQuality({ 0.86: 100_000 })).toBe(0.86);
    expect(pickQuality({ 0.86: 900_000, 0.58: 400_000 })).toBe(0.58);
    expect(pickQuality({})).toBeNull();
    expect(MAIL_PHOTO).toMatchObject({ width: 1200, height: 800, ratio: 1.5, targetBytes: 204800, maxBytes: 358400 });
  });
});

describe("dHash i nagłówki", () => {
  it("dhashFromGray: 64 bitów z porównania sąsiadów; jednolity obraz = same zera; gradient rosnący = same zera, malejący = same jedynki", () => {
    expect(dhashFromGray(new Array(72).fill(100))).toBe("0".repeat(64));
    expect(dhashFromGray(Array.from({ length: 72 }, (_, i) => i % 9))).toBe("0".repeat(64));
    expect(dhashFromGray(Array.from({ length: 72 }, (_, i) => 9 - (i % 9)))).toBe("1".repeat(64));
    expect(() => dhashFromGray([1, 2, 3])).toThrow();
  });
  it("sniffHeader rozpoznaje JPEG/PNG/WebP; checkSource: rozszerzenie nie ma znaczenia, liczy się nagłówek; limit 40 MB", () => {
    const png = new Uint8Array(40); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); png.set([0, 0, 0, 13], 8); png.set([0x49, 0x48, 0x44, 0x52], 12); png.set([0, 0, 0x04, 0xb0], 16); png.set([0, 0, 0x03, 0x20], 20);
    expect(sniffHeader(png)).toEqual({ mime: "image/png", width: 1200, height: 800 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x03, ...new Array(20).fill(0)]);
    expect(sniffHeader(jpg)).toEqual({ mime: "image/jpeg", width: 1200, height: 800 });
    expect(checkSource({ bytes: jpg, declaredType: "image/jpeg", size: 5_000_000 })).toMatchObject({ ok: true, errors: [] });
    expect(checkSource({ bytes: jpg, declaredType: "image/jpg", size: 5_000_000 }).ok).toBe(true); // stary alias
    expect(checkSource({ bytes: jpg, declaredType: "image/png", size: 5_000_000 }).errors).toEqual(["format_mismatch"]);
    expect(checkSource({ bytes: new Uint8Array(40), declaredType: "image/jpeg", size: 10 }).errors).toEqual(["format_unrecognized"]);
    expect(checkSource({ bytes: jpg, declaredType: "image/jpeg", size: 41 * 1024 * 1024 }).errors).toEqual(["source_too_large"]);
  });
  it("fmtBytes", () => { expect(fmtBytes(204800)).toBe("200 KB"); expect(fmtBytes(5 * 1024 * 1024)).toBe("5,0 MB"); expect(fmtBytes(0)).toBe("0 KB"); });
});
