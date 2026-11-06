// [feat/marketing-photos] Przygotowanie zdjęcia do biblioteki W PRZEGLĄDARCE administratora:
// prawdziwy format/wymiary pliku (nagłówek, nie rozszerzenie), kadr 3:2 (podgląd + przesunięcie), skalowanie
// do ≤ 1200 px, zapis JPEG z doborem jakości pod ~200 KB (twardy limit funkcji 350 KB), odcisk sha256 oryginału
// (duplikaty) i dHash 9×8 wersji do maila (bliźniacze kadry). Canvas → nowy plik BEZ metadanych (EXIF/GPS).
// Czyste funkcje (testowane): cropRect, qualitySteps, dhashFromGray, sniffHeader, fmtBytes. Funkcje z canvasem
// (prepareMailVersion, fileSha256, decodeImage) działają tylko w przeglądarce.

export const MAIL_PHOTO = Object.freeze({ width: 1200, height: 800, ratio: 1.5, targetBytes: 200 * 1024, maxBytes: 350 * 1024, maxSourceBytes: 40 * 1024 * 1024 });
export const QUALITY_STEPS = Object.freeze([0.86, 0.82, 0.78, 0.74, 0.7, 0.64, 0.58]);

/**
 * Kadr 3:2 wycięty z obrazu o wymiarach w×h, przesunięty o offset ∈ [0,1] (0 = lewo/góra, 0.5 = środek, 1 = prawo/dół).
 * Zwraca {sx, sy, sw, sh} w pikselach źródła — największy prostokąt o proporcji `ratio` mieszczący się w obrazie.
 */
export function cropRect(w, h, offset = 0.5, ratio = MAIL_PHOTO.ratio) {
  const W = Math.max(1, Math.floor(Number(w) || 0)), H = Math.max(1, Math.floor(Number(h) || 0));
  const o = Math.min(1, Math.max(0, Number(offset) || 0));
  let sw = W, sh = Math.round(W / ratio);
  if (sh > H) { sh = H; sw = Math.round(H * ratio); }
  sw = Math.min(sw, W); sh = Math.min(sh, H);
  const sx = Math.round((W - sw) * (sw < W ? o : 0));
  const sy = Math.round((H - sh) * (sh < H ? o : 0));
  return { sx, sy, sw, sh, landscape: W >= H };
}

/** Kolejność jakości JPEG: zaczyna od `start`, schodzi w dół aż plik ≤ targetBytes; nigdy poniżej ostatniego stopnia. */
export function qualitySteps(start = 0.86) {
  return QUALITY_STEPS.filter((q) => q <= start + 1e-9);
}

/** Wybór pierwszego stopnia, który mieści się w limicie; gdy żaden — ostatni (najmniejszy). sizes: {quality → bytes}. */
export function pickQuality(sizes, target = MAIL_PHOTO.targetBytes) {
  const entries = Object.entries(sizes).map(([q, b]) => [Number(q), Number(b)]).sort((a, b) => b[0] - a[0]);
  for (const [q, b] of entries) if (b <= target) return q;
  return entries.length ? entries[entries.length - 1][0] : null;
}

/** dHash z macierzy szarości 9×8 (72 wartości, wiersze po 9): bit = piksel jaśniejszy od sąsiada z prawej. 64 znaki '0'/'1'. */
export function dhashFromGray(gray) {
  if (!gray || gray.length !== 72) throw new Error("dhash expects 9x8 gray");
  let out = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out += gray[y * 9 + x] > gray[y * 9 + x + 1] ? "1" : "0";
  return out;
}

/** Nagłówek pliku → { mime, width, height } albo null (ta sama logika co po stronie funkcji, bez zaufania do rozszerzenia). */
export function sniffHeader(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 24) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m === 0xd9 || m === 0xda) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) return { mime: "image/jpeg", height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const u32 = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
    return { mime: "image/png", width: u32(16), height: u32(20) };
  }
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP") return { mime: "image/webp", width: null, height: null };
  return null;
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
  return Math.round(v / 1024) + " KB";
}

/** Czy plik (po nagłówku) nadaje się jako źródło: JPEG/PNG/WebP, ≤ 40 MB, nagłówek zgodny z deklaracją. */
export function checkSource({ bytes, declaredType, size }) {
  const errors = [];
  const info = sniffHeader(bytes);
  if (!info) errors.push("format_unrecognized");
  else if (declaredType && String(declaredType).toLowerCase() !== info.mime && !(declaredType === "image/jpg" && info.mime === "image/jpeg")) errors.push("format_mismatch");
  if (Number(size) > MAIL_PHOTO.maxSourceBytes) errors.push("source_too_large");
  return { ok: errors.length === 0, errors, info };
}

// ── tylko przeglądarka ────────────────────────────────────────────────────────
const toHex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function fileSha256(file) {
  const buf = await file.arrayBuffer();
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}

/** Dekoduje plik do bitmapy z poprawną orientacją EXIF (createImageBitmap). */
export async function decodeImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file, { imageOrientation: "from-image" });
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("decode_failed")); img.src = URL.createObjectURL(file); });
}

/**
 * Wersja „do maila”: kadr 3:2 (offset), skalowanie do 1200×800, JPEG z doborem jakości pod ~200 KB, dHash.
 * Canvas tworzy NOWY plik — żadnych metadanych oryginału (EXIF, lokalizacja GPS, nazwa aparatu).
 * @returns {Promise<{ blob: Blob, width, height, quality, bytes, dhash, crop }>}
 */
export async function prepareMailVersion(bitmap, { offset = 0.5, maxWidth = MAIL_PHOTO.width, target = MAIL_PHOTO.targetBytes } = {}) {
  const crop = cropRect(bitmap.width, bitmap.height, offset);
  const outW = Math.min(maxWidth, crop.sw), outH = Math.round(outW / MAIL_PHOTO.ratio);
  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);
  const sizes = {}; let chosen = null, blob = null;
  for (const q of qualitySteps()) {
    const b = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
    sizes[q] = b.size; chosen = q; blob = b;
    if (b.size <= target) break;
  }
  // odcisk dHash: 9×8 w skali szarości z gotowego kadru
  const small = document.createElement("canvas"); small.width = 9; small.height = 8;
  const sctx = small.getContext("2d"); sctx.drawImage(canvas, 0, 0, 9, 8);
  const px = sctx.getImageData(0, 0, 9, 8).data; const gray = [];
  for (let i = 0; i < px.length; i += 4) gray.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  return { blob, width: outW, height: outH, quality: chosen, bytes: blob.size, dhash: dhashFromGray(gray), crop, sizes };
}

export async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  let s = ""; const u = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < u.length; i += chunk) s += String.fromCharCode.apply(null, u.subarray(i, i + chunk));
  return btoa(s);
}
