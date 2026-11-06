/**
 * Netlify Function: marketing-photos
 * POST /.netlify/functions/marketing-photos   (admin JWT)
 * Body: { action: 'list' | 'upload' | 'approve' | 'update' | 'disable' | 'enable' | 'suggest' | 'usage', ... }
 *
 * [feat/marketing-photos] Biblioteka zdjęć do maili PreConnect (układ v2). Pliki w Storage (bucket publiczny
 * do odczytu `marketing-photos`), metadane w marketing_photos / marketing_photo_versions. ZAPIS do bucketa
 * tylko tutaj (service_role) po walidacji PRAWDZIWEGO formatu/wymiarów/rozmiaru z bajtów.
 *
 *  list     → zdjęcia (+ aktualna wersja, użycie: ile kampanii wysyłało, ostatnie użycie, otwarte przypisania)
 *             + ostrzeżenie o małej puli; publiczny adres plików jest jawny (klient poczty musi go pobrać)
 *  upload   → { title, alt_pl, alt_en, caption_pl?, caption_en?, kind, source?, rights?, categories?, year?,
 *               mime, data_base64, source_sha256?, source_name?, source_bytes?, source_width?, source_height?,
 *               dhash?, photo_id? (nowa wersja istniejącego zdjęcia), allow_similar? }
 *             przeglądarka wysyła już wykadrowaną i przeskalowaną wersję „do maila” (canvas → bez EXIF/GPS);
 *             serwer sprawdza magic bytes, wymiary (≤ 1200 px), rozmiar (≤ 350 KB), proporcje; duplikat
 *             oryginału (source_sha256) albo pliku (sha256) → 409; bliźniaczy kadr (dHash ≤ 6) → 409 similar_exists,
 *             chyba że allow_similar. Plik ląduje w PRYWATNYM buckecie marketing-photos-pending (public_url = null) —
 *             nikt go nie zobaczy, dopóki administrator nie zatwierdzi KONKRETNEJ wersji (review Codexa P1).
 *             Nowe zdjęcie = status pending; nowa wersja istniejącego zdjęcia NIE dziedziczy zatwierdzenia: zdjęcie zostaje
 *             przy approved_version_id (stary kadr w rotacji), nowy kadr czeka na approve (review Codexa P2).
 *  approve  → { photo_id, version_id? (domyślnie ostatnio wgrana) } → publikacja tej wersji (kopia pod niezmienny adres
 *             w publicznym buckecie, sha256 sprawdzony), approved_version_id = ta wersja, status ready
 *  update   → { photo_id, title?, alt_pl?, alt_en?, caption_pl?, caption_en?, kind?, source?, rights?, categories?, year?, review_note? }
 *             metadane; zamrożone kampanie mają własną kopię (frozen_photo), więc zmiana nie dotyka starych maili
 *  disable  → { photo_id } → status disabled (plik zostaje, stare maile nietknięte); enable → ready
 *  suggest  → { campaign_id? } → propozycja z rotacji (bez zapisu)
 *  usage    → { photo_id } → kampanie, które używały zdjęcia (z widoku marketing_photo_usage)
 *
 * Nic nie wysyła. Nie kasuje plików ani wierszy. Marketing nie rozlicza kredytów.
 */
import { createHash } from "node:crypto";
import { requireAdmin, json, parseBody, MARKETING_CORS } from "./_shared/marketing-auth.js";
import { ALLOWED_MIME, PHOTO_BUCKET, PENDING_BUCKET, hammingHex, pickPhoto, validateMailImage, versionPath } from "./_shared/marketing-photos.js";
import { loadLibrary, loadPhoto, loadPhotoVersion, isPublished, publishVersion } from "./_shared/marketing-photo-data.js";

const MAX_BASE64 = 600_000; // ~450 KB po dekodowaniu; twardy limit danych wejściowych
const SIMILAR_MAX_DISTANCE = 6;
const KINDS = ["authentic", "ai"];
const LIMITS = { title: 160, alt: 200, caption: 200, source: 300, rights: 300, review_note: 300, category: 40, categories: 8 };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: MARKETING_CORS };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = await requireAdmin(event, "marketing-photos");
  if (!auth.ok) return auth.response;
  const body = parseBody(event);
  if (!body) return json(400, { error: "invalid_json" });
  const { supaSvc, env, caller } = auth;

  try {
    switch (String(body.action || "")) {
      case "list": {
        const { photos, versions, usage } = await loadLibrary(supaSvc);
        const byPhoto = groupUsage(usage);
        const rows = photos.map((p) => decorate(p, versions, byPhoto));
        const readyCount = rows.filter((r) => r.status === "ready" && r.approved_version).length;
        return json(200, { ok: true, photos: rows, ready_count: readyCount, pending_versions: rows.filter((r) => r.pending_version).length, warnings: readyCount < 5 ? ["pool_small"] : [], bucket: PHOTO_BUCKET, pending_bucket: PENDING_BUCKET, public_read: true });
      }
      case "upload": {
        const meta = pickMeta(body, true);
        if (meta.errors.length) return json(422, { error: "metadata_invalid", errors: meta.errors });
        const b64 = String(body.data_base64 || "");
        if (!b64 || b64.length > MAX_BASE64) return json(413, { error: "payload_too_large", max_base64: MAX_BASE64 });
        let bytes;
        try { bytes = Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64"); } catch { return json(400, { error: "data_invalid" }); }
        const declared = String(body.mime || "").toLowerCase();
        if (!ALLOWED_MIME.includes(declared)) return json(415, { error: "format_not_allowed", allowed: ALLOWED_MIME });
        const check = validateMailImage(bytes, declared);
        if (!check.ok) return json(422, { error: "image_invalid", errors: check.errors, info: check.info });
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const sourceSha = /^[0-9a-f]{64}$/i.test(String(body.source_sha256 || "")) ? String(body.source_sha256).toLowerCase() : null;
        const dhash = /^[01]{64}$/.test(String(body.dhash || "")) ? String(body.dhash) : null;

        const { photos, versions } = await loadLibrary(supaSvc, { usage: false });
        const existingPhoto = body.photo_id ? photos.find((p) => String(p.id) === String(body.photo_id)) : null;
        if (body.photo_id && !existingPhoto) return json(404, { error: "photo_not_found" });
        // duplikaty: ten sam oryginał / ten sam plik — tylko dla NOWEGO zdjęcia (nowa wersja istniejącego może mieć ten sam oryginał)
        if (!existingPhoto) {
          if (sourceSha) { const dup = photos.find((p) => p.source_sha256 === sourceSha); if (dup) return json(409, { error: "duplicate_source", photo_id: dup.id, title: dup.title }); }
          const dupFile = versions.find((v) => v.sha256 === sha256);
          if (dupFile) return json(409, { error: "duplicate_file", photo_id: dupFile.photo_id });
          if (dhash && body.allow_similar !== true) {
            const similar = photos.filter((p) => p.dhash && hammingHex(p.dhash, dhash) != null && hammingHex(p.dhash, dhash) <= SIMILAR_MAX_DISTANCE)
              .map((p) => ({ photo_id: p.id, title: p.title, distance: hammingHex(p.dhash, dhash) }));
            if (similar.length) return json(409, { error: "similar_exists", similar, hint: "bliźniaczy kadr w bibliotece — wgraj mimo to (allow_similar) albo pomiń" });
          }
        }

        const nowIso = new Date().toISOString();
        let photo = existingPhoto;
        if (!photo) {
          const { data, error } = await supaSvc.from("marketing_photos").insert({
            ...meta.values, status: "pending", source_sha256: sourceSha, dhash, created_by: caller.id, updated_at: nowIso,
          }).select("*").maybeSingle();
          if (error) throw new Error("insert photo: " + error.message);
          photo = data;
        }
        const versionNo = 1 + versions.filter((v) => String(v.photo_id) === String(photo.id)).reduce((m, v) => Math.max(m, Number(v.version_no) || 0), 0);
        const path = versionPath(photo.id, versionNo, sha256, check.info.mime);
        // [P1] plik ląduje w PRYWATNYM buckecie; nigdy nie jest nadpisywany (upsert: false); nowa wersja = nowa ścieżka.
        // Publiczny adres powstaje dopiero przy zatwierdzeniu tej wersji (publishVersion).
        const up = await supaSvc.storage.from(PENDING_BUCKET).upload(path, bytes, { contentType: check.info.mime, cacheControl: "31536000", upsert: false });
        if (up.error) throw new Error("storage upload: " + up.error.message);
        const { data: version, error: vErr } = await supaSvc.from("marketing_photo_versions").insert({
          photo_id: photo.id, version_no: versionNo, storage_bucket: PENDING_BUCKET, storage_path: path, public_url: null,
          width: check.info.width, height: check.info.height, bytes: bytes.length, mime: check.info.mime, sha256, created_by: caller.id,
        }).select("*").maybeSingle();
        if (vErr) throw new Error("insert version: " + vErr.message);
        // [P2] current_version_id = ostatnio wgrany kadr; approved_version_id i status zostają (stary kadr dalej w rotacji)
        const patch = { current_version_id: version.id, updated_at: nowIso };
        if (existingPhoto && dhash) patch.dhash = dhash;
        const { data: updated, error: uErr } = await supaSvc.from("marketing_photos").update(patch).eq("id", photo.id).select("*").maybeSingle();
        if (uErr) throw new Error("update photo: " + uErr.message);
        return json(200, { ok: true, photo: { ...(updated || photo), current_version: version, pending_version: version }, version, new_photo: !existingPhoto, awaiting_approval: true, source: { sha256: sourceSha, name: str(body.source_name, 200), bytes: num(body.source_bytes), width: num(body.source_width), height: num(body.source_height) } });
      }
      case "approve": {
        // [P1/P2] zatwierdzenie KONKRETNEJ wersji: publikacja pliku pod niezmienny adres + approved_version_id
        const photo = await loadPhoto(supaSvc, body.photo_id);
        if (!photo) return json(404, { error: "photo_not_found" });
        if (photo.status === "disabled") return json(409, { error: "photo_disabled", hint: "najpierw włącz zdjęcie" });
        const versionId = body.version_id || photo.current_version_id;
        if (!versionId) return json(409, { error: "photo_without_file" });
        const version = await loadPhotoVersion(supaSvc, versionId);
        if (!version || String(version.photo_id) !== String(photo.id)) return json(404, { error: "version_not_found" });
        if (String(photo.approved_version_id || "") === String(version.id) && photo.status === "ready") return json(409, { error: "version_already_approved" });
        const pub = await publishVersion(supaSvc, version, caller.id);
        const nowIso = new Date().toISOString();
        const { data, error } = await supaSvc.from("marketing_photos")
          .update({ status: "ready", approved_version_id: version.id, approved_by: caller.id, approved_at: nowIso, disabled_by: null, disabled_at: null, updated_at: nowIso })
          .eq("id", photo.id).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        return json(200, { ok: true, photo: { ...data, approved_version: pub.version }, version: pub.version, published: pub.published });
      }
      case "disable":
      case "enable": {
        const photo = await loadPhoto(supaSvc, body.photo_id);
        if (!photo) return json(404, { error: "photo_not_found" });
        const action = String(body.action);
        const nowIso = new Date().toISOString();
        if (action === "enable") {
          if (photo.status !== "disabled") return json(409, { error: "photo_not_disabled", status: photo.status });
          const approved = await loadPhotoVersion(supaSvc, photo.approved_version_id);
          if (!isPublished(approved)) return json(409, { error: "photo_without_approved_version", hint: "zatwierdź kadr (approve) zamiast włączać" });
        }
        const patch = action === "disable"
          ? { status: "disabled", disabled_by: caller.id, disabled_at: nowIso, updated_at: nowIso }
          : { status: "ready", disabled_by: null, disabled_at: null, updated_at: nowIso };
        const { data, error } = await supaSvc.from("marketing_photos").update(patch).eq("id", photo.id).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        return json(200, { ok: true, photo: data });
      }
      case "update": {
        const photo = await loadPhoto(supaSvc, body.photo_id);
        if (!photo) return json(404, { error: "photo_not_found" });
        const meta = pickMeta({ ...photo, ...body, categories: body.categories ?? photo.categories }, false);
        if (meta.errors.length) return json(422, { error: "metadata_invalid", errors: meta.errors });
        const { data, error } = await supaSvc.from("marketing_photos").update({ ...meta.values, review_note: body.review_note === undefined ? photo.review_note : str(body.review_note, LIMITS.review_note), updated_at: new Date().toISOString() }).eq("id", photo.id).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        return json(200, { ok: true, photo: data });
      }
      case "suggest": {
        const { photos, versions, usage } = await loadLibrary(supaSvc);
        const pick = pickPhoto({ photos, usage, excludeCampaignId: body.campaign_id || null, preferPhotoId: body.photo_id || null });
        const byPhoto = groupUsage(usage);
        return json(200, { ok: true, photo: pick.photo ? decorate(pick.photo, versions, byPhoto) : null, reason: pick.reason, warnings: pick.warnings, pool: pick.pool, ranked: pick.ranked });
      }
      case "usage": {
        if (!body.photo_id) return json(400, { error: "photo_id_required" });
        const { data, error } = await supaSvc.from("marketing_photo_usage").select("*").eq("photo_id", body.photo_id).order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        return json(200, { ok: true, usage: data || [] });
      }
      default:
        return json(400, { error: "unknown_action" });
    }
  } catch (e) {
    console.error("[marketing-photos]", e?.message || e);
    return json(500, { error: "photos_failed", detail: String(e?.message || e) });
  }
};

function groupUsage(usage) {
  const by = new Map();
  for (const u of usage || []) {
    const k = String(u.photo_id);
    const s = by.get(k) || { campaigns: 0, sent_campaigns: 0, last_sent_at: null, open_assignments: 0 };
    s.campaigns += 1;
    if (Number(u.sent_count) > 0) { s.sent_campaigns += 1; const t = u.last_sent_at || u.first_sent_at; if (t && (!s.last_sent_at || new Date(t) > new Date(s.last_sent_at))) s.last_sent_at = t; }
    if (["draft", "approved", "sending"].includes(u.campaign_status)) s.open_assignments += 1;
    by.set(k, s);
  }
  return by;
}

function decorate(p, versions, byPhoto) {
  const current = versions.find((v) => String(v.id) === String(p.current_version_id)) || null;
  const approved = versions.find((v) => String(v.id) === String(p.approved_version_id)) || null;
  // nowy kadr czeka na akceptację: ostatnio wgrana wersja ≠ zatwierdzona i jeszcze nieopublikowana
  const pending = current && (!approved || String(current.id) !== String(approved.id)) && !isPublished(current) ? current : null;
  return { ...p, current_version: current, approved_version: isPublished(approved) ? approved : null, pending_version: pending, versions_count: versions.filter((v) => String(v.photo_id) === String(p.id)).length, usage: byPhoto.get(String(p.id)) || { campaigns: 0, sent_campaigns: 0, last_sent_at: null, open_assignments: 0 } };
}

function pickMeta(src, requireAlt) {
  const errors = [];
  const title = str(src.title, LIMITS.title), alt_pl = str(src.alt_pl, LIMITS.alt), alt_en = str(src.alt_en, LIMITS.alt);
  if (!title) errors.push("title_required");
  if (requireAlt || src.alt_pl !== undefined) { if (!alt_pl) errors.push("alt_pl_required"); }
  if (requireAlt || src.alt_en !== undefined) { if (!alt_en) errors.push("alt_en_required"); }
  const kind = src.kind == null ? "authentic" : String(src.kind);
  if (!KINDS.includes(kind)) errors.push("kind_invalid");
  const year = src.year == null || src.year === "" ? null : Number(src.year);
  if (year != null && (!Number.isInteger(year) || year < 2000 || year > 2100)) errors.push("year_invalid");
  const cats = Array.isArray(src.categories) ? src.categories.map((c) => str(c, LIMITS.category)).filter(Boolean).slice(0, LIMITS.categories) : [];
  for (const f of ["title", "alt_pl", "alt_en", "caption_pl", "caption_en", "source", "rights"]) if (/[<>]/.test(String(src[f] ?? ""))) errors.push(f + "_html_not_allowed");
  return { errors, values: { title, alt_pl, alt_en, caption_pl: str(src.caption_pl, LIMITS.caption), caption_en: str(src.caption_en, LIMITS.caption), kind, source: str(src.source, LIMITS.source), rights: str(src.rights, LIMITS.rights), categories: cats, year, review_note: str(src.review_note, LIMITS.review_note) } };
}
function str(v, max) { const s = String(v ?? "").trim(); return s ? s.slice(0, max) : null; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
