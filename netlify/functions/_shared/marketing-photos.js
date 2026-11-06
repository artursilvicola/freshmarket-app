/**
 * [feat/marketing-photos] Biblioteka zdjęć do maili PreConnect — czysta logika (bez I/O):
 *  * sniffImage        — PRAWDZIWY format i wymiary z bajtów (JPEG/PNG/WebP), nie z deklaracji klienta
 *  * validateMailImage — limity wersji „do maila” (≤ 1200 px, ≤ 350 KB, proporcje zbliżone do 3:2)
 *  * pickPhoto         — rotacja: ready + aktualna wersja, nigdy niewysłane najpierw, potem najdawniej wysłane,
 *                        omija zdjęcia z ostatnich 4 kampanii, które faktycznie wysyłały, i zdjęcia przypisane
 *                        do innych otwartych kampanii; ostrzega, gdy wybór jest za mały
 *  * freezePhoto       — kształt zamrożenia zapisywanego w kampanii przy zatwierdzeniu
 *  * hammingHex / hammingBits — odległość odcisków dHash (ostrzeżenie o bliźniaczym kadrze)
 *
 * Testy: tests/marketing-photos-lib.test.js
 */

export const PHOTO_BUCKET = "marketing-photos";
export const MAIL_IMAGE_LIMITS = Object.freeze({
  maxBytes: 350 * 1024,   // ~200 KB docelowo, 350 KB twardy limit (Codex: ≤ 1200 px, ok. 200 KB)
  minBytes: 1000,
  maxWidth: 1200, minWidth: 600,
  maxHeight: 1200, minHeight: 300,
  ratioMin: 1.3, ratioMax: 1.8,      // 3:2 = 1.5; dopuszczamy 4:3 (1.33) … 16:9 (1.78)
});
export const ROTATION = Object.freeze({ avoidRecentSending: 4, minPoolWarning: 5 });
export const ALLOWED_MIME = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

/** Rozpoznanie formatu i wymiarów z nagłówka pliku. Zwraca { mime, width, height } albo null. */
export function sniffImage(buf) {
  const b = toBytes(buf);
  if (!b || b.length < 24) return null;
  // JPEG: FF D8 FF … segmenty do SOF0/1/2 (C0, C1, C2); wymiary big-endian
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS bez SOF — uszkodzony
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = (b[i + 5] << 8) | b[i + 6], width = (b[i + 7] << 8) | b[i + 8];
        return width > 0 && height > 0 ? { mime: "image/jpeg", width, height } : null;
      }
      i += 2 + len;
    }
    return null;
  }
  // PNG: sygnatura 8 bajtów + IHDR (szer./wys. big-endian na bajtach 16–23)
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
    const width = readU32BE(b, 16), height = readU32BE(b, 20);
    return width > 0 && height > 0 ? { mime: "image/png", width, height } : null;
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP") {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 " && b.length >= 30) {
      const width = (b[26] | (b[27] << 8)) & 0x3fff, height = (b[28] | (b[29] << 8)) & 0x3fff;
      return width > 0 && height > 0 ? { mime: "image/webp", width, height } : null;
    }
    if (chunk === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      const width = (bits & 0x3fff) + 1, height = ((bits >> 14) & 0x3fff) + 1;
      return { mime: "image/webp", width, height };
    }
    if (chunk === "VP8X" && b.length >= 30) {
      const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { mime: "image/webp", width, height };
    }
    return null;
  }
  return null;
}

/**
 * Walidacja gotowej wersji „do maila”. Zwraca { ok, errors: string[], info } — info = sniff.
 * `declaredMime` (z klienta) musi zgadzać się z PRAWDZIWYM formatem.
 */
export function validateMailImage(buf, declaredMime, limits = MAIL_IMAGE_LIMITS) {
  const errors = [];
  const bytes = toBytes(buf);
  const info = sniffImage(bytes);
  if (!info) return { ok: false, errors: ["format_unrecognized"], info: null };
  if (!ALLOWED_MIME.includes(info.mime)) errors.push("format_not_allowed");
  if (declaredMime && String(declaredMime).toLowerCase() !== info.mime) errors.push("format_mismatch");
  if (bytes.length > limits.maxBytes) errors.push("too_large");
  if (bytes.length < limits.minBytes) errors.push("too_small");
  if (info.width > limits.maxWidth || info.height > limits.maxHeight) errors.push("dimensions_too_large");
  if (info.width < limits.minWidth || info.height < limits.minHeight) errors.push("dimensions_too_small");
  const ratio = info.width / info.height;
  if (ratio < limits.ratioMin || ratio > limits.ratioMax) errors.push("aspect_ratio");
  return { ok: errors.length === 0, errors, info: { ...info, bytes: bytes.length } };
}

/**
 * Rotacja zdjęć.
 * @param {object} a
 * @param {Array}  a.photos   wiersze marketing_photos (status, current_version_id, created_at, id)
 * @param {Array}  a.usage    wiersze widoku marketing_photo_usage (photo_id, campaign_id, campaign_status, sent_count, first_sent_at, last_sent_at, approved_at)
 * @param {string} [a.excludeCampaignId]  bieżąca kampania (jej własne przypisanie nie liczy się jako „inna otwarta”)
 * @param {string} [a.preferPhotoId]      ręczny wybór — zwracany, jeśli jest ready (reason: manual)
 * @returns {{ photo: object|null, reason: string, warnings: string[], pool: number, ranked: Array }}
 */
export function pickPhoto({ photos = [], usage = [], excludeCampaignId = null, preferPhotoId = null } = {}) {
  const warnings = [];
  const ready = photos.filter((p) => p && p.status === "ready" && p.current_version_id);
  if (preferPhotoId) {
    const manual = ready.find((p) => String(p.id) === String(preferPhotoId));
    if (manual) return { photo: manual, reason: "manual", warnings, pool: ready.length, ranked: [] };
    warnings.push("manual_not_ready");
  }
  if (!ready.length) return { photo: null, reason: "no_ready_photos", warnings: [...warnings, "no_ready_photos"], pool: 0, ranked: [] };
  if (ready.length < ROTATION.minPoolWarning) warnings.push("pool_small");

  // kampanie, które faktycznie wysyłały — 4 ostatnie po pierwszej wysyłce
  const sending = usage.filter((u) => Number(u.sent_count) > 0 && u.photo_id)
    .sort((a, b) => new Date(b.first_sent_at || b.approved_at || 0) - new Date(a.first_sent_at || a.approved_at || 0));
  const recent = new Set();
  for (const u of sending) { if (recent.size >= ROTATION.avoidRecentSending) break; recent.add(String(u.photo_id)); }
  // zdjęcia przypisane do INNYCH otwartych kampanii (szkic / zatwierdzona / w wysyłce)
  const openElsewhere = new Set(usage.filter((u) => ["draft", "approved", "sending"].includes(u.campaign_status) && String(u.campaign_id) !== String(excludeCampaignId || "")).map((u) => String(u.photo_id)));
  const stats = new Map();
  for (const u of sending) {
    const s = stats.get(String(u.photo_id)) || { sentCampaigns: 0, lastSentAt: null };
    s.sentCampaigns += 1;
    const t = u.last_sent_at || u.first_sent_at || u.approved_at;
    if (t && (!s.lastSentAt || new Date(t) > new Date(s.lastSentAt))) s.lastSentAt = t;
    stats.set(String(u.photo_id), s);
  }
  const ranked = ready.map((p) => {
    const s = stats.get(String(p.id)) || { sentCampaigns: 0, lastSentAt: null };
    return { photo: p, neverSent: s.sentCampaigns === 0, sentCampaigns: s.sentCampaigns, lastSentAt: s.lastSentAt, recent: recent.has(String(p.id)), openElsewhere: openElsewhere.has(String(p.id)) };
  }).sort((a, b) =>
    Number(a.recent) - Number(b.recent)                      // najpierw spoza 4 ostatnich wysyłających
    || Number(a.openElsewhere) - Number(b.openElsewhere)     // potem nieprzypisane do innych otwartych
    || Number(b.neverSent) - Number(a.neverSent)             // nigdy niewysłane
    || (new Date(a.lastSentAt || 0) - new Date(b.lastSentAt || 0)) // najdawniej wysłane
    || a.sentCampaigns - b.sentCampaigns
    || String(a.photo.created_at || "").localeCompare(String(b.photo.created_at || ""))
    || String(a.photo.id).localeCompare(String(b.photo.id)));
  const best = ranked[0];
  if (best.recent) warnings.push("all_recent");
  if (best.openElsewhere) warnings.push("all_assigned_elsewhere");
  const reason = best.recent ? "recent_fallback" : best.openElsewhere ? "assigned_elsewhere_fallback" : best.neverSent ? "never_sent" : "oldest_sent";
  return { photo: best.photo, reason, warnings, pool: ready.length, ranked: ranked.map((r) => ({ photo_id: r.photo.id, never_sent: r.neverSent, sent_campaigns: r.sentCampaigns, last_sent_at: r.lastSentAt, recent: r.recent, open_elsewhere: r.openElsewhere })) };
}

/** Zamrożenie zdjęcia do kampanii — tylko to, czego potrzebuje render i audyt. */
export function freezePhoto(photo, version) {
  if (!photo || !version) return null;
  const url = String(version.public_url || "");
  if (!/^https:\/\//i.test(url)) throw new Error("photo_url_not_https");
  return {
    photo_id: photo.id, version_id: version.id, version_no: version.version_no,
    url, width: version.width, height: version.height, sha256: version.sha256,
    alt_pl: String(photo.alt_pl || ""), alt_en: String(photo.alt_en || ""),
    caption_pl: photo.caption_pl ? String(photo.caption_pl) : null, caption_en: photo.caption_en ? String(photo.caption_en) : null,
    title: String(photo.title || ""), kind: photo.kind || "authentic", year: photo.year ?? null,
    frozen_at: new Date().toISOString(),
  };
}

/** Kształt zamrożenia poprawny? (render maila nie startuje bez adresu HTTPS i altów). */
export function validateFrozenPhoto(f) {
  if (!f || typeof f !== "object") return ["missing"];
  const errors = [];
  if (!/^https:\/\//i.test(String(f.url || ""))) errors.push("url_not_https");
  if (!f.photo_id || !f.version_id) errors.push("ids_missing");
  if (!String(f.alt_pl || "").trim() || !String(f.alt_en || "").trim()) errors.push("alt_missing");
  return errors;
}

export function hammingBits(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || !y || x.length !== y.length) return null;
  let d = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
  return d;
}
/** Odległość dwu odcisków zapisanych jako 64-bitowy ciąg '0'/'1' albo 16-znakowy hex. */
export function hammingHex(a, b) {
  const norm = (s) => { const v = String(s || "").trim(); return /^[01]{64}$/.test(v) ? v : /^[0-9a-f]{16}$/i.test(v) ? [...v].map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("") : null; };
  return hammingBits(norm(a), norm(b));
}

/** Ścieżka w buckecie: photos/<photo_id>/v<n>-<sha12>.<ext> — nowa wersja = nowa ścieżka. */
export function versionPath(photoId, versionNo, sha256, mime) {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `photos/${photoId}/v${versionNo}-${String(sha256).slice(0, 12)}.${ext}`;
}

/** Publiczny adres pliku w Storage (bucket publiczny). */
export function publicObjectUrl(supabaseUrl, bucket, objectPath) {
  return `${String(supabaseUrl || "").replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

function toBytes(buf) {
  if (!buf) return null;
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  return null;
}
function readU32BE(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
