import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commitCorrection, describeChange, loadCorrectionHistory, loadCorrections, undoCandidate } from "../../lib/fm-corrections";
import AddMeetingDialog from "./AddMeetingDialog";

const btn = { padding: "9px 13px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white", cursor: "pointer", font: "inherit", fontSize: 13 };
const card = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 };
const codeOf = e => String(e?.message || "").match(/fm_correction_[a-z_]+/)?.[0] || "network";

function ConfirmDialog({ pending, t, busy, cancel, confirm }) {
  const cancelRef = useRef(null);
  const [accept, setAccept] = useState(false);
  const [acceptGap, setAcceptGap] = useState(false);
  const dialogRef = useRef(null);
  useEffect(() => { const previous = globalThis.document?.activeElement; cancelRef.current?.focus(); return () => previous?.focus?.(); }, []);
  const onKey = e => {
    if (e.key === "Escape" && !busy) { e.preventDefault(); cancel(); }
    if (e.key === "Tab") {
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };
  const change = pending.change;
  const place = x => `${x.chain} · #${x.pos + 1}`;
  return <div style={{ position: "fixed", inset: 0, zIndex: 2200, background: "#0f172a99", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="fm-change-title" onKeyDown={onKey} style={{ ...card, width: "min(660px, 100%)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px #0004" }}>
      <h3 id="fm-change-title">{t(`fm.board.confirm_${pending.action}`)}</h3>
      {change ? <>
        <p><strong>{change.a.company}</strong><br/>{place(change.a)} → {place(change.b)}</p>
        {change.b.sid ? <p><strong>{change.b.company}</strong><br/>{place(change.b)} → {place(change.a)}</p> : <p>{t("fm.board.empty_target")}</p>}
        {change.a.cid !== change.b.cid && <p style={{ color: "#9a3412", fontWeight: 600 }}>{t("fm.board.cross_chain")}</p>}
        {!!change.rejected.length && <div style={{ ...card, borderColor: "#fca5a5", background: "#fef2f2" }}>
          <strong>{t("fm.board.rejected")}</strong>
          {change.rejected.map(x => <p key={`${x.cid}|${x.sid}`}>{x.company} — {x.chain}</p>)}
          <label><input type="checkbox" checked={accept} disabled={busy} onChange={e => setAccept(e.target.checked)}/> {t("fm.board.accept_rejection")}</label>
        </div>}
        {!!change.warnings.length && <div style={{ ...card, background: "#fffbeb" }}>
          <strong>{t("fm.board.gap_warning")}</strong>
          {change.warnings.map((x, i) => <p key={i}>{x.company}: {place(x)} / {x.otherChain} · #{x.otherPos + 1}</p>)}
          <label><input type="checkbox" checked={acceptGap} disabled={busy} onChange={e => setAcceptGap(e.target.checked)}/> {t("fm.board.accept_gap")}</label>
        </div>}
      </> : <p>{t(`fm.board.explain_${pending.action}`)}</p>}
      {pending.removal && <p><strong>{pending.removal.company}</strong><br/>{place(pending.removal)}</p>}
      {pending.addition && <><p><strong>{pending.addition.to.company}</strong><br/>{place(pending.addition.to)}</p>
        <p>{t("fm.board.add_count", { before: pending.addition.beforeCount, after: pending.addition.afterCount, limit: pending.addition.limit })}</p>
        <p>{t("fm.board.add_no_move")}</p></>}
      {pending.continueEdit && <p>{t(`fm.board.continue_${pending.continueEdit.action}`)}</p>}
      {pending.target && <HistorySummary entry={pending.target} t={t}/>}
      <p style={{ color: "#64748b", fontSize: 13 }}>{t("fm.board.confirm_hint")}</p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button ref={cancelRef} type="button" style={btn} disabled={busy} onClick={cancel}>{t("fm.board.cancel")}</button>
        <button type="button" style={{ ...btn, background: "#047857", color: "white" }} disabled={busy || (!!change?.rejected.length && !accept) || (!!change?.warnings.length && !acceptGap)} onClick={() => confirm(accept)}>{t(busy ? "fm.board.saving" : "fm.board.confirm")}</button>
      </div>
    </div>
  </div>;
}

function HistorySummary({ entry, t }) {
  const details = entry.details || {};
  const cell = x => `${x.company || x.sid || t("fm.board.empty_cell")} — ${x.chain || x.cid} #${x.pos + 1}`;
  return <div>
    <strong>{t(`fm.board.action_${entry.action}`)}</strong>
    {details.from && <div>{cell(details.from)} {details.to && <>{entry.action === "move" ? "→" : "↔"} {cell(details.to)}</>}</div>}
    {entry.action === "add" && details.to && <div>{cell(details.to)}</div>}
    {details.original?.from && <div>{cell(details.original.from)} {details.original.to ? <>↔ {cell(details.original.to)}</> : t("fm.board.restored_meeting")}</div>}
    {details.original?.to && !details.original.from && <div>{t("fm.board.removed_added_meeting")} {cell(details.original.to)}</div>}
    {entry.action === "undo" && <div>{t("fm.board.undo_revision", { revision: details.undo_revision })}</div>}
    {!!details.rejections?.length && <div style={{ color: "#b91c1c" }}>{t("fm.board.override_recorded")}</div>}
    <small style={{ color: "#64748b" }}>{entry.actor_name} · {new Date(entry.created_at).toLocaleString()} · #{entry.revision}</small>
  </div>;
}

export default function CorrectionBoard({ data, onApprove, fmChains = [], fmSuppliers = [], fmResps = {}, fmWishlists = {}, inputsReady = false, canEdit = false, buildCandidate, onDraftChange }) {
  const { t } = useTranslation("legacy");
  const [draft, setDraft] = useState(null), [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState(null), [pending, setPending] = useState(null), [filter, setFilter] = useState("all");
  const [inspected, setInspected] = useState(null);
  const [addTarget, setAddTarget] = useState(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const historyRef = useRef(null);
  const writing = useRef(false), generation = useRef(0), alive = useRef(false);
  const onDraftRef = useRef(onDraftChange); onDraftRef.current = onDraftChange;
  const onApproveRef = useRef(onApprove); onApproveRef.current = onApprove;
  const reload = useCallback(async () => {
    if (writing.current) return;
    const rev = ++generation.current; setLoaded(false); setError(""); setPending(null); setSelected(null); setInspected(null); setAddTarget(null);
    try {
      const next = await loadCorrections();
      const rows = next ? await loadCorrectionHistory(next.revision) : [];
      if (alive.current && rev === generation.current) {
        setDraft(next); setHistory(rows); setLoaded(true); if (next) onDraftRef.current?.(next.schedule);
        if (next?.approved) onApproveRef.current?.(next.schedule);
      }
    } catch (e) { if (alive.current && rev === generation.current) setError(codeOf(e)); }
  }, []);
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; ++generation.current; }; }, [reload]);
  useEffect(() => {
    if (!busy) return;
    const warn = e => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const plan = draft?.schedule || data;
  const undo = undoCandidate(history);
  const blocked = !loaded || busy || !!error || !inputsReady || !canEdit;
  const viewBlocked = !loaded || busy || !!error || !inputsReady || !!pending || !!addTarget;
  const moveBlocked = blocked || !draft || draft.approved || !!pending;
  const actionBlocked = blocked || !!pending || !!selected || !!addTarget;
  const labelCell = cell => ({ ...cell, company: fmSuppliers.find(s => s.id === cell.sid)?.name || cell.sid,
    chain: fmChains.find(c => c.id === cell.cid)?.name || cell.cid });
  const prepare = (action, extra = {}) => {
    if (blocked) return;
    setPending({ action, id: crypto.randomUUID(), revision: draft?.revision || 0, ...extra });
  };
  const cancel = () => { if (!writing.current) { setPending(null); setSelected(null); setAddTarget(null); } };
  const confirm = async accept => {
    if (!pending || writing.current || blocked) return;
    writing.current = true; ++generation.current; setBusy(true);
    const request = { ...pending, details: pending.change ? { from: pending.change.a, to: pending.change.b, accept_rejections: accept } : pending.removal ? { from: pending.removal } : pending.details };
    try {
      const next = await commitCorrection(request);
      if (!alive.current) return;
      setDraft(next); setPending(null); setSelected(null); onDraftRef.current?.(next.schedule);
      // Keep the preview attached to the company after its meeting changes position.
      setInspected(previous => {
        if (request.addition) return request.addition.to;
        if (!previous) return null;
        const destination = request.change?.a.sid === previous.sid ? request.change.b : previous;
        if (next.schedule.cq[destination.cid]?.[destination.pos] === previous.sid) return { ...destination, sid: previous.sid };
        for (const [cid, queue] of Object.entries(next.schedule.cq)) {
          const pos = queue.indexOf(previous.sid);
          if (pos !== -1) return { cid, pos, sid: previous.sid };
        }
        return null;
      });
      if (request.action === "approve") onApprove?.(next.schedule);
      // Read failure after a successful commit never rolls back the confirmed board.
      const rows = await loadCorrectionHistory(next.revision);
      if (alive.current) {
        setHistory(rows);
        // Initialization/unlocking is a separate confirmed write. Resume the intended action
        // only after both the saved board and its history have been obtained successfully.
        const continuation = request.continueEdit;
        if (continuation && !next.approved && (next.schedule.cq[continuation.cell.cid]?.[continuation.cell.pos] || null) === continuation.cell.sid) {
          if (continuation.action === "add") setAddTarget(continuation.cell);
          else if (continuation.action === "move") { setInspected(continuation.cell); setSelected(continuation.cell); }
          else setPending({ action: "remove", id: crypto.randomUUID(), revision: next.revision, removal: labelCell(continuation.cell) });
        }
      }
    } catch (e) {
      if (alive.current) { setError(codeOf(e)); setPending(null); setSelected(null); setAddTarget(null); setLoaded(false); }
    } finally { writing.current = false; if (alive.current) setBusy(false); }
  };
  const requestEdit = (action, cid, pos) => {
    if (actionBlocked) return;
    const sid = plan.cq[cid]?.[pos] || null;
    if (!sid) return;
    const cell = { cid, pos, sid };
    setInspected(cell);
    if (!draft) prepare("initialize", { schedule: plan, continueEdit: { action, cell } });
    else if (draft.approved) prepare("unlock", { continueEdit: { action, cell } });
    else if (action === "move") setSelected(cell);
    else prepare("remove", { removal: labelCell(cell) });
  };
  const armMove = (cid, pos) => requestEdit("move", cid, pos);
  const requestAdd = (cid, pos) => {
    if (actionBlocked || plan?.cq?.[cid]?.[pos]) return;
    const cell = { cid, pos, sid: null };
    if (!draft) prepare("initialize", { schedule: plan, continueEdit: { action: "add", cell } });
    else if (draft.approved) prepare("unlock", { continueEdit: { action: "add", cell } });
    else setAddTarget(cell);
  };
  const clickCell = (cid, pos, event) => {
    // Native double-click emits click(1), click(2), dblclick. Only dblclick arms editing.
    if (viewBlocked || event?.detail > 1) return;
    const sid = plan.cq[cid]?.[pos] || null;
    if (!selected) { if (sid) setInspected({ cid, pos, sid }); else requestAdd(cid, pos); return; }
    if (moveBlocked || (selected.cid === cid && selected.pos === pos)) return;
    try {
      const change = describeChange(plan, selected, { cid, pos }, fmSuppliers, fmChains, fmResps);
      if (change) prepare(change.action, { change }); else setSelected(null);
    } catch (e) { setSelected(null); setError(codeOf(e)); }
  };
  const names = new Map(fmSuppliers.map(s => [s.id, s.name]));
  const chains = filter === "all" ? fmChains : fmChains.filter(c => c.id === filter);
  const last = plan?.cq ? Math.max(20, ...Object.values(plan.cq).map(q => q.reduce((n, s, i) => s ? i + 1 : n, 0))) : 20;
  const meetings = plan?.cq ? Object.values(plan.cq).reduce((n, q) => n + q.filter(Boolean).length, 0) : 0;
  const inspectedMeetings = inspected ? Object.entries(plan?.cq || {}).flatMap(([cid, queue]) =>
    queue.flatMap((sid, pos) => sid === inspected.sid ? [{ cid, pos, chain: fmChains.find(c => c.id === cid)?.name || cid }] : [])) : [];
  return <section aria-label={t("fm.board.title")} onKeyDown={e => {
    if (e.key === "Escape" && !pending && !busy && !addTarget) { e.preventDefault(); if (selected) setSelected(null); else setInspected(null); }
  }}>
    {pending && <ConfirmDialog key={pending.id} pending={pending} t={t} busy={busy} cancel={cancel} confirm={confirm}/>}
    {addTarget && <AddMeetingDialog target={addTarget} plan={plan} suppliers={fmSuppliers} chains={fmChains} responses={fmResps} initialSupplier={inspected?.sid} t={t} cancel={cancel} choose={addition => {
      if (blocked || addition.issues.length) return;
      setAddTarget(null); prepare("add", { addition, details: { to: addition.to } });
    }}/>}
    <div style={card}>
      <h3 style={{ marginTop: 0 }}>{t("fm.board.title")}</h3>
      <p>{t("fm.board.instructions")}</p>
      <p style={{ color: "#64748b" }}>{draft ? t(draft.approved ? "fm.board.approved" : "fm.board.saved_revision", { revision: draft.revision }) : t("fm.board.not_started")}</p>
      {error && <p role="alert" style={{ color: "#b91c1c" }}>{t(`fm.board.errors.${error}`, { defaultValue: t("fm.board.errors.network") })}</p>}
      {!loaded && !error && <p role="status">{t("fm.board.loading")}</p>}
      {busy && <p role="status">{t("fm.board.saving")}</p>}
      {!canEdit && <p>{t("fm.board.phase_locked")}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn} disabled={busy} onClick={reload}>{t("fm.board.reload")}</button>
        <button type="button" style={btn} onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>{t("fm.board.history")} ({history.length})</button>
        {!draft ? <button type="button" style={btn} disabled={blocked || !plan?.cq} onClick={() => prepare("initialize", { schedule: plan })}>{t("fm.board.initialize")}</button> : <>
          <button type="button" style={btn} disabled={blocked || draft.approved || !undo} onClick={() => prepare("undo", { details: { undo_of: undo.id }, target: undo })}>{t("fm.board.undo")}</button>
          <button type="button" style={btn} disabled={blocked || draft.approved} onClick={() => prepare("rebuild", { schedule: buildCandidate() })}>{t("fm.board.rebuild")}</button>
          <button type="button" style={btn} disabled={blocked || draft.approved} onClick={() => prepare("load_approved")}>{t("fm.board.load_approved")}</button>
          <button type="button" style={{ ...btn, background: "#047857", color: "white" }} disabled={blocked} onClick={() => prepare(draft.approved ? "unlock" : "approve")}>{t(draft.approved ? "fm.board.unlock" : "fm.board.approve")}</button>
        </>}
      </div>
    </div>
    <div style={{ ...card, display: "flex", justifyContent: "space-around", gap: 10, flexWrap: "wrap" }}>
      <span>{fmSuppliers.length} {t("fm.corrections.kpi_suppliers")}</span><span>{fmChains.length} {t("fm.corrections.kpi_chains")}</span>
      <strong>{meetings} {t("fm.corrections.kpi_meetings")}</strong><span>{history.filter(x => ["swap", "move", "remove", "add", "undo", "rebuild", "load_approved"].includes(x.action)).length} {t("fm.corrections.kpi_admin_changes")}</span>
    </div>
    {fmChains.some(c => fmWishlists[c.id]?.length) && <div style={card}>
      <strong>{t("fm.corrections.wishlist_header")}</strong><p>{t("fm.corrections.wishlist_desc")}</p>
      {fmChains.filter(c => fmWishlists[c.id]?.length).map(c => <p key={c.id}><strong>{c.name}: </strong>{fmWishlists[c.id].map(id => names.get(id) || id).join(", ")}</p>)}
    </div>}
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <select aria-label={t("fm.board.filter")} disabled={busy || !!pending || !!addTarget} value={filter} onChange={e => { setFilter(e.target.value); setSelected(null); }} style={btn}>
        <option value="all">{t("fm.board.all_chains")}</option>{fmChains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {selected && <><strong style={{ color: "#92400e" }}>{t("fm.board.move_mode")}: {names.get(selected.sid)} — {fmChains.find(c => c.id === selected.cid)?.name} #{selected.pos + 1}</strong><button type="button" style={btn} onClick={cancel}>{t("fm.board.cancel_move")}</button></>}
    </div>
    {/* Fixed height keeps cells stationary between the two clicks of a native double-click. */}
    <div aria-label={t("fm.board.company_preview")} style={{ ...card, height: 156, boxSizing: "border-box", overflowY: "auto", background: "#eff6ff", borderColor: "#bfdbfe" }}>
      {inspected ? <>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <strong>{names.get(inspected.sid) || inspected.sid}</strong>
          <span>{t("fm.board.meeting_count", { count: inspectedMeetings.length })}</span>
          <button type="button" style={btn} disabled={actionBlocked} onClick={() => armMove(inspected.cid, inspected.pos)}>{t("fm.board.start_move")}</button>
          <button type="button" style={{ ...btn, color: "#b91c1c", borderColor: "#fca5a5" }} disabled={actionBlocked} onClick={() => requestEdit("remove", inspected.cid, inspected.pos)}>{t("fm.board.remove_meeting")}</button>
          <button type="button" style={btn} disabled={busy || !!pending} onClick={() => { setSelected(null); setInspected(null); }}>{t("fm.board.close_preview")}</button>
        </div>
        <p style={{ margin: "8px 0", fontSize: 13 }}><strong>{t("fm.board.selected_meeting")}:</strong> {fmChains.find(c => c.id === inspected.cid)?.name || inspected.cid} · #{inspected.pos + 1}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {inspectedMeetings.map(x => <span key={`${x.cid}:${x.pos}`} style={{ border: "1px solid #93c5fd", borderRadius: 6, padding: "4px 8px", background: "white" }}>{x.chain} · #{x.pos + 1}</span>)}
        </div>
        <p style={{ fontSize: 12, color: "#475569", marginBottom: 0 }}>{t(selected ? "fm.board.choose_destination" : "fm.board.preview_hint")}</p>
      </> : <p>{t("fm.board.preview_empty")}</p>}
    </div>
    <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 16 }}>
      <table style={{ borderCollapse: "collapse", minWidth: "100%", fontSize: 12 }}>
        <thead><tr><th style={{ padding: 10, position: "sticky", left: 0, background: "#f8fafc", zIndex: 2 }}>#</th>{chains.map(c => <th key={c.id} style={{ minWidth: 140, padding: 8, background: "#f8fafc" }}>{c.name}</th>)}</tr></thead>
        <tbody>{Array.from({ length: last + 5 }, (_, pos) => <tr key={pos} style={{ background: pos % 2 ? "#f8fafc" : "white" }}>
          <th style={{ padding: 6, position: "sticky", left: 0, background: pos % 2 ? "#f8fafc" : "white", zIndex: 1, color: pos < 25 ? "#059669" : pos < 35 ? "#d97706" : "#dc2626" }}>{pos + 1}</th>
          {chains.map(c => {
            const sid = plan?.cq?.[c.id]?.[pos] || null;
            const name = names.get(sid) || sid || t("fm.board.empty_cell");
            const active = selected?.cid === c.id && selected?.pos === pos;
            const highlighted = !!sid && inspected?.sid === sid;
            const override = sid && plan?.overrides?.[sid]?.[c.id];
            return <td key={c.id} style={{ padding: 0, borderRight: "1px solid #e2e8f0" }}><button type="button" data-cell={`${c.id}:${pos}`} data-move-source={active} aria-pressed={highlighted} aria-label={`${c.name} #${pos + 1}: ${sid ? name : t("fm.board.add_meeting")}`} title={`${sid ? name : t("fm.board.add_meeting")}${override ? " — " + t("fm.board.override_recorded") : ""}`} disabled={viewBlocked || (!sid && (blocked || (selected && moveBlocked)))} onClick={event => clickCell(c.id, pos, event)} onDoubleClick={() => armMove(c.id, pos)} style={{ width: "100%", height: 32, border: active ? "2px solid #d97706" : highlighted ? "2px solid #2563eb" : "1px solid transparent", textAlign: "left", padding: "3px 7px", background: active ? "#fef3c7" : highlighted ? "#dbeafe" : override ? "#fee2e2" : "transparent", color: sid ? "#334155" : "#64748b", cursor: "pointer", opacity: 1 }}>
              <span style={{ display: "block", maxWidth: 165, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sid && <span style={{ color: fmSuppliers.find(s => s.id === sid)?.pkg === "Premium" ? "#d97706" : "#3b82f6" }}>● </span>}{override ? "⚠ " : ""}{sid ? name : "+"}</span>
            </button></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, marginBottom: 14 }}>
      <span style={{ color: "#059669" }}>{t("fm.corrections.legend_green")}</span><span style={{ color: "#d97706" }}>{t("fm.corrections.legend_orange")}</span><span style={{ color: "#dc2626" }}>{t("fm.corrections.legend_red")}</span><span>{t("fm.corrections.legend_pkg")}</span>
    </div>
    <div ref={historyRef} style={card} aria-label={t("fm.board.history")}>
      <h3>{t("fm.board.history")}</h3><p>{t("fm.board.history_hint")}</p>
      {!history.length && <p>{t("fm.board.history_empty")}</p>}
      {history.slice(0, historyLimit).map(entry => <div key={entry.id} style={{ padding: "10px 0", borderTop: "1px solid #e2e8f0" }}><HistorySummary entry={entry} t={t}/></div>)}
      {history.length > historyLimit && <button type="button" style={btn} onClick={() => setHistoryLimit(n => n + 20)}>{t("fm.board.more")}</button>}
    </div>
  </section>;
}
