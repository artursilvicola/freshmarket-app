/**
 * [feat/marketing-photos] Odczyt biblioteki zdjęć (service_role) wspólny dla funkcji marketing-photos,
 * marketing-campaign i marketing-preview + publikacja wersji (review Codexa P1/P2):
 *  * upload ląduje w PRYWATNYM buckecie marketing-photos-pending (public_url = null);
 *  * publishVersion kopiuje bajty pod NIEZMIENNĄ ścieżkę w publicznym marketing-photos, sprawdza sha256 i ustawia
 *    public_url/published_at (jedyne dozwolone przejście w triggerze niezmienności);
 *  * rotacja i wybór w kampanii używają WYŁĄCZNIE photo.approved_version_id (konkretna zatwierdzona, opublikowana wersja).
 * Czysta logika rotacji/walidacji: ./marketing-photos.js.
 */
import { createHash } from "node:crypto";
import { PHOTO_BUCKET, PENDING_BUCKET, pickPhoto } from "./marketing-photos.js";

/** Biblioteka: zdjęcia + wersje (+ użycie). Wersje bez filtra po statusie — stare kampanie wskazują także na wyłączone. */
export async function loadLibrary(supaSvc, { usage = true } = {}) {
  const { data: photos, error } = await supaSvc.from("marketing_photos").select("*").order("created_at", { ascending: true });
  if (error) throw new Error("marketing_photos: " + error.message);
  const { data: versions, error: vErr } = await supaSvc.from("marketing_photo_versions").select("*").order("version_no", { ascending: true });
  if (vErr) throw new Error("marketing_photo_versions: " + vErr.message);
  let use = [];
  if (usage) {
    const { data, error: uErr } = await supaSvc.from("marketing_photo_usage").select("*");
    if (uErr) throw new Error("marketing_photo_usage: " + uErr.message);
    use = data || [];
  }
  return { photos: photos || [], versions: versions || [], usage: use };
}

export async function loadPhoto(supaSvc, id) {
  if (!id) return null;
  const { data, error } = await supaSvc.from("marketing_photos").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("marketing_photos: " + error.message);
  return data || null;
}

export async function loadPhotoVersion(supaSvc, id) {
  if (!id) return null;
  const { data, error } = await supaSvc.from("marketing_photo_versions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("marketing_photo_versions: " + error.message);
  return data || null;
}

/** Wersja opublikowana = ma published_at i adres HTTPS (tylko taka może trafić do kampanii / maila). */
export function isPublished(version) {
  return Boolean(version && version.published_at && /^https:\/\//i.test(String(version.public_url || "")));
}

/**
 * Zdjęcie kampanii do podglądu/panelu: po zatwierdzeniu ZAWSZE zamrożenie (frozen_photo); w szkicu — wybrana
 * wersja (photo_version_id; domyślnie zatwierdzona wersja zdjęcia) z aktualnymi metadanymi. Kształt jak frozen_photo + { frozen, status }.
 */
export async function resolveCampaignPhoto(supaSvc, campaign) {
  if (!campaign) return null;
  if (campaign.frozen_photo && campaign.frozen_photo.url) return { ...campaign.frozen_photo, frozen: true };
  if (!campaign.photo_id) return null;
  const photo = await loadPhoto(supaSvc, campaign.photo_id);
  if (!photo) return null;
  const version = await loadPhotoVersion(supaSvc, campaign.photo_version_id || photo.approved_version_id);
  if (!version || !isPublished(version)) return null;
  return {
    photo_id: photo.id, version_id: version.id, version_no: version.version_no, url: version.public_url, width: version.width, height: version.height, sha256: version.sha256,
    alt_pl: photo.alt_pl, alt_en: photo.alt_en, caption_pl: photo.caption_pl, caption_en: photo.caption_en, title: photo.title, kind: photo.kind, year: photo.year,
    status: photo.status, frozen: false,
  };
}

/** Propozycja z rotacji dla kampanii (bez zapisu). Wersja = ZATWIERDZONA wersja zdjęcia (nigdy „ostatnio wgrana”). */
export async function suggestPhoto(supaSvc, { campaignId = null, preferPhotoId = null } = {}) {
  const { photos, versions, usage } = await loadLibrary(supaSvc);
  const pick = pickPhoto({ photos, usage, excludeCampaignId: campaignId, preferPhotoId });
  const version = pick.photo ? versions.find((v) => String(v.id) === String(pick.photo.approved_version_id)) || null : null;
  return { ...pick, version: isPublished(version) ? version : null, photos, versions, usage };
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
async function readObject(supaSvc, bucket, path) {
  const dl = await supaSvc.storage.from(bucket).download(path);
  if (dl.error) throw new Error(`storage download ${bucket}/${path}: ${dl.error.message}`);
  return Buffer.from(await dl.data.arrayBuffer());
}
async function writeObject(supaSvc, bucket, path, bytes, mime) {
  // nigdy nie nadpisujemy (upsert: false); plik już istniejący pod TĄ ścieżką musi mieć te same bajty (ścieżka zawiera sha12)
  const up = await supaSvc.storage.from(bucket).upload(path, bytes, { contentType: mime, cacheControl: "31536000", upsert: false });
  if (up.error && !/already exists|duplicate/i.test(up.error.message)) throw new Error(`storage upload ${bucket}/${path}: ${up.error.message}`);
  return !up.error;
}

/**
 * Publikacja wersji: prywatny bucket → publiczny pod tą samą, niezmienną ścieżką; weryfikacja sha256 bajtów;
 * wiersz wersji dostaje public_url + published_at (trigger dopuszcza tylko to przejście). Kopia prywatna jest usuwana.
 * Idempotentne: wersja już opublikowana wraca bez zmian.
 */
export async function publishVersion(supaSvc, version, callerId = null) {
  if (!version) throw new Error("version_required");
  if (isPublished(version)) return { version, published: false };
  const sourceBucket = version.storage_bucket || PENDING_BUCKET; // zapamiętane PRZED update (obiekt wiersza może być współdzielony)
  const bytes = await readObject(supaSvc, sourceBucket, version.storage_path);
  if (sha256(bytes) !== version.sha256) throw new Error("publish: sha256 mismatch for " + version.storage_path);
  await writeObject(supaSvc, PHOTO_BUCKET, version.storage_path, bytes, version.mime);
  const pub = supaSvc.storage.from(PHOTO_BUCKET).getPublicUrl(version.storage_path);
  const publicUrl = String(pub?.data?.publicUrl || "");
  if (!/^https:\/\//i.test(publicUrl)) throw new Error("public_url_not_https");
  const { data, error } = await supaSvc.from("marketing_photo_versions")
    .update({ storage_bucket: PHOTO_BUCKET, public_url: publicUrl, published_at: new Date().toISOString(), published_by: callerId })
    .eq("id", version.id).is("published_at", null).select("*").maybeSingle();
  if (error) throw new Error("publish version: " + error.message);
  if (!data) throw new Error("publish version: row not updated (already published?)");
  if (sourceBucket !== PHOTO_BUCKET) await supaSvc.storage.from(sourceBucket).remove([version.storage_path]).catch(() => {});
  return { version: data, published: true };
}

/**
 * Cofnięcie publikacji (TYLKO porządki, np. pliki pending opublikowane przed migracją 20261107110000): publiczny → prywatny,
 * public_url = null. Trigger odrzuca, gdy wersję używa jakakolwiek kampania albo jest zatwierdzoną wersją zdjęcia.
 */
export async function unpublishVersion(supaSvc, version) {
  if (!version || !version.published_at) return { version, unpublished: false };
  // [review Codexa 3/P2] kolejność PONAWIALNA: 1) kopia do prywatnego, 2) usunięcie publicznego, 3) dopiero wtedy wiersz.
  // Gdy krok 2 zawiedzie, wiersz zostaje „published” i kolejne uruchomienie wraca do tej wersji; gdy publiczny obiekt już
  // nie istnieje (poprzednia próba usunęła go, a zapis wiersza padł), bajty bierzemy z kopii prywatnej.
  let bytes = null, publicExists = true;
  try { bytes = await readObject(supaSvc, PHOTO_BUCKET, version.storage_path); }
  catch (e) { publicExists = false; bytes = await readObject(supaSvc, PENDING_BUCKET, version.storage_path).catch(() => { throw new Error("unpublish: object missing in both buckets: " + version.storage_path + " (" + e.message + ")"); }); }
  if (sha256(bytes) !== version.sha256) throw new Error("unpublish: sha256 mismatch for " + version.storage_path);
  await writeObject(supaSvc, PENDING_BUCKET, version.storage_path, bytes, version.mime);
  if (publicExists) {
    const rm = await supaSvc.storage.from(PHOTO_BUCKET).remove([version.storage_path]);
    if (rm.error) throw new Error("unpublish: remove public object: " + rm.error.message);
    // Storage potrafi odpowiedzieć 200 bez usunięcia (brak uprawnień/ścieżki) — sprawdzamy, że obiektu już nie ma
    const still = await supaSvc.storage.from(PHOTO_BUCKET).download(version.storage_path);
    if (!still.error) throw new Error("unpublish: public object still present after remove: " + version.storage_path);
  }
  const { data, error } = await supaSvc.from("marketing_photo_versions")
    .update({ storage_bucket: PENDING_BUCKET, public_url: null, published_at: null, published_by: null })
    .eq("id", version.id).select("*").maybeSingle();
  if (error) throw new Error("unpublish version: " + error.message);
  if (!data) throw new Error("unpublish version: row not updated");
  return { version: data, unpublished: true };
}

/**
 * [review Codexa 3/P2] Chroniony podgląd KONKRETNEJ wersji dla administratora: wersja opublikowana → stały adres publiczny;
 * wersja prywatna → podpisany adres z prywatnego bucketa, ważny `ttlSeconds` (domyślnie 10 min), tworzony service_role
 * wyłącznie po requireAdmin. Nic nie publikuje. Zwraca mapę version_id → { url, signed, expires_at }.
 */
export async function previewUrls(supaSvc, versions, ttlSeconds = 600) {
  const out = {};
  const pending = [];
  for (const v of versions || []) {
    if (!v) continue;
    if (isPublished(v)) out[v.id] = { url: v.public_url, signed: false, expires_at: null };
    else pending.push(v);
  }
  if (pending.length) {
    const { data, error } = await supaSvc.storage.from(PENDING_BUCKET).createSignedUrls(pending.map((v) => v.storage_path), ttlSeconds);
    if (error) throw new Error("signed preview: " + error.message);
    const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    for (const v of pending) {
      const hit = (data || []).find((d) => d.path === v.storage_path || d.signedUrl?.includes(encodeURI(v.storage_path)) || d.signedUrl?.includes(v.storage_path));
      if (hit && hit.signedUrl && !hit.error) out[v.id] = { url: hit.signedUrl, signed: true, expires_at: expires };
    }
  }
  return out;
}
