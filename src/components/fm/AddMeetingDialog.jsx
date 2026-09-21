import { useEffect, useRef, useState } from "react";
import { describeAddition } from "../../lib/fm-corrections";

const button = { padding: "9px 13px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white", font: "inherit", cursor: "pointer" };

export default function AddMeetingDialog({ target, plan, suppliers, chains, responses, initialSupplier, t, cancel, choose }) {
  const [search, setSearch] = useState(""), [sid, setSid] = useState(initialSupplier || "");
  const searchRef = useRef(null), dialogRef = useRef(null);
  useEffect(() => { const previous = globalThis.document?.activeElement; searchRef.current?.focus(); return () => previous?.focus?.(); }, []);
  const candidates = suppliers.map(s => ({ supplier: s, addition: describeAddition(plan, target, s, chains, responses) }));
  const filtered = candidates.filter(x => x.supplier.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const picked = candidates.find(x => x.supplier.id === sid)?.addition;
  const eligibleCount = candidates.filter(x => !x.addition.issues.length).length;
  const onKey = e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    if (e.key === "Tab") {
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };
  return <div style={{ position: "fixed", inset: 0, zIndex: 2200, background: "#0f172a99", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="fm-add-title" onKeyDown={onKey} style={{ background: "white", borderRadius: 12, padding: 20, width: "min(680px, 100%)", maxHeight: "85vh", overflowY: "auto" }}>
      <h3 id="fm-add-title">{t("fm.board.add_meeting")}</h3>
      <p><strong>{chains.find(c => c.id === target.cid)?.name} · #{target.pos + 1}</strong></p>
      <p>{t("fm.board.add_no_move")}</p>
      <label>{t("fm.board.add_search")}<input ref={searchRef} type="search" value={search} onChange={e => { setSearch(e.target.value); setSid(""); }} style={{ ...button, boxSizing: "border-box", display: "block", width: "100%", margin: "8px 0" }}/></label>
      <label>{t("fm.board.add_company")}
        <select aria-label={t("fm.board.add_company")} size={8} value={sid} onChange={e => setSid(e.target.value)} style={{ ...button, display: "block", width: "100%", margin: "8px 0", maxWidth: "100%" }}>
          <option value="">{t("fm.board.add_choose")}</option>
          {filtered.map(({ supplier, addition: a }) => <option key={supplier.id} value={supplier.id}>{supplier.name} — {a.beforeCount}/{a.limit ?? "?"}{a.issues.length ? ` — ${t("fm.board.add_unavailable")}` : ""}</option>)}
        </select>
      </label>
      {!filtered.length && <p role="status">{t("fm.board.add_search_empty")}</p>}
      {!eligibleCount && <p role="status">{t("fm.board.add_none_eligible")}</p>}
      {picked && <>
        <p>{t("fm.board.add_count", { before: picked.beforeCount, after: picked.afterCount, limit: picked.limit ?? "?" })}</p>
        {!!picked.issues.length && <div role="status" style={{ color: "#9a3412" }}>{picked.issues.map(code => <p key={code}>{t(`fm.board.errors.${code}`)}</p>)}</div>}
        {!!picked.nearby.length && <p>{picked.nearby.map(m => `${m.chain} #${m.pos + 1}`).join(", ")}</p>}
      </>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button type="button" style={button} onClick={cancel}>{t("fm.board.cancel")}</button>
        <button type="button" style={{ ...button, background: "#047857", color: "white" }} disabled={!picked || !!picked.issues.length} onClick={() => { if (picked && !picked.issues.length) choose(picked); }}>{t("fm.board.add_review")}</button>
      </div>
    </div>
  </div>;
}
