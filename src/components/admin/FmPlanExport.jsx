// [feat/fm-plan-export] Panel admina: eksport planu spotkań B2B FM 2026.
// Karty PDF (pdfmake w przeglądarce, jeden renderer dla pobrań i wysyłki),
// pliki zbiorcze do drukarni (pdf-lib), ZIP (jszip), master Excel (xlsx)
// i wysyłka mailem karta po karcie przez funkcję fm-plan-send (Resend).
// Ciężkie moduły (pdfmake + czcionki ~0.5 MB) ładowane dopiero po kliknięciu.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { buildPlanModel, resolveImages } from "../../lib/fm-plan/model.js";
import { supplierDoc, chainDoc } from "../../lib/fm-plan/layout.js";
import { buildMasterWorkbook, workbookToArrayBuffer } from "../../lib/fm-plan/excel.js";

const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

async function getToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("no_session");
  return token;
}
// Obraz z URL → PNG data URI przez canvas (przeglądarka dekoduje WebP/SVG sama).
async function imageToPngDataUri(url) {
  const r = await fetch(url, { mode: "cors" });
  if (!r.ok) return null;
  const blob = await r.blob();
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return null;
  const scale = Math.min(1, 600 / bmp.width, 300 / bmp.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}
function download(blob, filename) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
let pdfMakeReady = null;
async function loadPdfMake() {
  if (!pdfMakeReady) {
    pdfMakeReady = Promise.all([import("pdfmake/build/pdfmake"), import("../../lib/fm-plan/fonts.js")]).then(([pm, fonts]) => {
      const pdfMake = pm.default || pm;
      pdfMake.vfs = fonts.FM_PLAN_FONTS_VFS;
      pdfMake.fonts = fonts.FM_PLAN_FONT_FAMILIES;
      return pdfMake;
    });
  }
  return pdfMakeReady;
}
const pdfBlob = (pdfMake, doc) => new Promise((res) => pdfMake.createPdf(doc).getBlob(res));
const blobToBase64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
async function pageCount(blob) { const { PDFDocument } = await import("pdf-lib"); return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount(); }
async function mergeBlobs(blobs) {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const b of blobs) { const src = await PDFDocument.load(await b.arrayBuffer()); (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); }
  return new Blob([await out.save()], { type: "application/pdf" });
}

export default function FmPlanExport({ fl, adminEmail }) {
  const { t } = useTranslation("legacy");
  const [phase, setPhase] = useState("idle"); // idle | loading | ready | sending
  const [step, setStep] = useState("");
  const [model, setModel] = useState(null);
  const [cards, setCards] = useState([]); // {card, kind, id, name, lang, n, pages, emails[], blob, filename, sentAt, status}
  const [tab, setTab] = useState("supplier");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState(null);
  const abortRef = useRef(false);
  useEffect(() => () => { abortRef.current = true; }, []);

  async function prepare() {
    setPhase("loading"); setSummary(null); setCards([]);
    try {
      setStep(t("fm_plan.step_data"));
      const token = await getToken();
      const r = await fetch("/.netlify/functions/fm-plan-data", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`fm-plan-data ${r.status}`);
      const raw = await r.json();
      const m = buildPlanModel(raw, { simulate: true });
      setStep(t("fm_plan.step_images"));
      await resolveImages(m, imageToPngDataUri);
      const pdfMake = await loadPdfMake();
      const all = [...m.suppliers.filter((s) => s.meetings.length).map((s) => ({ ...s, kind: "supplier" })), ...m.chains.filter((c) => c.meetings.length).map((c) => ({ ...c, kind: "chain" }))];
      const sentMap = new Map([...(raw.companies || []).map((c) => [`supplier:${c.id}`, c.fm_plan_sent_at]), ...(raw.retailers || []).map((r) => [`chain:${r.id}`, r.fm_plan_sent_at])]);
      const out = [];
      for (let i = 0; i < all.length; i++) {
        const c = all[i];
        setStep(t("fm_plan.step_render", { done: i + 1, total: all.length }));
        const blob = await pdfBlob(pdfMake, c.kind === "supplier" ? supplierDoc(c, { mode: m.mode }) : chainDoc(c, { mode: m.mode }));
        out.push({ card: c.card, kind: c.kind, id: c.id, name: c.name, lang: c.lang, n: c.meetings.length, pages: await pageCount(blob), emails: c.emails || [], blob, filename: `${c.card}-${slug(c.name)}-${c.lang}.pdf`, sentAt: sentMap.get(`${c.kind}:${c.id}`) || null, status: null });
      }
      setModel(m); setCards(out); setPhase("ready");
    } catch (e) {
      setPhase("idle"); fl?.(t("fm_plan.error", { message: e?.message || String(e) }), "error");
    }
  }

  const bySupplier = cards.filter((c) => c.kind === "supplier"), byChain = cards.filter((c) => c.kind === "chain");
  const gatesMissing = useMemo(() => (model ? model.chains.filter((c) => !c.gate).map((c) => c.name) : []), [model]);
  const canSend = model?.mode === "final";

  async function dlExcel() { download(new Blob([workbookToArrayBuffer(buildMasterWorkbook(model))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "plan-spotkan-FM2026.xlsx"); }
  async function dlPrint(kind) { download(await mergeBlobs(cards.filter((c) => c.kind === kind).map((c) => c.blob)), kind === "supplier" ? "DRUK-dostawcy.pdf" : "DRUK-sieci.pdf"); }
  async function dlZip() {
    const { default: JSZip } = await import("jszip"); const zip = new JSZip();
    for (const c of cards) zip.file(`${c.kind === "supplier" ? "dostawcy" : "sieci"}/${c.filename}`, c.blob);
    zip.file("plan-spotkan-FM2026.xlsx", workbookToArrayBuffer(buildMasterWorkbook(model)));
    download(await zip.generateAsync({ type: "blob" }), "karty-spotkan-FM2026.zip");
  }
  function preview(c) { window.open(URL.createObjectURL(c.blob), "_blank", "noopener"); }

  async function sendOne(c, to, test) {
    const token = await getToken();
    const r = await fetch("/.netlify/functions/fm-plan-send", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: c.kind, id: c.id, name: c.name, lang: c.lang, to, filename: c.filename, pdfBase64: await blobToBase64(c.blob), test }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ? `${j.error}${j.detail ? " — " + j.detail : ""}` : `HTTP ${r.status}`);
    return j;
  }
  async function sendTest() {
    const c = cards[0]; if (!c || !adminEmail) return;
    try { setPhase("sending"); await sendOne(c, [adminEmail], true); fl?.(t("fm_plan.test_sent", { email: adminEmail }), "success"); }
    catch (e) { fl?.(t("fm_plan.error", { message: e?.message || String(e) }), "error"); }
    finally { setPhase("ready"); }
  }
  async function sendAll(kind) {
    const list = cards.filter((c) => c.kind === kind);
    const withEmail = list.filter((c) => c.emails.length);
    if (!withEmail.length || !window.confirm(t("fm_plan.confirm_send", { n: withEmail.length }))) return;
    setPhase("sending"); abortRef.current = false;
    let ok = 0, err = 0; const skipped = list.length - withEmail.length;
    setProgress({ done: 0, total: withEmail.length });
    for (let i = 0; i < withEmail.length; i++) {
      if (abortRef.current) break;
      const c = withEmail[i];
      try { await sendOne(c, c.emails, false); c.status = "ok"; c.sentAt = new Date().toISOString(); ok++; }
      catch (e) { c.status = "err:" + (e?.message || e); err++; }
      setProgress({ done: i + 1, total: withEmail.length }); setCards([...cards]);
    }
    for (const c of list) if (!c.emails.length) c.status = "skip";
    setCards([...cards]); setSummary({ ok, err, skipped }); setPhase("ready");
  }

  const modeLabel = model ? t(`fm_plan.mode_${model.mode}`) : "";
  const modeColor = model?.mode === "final" ? "#059669" : model?.mode === "working" ? "#d97706" : "#b45309";
  const btn = (label, onClick, opts = {}) => (
    <button onClick={onClick} disabled={opts.disabled || phase === "loading" || phase === "sending"} title={opts.title}
      style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: opts.disabled ? "not-allowed" : "pointer", border: `1px solid ${opts.primary ? "#0d9488" : "#cbd5e1"}`, background: opts.primary ? "#0d9488" : "white", color: opts.primary ? "white" : "#0f172a", opacity: opts.disabled ? 0.5 : 1, fontFamily: "inherit" }}>{label}</button>
  );
  const list = tab === "supplier" ? bySupplier : byChain;

  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>{t("fm_plan.title")}</div>
      <div style={{ fontSize: 12, color: "#64748b", margin: "4px 0 12px", lineHeight: 1.5 }}>{t("fm_plan.desc")}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {btn(phase === "loading" ? t("fm_plan.loading", { step }) : model ? t("fm_plan.reload") : t("fm_plan.load"), prepare, { primary: !model })}
        {model && <span style={{ fontSize: 11, fontWeight: 700, color: modeColor, padding: "4px 10px", border: `1px solid ${modeColor}44`, borderRadius: 20, background: `${modeColor}11` }}>{modeLabel}</span>}
        {model && <span style={{ fontSize: 11, color: "#64748b" }}>{t("fm_plan.stats", { suppliers: bySupplier.length, chains: byChain.length, pairs: model.pairs.length, noEmail: cards.filter((c) => !c.emails.length).length })}</span>}
      </div>

      {model && gatesMissing.length > 0 && (
        <div style={{ marginTop: 10, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400e" }}>{t("fm_plan.gate_missing", { names: gatesMissing.join(", ") })}</div>
      )}

      {model && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {btn(t("fm_plan.dl_excel"), dlExcel)}
            {btn(t("fm_plan.dl_print_sup"), () => dlPrint("supplier"), { disabled: !bySupplier.length })}
            {btn(t("fm_plan.dl_print_chain"), () => dlPrint("chain"), { disabled: !byChain.length })}
            {btn(t("fm_plan.dl_zip"), dlZip)}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            {btn(t("fm_plan.send_test"), sendTest, { disabled: !adminEmail || !cards.length })}
            {btn(t("fm_plan.send_suppliers", { n: bySupplier.filter((c) => c.emails.length).length }), () => sendAll("supplier"), { primary: true, disabled: !canSend || !bySupplier.length })}
            {btn(t("fm_plan.send_chains", { n: byChain.filter((c) => c.emails.length).length }), () => sendAll("chain"), { primary: true, disabled: !canSend || !byChain.length })}
            {phase === "sending" && progress.total > 0 && <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 600 }}>{t("fm_plan.sending", progress)}</span>}
          </div>
          {!canSend && <div style={{ fontSize: 11.5, color: "#b45309", marginTop: 6 }}>{t("fm_plan.send_blocked")}</div>}
          {summary && <div style={{ fontSize: 12, color: "#0f172a", marginTop: 8, fontWeight: 600 }}>{t("fm_plan.sent_summary", summary)}</div>}

          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            {["supplier", "chain"].map((k) => (
              <button key={k} onClick={() => setTab(k)} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${tab === k ? "#0d9488" : "#cbd5e1"}`, background: tab === k ? "#0d9488" : "white", color: tab === k ? "white" : "#475569", cursor: "pointer", fontFamily: "inherit" }}>
                {t(k === "supplier" ? "fm_plan.tab_suppliers" : "fm_plan.tab_chains")} ({k === "supplier" ? bySupplier.length : byChain.length})
              </button>
            ))}
          </div>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: "#64748b", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em" }}>
                {["col_card", "col_name", "col_lang", "col_n", "col_pages", "col_emails", "col_status", ""].map((k, i) => <th key={i} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>{k ? t(`fm_plan.${k}`) : ""}</th>)}
              </tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.kind + c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>{c.card}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: "6px 8px" }}>{c.lang.toUpperCase()}</td>
                    <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{c.n}</td>
                    <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{c.pages}</td>
                    <td style={{ padding: "6px 8px", color: c.emails.length ? "#0f172a" : "#dc2626", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.emails.join(", ")}>{c.emails.length ? c.emails.join(", ") : t("fm_plan.no_email")}</td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: c.status?.startsWith("err") ? "#dc2626" : c.status === "ok" ? "#059669" : "#64748b" }}>
                      {c.status === "ok" ? t("fm_plan.status_ok") : c.status === "skip" ? t("fm_plan.status_skip") : c.status?.startsWith("err") ? `${t("fm_plan.status_err")}: ${c.status.slice(4)}` : c.sentAt ? t("fm_plan.sent_at", { when: new Date(c.sentAt).toLocaleString() }) : ""}
                    </td>
                    <td style={{ padding: "6px 8px" }}><button onClick={() => preview(c)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "white", cursor: "pointer", fontFamily: "inherit" }}>{t("fm_plan.preview")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
