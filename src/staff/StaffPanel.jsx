// [feat/fm-queue] /obsluga — panel operatora kolejki (tablet 1024×768, dotyk, PL/EN).
// Wszystkie zmiany stanu idą przez RPC fm_queue_* (SECURITY DEFINER, version,
// obowiązkowy klucz idempotencji). Panel NIE pisze do tabel bezpośrednio.
// Numer publiczny (TERAZ) nigdy nie cofa się — „Cofnij” dotyczy tylko statusu spotkania.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { fmQueueRpc, listFmQueueMeetings, newIdemKey, subscribeFmQueue } from "../lib/fm-queue";
import StaffLoginPage, { LangToggle } from "./StaffLoginPage";
import { C, MODE_LABEL, fmtElapsed, humanFmError, statusLabel } from "./staffUi";
import { useStaffLang } from "./staffI18n";

const UNDO_WINDOW_MS = 30_000;
const POLL_MS = 10_000;

export default function StaffPanel() {
  const { user, role, profile, loading, signOut } = useAuth();
  const { lang, setLang, t } = useStaffLang();
  if (loading) return <Center>{t.loading}</Center>;
  if (!user) return <StaffLoginPage />;
  if (role !== "staff" && role !== "admin") {
    return (
      <Center>
        <div style={{ fontSize: 16, color: C.ink, marginBottom: 12 }}>{t.not_staff}</div>
        <BigBtn onClick={() => signOut?.()} tone="ghost">{t.logout}</BigBtn>
      </Center>
    );
  }
  return <Operator user={user} profile={profile} signOut={signOut} isAdmin={role === "admin"} lang={lang} setLang={setLang} t={t} />;
}

function Operator({ user, profile, signOut, isAdmin, lang, setLang, t }) {
  const [stations, setStations] = useState([]);
  const [stationsErr, setStationsErr] = useState("");
  const [selectedId, setSelectedId] = useState(() => { try { return localStorage.getItem("fm_station_id") || ""; } catch { return ""; } });
  const [state, setState] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [lastAction, setLastAction] = useState(null); // { ts, label }
  const [excModal, setExcModal] = useState(null);     // { name, step: "form" | "confirm" }
  const [, setTick] = useState(0);
  const stateRef = useRef(null);
  stateRef.current = state;

  const showToast = useCallback((text, tone = "error") => {
    setToast({ text, tone, id: Date.now() });
    setTimeout(() => setToast(x => (x && Date.now() - x.id >= 3800 ? null : x)), 4000);
  }, []);

  const loadStations = useCallback(async () => {
    try { setStations((await fmQueueRpc.myStations()) || []); setStationsErr(""); }
    catch (e) { setStationsErr(humanFmError(e, lang)); }
  }, [lang]);

  const refreshState = useCallback(async () => {
    if (!selectedId) return;
    try { const st = await fmQueueRpc.stationState(selectedId); if (st) setState(st); }
    catch (e) { if (e?.fmCode === "FM_AUTH_REQUIRED" || e?.fmCode === "FM_FORBIDDEN") showToast(humanFmError(e, lang)); }
  }, [selectedId, showToast, lang]);

  const refreshMeetings = useCallback(async () => {
    const gid = stateRef.current?.group_id;
    if (!gid) return;
    try { setMeetings(await listFmQueueMeetings(gid)); } catch { /* lista opcjonalna */ }
  }, []);

  useEffect(() => { loadStations(); }, [loadStations]);
  useEffect(() => {
    if (!selectedId) { setState(null); return; }
    const s = stations.find(x => x.station_id === selectedId);
    if (s?.state) setState(s.state);
    refreshState();
  }, [selectedId, stations, refreshState]);
  useEffect(() => { refreshMeetings(); }, [state?.group_id, state?.version, refreshMeetings]);
  useEffect(() => {
    const unsub = subscribeFmQueue(() => { refreshState(); });
    const i = setInterval(() => { refreshState(); }, POLL_MS);
    return () => { unsub(); clearInterval(i); };
  }, [refreshState]);
  useEffect(() => {
    const i = setInterval(() => setTick(x => x + 1), 1000);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { clearInterval(i); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  function pick(id) {
    setSelectedId(id);
    try { if (id) localStorage.setItem("fm_station_id", id); else localStorage.removeItem("fm_station_id"); } catch { /* noop */ }
  }

  // Jedna operacja = jeden klucz idempotencji; przy błędzie sieci ponawiamy z TYM SAMYM kluczem.
  const act = useCallback(async (label, makeCall) => {
    if (busy || !online) return;
    const idem = newIdemKey();
    setBusy(true);
    let attempt = 0;
    try {
      for (;;) {
        try {
          const st = await makeCall(idem, stateRef.current?.version ?? 0);
          if (st && typeof st === "object" && st.station_id) setState(st); else await refreshState();
          setLastAction({ ts: Date.now(), label });
          return st;
        } catch (e) {
          const network = e?.message && /fetch|network|Failed to fetch|Load failed/i.test(e.message) && !e.fmCode;
          if (network && attempt < 2) { attempt++; await new Promise(r => setTimeout(r, 1500)); continue; }
          if (e?.fmCode === "FM_CONFLICT") await refreshState();
          showToast(humanFmError(e, lang));
          return null;
        }
      }
    } finally {
      setBusy(false);
      refreshMeetings();
    }
  }, [busy, online, refreshState, refreshMeetings, showToast, lang]);

  const selected = stations.find(x => x.station_id === selectedId);
  const undoLeft = lastAction ? Math.max(0, Math.ceil((lastAction.ts + UNDO_WINDOW_MS - Date.now()) / 1000)) : 0;
  const canUndo = undoLeft > 0 && (lastAction?.label === "start" || lastAction?.label === "no_show" || (lastAction?.label === "finish" && !state?.current));

  const noShows = useMemo(() => meetings.filter(m => m.status === "no_show"), [meetings]);
  const upcoming = useMemo(() => {
    const last = state?.last_called_nr ?? 0;
    return meetings.filter(m => m.status === "planned" && m.nr > last).slice(0, 8);
  }, [meetings, state?.last_called_nr]);
  const readyReturnee = (state?.waiting_returnees || []).find(r => r.ready);
  const nextExceptionNr = Math.max(state?.last_called_nr || 0, ...meetings.map(m => m.nr || 0)) + 1;

  async function addException(name) {
    const r = await act("add_exception", async (idem) => { await fmQueueRpc.addException(state.group_id, name, idem); return null; });
    setExcModal(null);
    if (r !== null) showToast(`${t.exc_title}: ${name}`, "ok");
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink, display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: C.white, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontWeight: 800, letterSpacing: "0.04em", color: C.teal }}>{t.brand} · {t.staff_title.toUpperCase()}</div>
        <div style={{ color: C.slate, fontSize: 13 }}>{isAdmin ? "admin" : (profile?.name || user.email?.split("@")[0]?.toUpperCase())}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <LangToggle lang={lang} setLang={setLang} />
          {selected && <SmallBtn onClick={() => pick("")}>{t.change_station}</SmallBtn>}
          <SmallBtn onClick={() => { pick(""); signOut?.(); }}>{t.logout}</SmallBtn>
        </div>
      </header>

      {!online && <div role="alert" style={{ background: C.red, color: "white", textAlign: "center", padding: "10px 12px", fontWeight: 700 }}>{t.offline}</div>}

      {!selected && (
        <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <h1 style={{ fontSize: 22, margin: "4px 0 14px" }}>{t.pick_station}</h1>
          {stationsErr && <Note tone="error">{stationsErr}</Note>}
          {!stationsErr && stations.length === 0 && <Note>{t.no_stations}</Note>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
            {stations.map(s => {
              const ml = MODE_LABEL[s.state?.mode] || MODE_LABEL.closed;
              return (
                <button key={s.station_id} onClick={() => pick(s.station_id)} style={{ textAlign: "left", background: C.white, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: "16px", cursor: "pointer", fontFamily: "inherit", minHeight: 110 }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{s.retailer_name}{s.group_label ? ` · ${s.group_label}` : ""}</div>
                  <div style={{ fontSize: 13, color: C.slate, marginTop: 2 }}>
                    {t.station} {s.station_label || s.station_idx}{s.stations_in_group > 1 ? ` ${t.of} ${s.stations_in_group}` : ""}{s.gate ? ` · ${t.gate} ${s.gate}` : ""}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                    <Pill color={ml.color} bg={ml.bg}>{ml[lang]}</Pill>
                    {s.state?.current?.nr && <span style={{ fontSize: 13, color: C.slate }}>{t.now} <b>{s.state.current.nr}</b></span>}
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      )}

      {selected && state && (
        <main style={{ padding: "14px 16px 24px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box", flex: 1 }}>
          <StationHeader s={selected} state={state} t={t} lang={lang} />
          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 14, marginTop: 12 }}>
            <NowCard state={state} t={t} />
            <NextCard state={state} upcoming={upcoming} t={t} />
          </div>

          <ActionBar
            state={state} busy={busy || !online} canUndo={canUndo} undoLeft={undoLeft} readyReturnee={readyReturnee} t={t}
            on={{
              open: () => act("open_station", (idem, v) => fmQueueRpc.openStation(selectedId, v, idem)),
              callNext: () => act("call_next", (idem, v) => fmQueueRpc.callNext(selectedId, v, idem)),
              start: () => act("start", (idem, v) => fmQueueRpc.start(selectedId, v, idem)),
              finishNext: () => act("finish", (idem, v) => fmQueueRpc.finishAndCallNext(selectedId, v, true, idem)),
              finish: () => act("finish", (idem, v) => fmQueueRpc.finishAndCallNext(selectedId, v, false, idem)),
              noShow: () => act("no_show", (idem, v) => fmQueueRpc.noShow(selectedId, v, idem)),
              undo: () => act("undo", (idem, v) => fmQueueRpc.undo(selectedId, v, idem)),
              serveReturnee: () => readyReturnee && act("serve_returnee", (idem, v) => fmQueueRpc.serveReturnee(selectedId, readyReturnee.id, v, idem)),
              finishReturnee: () => act("finish_returnee", (idem, v) => fmQueueRpc.finishReturnee(selectedId, v, idem)),
              mode: (m) => act("set_mode", (idem, v) => fmQueueRpc.setMode(selectedId, m, v, idem)),
              exception: () => setExcModal({ name: "", step: "form" }),
            }}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
            <ListCard title={t.returnees_title} empty={t.returnees_empty}>
              {(state.waiting_returnees || []).map(r => (
                <Row key={r.id} nr={r.nr} name={r.name}
                  sub={r.ready ? t.ready_hint : `${t.waits_for} ${r.return_after_nr}`}
                  right={<SmallBtn tone="ghost" disabled={busy} onClick={() => act("skip", async (idem) => { await fmQueueRpc.skip(r.id, idem); return null; })}>{t.resigns}</SmallBtn>} />
              ))}
            </ListCard>
            <ListCard title={t.noshows_title} empty={t.noshows_empty}>
              {noShows.map(m => (
                <Row key={m.id} nr={m.nr} name={m.companies?.name || m.exception_name || "—"} sub={statusLabel(lang, m.status)}
                  right={<SmallBtn tone="primary" disabled={busy} onClick={() => act("mark_returned", async (idem) => { await fmQueueRpc.markReturned(m.id, idem); return null; })}>{t.returned}</SmallBtn>} />
              ))}
            </ListCard>
          </div>
        </main>
      )}

      {excModal && (
        <Modal onClose={() => setExcModal(null)}>
          <div style={eyebrow}>{t.exc_title.toUpperCase()}</div>
          <p style={{ margin: "0 0 12px", color: C.slate, fontSize: 14, lineHeight: 1.5 }}>{t.exc_desc}</p>
          {excModal.step === "form" ? (
            <form onSubmit={e => { e.preventDefault(); if (excModal.name.trim()) setExcModal({ ...excModal, name: excModal.name.trim(), step: "confirm" }); }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>{t.exc_name}</label>
              <input autoFocus value={excModal.name} onChange={e => setExcModal({ ...excModal, name: e.target.value })} maxLength={120}
                style={{ width: "100%", boxSizing: "border-box", padding: "14px", borderRadius: 12, border: `1.5px solid ${C.line}`, fontSize: 18, fontFamily: "inherit" }} />
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{t.exc_next_nr}: <b>{nextExceptionNr}</b></div>
              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                <BigBtn tone="ghost" onClick={() => setExcModal(null)}>{t.exc_cancel}</BigBtn>
                <button type="submit" disabled={!excModal.name.trim()} style={bigPrimary(!excModal.name.trim())}>{t.exc_add} →</button>
              </div>
            </form>
          ) : (
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, margin: "8px 0 16px" }}>{t.exc_confirm(excModal.name, nextExceptionNr)}</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <BigBtn tone="ghost" onClick={() => setExcModal({ ...excModal, step: "form" })}>{t.exc_cancel}</BigBtn>
                <BigBtn tone="primary" disabled={busy} onClick={() => addException(excModal.name)}>{t.exc_add}</BigBtn>
              </div>
            </div>
          )}
        </Modal>
      )}

      {toast && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", background: toast.tone === "error" ? C.red : C.tealDark, color: "white", padding: "12px 18px", borderRadius: 12, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.25)", maxWidth: "90vw" }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function StationHeader({ s, state, t, lang }) {
  const ml = MODE_LABEL[state.mode] || MODE_LABEL.closed;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{s.retailer_name}{s.group_label ? ` · ${s.group_label}` : ""}</div>
        <div style={{ fontSize: 13, color: C.slate, marginTop: 3 }}>
          {t.station} {s.station_label || s.station_idx}{s.stations_in_group > 1 ? ` ${t.of} ${s.stations_in_group}` : ""}{s.gate ? ` · ${t.gate} ${s.gate}` : ""}
        </div>
      </div>
      <Pill color={ml.color} bg={ml.bg} big>{ml[lang]}</Pill>
      <div style={{ marginLeft: "auto", display: "flex", gap: 18, fontSize: 13, color: C.slate }}>
        <span>{t.last_called} <b style={{ color: C.ink, fontSize: 16 }}>{state.last_called_nr || "—"}</b></span>
        <span>{t.in_queue} <b style={{ color: C.ink, fontSize: 16 }}>{state.remaining ?? 0}</b></span>
      </div>
    </div>
  );
}

function NowCard({ state, t }) {
  const cur = state.current, ret = state.returnee;
  const active = cur && ["called", "in_progress"].includes(cur.status);
  return (
    <section style={card}>
      <div style={eyebrow}>{t.now}</div>
      {ret ? (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontSize: 84, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: C.blue }}>{ret.nr}</div>
            <Pill color={C.blue} bg={C.blueBg}>{t.returnee_pill}</Pill>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{ret.name}</div>
          <div style={{ color: C.slate, marginTop: 4 }}>{t.ongoing} {fmtElapsed(ret.started_at)}</div>
        </div>
      ) : active ? (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: cur.status === "in_progress" ? C.green : C.amber }}>{cur.nr}</div>
            <Pill color={cur.status === "in_progress" ? C.green : C.amber} bg={cur.status === "in_progress" ? C.greenBg : C.amberBg} big>
              {cur.status === "in_progress" ? t.in_progress : t.called_waiting}
            </Pill>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{cur.name}</div>
          <div style={{ color: C.slate, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
            {cur.status === "in_progress" ? `${t.ongoing} ${fmtElapsed(cur.started_at)}` : `${t.since_call} ${fmtElapsed(cur.called_at)}`}
          </div>
        </div>
      ) : (
        <div style={{ color: C.muted, fontSize: 18, padding: "24px 0" }}>
          {state.mode === "free_entry" ? t.free_entry_now : state.mode === "open" ? t.station_free : t.station_closed}
        </div>
      )}
    </section>
  );
}

function NextCard({ state, upcoming, t }) {
  const nx = state.next;
  return (
    <section style={card}>
      <div style={eyebrow}>{t.next}</div>
      {nx ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{nx.nr}</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{nx.name}</div>
        </div>
      ) : <div style={{ color: C.muted, fontSize: 16 }}>{t.queue_end}</div>}
      {upcoming.length > 1 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          {upcoming.slice(1, 6).map(m => (
            <div key={m.id} style={{ display: "flex", gap: 10, fontSize: 13, padding: "4px 0", color: C.slate }}>
              <b style={{ width: 28, textAlign: "right", color: C.ink, fontVariantNumeric: "tabular-nums" }}>{m.nr}</b>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.companies?.name || m.exception_name || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ActionBar({ state, busy, canUndo, undoLeft, readyReturnee, on, t }) {
  const cur = state.current;
  const active = cur && ["called", "in_progress"].includes(cur.status);
  const mode = state.mode;
  const btns = [];
  if (state.returnee) {
    btns.push(<BigBtn key="fr" tone="primary" disabled={busy} onClick={on.finishReturnee}>{t.btn_finish_returnee}</BigBtn>);
  } else if (mode === "closed") {
    btns.push(<BigBtn key="open" tone="primary" disabled={busy} onClick={on.open}>{t.btn_open}</BigBtn>);
  } else if (mode === "paused") {
    btns.push(<BigBtn key="resume" tone="primary" disabled={busy} onClick={on.open}>{t.btn_resume}</BigBtn>);
    btns.push(<BigBtn key="close" tone="ghost" disabled={busy} onClick={() => on.mode("closed")}>{t.btn_close}</BigBtn>);
  } else if (mode === "free_entry") {
    btns.push(<BigBtn key="back" tone="primary" disabled={busy} onClick={() => on.mode("open")}>{t.btn_back_queue}</BigBtn>);
    btns.push(<BigBtn key="close" tone="ghost" disabled={busy} onClick={() => on.mode("closed")}>{t.btn_close}</BigBtn>);
  } else if (active && cur.status === "called") {
    btns.push(<BigBtn key="start" tone="primary" disabled={busy} onClick={on.start}>{t.btn_start}</BigBtn>);
    btns.push(<BigBtn key="ns" tone="danger" disabled={busy} onClick={on.noShow}>{t.btn_no_show}</BigBtn>);
  } else if (active && cur.status === "in_progress") {
    btns.push(<BigBtn key="fn" tone="primary" disabled={busy} onClick={on.finishNext}>{t.btn_finish_next}{state.next ? ` (${state.next.nr})` : ""}</BigBtn>);
    btns.push(<BigBtn key="f" tone="ghost" disabled={busy} onClick={on.finish}>{t.btn_finish}</BigBtn>);
    btns.push(<BigBtn key="ns" tone="danger" disabled={busy} onClick={on.noShow}>{t.btn_no_show}</BigBtn>);
  } else {
    btns.push(<BigBtn key="cn" tone="primary" disabled={busy || !state.next} onClick={on.callNext}>{t.btn_call_next}{state.next ? ` → ${state.next.nr}` : ""}</BigBtn>);
    if (readyReturnee) btns.push(<BigBtn key="sr" tone="info" disabled={busy} onClick={on.serveReturnee}>{t.btn_serve_returnee} ({readyReturnee.nr})</BigBtn>);
    btns.push(<BigBtn key="fe" tone="ghost" disabled={busy} onClick={() => on.mode("free_entry")}>{t.btn_free_entry}</BigBtn>);
    btns.push(<BigBtn key="pa" tone="ghost" disabled={busy} onClick={() => on.mode("paused")}>{t.btn_pause}</BigBtn>);
    btns.push(<BigBtn key="cl" tone="ghost" disabled={busy} onClick={() => on.mode("closed")}>{t.btn_close}</BigBtn>);
  }
  return (
    <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
      {btns}
      <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
        {canUndo && <BigBtn tone="warn" disabled={busy} onClick={on.undo} title={t.undo_hint}>{t.btn_undo} ({undoLeft} s)</BigBtn>}
        {mode !== "closed" && <BigBtn tone="ghost" disabled={busy} onClick={on.exception}>{t.btn_exception}</BigBtn>}
      </div>
    </div>
  );
}

function ListCard({ title, empty, children }) {
  const kids = Array.isArray(children) ? children.filter(Boolean) : (children ? [children] : []);
  return (
    <section style={card}>
      <div style={eyebrow}>{title}</div>
      {kids.length === 0 ? <div style={{ color: C.muted, fontSize: 14 }}>{empty}</div> : kids}
    </section>
  );
}

function Row({ nr, name, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 22, fontWeight: 900, width: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{nr}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        {sub && <div style={{ fontSize: 12, color: C.slate }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 18, padding: "22px 24px", width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {children}
      </div>
    </div>
  );
}

const card = { background: C.white, borderRadius: 16, border: `1px solid ${C.line}`, padding: "14px 18px" };
const eyebrow = { fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: C.muted, marginBottom: 8 };
const bigPrimary = (disabled) => ({ minHeight: 64, padding: "0 22px", borderRadius: 14, border: `1.5px solid ${C.teal}`, background: C.teal, color: "white", fontSize: 17, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit" });

function Pill({ children, color, bg, big }) {
  return <span style={{ display: "inline-block", padding: big ? "6px 12px" : "3px 9px", borderRadius: 999, background: bg, color, fontWeight: 800, fontSize: big ? 13 : 11, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{children}</span>;
}
function BigBtn({ children, onClick, disabled, tone = "primary", title }) {
  const tones = {
    primary: { bg: C.teal, fg: "white", bd: C.teal },
    danger: { bg: C.redBg, fg: "#991b1b", bd: "#fecaca" },
    warn: { bg: C.amberBg, fg: "#92400e", bd: "#fde68a" },
    info: { bg: C.blueBg, fg: "#1e40af", bd: "#bfdbfe" },
    ghost: { bg: C.white, fg: C.slate, bd: C.line },
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{ minHeight: 64, padding: "0 22px", borderRadius: 14, border: `1.5px solid ${tones.bd}`, background: tones.bg, color: tones.fg, fontSize: 17, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit", touchAction: "manipulation" }}>
      {children}
    </button>
  );
}
function SmallBtn({ children, onClick, disabled, tone = "ghost" }) {
  const primary = tone === "primary";
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ minHeight: 40, padding: "0 14px", borderRadius: 10, border: `1.5px solid ${primary ? C.teal : C.line}`, background: primary ? C.teal : C.white, color: primary ? "white" : C.slate, fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit" }}>
      {children}
    </button>
  );
}
function Note({ children, tone }) {
  const err = tone === "error";
  return <div style={{ padding: "12px 14px", borderRadius: 12, background: err ? C.redBg : C.white, border: `1px solid ${err ? "#fecaca" : C.line}`, color: err ? "#991b1b" : C.slate, marginBottom: 12 }}>{children}</div>;
}
function Center({ children }) {
  return <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.slate, fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center" }}>{children}</div>;
}
