// [feat/marketing-activation] Marketing → Aktywacja PreConnect (faza 1, założenia Artura 5.11).
// Ekran administratora za flagą ADMIN_MARKETING_ACTIVATION. Przebieg: wybór GRUPY odbiorców →
// lista firm (saldo, rezerwacje, ważność, powód kwalifikacji / wykluczenia) → treść PL/EN
// edytowana bez HTML → podgląd → zatwierdzenie (zamrożenie) → rejestr, test, wysyłka z rejestru.
// Bez „potrzeb kupców": nie znamy bieżących potrzeb, dostawca przedstawia to, co ma.
// Wszystko przez funkcje Netlify sprawdzające rolę admina po stronie serwera.
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { marketingCall } from "../../lib/db.js";

export const AUDIENCES = ["credits_no_proposal", "credits_proposal_ready", "used_before_free_credits", "credits_expiring", "no_valid_credits", "selected_companies"];
const EMPTY_CONTENT = { pl: { subject: "", body: "", cta: "" }, en: { subject: "", body: "", cta: "" } };
const box = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 };
const btn = (variant = "primary") => ({
  padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  border: variant === "primary" ? "none" : "1px solid #cbd5e1",
  background: variant === "primary" ? "#0d9488" : variant === "danger" ? "#dc2626" : "white",
  color: variant === "secondary" ? "#0f172a" : "white",
});
const tag = (bg, fg) => ({ display: "inline-block", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: bg, color: fg, marginRight: 4, marginBottom: 2 });
const inp = { padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const stepTitle = { fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#0f172a" };
const fmtDate = (s) => (s ? String(s).slice(0, 10) : "—");
const sameContent = (a, b) => JSON.stringify(a || EMPTY_CONTENT) === JSON.stringify(b || EMPTY_CONTENT);

export default function MarketingActivation({ fl }) {
  const { t } = useTranslation("legacy");
  const tr = (k, o) => t("admin.marketing." + k, o);
  const audLabel = (key) => tr("aud_" + key, { defaultValue: tr("tpl_" + key, { defaultValue: key }) });
  const [campaigns, setCampaigns] = useState([]);
  const [current, setCurrent] = useState(null);           // { campaign, default_content, messages }
  const [candidates, setCandidates] = useState(null);     // { rows, summary, snapshot_at }
  const [selected, setSelected] = useState({});           // company_id -> true
  const [showOthers, setShowOthers] = useState(false);
  const [preview, setPreview] = useState(null);           // { subject, html, text, row, locale }
  const [content, setContent] = useState(EMPTY_CONTENT);  // edytor treści PL/EN
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ name: "", template_key: AUDIENCES[0], reply_to: "" });

  const toast = (msg, kind) => { if (typeof fl === "function") fl(msg, kind); };
  const errText = (e) => { const code = e?.payload?.error; const key = code ? "err_" + code : null; const msg = key ? t("admin.marketing." + key, { defaultValue: "" }) : ""; return msg || e?.message || String(e); };
  const run = async (label, fn) => { setBusy(label); try { return await fn(); } catch (e) { toast(errText(e), "error"); return null; } finally { setBusy(null); } };

  const loadCampaigns = () => run("list", async () => { const r = await marketingCall("marketing-campaign", { action: "list" }); setCampaigns(r.campaigns || []); return r; });
  useEffect(() => { loadCampaigns(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const contentOf = (r) => (r?.campaign?.content && Object.keys(r.campaign.content).length ? r.campaign.content : (r?.default_content || EMPTY_CONTENT));
  const openCampaign = (id) => run("get", async () => {
    const r = await marketingCall("marketing-campaign", { action: "get", campaign_id: id });
    setCurrent(r); setCandidates(null); setSelected({}); setPreview(null); setContent(contentOf(r));
    const c = await marketingCall("marketing-candidates", { campaign_id: id });
    setCandidates(c);
    return r;
  });

  const createCampaign = () => run("create", async () => {
    if (form.template_key === "selected_companies" && !form.name.trim()) return;
    const r = await marketingCall("marketing-campaign", { action: "create", ...form });
    toast(tr("created")); await loadCampaigns(); await openCampaign(r.campaign.id);
  });

  const refreshCandidates = () => current && run("candidates", async () => { const c = await marketingCall("marketing-candidates", { campaign_id: current.campaign.id }); setCandidates(c); setSelected({}); toast(tr("refreshed", { at: new Date(c.snapshot_at).toLocaleTimeString("pl-PL") })); });

  const previewRow = () => {
    const rows = candidates?.rows || [];
    return rows.find((r) => selected[r.company_id]) || rows.find((r) => r.eligible) || rows[0] || null;
  };
  const doPreview = (row, locale, useEditor = true) => current && run("preview", async () => {
    if (!row) { toast(tr("no_rows"), "error"); return; }
    const body = { campaign_id: current.campaign.id, company_id: row.company_id, locale: locale || row.locale };
    if (useEditor && current.campaign.status === "draft") body.content = content; // niezapisana treść z edytora
    const r = await marketingCall("marketing-preview", body);
    // znacznik „treść własna" w tytule: w szkicu = edytor różni się od domyślnej, po zatwierdzeniu = zapisana treść własna
    const custom = current.campaign.status === "draft" ? !sameContent(content, current.default_content || EMPTY_CONTENT) : Object.keys(current.campaign.content || {}).length > 0;
    setPreview({ ...r, locale: locale || row.locale, rowRef: row, custom });
  });

  // wierna kopia z rejestru (to, co wyjdzie/wyszło) — w odróżnieniu od podglądu szablonu z aktualnych danych
  const savedPreview = (m) => current && run("saved", async () => {
    const r = await marketingCall("marketing-campaign", { action: "message", campaign_id: current.campaign.id, message_id: m.id });
    setPreview({ subject: r.message.subject, html: r.message.html, text: r.message.text_body, locale: r.message.locale, row: { company_name: r.message.snapshot?.company_name || r.message.to_email }, saved: true, to: r.message.to_email });
  });

  const saveContent = (reset = false) => current && run("content", async () => {
    const r = await marketingCall("marketing-campaign", { action: "update_content", campaign_id: current.campaign.id, content: reset ? {} : content, expected_version: current.campaign.content_version });
    toast(reset ? tr("content_reset") : tr("content_saved"));
    const next = { ...current, campaign: r.campaign };
    setCurrent(next); setContent(contentOf(next));
    await loadCampaigns();
  });

  const selectedRows = useMemo(() => (candidates?.rows || []).filter((r) => selected[r.company_id] && r.eligible), [candidates, selected]);
  const approve = () => current && run("approve", async () => {
    // bez pola „źródło zgody” (decyzja Artura 05.11): zgoda z regulaminu przy rejestracji, podstawę zapisuje serwer
    const recipients = selectedRows.map((r) => ({ company_id: r.company_id }));
    if (!recipients.length) { toast(tr("select_first"), "error"); return; }
    // [P1 #1] niezapisane zmiany w edytorze: podgląd pokazywał inną treść niż ta w bazie — najpierw zapis
    if (isDraft && !sameContent(content, contentOf(current))) { toast(tr("save_first"), "error"); return; }
    const pl = selectedRows.filter((r) => r.locale === "pl").length, en = selectedRows.length - pl;
    if (!window.confirm(tr("approve_confirm", { n: recipients.length, pl, en, audience: audLabel(current.campaign.template_key) }))) return;
    const r = await marketingCall("marketing-campaign", { action: "approve", campaign_id: current.campaign.id, recipients, content_version: current.campaign.content_version });
    toast(tr("approved", { n: r.approved, skipped: (r.skipped || []).length }));
    await openCampaign(current.campaign.id); await loadCampaigns();
  });

  const sendTest = (messageId) => current && run("test", async () => {
    if (!testTo.trim()) { toast(tr("test_to_required"), "error"); return; }
    const r = await marketingCall("marketing-send", { campaign_id: current.campaign.id, mode: "test", test_to: testTo.trim(), message_id: messageId });
    toast(r.duplicate ? tr("test_duplicate") : tr("test_sent", { to: testTo.trim() }));
    await openCampaign(current.campaign.id);
  });

  const sendBatch = () => current && run("send", async () => {
    const pending = (current.messages || []).filter((m) => !m.is_test && ["pending", "claimed"].includes(m.state)).length;
    if (!window.confirm(tr("send_confirm", { n: pending }))) return;
    const r = await marketingCall("marketing-send", { campaign_id: current.campaign.id, mode: "batch" });
    toast(tr("send_result", { ...r.outcome, remaining: r.remaining }));
    if (r.allowlist?.active) toast(tr("send_allowlist_note", { n: r.allowlist.blocked || 0 }), "info");
    await openCampaign(current.campaign.id); await loadCampaigns();
  });

  const closeCampaign = () => current && run("close", async () => {
    if (!window.confirm(tr("close_confirm", { name: current.campaign.name }))) return;
    await marketingCall("marketing-campaign", { action: "close", campaign_id: current.campaign.id });
    toast(tr("closed_toast")); await loadCampaigns(); await openCampaign(current.campaign.id);
  });

  const visibleRows = useMemo(() => (candidates?.rows || []).filter((r) => showOthers || r.eligible), [candidates, showOthers]);
  const selectedCount = selectedRows.length;
  const isDraft = current?.campaign?.status === "draft";
  const isManual = current?.campaign?.template_key === "selected_companies";
  const editable = current && ["draft", "approved"].includes(current.campaign.status);
  const contentDirty = current && !sameContent(content, contentOf(current));
  const contentIsCustom = current && Object.keys(current.campaign.content || {}).length > 0;
  const setField = (locale, field, value) => setContent({ ...content, [locale]: { ...content[locale], [field]: value } });
  const reasonTag = (r) => {
    const code = r.audience_reason || "";
    const ok = r.in_audience;
    return <span style={tag(ok ? "#dcfce7" : "#fee2e2", ok ? "#166534" : "#991b1b")}>{tr("r_" + code, { defaultValue: code })}</span>;
  };

  return (
    <div style={{ padding: 20, maxWidth: 1240 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px", color: "#0f172a" }}>{tr("title")}</h1>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>{tr("subtitle")}</div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14 }}>
        <div>
          <div style={box}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{tr("campaigns")}</div>
            {campaigns.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>{tr("no_campaigns")}</div>}
            {campaigns.map((c) => (
              <div key={c.id} data-testid="mk-campaign" onClick={() => openCampaign(c.id)} style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: current?.campaign?.id === c.id ? "#f0fdfa" : "transparent", border: "1px solid " + (current?.campaign?.id === c.id ? "#99f6e4" : "transparent"), marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{tr("status_" + c.status)} · {audLabel(c.template_key)} · {c.counts?.total || 0} {tr("messages_short")}</div>
              </div>
            ))}
          </div>
          <div style={box}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{tr("new_campaign")}</div>
            {form.template_key === "selected_companies" && <>
              <label htmlFor="mk-campaign-name" style={{ fontSize: 11, color: "#64748b" }}>{tr("f_name")}</label>
              <input id="mk-campaign-name" data-testid="mk-name" maxLength={160} style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr("f_name_ph")} />
            </>}
            <label style={{ fontSize: 11, color: "#64748b", marginTop: 8, display: "block" }}>{tr("f_audience")}</label>
            <select data-testid="mk-audience" style={inp} value={form.template_key} onChange={(e) => setForm({ ...form, template_key: e.target.value })}>
              {AUDIENCES.map((k) => <option key={k} value={k}>{tr("aud_" + k)}</option>)}
            </select>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{tr("aud_desc_" + form.template_key)}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{tr("automatic_name")}</div>
            <label style={{ fontSize: 11, color: "#64748b", marginTop: 8, display: "block" }}>{tr("f_reply_to")}</label>
            <input style={inp} value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} placeholder="preconnect@freshmarket.eu" />
            <button data-testid="mk-create" style={{ ...btn("primary"), marginTop: 10 }} disabled={!!busy || (form.template_key === "selected_companies" && !form.name.trim())} onClick={createCampaign}>{tr("create")}</button>
          </div>
        </div>

        <div>
          {!current && <div style={{ ...box, color: "#64748b", fontSize: 13 }}>{tr("pick_campaign")}</div>}
          {current && (
            <>
              <div style={box}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{current.campaign.name}</div>
                  <span style={tag("#e2e8f0", "#0f172a")}>{tr("status_" + current.campaign.status)}</span>
                  <span style={tag("#ccfbf1", "#0f766e")}>{audLabel(current.campaign.template_key)}</span>
                  {current.campaign.reply_to && <span style={{ fontSize: 11, color: "#64748b" }}>reply-to: {current.campaign.reply_to}</span>}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button style={btn("secondary")} disabled={!!busy} onClick={refreshCandidates}>{tr("refresh")}</button>
                    {current.campaign.status !== "closed" && <button data-testid="mk-close" style={btn("secondary")} disabled={!!busy} onClick={closeCampaign}>{tr("close_campaign")}</button>}
                  </div>
                </div>
                {AUDIENCES.includes(current.campaign.template_key) && <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>{tr("aud_desc_" + current.campaign.template_key)}</div>}
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{tr("no_send_note")}</div>
              </div>

              {candidates && (
                <div style={box}>
                  <div style={stepTitle}>{tr("step_recipients")}</div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginBottom: 6 }}>
                    <span><b>{candidates.summary.companies}</b> {tr("s_companies")}</span>
                    <span><b>{candidates.summary.base_ok}</b> {tr("s_base_ok")}</span>
                    <span><b>{candidates.summary.eligible}</b> {tr("s_eligible")}</span>
                    <span style={{ color: "#94a3b8" }}>{tr("snapshot_at")} {new Date(candidates.snapshot_at).toLocaleString("pl-PL")}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{tr("by_audience")}: {AUDIENCES.map((k) => `${tr("aud_" + k)} ${candidates.summary.by_audience?.[k] ?? 0}`).join(" · ")}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>{tr("exclusions_overlap")}: {Object.entries(candidates.summary.by_exclusion || {}).map(([k, v]) => `${tr("ex_" + k)} ${v}`).join(" · ") || "—"}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} /> {tr("show_others")}</label>
                    {/* kampania ręczna („Do wybranych firm"): bez masowego zaznaczania — tylko pojedyncze firmy (review b279e44 pkt 1) */}
                    {editable && !isManual && <button data-testid="mk-select-visible" style={btn("secondary")} onClick={() => { const next = {}; visibleRows.filter((r) => r.eligible).forEach((r) => { next[r.company_id] = true; }); setSelected(next); }}>{tr("select_visible")}</button>}
                    {editable && isManual && <span data-testid="mk-manual-hint" style={{ fontSize: 11, color: "#64748b" }}>{tr("manual_pick_hint", { n: selectedCount })}</span>}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ textAlign: "left", color: "#64748b", fontSize: 11 }}>
                        <th style={{ padding: 6 }}></th><th style={{ padding: 6 }}>{tr("c_company")}</th><th style={{ padding: 6 }}>{tr("c_operator")}</th><th style={{ padding: 6 }}>{tr("c_lang")}</th>
                        <th style={{ padding: 6 }}>{tr("c_credits")}</th><th style={{ padding: 6 }}>{tr("c_reserved")}</th><th style={{ padding: 6 }}>{tr("c_expiry")}</th><th style={{ padding: 6 }}>{tr("c_activity")}</th>
                        <th style={{ padding: 6 }}>{tr("c_reason")}</th><th style={{ padding: 6 }}></th>
                      </tr></thead>
                      <tbody>
                        {visibleRows.map((r) => (
                          <tr key={r.company_id} data-testid="mk-row" style={{ borderTop: "1px solid #f1f5f9", opacity: r.eligible ? 1 : 0.65 }}>
                            <td style={{ padding: 6 }}>{editable && r.eligible && <input type="checkbox" checked={!!selected[r.company_id]} onChange={(e) => setSelected({ ...selected, [r.company_id]: e.target.checked })} />}</td>
                            <td style={{ padding: 6 }}><div style={{ fontWeight: 600 }}>{r.company_name}</div><div style={{ color: "#94a3b8", fontSize: 11 }}>{r.country} · {(r.categories || []).join(", ")}</div></td>
                            <td style={{ padding: 6 }}>{r.email ? <><div>{r.operator_name || "—"}</div><div style={{ color: "#64748b", fontSize: 11 }}>{r.email}</div></> : "—"}</td>
                            <td style={{ padding: 6 }}>{r.locale.toUpperCase()}</td>
                            <td style={{ padding: 6 }} title={`bezpł. ${r.snapshot.credits_free} / kup. ${r.snapshot.credits_paid} / hist. ${r.snapshot.credits_legacy}`}><b>{r.snapshot.credits_available}</b> <span style={{ color: "#94a3b8", fontSize: 11 }}>/ {r.snapshot.credits_remaining}</span></td>
                            <td style={{ padding: 6 }}>{r.snapshot.reserved}</td>
                            <td style={{ padding: 6 }}>{fmtDate(r.snapshot.nearest_expiry)}</td>
                            <td style={{ padding: 6, fontSize: 11 }}>{tr("sends")}: {r.snapshot.sends_total} · {tr("reads")}: {r.snapshot.reads_total} · {tr("offers")}: {r.snapshot.offers_total}<br />{tr("last_send")}: {fmtDate(r.snapshot.last_send_at)}</td>
                            <td style={{ padding: 6 }}>{reasonTag(r)}
                              {r.exclusions.map((x) => <span key={x} style={tag("#fee2e2", "#991b1b")}>{tr("ex_" + x)}</span>)}
                              {r.warnings.map((x) => <span key={x} style={tag("#fef3c7", "#92400e")}>{tr("w_" + x)}</span>)}</td>
                            <td style={{ padding: 6, whiteSpace: "nowrap" }}><button style={btn("secondary")} disabled={!!busy} onClick={() => doPreview(r, "pl")}>PL</button> <button style={btn("secondary")} disabled={!!busy} onClick={() => doPreview(r, "en")}>EN</button></td>
                          </tr>
                        ))}
                        {visibleRows.length === 0 && <tr><td colSpan={10} style={{ padding: 12, color: "#94a3b8" }}>{tr("no_rows")}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={box}>
                <div style={{ ...stepTitle, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{tr("step_content")}</span>
                  <span style={tag(contentIsCustom ? "#fef3c7" : "#f1f5f9", contentIsCustom ? "#92400e" : "#475569")}>{contentIsCustom ? tr("content_custom") : tr("content_default")}</span>
                  {contentDirty && isDraft && <span style={tag("#fee2e2", "#991b1b")}>{tr("content_unsaved")}</span>}
                </div>
                {isDraft ? (
                  <>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{tr("content_hint")}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>{tr("placeholders_help")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {["pl", "en"].map((locale) => (
                        <div key={locale}>
                          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{locale.toUpperCase()}</div>
                          <label style={{ fontSize: 11, color: "#64748b" }}>{tr("f_subject")}</label>
                          <input data-testid={`mk-subject-${locale}`} style={inp} value={content[locale]?.subject || ""} onChange={(e) => setField(locale, "subject", e.target.value)} />
                          <label style={{ fontSize: 11, color: "#64748b", marginTop: 6, display: "block" }}>{tr("f_body")}</label>
                          <textarea data-testid={`mk-body-${locale}`} style={{ ...inp, minHeight: 260, fontFamily: "inherit" }} value={content[locale]?.body || ""} onChange={(e) => setField(locale, "body", e.target.value)} />
                          <label style={{ fontSize: 11, color: "#64748b", marginTop: 6, display: "block" }}>{tr("f_cta")}</label>
                          <input data-testid={`mk-cta-${locale}`} style={inp} value={content[locale]?.cta || ""} onChange={(e) => setField(locale, "cta", e.target.value)} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                      <button data-testid="mk-save-content" style={btn("primary")} disabled={!!busy || !contentDirty} onClick={() => saveContent(false)}>{tr("save_content")}</button>
                      <button data-testid="mk-reset-content" style={btn("secondary")} disabled={!!busy} onClick={() => saveContent(true)}>{tr("reset_content")}</button>
                      <span style={{ width: 12 }} />
                      <button data-testid="mk-preview-pl" style={btn("secondary")} disabled={!!busy} onClick={() => doPreview(previewRow(), "pl")}>{tr("preview_pl")}</button>
                      <button data-testid="mk-preview-en" style={btn("secondary")} disabled={!!busy} onClick={() => doPreview(previewRow(), "en")}>{tr("preview_en")}</button>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{tr("preview_pick_hint")}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "#64748b" }}>{tr("content_frozen_note")}</div>
                )}
              </div>

              {editable && candidates && (
                <div style={box}>
                  <div style={stepTitle}>{tr("step_approve")}</div>
                  <div style={{ fontSize: 12, marginBottom: 8 }} data-testid="mk-approve-summary">{tr("approve_summary", { n: selectedCount, pl: selectedRows.filter((r) => r.locale === "pl").length, en: selectedRows.filter((r) => r.locale === "en").length, audience: audLabel(current.campaign.template_key) })}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{tr("consent_note")}</span>
                    <button data-testid="mk-approve" style={btn("primary")} disabled={!!busy || selectedCount === 0} onClick={approve}>{tr("approve", { n: selectedCount })}</button>
                    {contentDirty && isDraft && <span style={tag("#fee2e2", "#991b1b")}>{tr("save_first")}</span>}
                  </div>
                </div>
              )}

              <div style={box}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{tr("messages")} ({(current.messages || []).filter((m) => !m.is_test).length})</div>
                  {current.campaign.status !== "closed" && <input style={{ ...inp, width: 260 }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={tr("test_to_ph")} />}
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{tr("test_note")}</span>
                  {["approved", "sending"].includes(current.campaign.status) && (
                    <button style={{ ...btn("danger"), marginLeft: "auto" }} disabled={!!busy} onClick={sendBatch}>{tr("send_batch")}</button>
                  )}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ textAlign: "left", color: "#64748b", fontSize: 11 }}><th style={{ padding: 6 }}>{tr("m_to")}</th><th style={{ padding: 6 }}>{tr("m_subject")}</th><th style={{ padding: 6 }}>{tr("c_consent")}</th><th style={{ padding: 6 }}>{tr("m_state")}</th><th style={{ padding: 6 }}>{tr("m_attempts")}</th><th style={{ padding: 6 }}>{tr("m_sent")}</th><th style={{ padding: 6 }}></th></tr></thead>
                  <tbody>
                    {(current.messages || []).map((m) => (
                      <tr key={m.id} style={{ borderTop: "1px solid #f1f5f9", color: m.is_test ? "#94a3b8" : "#0f172a" }}>
                        <td style={{ padding: 6 }}>{m.to_email}{m.is_test && <span style={tag("#f1f5f9", "#475569")}>TEST</span>}</td>
                        <td style={{ padding: 6 }}>{m.subject}</td>
                        <td style={{ padding: 6, fontSize: 11 }}>{m.consent_source || <span style={{ color: "#dc2626" }}>{tr("consent_missing")}</span>}</td>
                        <td style={{ padding: 6 }}><span style={tag(stateBg(m.state), stateFg(m.state))}>{tr("st_" + m.state)}</span>{m.last_error && <div style={{ fontSize: 10, color: "#94a3b8" }}>{m.last_error}</div>}</td>
                        <td style={{ padding: 6 }}>{m.attempts}</td>
                        <td style={{ padding: 6, fontSize: 11 }}>{m.sent_at ? new Date(m.sent_at).toLocaleString("pl-PL") : "—"}{m.resend_message_id && <div style={{ color: "#94a3b8", fontSize: 10 }}>{m.resend_message_id}</div>}</td>
                        <td style={{ padding: 6, whiteSpace: "nowrap" }}><button data-testid="mk-saved-preview" style={btn("secondary")} disabled={!!busy} onClick={() => savedPreview(m)}>{tr("saved_preview")}</button> {!m.is_test && current.campaign.status !== "closed" && <button style={btn("secondary")} disabled={!!busy} onClick={() => sendTest(m.id)}>{tr("send_test")}</button>}</td>
                      </tr>
                    ))}
                    {(current.messages || []).length === 0 && <tr><td colSpan={7} style={{ padding: 12, color: "#94a3b8" }}>{tr("no_messages")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 12, width: "min(760px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{preview.saved ? tr("saved_preview_title") : tr("preview")} · {preview.locale.toUpperCase()} · {preview.row?.company_name}{preview.saved ? ` · ${preview.to}` : preview.custom ? ` · ${tr("content_custom")}` : ""}</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {!preview.saved && <button style={btn("secondary")} onClick={() => doPreview(preview.rowRef, "pl")}>PL</button>}
                {!preview.saved && <button style={btn("secondary")} onClick={() => doPreview(preview.rowRef, "en")}>EN</button>}
                <button style={btn("secondary")} onClick={() => setPreview(null)}>✕</button>
              </div>
            </div>
            {!preview.saved && !isDraft && <div data-testid="mk-preview-live-note" style={{ padding: "6px 16px", fontSize: 11, color: "#92400e", background: "#fef3c7" }}>{tr("preview_live_note")}</div>}
            <div style={{ padding: "8px 16px", fontSize: 12, borderBottom: "1px solid #f1f5f9" }}><b>{tr("m_subject")}:</b> {preview.subject}</div>
            <iframe title="preview" srcDoc={preview.html} sandbox="" style={{ flex: 1, border: "none", minHeight: 420 }} />
            <details style={{ padding: "8px 16px", fontSize: 11, color: "#475569", borderTop: "1px solid #f1f5f9" }}><summary>{tr("text_version")}</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{preview.text}</pre></details>
          </div>
        </div>
      )}
    </div>
  );
}

function stateBg(s) { return s === "accepted" ? "#dcfce7" : s === "rejected" || s === "blocked_no_consent" ? "#fee2e2" : s === "suppressed" ? "#f1f5f9" : s === "needs_review" || s === "uncertain" ? "#fef3c7" : "#e0f2fe"; }
function stateFg(s) { return s === "accepted" ? "#166534" : s === "rejected" || s === "blocked_no_consent" ? "#991b1b" : s === "suppressed" ? "#475569" : s === "needs_review" || s === "uncertain" ? "#92400e" : "#075985"; }
