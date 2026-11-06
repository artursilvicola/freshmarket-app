/**
 * [feat/marketing-photos] Odczyt biblioteki zdjęć (service_role) wspólny dla funkcji marketing-photos,
 * marketing-campaign i marketing-preview. Czysta logika rotacji/walidacji: ./marketing-photos.js.
 */
import { pickPhoto } from "./marketing-photos.js";

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

/**
 * Zdjęcie kampanii do podglądu/panelu: po zatwierdzeniu ZAWSZE zamrożenie (frozen_photo); w szkicu — wybrana
 * wersja (photo_version_id) z aktualnymi metadanymi zdjęcia. Zwraca kształt jak frozen_photo + { frozen, status }.
 */
export async function resolveCampaignPhoto(supaSvc, campaign) {
  if (!campaign) return null;
  if (campaign.frozen_photo && campaign.frozen_photo.url) return { ...campaign.frozen_photo, frozen: true };
  if (!campaign.photo_id) return null;
  const photo = await loadPhoto(supaSvc, campaign.photo_id);
  if (!photo) return null;
  const version = await loadPhotoVersion(supaSvc, campaign.photo_version_id || photo.current_version_id);
  if (!version) return null;
  return {
    photo_id: photo.id, version_id: version.id, version_no: version.version_no, url: version.public_url, width: version.width, height: version.height, sha256: version.sha256,
    alt_pl: photo.alt_pl, alt_en: photo.alt_en, caption_pl: photo.caption_pl, caption_en: photo.caption_en, title: photo.title, kind: photo.kind, year: photo.year,
    status: photo.status, frozen: false,
  };
}

/** Propozycja z rotacji dla kampanii (bez zapisu). */
export async function suggestPhoto(supaSvc, { campaignId = null, preferPhotoId = null } = {}) {
  const { photos, versions, usage } = await loadLibrary(supaSvc);
  const pick = pickPhoto({ photos, usage, excludeCampaignId: campaignId, preferPhotoId });
  const version = pick.photo ? versions.find((v) => String(v.id) === String(pick.photo.current_version_id)) || null : null;
  return { ...pick, version, photos, versions, usage };
}
