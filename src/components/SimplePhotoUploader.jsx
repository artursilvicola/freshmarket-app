import { useState, useRef } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

/**
 * Kompresja obrazka przed uploadem.
 * - Skala do maks. MAX_DIM (długiego boku) z zachowaniem proporcji
 * - Konwersja do WebP (lepsza kompresja przy zachowaniu ostrości)
 * - Quality 0.85 (~150-300 KB dla typowego zdjęcia produktu)
 * Dzięki temu zdjęcia są szybkie, ale wciąż czytelne (kupiec widzi opakowanie).
 * Pliki nie-graficzne (np. SVG, GIF animowany) są przekazywane bez zmian.
 */
const MAX_DIM = 1600;
async function compressImage(file) {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;
  try {
    const img = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      im.src = url;
    });
    const ratio = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85)
    );
    if (!blob) return file;
    // Jeśli kompresja "zwiększyła" rozmiar (małe zdjęcie) - zostaw oryginał
    if (blob.size >= file.size) return file;
    const newName = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], newName, { type: "image/webp" });
  } catch (e) {
    console.warn("[compressImage] fallback to original:", e);
    return file;
  }
}

/**
 * <SimplePhotoUploader>
 *
 * Lekki uploader do Supabase Storage. Nie pisze do żadnej tabeli — caller
 * dostaje listę URL-i przez onChange i sam decyduje co z nią zrobić
 * (np. zapisać do offer.photos array, do co.logo string, etc.).
 *
 * Props:
 *   bucket    : nazwa bucketa (np. 'offer-photos', 'company-logos')
 *   pathPrefix: string używany jako pierwszy segment ścieżki (np. companyId)
 *               polityka RLS sprawdza pierwszy segment, więc to musi być
 *               UUID/id firmy aktywnego usera
 *   subFolder : opcjonalny drugi segment (np. offerId — nie jest wymagany)
 *   value     : aktualna lista URL-i (jeśli single = string, jeśli multi = string[])
 *   onChange  : (newValue) => void — wywołane po zmianie listy
 *   multi     : boolean — true: array URL-i, false: pojedynczy URL
 *   max       : limit liczby zdjęć (multi only)
 *   accept    : accept attribute na input (default "image/*")
 *   label     : tekst placeholder w drop zone
 */
export default function SimplePhotoUploader({
  bucket = "offer-photos",
  pathPrefix,
  subFolder,
  value,
  onChange,
  multi = true,
  max = 8,
  accept = "image/*",
  // [Krok 11 P1] label: default undefined żeby caller mógł nadpisać własnym
  // stringiem (np. "Wgraj logo firmy"). Jeśli brak — fallback do t() poniżej.
  // Stary default "Kliknij lub przeciągnij zdjęcia" jest teraz w common.uploader.
  label,
}) {
  // [Krok 11 P1] Bilingual przez useTranslation ('common' default ns).
  const { t } = useTranslation();
  const fileInputRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const list = multi
    ? Array.isArray(value) ? value : []
    : (value ? [value] : []);

  const handleFiles = async (files) => {
    if (!pathPrefix) {
      setError(t("uploader.errors.no_path_prefix"));
      return;
    }
    const fileArr = Array.from(files);
    if (multi && list.length + fileArr.length > max) {
      setError(t("uploader.errors.limit_reached", { max }));
      return;
    }
    if (!multi && fileArr.length > 1) {
      // single mode - bierze tylko pierwszy plik
      fileArr.length = 1;
    }
    setError(null);
    setUploading(true);
    setProgress(0);

    const newUrls = [];
    let i = 0;
    for (const rawFile of fileArr) {
      i++;
      try {
        // Kompresja do 1600px / WebP / quality 0.85 (czytelne, ale lekkie)
        const file = await compressImage(rawFile);
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const safeName = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .slice(0, 40);
        const segments = [pathPrefix];
        if (subFolder) segments.push(subFolder);
        segments.push(`${Date.now()}-${safeName}.${ext}`);
        const path = segments.join("/");

        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
        newUrls.push(pub.publicUrl);
        setProgress(Math.round((i / fileArr.length) * 100));
      } catch (e) {
        setError(t("uploader.errors.upload_failed", { file: file.name, message: e.message }));
      }
    }

    if (multi) {
      onChange?.([...list, ...newUrls]);
    } else if (newUrls[0]) {
      onChange?.(newUrls[0]);
    }
    setUploading(false);
    setProgress(0);
  };

  const handleDelete = (urlToRemove) => {
    if (!confirm(t("uploader.confirm_delete"))) return;
    if (multi) {
      onChange?.(list.filter((u) => u !== urlToRemove));
    } else {
      onChange?.(null);
    }
    // (Storage cleanup pomijamy w tej wersji - URL znika z UI, plik zostaje w bucket)
  };

  return (
    <div style={{ width: "100%" }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#0d9488" : "#cbd5e1"}`,
          background: dragOver ? "#f0fdfa" : "#f8fafc",
          borderRadius: 10,
          padding: 18,
          textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          transition: "all 0.15s",
          marginBottom: list.length ? 12 : 0,
        }}
      >
        {uploading ? (
          <>
            <Loader2 size={28} style={{ color: "#0d9488", animation: "spin 1s linear infinite" }} />
            <div style={{ marginTop: 6, fontSize: 13, color: "#475569" }}>{t("uploader.uploading", { progress })}</div>
            <style>{`@keyframes spin { from {transform:rotate(0)} to {transform:rotate(360deg)} }`}</style>
          </>
        ) : (
          <>
            <Upload size={24} style={{ color: "#64748b" }} />
            {/* [Krok 11] Caller może nadpisać label własnym stringiem; fallback do i18n. */}
            <div style={{ marginTop: 6, fontSize: 13, color: "#475569", fontWeight: 500 }}>{label ?? t("uploader.click_or_drag")}</div>
            <div style={{ marginTop: 3, fontSize: 11, color: "#94a3b8" }}>
              {multi
                ? t("uploader.hint_simple_multi", { max })
                : t("uploader.hint_simple_single")}
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multi}
          style={{ display: "none" }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {error && (
        <div style={{
          color: "#dc2626", fontSize: 12, padding: 6,
          background: "#fee2e2", borderRadius: 6, marginTop: 6,
        }}>{error}</div>
      )}

      {list.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: multi ? "repeat(auto-fill, minmax(100px, 1fr))" : "1fr",
          gap: 8,
          marginTop: 8,
        }}>
          {list.map((url) => (
            <div key={url} style={{
              position: "relative",
              aspectRatio: multi ? "1" : "auto",
              borderRadius: 8,
              overflow: "hidden",
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              maxHeight: multi ? "auto" : 120,
            }}>
              <img
                src={url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: multi ? "cover" : "contain" }}
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleDelete(url); }}
                style={{
                  position: "absolute", top: 4, right: 4,
                  background: "rgba(0,0,0,0.7)", color: "white", border: "none",
                  borderRadius: "50%", width: 22, height: 22,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}
                aria-label={t("uploader.delete_alt")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
