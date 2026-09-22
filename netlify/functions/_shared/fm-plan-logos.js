/**
 * [feat/fm-plan-send-server-card] Kanoniczne logotypy do kart PDF generowanych na serwerze.
 *
 * Źródłem obrazu jest WYŁĄCZNIE adres z bazy (companies.logo_url / retailers.logo_url)
 * na naszym Supabase Storage. Przeglądarka administratora nie dostarcza żadnych bajtów —
 * obraz z innego hosta, inny format, za duży plik albo błąd sieci = brak logo
 * (renderer używa dotychczasowego fallbacku: inicjały / nazwa). Nic nie blokuje wysyłki.
 *
 * Supabase trzyma logotypy głównie jako WebP, a pdfmake w Node czyta tylko PNG/JPEG,
 * więc WebP dekodujemy zaufanym dekoderem WASM (@jsquash/webp, bez natywnych modułów)
 * i kodujemy do PNG własnym, minimalnym koderem (zlib z Node). Obrazy są pomniejszane
 * do maks. 600×300 px (kafelek na karcie ma 60×24 / 68×34 pt).
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 4000;
const TARGET_W = 600, TARGET_H = 300;
const FETCH_TIMEOUT_MS = 4000;
const CONCURRENCY = 6;
const CACHE_MAX = 300;
const cache = new Map(); // url → data URI | null (ciepła lambda)

// Ścieżka do .wasm: w bundlu Netlify (CJS, esbuild) `import.meta.url` nie istnieje, ale jest `require`;
// lokalnie (ESM, vitest/CLI) jest odwrotnie. Rozwiązujemy przez node_modules obok modułu.
function resolveWasm() {
  const spec = "@jsquash/webp/codec/dec/webp_dec.wasm";
  if (typeof require === "function") return require.resolve(spec);
  const base = (typeof __filename === "string" && __filename) || (typeof import.meta !== "undefined" && import.meta.url) || null;
  return createRequire(base).resolve(spec);
}
let decoderReady = null;
async function webpDecoder() {
  if (!decoderReady) {
    decoderReady = (async () => {
      const mod = await import("@jsquash/webp/decode.js");
      const wasm = await WebAssembly.compile(await readFile(resolveWasm()));
      await mod.init(wasm);
      return mod.default;
    })().catch((e) => { decoderReady = null; throw e; });
  }
  return decoderReady;
}

// ── minimalny koder PNG (RGBA 8-bit, filtr 0) ──────────────────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
export function encodePngRgba(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

// ── pomniejszanie (uśrednianie bloków; alfa premultiplikowana) ───────────
export function downscaleRgba(rgba, width, height, maxW = TARGET_W, maxH = TARGET_H) {
  const scale = Math.min(1, maxW / width, maxH / height);
  if (scale >= 1) return { data: rgba, width, height };
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * height / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * width / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * width + xx) * 4; const al = rgba[i + 3]; r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++; }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; } out[o + 3] = a / n;
    }
  }
  return { data: out, width: w, height: h };
}

export const isWebp = (buf) => buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
export const isPng = (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
export const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

export async function webpToPngDataUri(buf) {
  const decode = await webpDecoder();
  // świeża kopia (offset 0): Buffer z puli Node ma niezerowy byteOffset, a dekoder chce czystego ArrayBuffer
  const img = await decode(Uint8Array.from(buf).buffer);
  if (!img || !img.width || !img.height || img.width > MAX_SIDE || img.height > MAX_SIDE) return null;
  const small = downscaleRgba(img.data, img.width, img.height);
  return "data:image/png;base64," + encodePngRgba(small.data, small.width, small.height).toString("base64");
}

// Tylko nasz Supabase Storage (publiczne obiekty). Wszystko inne → brak logo.
export function isAllowedLogoUrl(url, supabaseUrl) {
  try {
    const u = new URL(String(url || "")); const base = new URL(String(supabaseUrl || ""));
    return u.protocol === "https:" && u.origin === base.origin && u.pathname.startsWith("/storage/v1/object/public/");
  } catch { return false; }
}

async function fetchBytes(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "error" });
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > MAX_BYTES ? null : buf;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// URL → data URI (PNG/JPEG) albo null. Nigdy nie rzuca.
export async function canonicalLogoDataUri(url, supabaseUrl) {
  if (!isAllowedLogoUrl(url, supabaseUrl)) return null;
  if (cache.has(url)) return cache.get(url);
  let out = null;
  try {
    const buf = await fetchBytes(url);
    if (buf) {
      if (isPng(buf)) out = "data:image/png;base64," + buf.toString("base64");
      else if (isJpeg(buf)) out = "data:image/jpeg;base64," + buf.toString("base64");
      else if (isWebp(buf)) out = await webpToPngDataUri(buf);
    }
  } catch { out = null; }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(url, out);
  return out;
}

// Uzupełnia kartę modelu (dostawcy lub sieci) kanonicznymi logotypami: własne + kontrahentów.
export async function attachCanonicalLogos(card, supabaseUrl) {
  const jobs = [];
  jobs.push([card, card.logoUrl]);
  for (const m of card.meetings) { const target = card.kind === "supplier" ? m.chain : m.supplier; jobs.push([target, target.logoUrl]); }
  const byUrl = new Map();
  for (const [, url] of jobs) if (url && !byUrl.has(url)) byUrl.set(url, null);
  const urls = [...byUrl.keys()];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
    while (next < urls.length) { const url = urls[next++]; byUrl.set(url, await canonicalLogoDataUri(url, supabaseUrl)); }
  }));
  let attached = 0;
  for (const [target, url] of jobs) { target.logo = url ? byUrl.get(url) || null : null; if (target.logo) attached++; }
  return { attached, requested: urls.length };
}

export const __testing = { cache };
