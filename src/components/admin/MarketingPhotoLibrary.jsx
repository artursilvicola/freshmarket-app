// [feat/marketing-photos] Marketing → Biblioteka zdjęć do maili PreConnect (zadanie Codexa 06.11).
// Wgrywanie wielu plików: prawdziwy format/wymiary z nagłówka, kadr 3:2 z podglądem i przesunięciem, skalowanie do
// 1200×800 i JPEG ok. 200 KB w przeglądarce (canvas = NOWY plik bez EXIF/GPS), sha256 oryginału (duplikaty),
// dHash (bliźniacze kadry), metadane (nazwa, alt PL/EN, podpisy, rodzaj, pochodzenie, prawa, kategorie, rok).
// Nowe zdjęcie = „do zatwierdzenia”; do rotacji wchodzi po „Zatwierdź kadr”. Wyłączenie nie psuje starych maili.
// Zapis do Storage tylko przez funkcję marketing-photos (service_role) — przeglądarka nie dotyka bucketa.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { marketingCall } from "../../lib/db.js";
import { blobToBase64, checkSource, decodeImage, fileSha256, fmtBytes, prepareMailVersion, MAIL_PHOTO } from "../../lib/marketing-photo-prep.js";

const box = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 };
const btn = (variant = "primary") => ({
  padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  border: variant === "primary" ? "none" : "1px solid #cbd5e1",
  background: variant === "primary" ? "#0d9488" : variant === "danger" ? "#dc2626" : "white",
  color: variant === "secondary" ? "#0f172a" : "white",
});
const tag = (bg, fg) => ({ display: "inline-block", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: bg, color: fg, marginRight: 4, marginBottom: 2 });
const inp = { padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const STATUS_STYLE = { pending: ["#fef3c7", "#92400e"], ready: ["#dcfce7", "#166534"], disabled: ["#f1f5f9", "#475569"] };
const fmtAt = (s) => (s ? new Date(s).toLocaleDateString("pl-PL") : "—");
const yearFromName = (name) => { const m = String(name || "").match(/(20[2-9]\d)/); return m ? Number(m[1]) : ""; };

export default function MarketingPhotoLibrary({ fl }) {
  const { t } = useTranslation("legacy");
  const tr = (k, o) => t("admin.marketing." + k, o);
  const [data, setData] = useState(null);          // { photos, ready_count, warnings }
  const [filter, setFilter] = useState("all");
  const [queue, setQueue] = useState([]);          // pliki w przygotowaniu
  const [busy, setBusy] = useState(null);
  const [usage, setUsage] = useState(null);        // { photo, rows }
  const [edit, setEdit] = useState(null);          // zdjęcie w edycji metadanych
  const fileRef = useRef(null);

  const toast = (msg, kind) => { if (typeof fl === "function") fl(msg, kind); };
  const errText = (e) => { const code = e?.payload?.error; const msg = code ? t("admin.marketing.err_" + code, { defaultValue: "" }) : ""; return msg || e?.message || String(e); };
  const run = async (label, fn) => { setBusy(label); try { return await fn(); } catch (e) { toast(errText(e), "error"); return null; } finally { setBusy(null); } };
  const load = () => run("list", async () => { const r = await marketingCall("marketing-photos", { action: "list" }); setData(r); return r; });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const photos = useMemo(() => (data?.photos || []).filter((p) => filter === "all" || p.status === filter), [data, filter]);

  // ── wgrywanie ──────────────────────────────────────────────────────────────
  const onFiles = async (files) => {
    const items = [];
    for (const file of Array.from(files || [])) {
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      const item = { id, file, status: "reading", offset: 0.5, meta: { title: file.name.replace(/\.[^.]+$/, ""), alt_pl: "", alt_en: "", caption_pl: "", caption_en: "", kind: "authentic", source: file.name, rights: tr("ph_default_rights"), categories: "", year: yearFromName(file.name), review_note: "" } };
      if (item.meta.year) { item.meta.caption_pl = tr("ph_default_caption_pl", { year: item.meta.year }); item.meta.caption_en = tr("ph_default_caption_en", { year: item.meta.year }); }
      items.push(item);
    }
    setQueue((q) => [...q, ...items]);
    for (const item of items) await prepareItem(item);
    if (fileRef.current) fileRef.current.value = "";
  };
  const patchItem = (id, patch) => setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x)));
  const prepareItem = async (item, offset = item.offset) => {
    try {
      const head = new Uint8Array(await item.file.slice(0, 65536).arrayBuffer());
      const src = checkSource({ bytes: head, declaredType: item.file.type, size: item.file.size });
      if (!src.ok) { patchItem(item.id, { status: "rejected", error: tr("ph_invalid", { errors: src.errors.join(", ") }) }); return; }
      const [sha, bitmap] = await Promise.all([item.sha || fileSha256(item.file), item.bitmap || decodeImage(item.file)]);
      const prepared = await prepareMailVersion(bitmap, { offset });
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      patchItem(item.id, { status: "ready", sha, bitmap, offset, info: { ...src.info, width: bitmap.width, height: bitmap.height }, prepared, previewUrl: URL.createObjectURL(prepared.blob), error: null });
    } catch (e) {
      patchItem(item.id, { status: "rejected", error: tr("ph_invalid", { errors: String(e?.message || e) }) });
    }
  };
  const recrop = (item, offset) => { patchItem(item.id, { offset, status: "preparing" }); prepareItem({ ...item, offset }, offset); };
  const removeItem = (item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); setQueue((q) => q.filter((x) => x.id !== item.id)); };

  const upload = (item, allowSimilar = false) => run("upload", async () => {
    const m = item.meta;
    if (!m.alt_pl.trim() || !m.alt_en.trim()) { patchItem(item.id, { error: tr("ph_alt_required") }); return; }
    patchItem(item.id, { status: "uploading", error: null, similar: null });
    try {
      const r = await marketingCall("marketing-photos", {
        action: "upload", title: m.title, alt_pl: m.alt_pl, alt_en: m.alt_en, caption_pl: m.caption_pl, caption_en: m.caption_en, kind: m.kind, source: m.source, rights: m.rights,
        categories: String(m.categories || "").split(",").map((s) => s.trim()).filter(Boolean), year: m.year === "" ? null : Number(m.year), review_note: m.review_note,
        mime: "image/jpeg", data_base64: await blobToBase64(item.prepared.blob), source_sha256: item.sha, source_name: item.file.name, source_bytes: item.file.size, source_width: item.info.width, source_height: item.info.height, dhash: item.prepared.dhash, allow_similar: allowSimilar,
      });
      toast(r.new_photo ? tr("ph_saved", { title: r.photo.title }) : tr("ph_saved_new_version", { title: r.photo.title, n: r.version?.version_no }));
      removeItem(item);
      await load();
    } catch (e) {
      const code = e?.payload?.error;
      if (code === "similar_exists") { patchItem(item.id, { status: "ready", similar: e.payload.similar || [], error: tr("ph_similar", { titles: (e.payload.similar || []).map((s) => s.title).join(", ") }) }); return; }
      if (code === "duplicate_source") { patchItem(item.id, { status: "rejected", error: tr("ph_dup_source", { title: e.payload.title || "" }) }); return; }
      if (code === "duplicate_file") { patchItem(item.id, { status: "rejected", error: tr("ph_dup_file") }); return; }
      patchItem(item.id, { status: "ready", error: errText(e) + (e?.payload?.errors ? ": " + e.payload.errors.join(", ") : "") });
    }
  });

  // ── akcje na zdjęciach ─────────────────────────────────────────────────────
  const approveVersion = (photo) => run("approve", async () => {
    const v = photo.pending_version;
    await marketingCall("marketing-photos", { action: "approve", photo_id: photo.id, version_id: v?.id });
    toast(photo.approved_version && v ? tr("ph_new_version_approved", { n: v.version_no }) : tr("ph_approved")); await load();
  });
  const action = (act, photo, okKey) => run(act, async () => {
    if (act === "disable" && !window.confirm(tr("ph_disable_confirm", { title: photo.title }))) return;
    await marketingCall("marketing-photos", { action: act, photo_id: photo.id });
    toast(tr(okKey)); await load();
  });
  const saveEdit = () => edit && run("update", async () => {
    await marketingCall("marketing-photos", { action: "update", photo_id: edit.id, title: edit.title, alt_pl: edit.alt_pl, alt_en: edit.alt_en, caption_pl: edit.caption_pl, caption_en: edit.caption_en, kind: edit.kind, source: edit.source, rights: edit.rights, categories: String(edit.categories || "").split(",").map((s) => s.trim()).filter(Boolean), year: edit.year === "" || edit.year == null ? null : Number(edit.year), review_note: edit.review_note });
    toast(tr("ph_updated")); setEdit(null); await load();
  });
  const showUsage = (photo) => run("usage", async () => { const r = await marketingCall("marketing-photos", { action: "usage", photo_id: photo.id }); setUsage({ photo, rows: r.usage || [] }); });

  const setMeta = (item, k, v) => patchItem(item.id, (x) => ({ meta: { ...x.meta, [k]: v } }));
  const metaField = (label, value, onChange, props = {}) => (
    <label style={{ display: "block", fontSize: 11, color: "#64748b", marginTop: 6 }}>{label}
      <input style={{ ...inp, marginTop: 2 }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...props} />
    </label>
  );

  return (
    <div>
      <div style={box}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{tr("photos_title")}</div>
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>{tr("photos_subtitle")}</div>
        <div data-testid="ph-public-warning" style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", borderRadius: 8, padding: "6px 10px" }}>{tr("photos_public_warning")}</div>
        {data && (data.warnings || []).includes("pool_small") && <div data-testid="ph-pool-small" style={{ fontSize: 11, color: "#991b1b", background: "#fee2e2", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>{tr("photos_pool_small", { n: data.ready_count })}</div>}
      </div>

      <div style={box}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ ...btn("primary"), display: "inline-block" }}>{tr("photos_upload")}
            <input ref={fileRef} data-testid="ph-file" type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: "none" }} onChange={(e) => onFiles(e.target.files)} />
          </label>
          <span style={{ fontSize: 11, color: "#64748b", flex: 1, minWidth: 260 }}>{tr("photos_upload_hint")}</span>
        </div>
        {queue.map((item) => (
          <div key={item.id} data-testid="ph-queue-item" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 420px) 1fr", gap: 14, borderTop: "1px solid #f1f5f9", paddingTop: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{tr("ph_source")}: {item.info ? tr("ph_source_info", { name: item.file.name, type: item.info.mime, size: fmtBytes(item.file.size), w: item.info.width, h: item.info.height }) : item.file.name}</div>
              {item.previewUrl ? <img src={item.previewUrl} alt="" style={{ display: "block", width: "100%", maxWidth: 420, aspectRatio: "3 / 2", objectFit: "cover", borderRadius: 8, marginTop: 6, background: "#e2e8f0" }} />
                : <div style={{ width: "100%", maxWidth: 420, aspectRatio: "3 / 2", borderRadius: 8, marginTop: 6, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#94a3b8" }}>{item.status === "rejected" ? "✕" : tr("ph_preparing")}</div>}
              {item.info && <>
                <input type="range" min={0} max={100} value={Math.round(item.offset * 100)} onChange={(e) => recrop(item, Number(e.target.value) / 100)} style={{ width: "100%", marginTop: 6 }} disabled={item.status === "uploading"} />
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{tr("ph_crop_hint")}</div>
                {item.prepared && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{tr("ph_mail_version", { w: item.prepared.width, h: item.prepared.height, size: fmtBytes(item.prepared.bytes), q: item.prepared.quality })}</div>}
              </>}
              {item.error && <div data-testid="ph-item-error" style={{ fontSize: 11, color: "#991b1b", marginTop: 6 }}>{item.error}</div>}
            </div>
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                {metaField(tr("f_title"), item.meta.title, (v) => setMeta(item, "title", v), { maxLength: 160 })}
                <label style={{ display: "block", fontSize: 11, color: "#64748b", marginTop: 6 }}>{tr("f_kind")}
                  <select style={{ ...inp, marginTop: 2 }} value={item.meta.kind} onChange={(e) => setMeta(item, "kind", e.target.value)}><option value="authentic">{tr("kind_authentic")}</option><option value="ai">{tr("kind_ai")}</option></select>
                </label>
                {metaField(tr("f_alt_pl"), item.meta.alt_pl, (v) => setMeta(item, "alt_pl", v), { maxLength: 200 })}
                {metaField(tr("f_alt_en"), item.meta.alt_en, (v) => setMeta(item, "alt_en", v), { maxLength: 200 })}
                {metaField(tr("f_caption_pl"), item.meta.caption_pl, (v) => setMeta(item, "caption_pl", v), { maxLength: 200 })}
                {metaField(tr("f_caption_en"), item.meta.caption_en, (v) => setMeta(item, "caption_en", v), { maxLength: 200 })}
                {metaField(tr("f_source_text"), item.meta.source, (v) => setMeta(item, "source", v), { maxLength: 300 })}
                {metaField(tr("f_rights"), item.meta.rights, (v) => setMeta(item, "rights", v), { maxLength: 300 })}
                {metaField(tr("f_categories"), item.meta.categories, (v) => setMeta(item, "categories", v))}
                {metaField(tr("f_year"), item.meta.year, (v) => setMeta(item, "year", v.replace(/\D/g, "").slice(0, 4)), { inputMode: "numeric" })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <button data-testid="ph-save" style={btn("primary")} disabled={!!busy || item.status !== "ready"} onClick={() => upload(item, false)}>{tr("ph_save")}</button>
                {item.similar && <button style={btn("danger")} disabled={!!busy} onClick={() => upload(item, true)}>{tr("ph_similar_force")}</button>}
                <button style={btn("secondary")} disabled={item.status === "uploading"} onClick={() => removeItem(item)}>{tr("ph_skip")}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{tr("tab_photos")} ({(data?.photos || []).length})</div>
          <span style={{ fontSize: 11, color: "#64748b" }}>{tr("ph_status_ready")}: <b>{data?.ready_count ?? "—"}</b></span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {["all", "ready", "pending", "disabled"].map((f) => <button key={f} data-testid={`ph-filter-${f}`} style={{ ...btn(filter === f ? "primary" : "secondary"), padding: "4px 9px" }} onClick={() => setFilter(f)}>{f === "all" ? tr("ph_filter_all") : tr("ph_status_" + f)}</button>)}
          </div>
        </div>
        {data && photos.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>{tr("ph_no_photos")}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
          {photos.map((p) => {
            const [bg, fg] = STATUS_STYLE[p.status] || STATUS_STYLE.disabled;
            const u = p.usage || {};
            return (
              <div key={p.id} data-testid="ph-card" style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", opacity: p.status === "disabled" ? 0.6 : 1 }}>
                {/* [review Codexa P1] miniatura tylko z OPUBLIKOWANEJ (zatwierdzonej) wersji; kadr oczekujący leży w prywatnym buckecie bez adresu */}
                {p.approved_version ? <img src={p.approved_version.public_url} alt={p.alt_pl} loading="lazy" style={{ display: "block", width: "100%", aspectRatio: "3 / 2", objectFit: "cover", background: "#e2e8f0" }} />
                  : p.pending_version?.preview?.url ? <img data-testid="ph-pending-preview" src={p.pending_version.preview.url} alt={p.alt_pl} loading="lazy" style={{ display: "block", width: "100%", aspectRatio: "3 / 2", objectFit: "cover", background: "#e2e8f0" }} />
                  : <div data-testid="ph-private" style={{ aspectRatio: "3 / 2", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#94a3b8", textAlign: "center", padding: 8 }}>{tr("ph_private_pending")}</div>}
                <div style={{ padding: 10 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.title}>{p.title}</div>
                    <span style={tag(bg, fg)}>{tr("ph_status_" + p.status)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{p.year || "—"} · {tr("kind_" + (p.kind || "authentic"))}{p.approved_version ? ` · ${tr("ph_version", { n: p.approved_version.version_no })} · ${p.approved_version.width}×${p.approved_version.height} · ${fmtBytes(p.approved_version.bytes)}` : ""}</div>
                  {p.approved_version && p.pending_version && <div data-testid="ph-pending-version" style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "3px 6px", marginTop: 4 }}>
                    {tr("ph_new_version_pending", { n: p.pending_version.version_no })}
                    {/* [review Codexa 3/P2] kadr, który zatwierdzam, musi być widoczny — podpisany podgląd prywatnej wersji */}
                    {p.pending_version.preview?.url && <img data-testid="ph-pending-preview" src={p.pending_version.preview.url} alt={tr("ph_pending_preview_alt", { n: p.pending_version.version_no })} loading="lazy" style={{ display: "block", width: "100%", aspectRatio: "3 / 2", objectFit: "cover", borderRadius: 6, marginTop: 6, background: "#e2e8f0" }} />}
                  </div>}
                  {p.pending_version?.published && <div data-testid="ph-pending-published" style={{ fontSize: 11, color: "#991b1b", background: "#fee2e2", borderRadius: 6, padding: "3px 6px", marginTop: 4 }}>{tr("ph_pending_published_unapproved", { n: p.pending_version.version_no })}</div>}
                  {p.pending_version?.preview?.signed && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{tr("ph_preview_signed_note")}</div>}
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{p.caption_pl || p.alt_pl}</div>
                  {p.review_note && <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>{p.review_note}</div>}
                  <div style={{ fontSize: 11, color: u.sent_campaigns ? "#475569" : "#166534", marginTop: 4 }}>
                    {u.sent_campaigns ? `${tr("ph_used", { n: u.campaigns, sent: u.sent_campaigns })} · ${tr("ph_last_used", { at: fmtAt(u.last_sent_at) })}` : tr("ph_never")}{u.open_assignments ? ` · ${tr("ph_open_assign", { n: u.open_assignments })}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                    {/* zatwierdzenie dotyczy KONKRETNEJ wersji (review Codexa P2): nowe zdjęcie albo nowy kadr istniejącego */}
                    {p.status !== "disabled" && p.pending_version && <button data-testid="ph-approve" style={{ ...btn("primary"), padding: "4px 9px" }} disabled={!!busy} onClick={() => approveVersion(p)}>{p.approved_version ? tr("ph_approve_new_version", { n: p.pending_version.version_no }) : tr("ph_approve")}</button>}
                    {p.status === "ready" && <button data-testid="ph-disable" style={{ ...btn("secondary"), padding: "4px 9px" }} disabled={!!busy} onClick={() => action("disable", p, "ph_disabled")}>{tr("ph_disable")}</button>}
                    {p.status === "disabled" && <button style={{ ...btn("secondary"), padding: "4px 9px" }} disabled={!!busy} onClick={() => action("enable", p, "ph_enabled")}>{tr("ph_enable")}</button>}
                    <button style={{ ...btn("secondary"), padding: "4px 9px" }} disabled={!!busy} onClick={() => setEdit({ ...p, categories: (p.categories || []).join(", "), year: p.year ?? "" })}>{tr("ph_edit")}</button>
                    <button data-testid="ph-usage" style={{ ...btn("secondary"), padding: "4px 9px" }} disabled={!!busy} onClick={() => showUsage(p)}>{tr("ph_usage")}</button>
                    {p.approved_version && <a href={p.approved_version.public_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#0d9488", alignSelf: "center" }}>{tr("ph_open_file")}</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {usage && (
        <Modal onClose={() => setUsage(null)} title={`${tr("ph_usage_title")} · ${usage.photo.title}`}>
          {usage.rows.length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>{tr("ph_usage_empty")}</div> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ textAlign: "left", color: "#64748b", fontSize: 11 }}><th style={{ padding: 6 }}>{tr("c_campaign")}</th><th style={{ padding: 6 }}>{tr("c_status")}</th><th style={{ padding: 6 }}>{tr("c_sent")}</th><th style={{ padding: 6 }}>{tr("c_date")}</th></tr></thead>
              <tbody>{usage.rows.map((r) => <tr key={r.campaign_id} style={{ borderTop: "1px solid #f1f5f9" }}><td style={{ padding: 6 }}>{r.campaign_name}</td><td style={{ padding: 6 }}>{tr("status_" + r.campaign_status, { defaultValue: r.campaign_status })}</td><td style={{ padding: 6 }}>{r.sent_count}{r.first_sent_at ? ` · ${fmtAt(r.first_sent_at)}` : ""}</td><td style={{ padding: 6 }}>{fmtAt(r.created_at)}</td></tr>)}</tbody>
            </table>
          )}
        </Modal>
      )}
      {edit && (
        <Modal onClose={() => setEdit(null)} title={`${tr("ph_edit")} · ${edit.title}`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            {metaField(tr("f_title"), edit.title, (v) => setEdit({ ...edit, title: v }), { maxLength: 160 })}
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginTop: 6 }}>{tr("f_kind")}<select style={{ ...inp, marginTop: 2 }} value={edit.kind || "authentic"} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="authentic">{tr("kind_authentic")}</option><option value="ai">{tr("kind_ai")}</option></select></label>
            {metaField(tr("f_alt_pl"), edit.alt_pl, (v) => setEdit({ ...edit, alt_pl: v }), { maxLength: 200 })}
            {metaField(tr("f_alt_en"), edit.alt_en, (v) => setEdit({ ...edit, alt_en: v }), { maxLength: 200 })}
            {metaField(tr("f_caption_pl"), edit.caption_pl, (v) => setEdit({ ...edit, caption_pl: v }), { maxLength: 200 })}
            {metaField(tr("f_caption_en"), edit.caption_en, (v) => setEdit({ ...edit, caption_en: v }), { maxLength: 200 })}
            {metaField(tr("f_source_text"), edit.source, (v) => setEdit({ ...edit, source: v }), { maxLength: 300 })}
            {metaField(tr("f_rights"), edit.rights, (v) => setEdit({ ...edit, rights: v }), { maxLength: 300 })}
            {metaField(tr("f_categories"), edit.categories, (v) => setEdit({ ...edit, categories: v }))}
            {metaField(tr("f_year"), edit.year, (v) => setEdit({ ...edit, year: v.replace(/\D/g, "").slice(0, 4) }), { inputMode: "numeric" })}
            {metaField(tr("f_review_note"), edit.review_note, (v) => setEdit({ ...edit, review_note: v }), { maxLength: 300 })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button data-testid="ph-edit-save" style={btn("primary")} disabled={!!busy} onClick={saveEdit}>{tr("save_content")}</button>
            <button style={btn("secondary")} onClick={() => setEdit(null)}>✕</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 760 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 12, width: `min(${width}px, 100%)`, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
          <button style={{ ...btn("secondary"), marginLeft: "auto" }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 16, overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

export { MAIL_PHOTO };
