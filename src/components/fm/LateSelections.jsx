import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { loadLateSelections, saveLateSelection, setLateAccess } from "../../lib/fm-late-selections";

const box = { marginTop: 18, padding: 16, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10 };
const button = { padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 7, background: "white", cursor: "pointer", fontSize: 12 };
const line = { padding: "10px 0", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };

// Confirmed values only. One write at a time; reads started before a write cannot replace it.
function useLateSelections(retailerId, valid = true) {
  const [data, setData] = useState({ access: [], rows: [], ready: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const serial = useRef(0);
  const writing = useRef(false);
  const mounted = useRef(false);
  const reload = useCallback(async () => {
    if (!valid || writing.current) return;
    const rev = ++serial.current;
    setLoading(true);
    setMessage("");
    setError(false);
    try {
      const fresh = await loadLateSelections(retailerId);
      if (mounted.current && rev === serial.current) setData({ ...fresh, ready: true });
    } catch {
      if (mounted.current && rev === serial.current) { setData(d => ({ ...d, ready: false })); setError(true); setMessage("load_error"); }
    } finally {
      if (mounted.current && rev === serial.current) setLoading(false);
    }
  }, [retailerId, valid]);
  useEffect(() => {
    mounted.current = true;
    if (valid) reload(); else setLoading(false);
    return () => { mounted.current = false; ++serial.current; };
  }, [reload, valid]);
  const write = async (operation, update) => {
    if (writing.current || loading || !data.ready || error) return;
    writing.current = true; ++serial.current; setBusy(true); setMessage(""); setError(false);
    try {
      const result = await operation();
      if (mounted.current) { setData(prev => update(prev, result)); setMessage("saved"); }
    } catch {
      if (mounted.current) { setError(true); setMessage("save_error"); }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { data, loading, busy, message, error, reload, write, blocked: loading || busy || error || !data.ready };
}

function Status({ state, t }) {
  return <div style={{ margin: "10px 0" }}>
    <button type="button" style={button} disabled={state.loading || state.busy} onClick={state.reload}>{t("fm.late.refresh")}</button>
    {state.loading && <span role="status" style={{ marginLeft: 8 }}>{t("fm.late.loading")}</span>}
    {state.message && <div role={state.error ? "alert" : "status"} style={{ marginTop: 8, color: state.error ? "#b91c1c" : "#047857" }}>{t("fm.late." + state.message)}</div>}
  </div>;
}

export function BuyerLateSelections({ retailerId, suppliers = [], style = null }) {
  const { t } = useTranslation("legacy");
  const state = useLateSelections(retailerId, !!retailerId);
  const [search, setSearch] = useState("");
  if (!retailerId) return null;
  const enabled = state.data.access.some(a => a.retailer_id === retailerId && a.enabled);
  const ownRows = state.data.rows.filter(r => r.retailer_id === retailerId);
  if (state.data.ready && !enabled && !ownRows.length) return null;
  const choices = new Map(ownRows.map(r => [r.supplier_legacy_id, r]));
  const visible = suppliers.filter(s => (enabled || choices.has(s.id)) && s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section style={style ? { ...box, ...style } : box} aria-label={t("fm.late.buyer_title")}>
    <h3 style={{ marginTop: 0 }}>{t("fm.late.buyer_title")}</h3>
    <p>{t("fm.late.description")}</p>
    <Status state={state} t={t}/>
    {state.data.ready && !enabled && <p>{t("fm.late.closed")}</p>}
    {state.data.ready && <input aria-label={t("fm.late.search")} placeholder={t("fm.late.search")} value={search} onChange={e => setSearch(e.target.value)} style={{ padding: 8, width: "100%", boxSizing: "border-box" }}/>}
    {visible.map(s => {
      const current = choices.get(s.id)?.zone;
      const choose = zone => state.write(
        () => saveLateSelection(retailerId, s.id, current === zone ? null : zone),
        (prev, saved) => ({ ...prev, rows: [...prev.rows.filter(r => !(r.retailer_id === retailerId && r.supplier_legacy_id === s.id)), ...(saved ? [saved] : [])] }),
      );
      return <div key={s.id} style={line} data-supplier={s.id}>
        <div style={{ flex: 1, minWidth: 180 }}><strong>{s.name}</strong><div style={{ fontSize: 12, color: "#64748b" }}>{s.country} · {s.products}</div></div>
        {["want", "chance", "remove"].map(zone => <button type="button" key={zone} disabled={!enabled || state.blocked} aria-pressed={current === zone} onClick={() => choose(zone)} style={{ ...button, background: current === zone ? (zone === "remove" ? "#fee2e2" : "#d1fae5") : "white", fontWeight: current === zone ? 700 : 400 }}>{t("fm.buyer.btn_" + zone)}</button>)}
      </div>;
    })}
    {state.data.ready && !visible.length && <p>{t("fm.late.no_results")}</p>}
  </section>;
}

export function AdminLateSelections({ retailers = [], suppliers = [], canOpen = false }) {
  const { t } = useTranslation("legacy");
  const state = useLateSelections(undefined);
  const [filter, setFilter] = useState("");
  const chains = retailers.filter(r => r.fm26Active && r.active !== false && r.fm26ChainId);
  const names = new Map(suppliers.map(s => [s.id, s.name]));
  const rows = state.data.rows.filter(r => !filter || String(r.retailer_id) === filter);
  const retailerNames = new Map(retailers.map(r => [r.id, r.name]));
  return <section style={box} aria-label={t("fm.late.admin_title")}>
    <h3 style={{ marginTop: 0 }}>{t("fm.late.admin_title")}</h3>
    <p>{t("fm.late.description")}</p>
    <Status state={state} t={t}/>
    {!canOpen && <p>{t("fm.late.phase_required")}</p>}
    {state.data.ready && <>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {chains.map(r => {
          const enabled = state.data.access.some(a => a.retailer_id === r.id && a.enabled);
          return <label key={r.id} style={line}>
            <input type="checkbox" checked={enabled} disabled={state.blocked || (!canOpen && !enabled)} onChange={() => state.write(
              () => setLateAccess(r.id, !enabled),
              (prev, saved) => ({ ...prev, access: [...prev.access.filter(a => a.retailer_id !== r.id), saved] }),
            )}/>
            {r.name} — {t(enabled ? "fm.late.access_open" : "fm.late.access_closed")}
          </label>;
        })}
      </div>
      <h4>{t("fm.late.received")}</h4>
      <select aria-label={t("fm.late.filter")} value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: 8 }}>
        <option value="">{t("fm.late.all_chains")}</option>
        {retailers.filter(r => state.data.rows.some(x => x.retailer_id === r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {!rows.length ? <p>{t("fm.late.empty")}</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse", textAlign: "left" }}>
        <thead><tr>{["chain", "supplier", "choice", "date"].map(k => <th key={k} style={{ padding: 8 }}>{t("fm.late." + k)}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} style={{ borderTop: "1px solid #e2e8f0" }}>
          <td style={{ padding: 8 }}>{retailerNames.get(r.retailer_id) || r.retailer_id}</td>
          <td style={{ padding: 8 }}>{names.get(r.supplier_legacy_id) || r.supplier_legacy_id}</td>
          <td style={{ padding: 8 }}>{["want", "chance", "remove"].includes(r.zone) ? t("fm.buyer.btn_" + r.zone) : r.zone}</td>
          <td style={{ padding: 8 }}>{r.responded_at ? new Date(r.responded_at).toLocaleString() : "—"}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}
