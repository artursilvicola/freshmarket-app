import { useState, useRef } from "react";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";

/**
 * <PhotoUploader>
 *
 * Multi-file upload do Supabase Storage z automatycznym zapisem
 * referencji do tabeli offer_photos.
 *
 * Props:
 *   offerId: uuid (wymagane) — do której oferty wgrywamy
 *   bucket: string (default 'offer-photos')
 *   existing: [{id, url, storage_path}] — już wgrane (do podglądu/usunięcia)
 *   onChange: (newList) => void — wywoływane po każdym uploadzie/usunięciu
 *   max: number (default 8) — limit zdjęć
 *
 * Konwencja ścieżki: <company_id>/<offer_id>/<timestamp>-<filename>
 * (bo polityka RLS w Supabase Storage sprawdza pierwszy segment)
 */
export default function PhotoUploader({
  offerId,
  bucket = "offer-photos",
  existing = [],
  onChange,
  max = 8,
}) {
  const { profile } = useAuth();
  const fileInputRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [photos, setPhotos] = useState(existing);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const companyId = profile?.company_id;

  const handleFiles = async (files) => {
    if (!companyId) {
      setError("Brak company_id w profilu — skontaktuj się z administratorem.");
      return;
    }
    if (!offerId) {
      setError("Brak offerId — najpierw zapisz ofertę, potem dodaj zdjęcia.");
      return;
    }
    const fileArr = Array.from(files);
    if (photos.length + fileArr.length > max) {
      setError(`Limit ${max} zdjęć — usuń stare przed dodaniem nowych.`);
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);

    const newPhotos = [];
    let i = 0;
    for (const file of fileArr) {
      i++;
      try {
        // Wygeneruj nazwę pliku
        const ext = file.name.split(".").pop().toLowerCase();
        const safeName = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .slice(0, 40);
        const path = `${companyId}/${offerId}/${Date.now()}-${safeName}.${ext}`;

        // Upload do Storage
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (upErr) throw upErr;

        // Pobierz publiczny URL
        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);

        // Zapisz do offer_photos
        const { data: row, error: dbErr } = await supabase
          .from("offer_photos")
          .insert({
            offer_id: offerId,
            storage_path: path,
            url: pub.publicUrl,
            sort_order: photos.length + newPhotos.length,
          })
          .select()
          .single();
        if (dbErr) throw dbErr;

        newPhotos.push(row);
        setProgress(Math.round((i / fileArr.length) * 100));
      } catch (e) {
        setError(`Błąd przy ${file.name}: ${e.message}`);
      }
    }

    const updated = [...photos, ...newPhotos];
    setPhotos(updated);
    onChange?.(updated);
    setUploading(false);
    setProgress(0);
  };

  const handleDelete = async (photo) => {
    if (!confirm("Usunąć zdjęcie?")) return;
    try {
      // Usuń z Storage
      await supabase.storage.from(bucket).remove([photo.storage_path]);
      // Usuń z DB
      await supabase.from("offer_photos").delete().eq("id", photo.id);
      const updated = photos.filter((p) => p.id !== photo.id);
      setPhotos(updated);
      onChange?.(updated);
    } catch (e) {
      setError(`Nie udało się usunąć: ${e.message}`);
    }
  };

  return (
    <div style={{ width: "100%" }}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
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
          padding: 24,
          textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          transition: "all 0.15s",
          marginBottom: photos.length ? 14 : 0,
        }}
      >
        {uploading ? (
          <>
            <Loader2
              size={32}
              style={{ color: "#0d9488", animation: "spin 1s linear infinite" }}
            />
            <div style={{ marginTop: 8, fontSize: 14, color: "#475569" }}>
              Wgrywanie... {progress}%
            </div>
            <style>{`@keyframes spin { from {transform:rotate(0)} to {transform:rotate(360deg)} }`}</style>
          </>
        ) : (
          <>
            <Upload size={28} style={{ color: "#64748b" }} />
            <div style={{ marginTop: 8, fontSize: 14, color: "#475569", fontWeight: 500 }}>
              Kliknij lub przeciągnij zdjęcia
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>
              JPG, PNG, WebP, GIF · max 5 MB · do {max} zdjęć
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {error && (
        <div
          style={{
            color: "#dc2626",
            fontSize: 13,
            padding: 8,
            background: "#fee2e2",
            borderRadius: 6,
            marginTop: 8,
          }}
        >
          {error}
        </div>
      )}

      {/* Galeria */}
      {photos.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 10,
            marginTop: 10,
          }}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: 8,
                overflow: "hidden",
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
              }}
            >
              {p.url ? (
                <img
                  src={p.url}
                  alt={p.alt || ""}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <ImageIcon
                  size={32}
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    color: "#94a3b8",
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => handleDelete(p)}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  background: "rgba(0,0,0,0.7)",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
                aria-label="Usuń zdjęcie"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
