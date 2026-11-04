// [feat/marketing-activation] Marketing → Aktywacja PreConnect (faza 1).
// Ekran administratora za flagą ADMIN_MARKETING_ACTIVATION: kampanie, kandydaci
// (saldo, rezerwacje, ważność, wykluczenia, dopasowanie), źródło zgody, podgląd PL/EN,
// zatwierdzenie (zamrożenie), test na adres zespołu, wysyłka z rejestru, stany.
// Wszystko przez funkcje Netlify sprawdzające rolę admina po stronie serwera.
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { marketingCall } from "../../lib/db.js";

const TEMPLATES = ["start_with_credits", "return_active"];
const box = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 };
const btn = (variant = "primary") => ({
  padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  border: variant === "primary" ? "none" : "1px solid #cbd5e1",
  background: variant === "primary" ? "#0d9488" : variant === "danger" ? "#dc2626" : "white",
  color: variant === "secondary" ? "#0f172a" : "white",
});
const tag = (bg, fg) => ({ display: "inline-block", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: bg, color: fg, marginRight: 4, marginBottom: 2 });
const inp = { padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const fmtDate = (s) => (s ? String(s).slice(0, 10) : "—");

export default function MarketingActivation({ fl }) {
  const { t } = useTranslation("legacy");
  const tr = (k, o) => t("admin.marketing." + k, o);
  const [campaigns, setCampaigns] = useState([]);
  const [current, setCurrent] = useState(null);           // { campaign, messages }
  const [candidates, setCandidates] = useState(null);     // { rows, summary, snapshot_at }
  const [selected, setSelected] = useState({});           // company_id -> true
  const [consent, setConsent] = useState({});             // company_id -> text
  const [bulkConsent, setBulkConsent] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [preview, setPreview] = useState(null);           // { subject, html, text, row, locale }
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ name: "", template_key: "start_with_credits", target_categories: "", target_keywords: "", needs_note: "", reply_to: "" });

  const toast = (msg, kind) => { if (typeof fl === "function") fl(msg, kind); };
  const run = async (label, fn) => { setBusy(label); try { return await fn(); } catch (e) { toast(e?.message || String(e), "error"); return null; } finally { setBusy(null); } };

  const loadCampaigns = () => run("list", async () => { const r = await marketingCall("marketing-campaign", { action: "list" }); setCampaigns(r.campaigns || []); return r; });
  useEffect(() => { loadCampaigns(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCampaign = (id) => run("get", async () => {
    const r = await marketingCall("marketing-campaign", { action: "get", campaign_id: id });
    setCurrent(r); setCandidates(null); setSelected({}); setPreview(null);
    const c = await marketingCall("marketing-candidates", { campaign_id: id });
    setCandidates(c);
    return r;
  });

  const createCampaign = () => run("create", async () => {
    const r = await marketingCall("marketing-campaign", { action: "create", ...form });
    toast(tr("created")); await loadCampaigns(); await openCampaign(r.campaign.id);
  });

  const refreshCandidates = () => current && run("candidates", async () => { const c = await marketingCall("marketing-candidates", { campaign_id: current.campaign.id }); setCandidates(c); setSelected({}); toast(tr("refreshed", { at: new Date(c.snapshot_at).toLocaleTimeString("pl-PL") })); });

  const doPreview = (row, locale) => current && run("preview", async () => {
    const r = await marketingCall("marketing-preview", { campaign_id: current.campaign.id, company_id: row.company_id, locale: locale || row.locale });
    setPreview({ ...r, locale: locale || row.locale, rowRef: row });
  });

  const approve = () => current && run("approve", async () => {
    const recipients = Object.keys(selected).filter((id) => selected[id]).map((id) => ({ company_id: id, consent_source: consent[id] || bulkConsent || "" }));
    if (!recipients.length) { toast(tr("select_first"), "error"); return; }
    if (recipients.some((r) => !r.consent_source.trim())) { toast(tr("consent_required"), "error"); return; }
    if (!window.confirm(tr("approve_confirm", { n: recipients.length }))) return;
    const r = await marketingCall("marketing-campaign", { action: "approve", campaign_id: current.campaign.id, recipients });
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
    await openCampaign(current.campaign.id); await loadCampaigns();
  });

  const visibleRows = useMemo(() => {
    const rows = candidates?.rows || [];
    return rows.filter((r) => (showExcluded || r.eligible) && (segmentFilter === "all" || r.segment === segmentFilter));
  }, [candidates, showExcluded, segmentFilter]);
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const editable = current && ["draft", "approved"].includes(current.campaign.status);

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
                <div style={{ fontSize: 11, color: "#64748b" }}>{tr("status_" + c.status)} · {tr("tpl_" + c.template_key)} · {c.counts?.total || 0} {tr("messages_short")}</div>
              </div>
            ))}
          </div>
          <div style={box}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{tr("new_campaign")}</div>
            <label style={{ fontSize: 11, color: "#64748b" }}>{tr("f_name")}</label>
            <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr("f_name_ph")} />
            <label style={{ fontSize: 11, color: "#64748b", marginTop: 8, display: "block" }}>{tr("f_template")}</label>
            <select style={inp} value={form.template_key} onChange={(e) => setForm({ ...form, template_key: e.target.value })}>
              {TEMPLATES.map((k) => <option key={k} value={k}>{tr("tpl_" + k)}</option>)}
            </select>
            <label style={{ fontSize: 11, color: "#64748b", marginTop: 8, display: "block" }}>{tr("f_categories")}</label>
            <input style={inp} value={form.target_categories} onChange={(e) => setForm({ ...form, target_categories: e.target.value })} placeholder="owoce, warzywa" />
            <label style={{ fontSize: 11, color: "#64748b", marginTop: 8, display: "block" }}>{tr("f_keywords")}</label>
            <input style={inp} value={form.target_keywords} onChange={(e) => setForm({ ...form, target_keywords: e.target.value })} placeholder="jabłka, pomidory malinowe" />
            <label style={{ fontSize: 11, color: "#64748b", marginTop: 8, display: "block" }}>{tr("f_needs")}</label>
            <textarea style={{ ...inp, minHeight: 54 }} value={form.needs_note} onChange={(e) => setForm({ ...form, needs_note: e.target.value })} placeholder={tr("f_needs_ph")} />
            <label style={{ fontSize: 11, color: "#64748b", marginTop: 8, display: "block" }}>{tr("f_reply_to")}</label>
            <input style={inp} value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} placeholder="preconnect@freshmarket.eu" />
            <button style={{ ...btn("primary"), marginTop: 10 }} disabled={!!busy || !form.name.trim()} onClick={createCampaign}>{tr("create")}</button>
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
                  <span style={tag("#ccfbf1", "#0f766e")}>{tr("tpl_" + current.campaign.template_key)}</span>
                  {current.campaign.reply_to && <span style={{ fontSize: 11, color: "#64748b" }}>reply-to: {current.campaign.reply_to}</span>}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button style={btn("secondary")} disabled={!!busy} onClick={refreshCandidates}>{tr("refresh")}</button>
                  </div>
                </div>
                {(current.campaign.target_categories?.length || current.campaign.target_keywords?.length) ? (
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>{tr("needs")}: {[...(current.campaign.target_categories || []), ...(current.campaign.target_keywords || [])].join(", ")}{current.campaign.needs_note ? ` — ${current.campaign.needs_note}` : ""}</div>
                ) : <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>{tr("needs_none")}</div>}
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{tr("no_send_note")}</div>
              </div>

              {candidates && (
                <div style={box}>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginBottom: 10 }}>
                    <span><b>{candidates.summary.companies}</b> {tr("s_companies")}</span>
                    <span><b>{candidates.summary.eligible}</b> {tr("s_eligible")}</span>
                    <span><b>{candidates.summary.matched}</b> {tr("s_matched")}</span>
                    {Object.entries(candidates.summary.by_segment || {}).map(([k, v]) => <span key={k}>{tr("seg_" + k)}: <b>{v}</b></span>)}
                    <span style={{ color: "#94a3b8" }}>{tr("snapshot_at")} {new Date(candidates.snapshot_at).toLocaleString("pl-PL")}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>{tr("exclusions_overlap")}: {Object.entries(candidates.summary.by_exclusion || {}).map(([k, v]) => `${tr("ex_" + k)} ${v}`).join(" · ") || "—"}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} /> {tr("show_excluded")}</label>
                    <select style={{ ...inp, width: 220 }} value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)}>
                      <option value="all">{tr("all_segments")}</option>
                      {["start_with_credits", "return_active", "in_process_only", "no_credits"].map((k) => <option key={k} value={k}>{tr("seg_" + k)}</option>)}
                    </select>
                    {editable && <>
                      <input style={{ ...inp, width: 300 }} value={bulkConsent} onChange={(e) => setBulkConsent(e.target.value)} placeholder={tr("consent_bulk_ph")} />
                      <button data-testid="mk-select-visible" style={btn("secondary")} onClick={() => { const next = {}; visibleRows.filter((r) => r.eligible).forEach((r) => { next[r.company_id] = true; }); setSelected(next); }}>{tr("select_visible")}</button>
                      <button data-testid="mk-approve" style={btn("primary")} disabled={!!busy || selectedCount === 0} onClick={approve}>{tr("approve", { n: selectedCount })}</button>
                    </>}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ textAlign: "left", color: "#64748b", fontSize: 11 }}>
                        <th style={{ padding: 6 }}></th><th style={{ padding: 6 }}>{tr("c_company")}</th><th style={{ padding: 6 }}>{tr("c_operator")}</th><th style={{ padding: 6 }}>{tr("c_lang")}</th>
                        <th style={{ padding: 6 }}>{tr("c_credits")}</th><th style={{ padding: 6 }}>{tr("c_reserved")}</th><th style={{ padding: 6 }}>{tr("c_expiry")}</th><th style={{ padding: 6 }}>{tr("c_activity")}</th>
                        <th style={{ padding: 6 }}>{tr("c_segment")}</th><th style={{ padding: 6 }}>{tr("c_match")}</th><th style={{ padding: 6 }}>{tr("c_consent")}</th><th style={{ padding: 6 }}></th>
                      </tr></thead>
                      <tbody>
                        {visibleRows.map((r) => (
                          <tr key={r.company_id} style={{ borderTop: "1px solid #f1f5f9", opacity: r.eligible ? 1 : 0.6 }}>
                            <td style={{ padding: 6 }}>{editable && r.eligible && <input type="checkbox" checked={!!selected[r.company_id]} onChange={(e) => setSelected({ ...selected, [r.company_id]: e.target.checked })} />}</td>
                            <td style={{ padding: 6 }}><div style={{ fontWeight: 600 }}>{r.company_name}</div><div style={{ color: "#94a3b8", fontSize: 11 }}>{r.country} · {(r.categories || []).join(", ")}</div></td>
                            <td style={{ padding: 6 }}>{r.email ? <><div>{r.operator_name || "—"}</div><div style={{ color: "#64748b", fontSize: 11 }}>{r.email}</div></> : "—"}</td>
                            <td style={{ padding: 6 }}>{r.locale.toUpperCase()}</td>
                            <td style={{ padding: 6 }}><b>{r.snapshot.credits_remaining}</b> <span style={{ color: "#94a3b8", fontSize: 11 }}>({r.snapshot.credits_free}/{r.snapshot.credits_paid}/{r.snapshot.credits_legacy})</span></td>
                            <td style={{ padding: 6 }}>{r.snapshot.reserved}</td>
                            <td style={{ padding: 6 }}>{fmtDate(r.snapshot.nearest_expiry)}</td>
                            <td style={{ padding: 6, fontSize: 11 }}>{tr("sends")}: {r.snapshot.sends_total} · {tr("reads")}: {r.snapshot.reads_total}<br />{tr("last_send")}: {fmtDate(r.snapshot.last_send_at)}</td>
                            <td style={{ padding: 6 }}><span style={tag(r.eligible ? "#dcfce7" : "#fee2e2", r.eligible ? "#166534" : "#991b1b")}>{tr("seg_" + r.segment)}</span>
                              {r.exclusions.map((x) => <span key={x} style={tag("#fee2e2", "#991b1b")} title={tr("ex_" + x)}>{tr("ex_" + x)}</span>)}
                              {r.warnings.map((x) => <span key={x} style={tag("#fef3c7", "#92400e")}>{tr("w_" + x)}</span>)}</td>
                            <td style={{ padding: 6 }}>{r.match.status === "n/a" ? "—" : r.match.status === "yes" ? <span style={tag("#dcfce7", "#166534")}>{[...r.match.categories, ...r.match.keywords].join(", ")}</span> : <span style={tag("#f1f5f9", "#475569")}>{tr("match_no")}</span>}</td>
                            <td style={{ padding: 6 }}>{editable && r.eligible ? <input style={{ ...inp, width: 160 }} value={consent[r.company_id] ?? ""} onChange={(e) => setConsent({ ...consent, [r.company_id]: e.target.value })} placeholder={bulkConsent || tr("consent_ph")} /> : null}</td>
                            <td style={{ padding: 6, whiteSpace: "nowrap" }}>{r.template_key && <><button style={btn("secondary")} disabled={!!busy} onClick={() => doPreview(r, "pl")}>PL</button> <button style={btn("secondary")} disabled={!!busy} onClick={() => doPreview(r, "en")}>EN</button></>}</td>
                          </tr>
                        ))}
                        {visibleRows.length === 0 && <tr><td colSpan={12} style={{ padding: 12, color: "#94a3b8" }}>{tr("no_rows")}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={box}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{tr("messages")} ({(current.messages || []).filter((m) => !m.is_test).length})</div>
                  <input style={{ ...inp, width: 260 }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={tr("test_to_ph")} />
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
                        <td style={{ padding: 6, whiteSpace: "nowrap" }}>{!m.is_test && <button style={btn("secondary")} disabled={!!busy} onClick={() => sendTest(m.id)}>{tr("send_test")}</button>}</td>
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
              <div style={{ fontWeight: 700, fontSize: 13 }}>{tr("preview")} · {preview.locale.toUpperCase()} · {preview.row?.company_name}</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button style={btn("secondary")} onClick={() => doPreview(preview.rowRef, "pl")}>PL</button>
                <button style={btn("secondary")} onClick={() => doPreview(preview.rowRef, "en")}>EN</button>
                <button style={btn("secondary")} onClick={() => setPreview(null)}>✕</button>
              </div>
            </div>
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
