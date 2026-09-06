// [feat/fm-queue] /obsluga — panel operatora kolejki (tablet 1024×768, dotyk).
// Wszystkie zmiany stanu idą przez RPC fm_queue_* (SECURITY DEFINER, version,
// idempotency key). Panel NIE pisze do tabel bezpośrednio.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { fmQueueRpc, listFmQueueMeetings, newIdemKey, subscribeFmQueue } from "../lib/fm-queue";
import StaffLoginPage from "./StaffLoginPage";
import { C, MODE_LABEL, STATUS_LABEL, fmtElapsed, humanFmError } from "./staffUi";

const UNDO_WINDOW_MS = 30_000;
const POLL_MS = 10_000;

export default function StaffPanel() {
  const { user, role, profile, loading, signOut } = useAuth();
  if (loading) return <Center>Ładowanie…</Center>;
  if (!user) return <StaffLoginPage />;
  if (role !== "staff" && role !== "admin") {
    return (
      <Center>
        <div style={{ fontSize: 16, color: C.ink, marginBottom: 12 }}>To konto nie jest kontem obsługi.</div>
        <BigBtn onClick={() => signOut?.()} tone="ghost">Wyloguj</BigBtn>
      </Center>
    );
  }
  return <Operator user={user} profile={profile} signOut={signOut} isAdmin={role === "admin"} />;
}

function Operator({ user, profile, signOut, isAdmin }) {
  const [stations, setStations] = useState([]);
  const [stationsErr, setStationsErr] = useState("");
  const [selectedId, setSelectedId] = useState(() => { try { return localStorage.getItem("fm_station_id") || ""; } catch { return ""; } });
  const [state, setState] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [lastAction, setLastAction] = useState(null); // { ts, label }
  const [, setTick] = useState(0);
  const stateRef = useRef(null);
  stateRef.current = state;

  const showToast = useCallback((text, tone = "error") => {
    setToast({ text, tone, id: Date.now() });
    setTimeout(() => setToast(t => (t && Date.now() - t.id >= 3800 ? null : t)), 4000);
  }, []);

  const loadStations = useCallback(async () => {
    try {
      const rows = await fmQueueRpc.myStations();
      setStations(rows || []);
      setStationsErr("");
    } catch (e) {
      setStationsErr(humanFmError(e));
    }
  }, []);

  const refreshState = useCallback(async () => {
    if (!selectedId) return;
    try {
      const st = await fmQueueRpc.stationState(selectedId);
      if (st) setState(st);
    } catch (e) {
      if (e?.fmCode === "FM_AUTH_REQUIRED") showToast(humanFmError(e));
    }
  }, [selectedId, showToast]);

  const refreshMeetings = useCallback(async () => {
    const gid = stateRef.current?.group_id;
    if (!gid) return;
    try { setMeetings(await listFmQueueMeetings(gid)); } catch { /* RLS/brak — lista opcjonalna */ }
  }, []);

  useEffect(() => { loadStations(); }, [loadStations]);
  useEffect(() => {
    if (!selectedId) { setState(null); return; }
    const s = stations.find(x => x.station_id === selectedId);
    if (s?.state) setState(s.state);
    refreshState();
  }, [selectedId, stations, refreshState]);
  useEffect(() => { refreshMeetings(); }, [state?.group_id, state?.version, refreshMeetings]);

  // Realtime + polling fallback (Wi-Fi obiektu bywa kapryśne)
  useEffect(() => {
    const unsub = subscribeFmQueue(() => { refreshState(); });
    const t = setInterval(() => { refreshState(); }, POLL_MS);
    return () => { unsub(); clearInterval(t); };
  }, [refreshState]);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
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
          if (st && typeof st === "object" && st.station_id) setState(st);
          else await refreshState();
          setLastAction({ ts: Date.now(), label });
          return;
        } catch (e) {
          const network = e?.message && /fetch|network|Failed to fetch|Load failed/i.test(e.message) && !e.fmCode;
          if (network && attempt < 2) { attempt++; await new Promise(r => setTimeout(r, 1500)); continue; }
          if (e?.fmCode === "FM_CONFLICT") { await refreshState(); }
          showToast(humanFmError(e));
          return;
        }
      }
    } finally {
      setBusy(false);
      refreshMeetings();
    }
  }, [busy, online, refreshState, refreshMeetings, showToast]);

  const selected = stations.find(x => x.station_id === selectedId);
  const undoLeft = lastAction ? Math.max(0, Math.ceil((lastAction.ts + UNDO_WINDOW_MS - Date.now()) / 1000)) : 0;
  const canUndo = undoLeft > 0 && ["call_next", "start", "finish", "no_show"].includes(lastAction?.label);

  const noShows = useMemo(() => meetings.filter(m => m.status === "no_show"), [meetings]);
  const upcoming = useMemo(() => {
    const last = state?.last_called_nr ?? 0;
    return meetings.filter(m => m.status === "planned" && m.nr > last).slice(0, 8);
  }, [meetings, state?.last_called_nr]);
  const readyReturnee = (state?.waiting_returnees || []).find(r => r.ready);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink, display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: C.white, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontWeight: 800, letterSpacing: "0.04em", color: C.teal }}>FRESH MARKET 2026 · OBSŁUGA</div>
        <div style={{ color: C.slate, fontSize: 13 }}>{isAdmin ? "admin" : (profile?.name || user.email?.split("@")[0]?.toUpperCase())}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {selected && <SmallBtn onClick={() => pick("")}>Zmień stanowisko</SmallBtn>}
          <SmallBtn onClick={() => { pick(""); signOut?.(); }}>Wyloguj</SmallBtn>
        </div>
      </header>

      {!online && (
        <div role="alert" style={{ background: C.red, color: "white", textAlign: "center", padding: "10px 12px", fontWeight: 700 }}>
          Brak połączenia z siecią — przyciski zablokowane. Ostatni znany stan może być nieaktualny.
        </div>
      )}

      {!selected && (
        <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <h1 style={{ fontSize: 22, margin: "4px 0 14px" }}>Wybierz stanowisko</h1>
          {stationsErr && <Note tone="error">{stationsErr}</Note>}
          {!stationsErr && stations.length === 0 && <Note>Brak przypisanych stanowisk. Poproś organizatora o przypisanie do sieci.</Note>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
            {stations.map(s => {
              const ml = MODE_LABEL[s.state?.mode] || MODE_LABEL.closed;
              return (
                <button key={s.station_id} onClick={() => pick(s.station_id)} style={{ textAlign: "left", background: C.white, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: "16px", cursor: "pointer", fontFamily: "inherit", minHeight: 110 }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{s.retailer_name}{s.group_label ? ` · ${s.group_label}` : ""}</div>
                  <div style={{ fontSize: 13, color: C.slate, marginTop: 2 }}>
                    Stanowisko {s.station_label || s.station_idx}{s.stations_in_group > 1 ? ` z ${s.stations_in_group}` : ""}{s.gate ? ` · GATE ${s.gate}` : ""}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                    <Pill color={ml.color} bg={ml.bg}>{ml.pl}</Pill>
                    {s.state?.current?.nr && <span style={{ fontSize: 13, color: C.slate }}>TERAZ <b>{s.state.current.nr}</b></span>}
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      )}

      {selected && state && (
        <main style={{ padding: "14px 16px 24px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box", flex: 1 }}>
          <StationHeader s={selected} state={state} />
          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 14, marginTop: 12 }}>
            <NowCard state={state} />
            <NextCard state={state} upcoming={upcoming} />
          </div>

          <ActionBar
            state={state} busy={busy || !online} canUndo={canUndo} undoLeft={undoLeft} readyReturnee={readyReturnee}
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
              exception: () => {
                const name = window.prompt("Spotkanie wyjątkowe — nazwa firmy (dostanie numer na końcu kolejki):");
                if (name && name.trim()) act("add_exception", async (idem) => { await fmQueueRpc.addException(state.group_id, name.trim(), idem); return null; });
              },
            }}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
            <ListCard title="Powracający (obsługa poza tablicą)" empty="Nikt nie czeka.">
              {(state.waiting_returnees || []).map(r => (
                <Row key={r.id} nr={r.nr} name={r.name}
                  sub={r.ready ? "gotowy — stanowisko wolne → „Obsłuż powracającego”" : `czeka na zakończenie spotkania nr ${r.return_after_nr}`}
                  right={<SmallBtn tone="ghost" disabled={busy} onClick={() => act("skip", async (idem) => { await fmQueueRpc.skip(r.id, idem); return null; })}>Rezygnuje</SmallBtn>} />
              ))}
            </ListCard>
            <ListCard title="Nieobecni — zgłosili się ponownie?" empty="Brak nieobecnych.">
              {noShows.map(m => (
                <Row key={m.id} nr={m.nr} name={m.companies?.name || m.exception_name || "—"} sub={STATUS_LABEL[m.status]}
                  right={<SmallBtn tone="primary" disabled={busy} onClick={() => act("mark_returned", async (idem) => { await fmQueueRpc.markReturned(m.id, idem); return null; })}>Wrócił</SmallBtn>} />
              ))}
            </ListCard>
          </div>
        </main>
      )}

      {toast && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", background: toast.tone === "error" ? C.red : C.tealDark, color: "white", padding: "12px 18px", borderRadius: 12, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.25)", maxWidth: "90vw" }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function StationHeader({ s, state }) {
  const ml = MODE_LABEL[state.mode] || MODE_LABEL.closed;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{s.retailer_name}{s.group_label ? ` · ${s.group_label}` : ""}</div>
        <div style={{ fontSize: 13, color: C.slate, marginTop: 3 }}>
          Stanowisko {s.station_label || s.station_idx}{s.stations_in_group > 1 ? ` z ${s.stations_in_group}` : ""}{s.gate ? ` · GATE ${s.gate}` : ""}
        </div>
      </div>
      <Pill color={ml.color} bg={ml.bg} big>{ml.pl}</Pill>
      <div style={{ marginLeft: "auto", display: "flex", gap: 18, fontSize: 13, color: C.slate }}>
        <span>ostatnio wywołany <b style={{ color: C.ink, fontSize: 16 }}>{state.last_called_nr || "—"}</b></span>
        <span>w kolejce <b style={{ color: C.ink, fontSize: 16 }}>{state.remaining ?? 0}</b></span>
      </div>
    </div>
  );
}

function NowCard({ state }) {
  const cur = state.current, ret = state.returnee;
  const active = cur && ["called", "in_progress"].includes(cur.status);
  return (
    <section style={card}>
      <div style={eyebrow}>TERAZ</div>
      {ret ? (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontSize: 84, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: C.blue }}>{ret.nr}</div>
            <Pill color={C.blue} bg={C.blueBg}>POWRACAJĄCY · POZA TABLICĄ</Pill>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{ret.name}</div>
          <div style={{ color: C.slate, marginTop: 4 }}>w trakcie · {fmtElapsed(ret.started_at)}</div>
        </div>
      ) : active ? (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: cur.status === "in_progress" ? C.green : C.amber }}>{cur.nr}</div>
            <Pill color={cur.status === "in_progress" ? C.green : C.amber} bg={cur.status === "in_progress" ? C.greenBg : C.amberBg} big>
              {cur.status === "in_progress" ? "W TRAKCIE" : "WYWOŁANY — CZEKAMY"}
            </Pill>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{cur.name}</div>
          <div style={{ color: C.slate, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
            {cur.status === "in_progress" ? `trwa ${fmtElapsed(cur.started_at)}` : `od wywołania ${fmtElapsed(cur.called_at)}`}
          </div>
        </div>
      ) : (
        <div style={{ color: C.muted, fontSize: 18, padding: "24px 0" }}>
          {state.mode === "free_entry" ? "Wolne wejście — bez numerków." : state.mode === "open" ? "Stanowisko wolne." : "Stanowisko zamknięte."}
        </div>
      )}
    </section>
  );
}

function NextCard({ state, upcoming }) {
  const nx = state.next;
  return (
    <section style={card}>
      <div style={eyebrow}>NASTĘPNY</div>
      {nx ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{nx.nr}</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{nx.name}</div>
        </div>
      ) : <div style={{ color: C.muted, fontSize: 16 }}>Koniec kolejki.</div>}
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

function ActionBar({ state, busy, canUndo, undoLeft, readyReturnee, on }) {
  const cur = state.current;
  const active = cur && ["called", "in_progress"].includes(cur.status);
  const mode = state.mode;
  const btns = [];
  if (state.returnee) {
    btns.push(<BigBtn key="fr" tone="primary" disabled={busy} onClick={on.finishReturnee}>Zakończ powracającego</BigBtn>);
  } else if (mode === "closed") {
    btns.push(<BigBtn key="open" tone="primary" disabled={busy} onClick={on.open}>Otwórz stanowisko</BigBtn>);
  } else if (mode === "paused") {
    btns.push(<BigBtn key="resume" tone="primary" disabled={busy} onClick={on.open}>Wznów</BigBtn>);
    btns.push(<BigBtn key="close" tone="ghost" disabled={busy} onClick={() => on.mode("closed")}>Zamknij</BigBtn>);
  } else if (mode === "free_entry") {
    btns.push(<BigBtn key="back" tone="primary" disabled={busy} onClick={() => on.mode("open")}>Wróć do kolejki</BigBtn>);
    btns.push(<BigBtn key="close" tone="ghost" disabled={busy} onClick={() => on.mode("closed")}>Zamknij</BigBtn>);
  } else if (active && cur.status === "called") {
    btns.push(<BigBtn key="start" tone="primary" disabled={busy} onClick={on.start}>Rozpocznij spotkanie</BigBtn>);
    btns.push(<BigBtn key="ns" tone="danger" disabled={busy} onClick={on.noShow}>Nieobecny</BigBtn>);
  } else if (active && cur.status === "in_progress") {
    btns.push(<BigBtn key="fn" tone="primary" disabled={busy} onClick={on.finishNext}>Zakończ i wywołaj następny{state.next ? ` (${state.next.nr})` : ""}</BigBtn>);
    btns.push(<BigBtn key="f" tone="ghost" disabled={busy} onClick={on.finish}>Zakończ</BigBtn>);
    btns.push(<BigBtn key="ns" tone="danger" disabled={busy} onClick={on.noShow}>Nieobecny</BigBtn>);
  } else {
    btns.push(<BigBtn key="cn" tone="primary" disabled={busy || !state.next} onClick={on.callNext}>Wywołaj następny{state.next ? ` → ${state.next.nr}` : ""}</BigBtn>);
    if (readyReturnee) btns.push(<BigBtn key="sr" tone="info" disabled={busy} onClick={on.serveReturnee}>Obsłuż powracającego ({readyReturnee.nr})</BigBtn>);
    btns.push(<BigBtn key="fe" tone="ghost" disabled={busy} onClick={() => on.mode("free_entry")}>Wolne wejście</BigBtn>);
    btns.push(<BigBtn key="pa" tone="ghost" disabled={busy} onClick={() => on.mode("paused")}>Przerwa</BigBtn>);
    btns.push(<BigBtn key="cl" tone="ghost" disabled={busy} onClick={() => on.mode("closed")}>Zamknij</BigBtn>);
  }
  return (
    <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
      {btns}
      <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
        {canUndo && <BigBtn tone="warn" disabled={busy} onClick={on.undo}>Cofnij ({undoLeft} s)</BigBtn>}
        {mode !== "closed" && <BigBtn tone="ghost" disabled={busy} onClick={on.exception}>+ Wyjątek</BigBtn>}
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

const card = { background: C.white, borderRadius: 16, border: `1px solid ${C.line}`, padding: "14px 18px" };
const eyebrow = { fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: C.muted, marginBottom: 8 };

function Pill({ children, color, bg, big }) {
  return <span style={{ display: "inline-block", padding: big ? "6px 12px" : "3px 9px", borderRadius: 999, background: bg, color, fontWeight: 800, fontSize: big ? 13 : 11, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{children}</span>;
}
function BigBtn({ children, onClick, disabled, tone = "primary" }) {
  const tones = {
    primary: { bg: C.teal, fg: "white", bd: C.teal },
    danger: { bg: C.redBg, fg: "#991b1b", bd: "#fecaca" },
    warn: { bg: C.amberBg, fg: "#92400e", bd: "#fde68a" },
    info: { bg: C.blueBg, fg: "#1e40af", bd: "#bfdbfe" },
    ghost: { bg: C.white, fg: C.slate, bd: C.line },
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled}
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
