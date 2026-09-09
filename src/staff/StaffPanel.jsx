// [feat/fm-queue] /obsluga — panel operatora kolejki (tablet 1024×768, dotyk, PL/EN).
// Wszystkie zmiany stanu idą przez RPC fm_queue_* (SECURITY DEFINER, version,
// obowiązkowy klucz idempotencji). Panel NIE pisze do tabel bezpośrednio.
// Numer publiczny (TERAZ) nigdy nie cofa się — „Cofnij” dotyczy tylko statusu spotkania.
// [feat/staff-meeting-list] Weryfikacja dostawcy po nazwie firmy: TERAZ/NASTĘPNY z pełną nazwą,
// sieć/grupa/stanowisko i statusem + „Lista spotkań” (pełna kolejka grupy pod RLS: admin i
// obsługa przypisana do sieci; Dino Owoce/Kwiaty = osobne grupy, Auchan ×2 = wspólna lista
// z kolumną stanowiska). Warstwa danych jest wstrzykiwana (`api`) — podgląd dev bez bazy.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { newIdemKey, staffApi } from "../lib/fm-queue";
import StaffLoginPage, { LangToggle } from "./StaffLoginPage";
import { C, MODE_LABEL, fmtElapsed, humanFmError, statusLabel } from "./staffUi";
import { useStaffLang } from "./staffI18n";
import { fmtDatePL, warsawToday } from "../lib/fm-date";
import {
  LIST_TIMEOUT_MS, MEETING_FILTERS, countByFilter, filterMeetings, fmtClock, isDataStale,
  isException, meetingName, stationLabelFor, withReadTimeout,
} from "./meetingList";

const UNDO_WINDOW_MS = 30_000;
const POLL_MS = 10_000;
// Zakres danych listy: `groupId` mówi, CZYJE są wiersze; `rows === null` = brak danych tej grupy.
const EMPTY_SCOPE = { groupId: null, rows: null, at: null, error: false, loading: false };

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

// `initial` — tylko podgląd dev (/obsluga-demo?station=…&view=list&filter=done&q=12&open=10): stan startowy do zrzutów.
export function Operator({ user, profile, signOut, isAdmin, lang, setLang, t, api = staffApi, initial = null }) {
  const [stationSnapshot, setStationSnapshot] = useState({ rows: [], gen: -1, order: 0, requestedAt: 0 });
  const stations = stationSnapshot.rows;
  const [stationsErr, setStationsErr] = useState("");
  const [selectedId, setSelectedId] = useState(() => { if (initial?.station) return initial.station; try { return localStorage.getItem("fm_station_id") || ""; } catch { return ""; } });
  const [rawState, setState] = useState(null);
  // [review 8.09 — P1] Lista spotkań i etykiety stanowisk są ZWIĄZANE Z GRUPĄ: nigdy nie pokazujemy
  // danych innej sieci pod bieżącym nagłówkiem. `rows === null` = brak danych tej grupy (ładowanie
  // albo błąd) — nie wolno wtedy pokazać ani poprzedniej listy, ani „brak spotkań”.
  const [mtg, setMtg] = useState(EMPTY_SCOPE);                 // { groupId, rows, at, error, loading }
  const [groupStations, setGroupStations] = useState({ groupId: null, rows: [] });
  const [view, setView] = useState(initial?.view === "list" ? "list" : "station"); // "station" | "list"
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [lastAction, setLastAction] = useState(null); // { ts, label }
  const [excModal, setExcModal] = useState(null);     // { name, step: "form" | "confirm" }
  const [, setTick] = useState(0);
  // Ekran pokazuje stan TYLKO wybranego stanowiska (i jego grupy) — stan innego stanowiska,
  // który przyszedłby jakąkolwiek drogą, nie jest renderowany (review v2 8.09).
  const selected = stations.find(x => x.station_id === selectedId);
  const state = rawState && rawState.station_id === selectedId && (!selected?.group_id || selected.group_id === rawState.group_id) ? rawState : null;
  const stateRef = useRef(null);            // ostatni PRZYJĘTY stan — ustawiany synchronicznie w applyState
  const viewRef = useRef(view);
  viewRef.current = view;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  // [review v2 8.09] JEDNA wspólna bramka przyjmowania wyników dla odczytów stanu, Realtime,
  // interwału, listy i wyników operacji: GENERACJA WYBORU (rośnie przy każdym wejściu/wyjściu ze
  // stanowiska — Auchan → Dino → Auchan to trzy różne generacje) + WERSJA stanowiska/grupy z bazy.
  const genRef = useRef(0);
  // Jeden porządek dla odczytów, operacji i zasiewu. Nadawany PRZED wysłaniem, nie po odpowiedzi.
  // Same wersje nie opisują całego snapshotu: np. ready powracającego zależy od drugiego stanowiska.
  const stateOrderRef = useRef(0), stateAppliedOrderRef = useRef(0), stationsAppliedOrderRef = useRef(0);
  const mtgSeq = useRef(0), mtgApplied = useRef(0);
  const mtgInflight = useRef({ gen: 0, count: 0 }), mtgPending = useRef(false);
  const refreshMeetingsRef = useRef(null);

  const showToast = useCallback((text, tone = "error") => {
    setToast({ text, tone, id: Date.now() });
    setTimeout(() => setToast(x => (x && Date.now() - x.id >= 3800 ? null : x)), 4000);
  }, []);

  const loadStations = useCallback(async () => {
    const gen = genRef.current, order = ++stateOrderRef.current, requestedAt = Date.now();
    try {
      // Stanowiska z DZISIEJSZEGO dnia (Europe/Warsaw): konto obsługi działa tylko w swoim dniu,
      // a RPC bez daty brałby max(event_date) = 24.09 — operator dnia testowego widziałby pustą listę.
      const rows = (await api.rpc.myStations(warsawToday())) || [];
      if (gen !== genRef.current || order < stationsAppliedOrderRef.current) return;
      stationsAppliedOrderRef.current = order;
      setStationSnapshot({ rows, gen, order, requestedAt });
      setStationsErr("");
    } catch (e) {
      if (gen !== genRef.current || order < stationsAppliedOrderRef.current) return;
      stationsAppliedOrderRef.current = order;
      setStationsErr(humanFmError(e, lang));
    }
  }, [api, lang]);

  // BRAMKA przyjęcia kandydata stanu stanowiska (odczyt, Realtime, interwał, wynik operacji, zasiew).
  // Odrzuca: inną generację wyboru, inne stanowisko niż wybrane oraz stan STARSZY od już przyjętego
  // Wersje nie maleją, ale nie każda zmiana danych pochodnych je podbija (np. waiting_returnees.ready).
  // Przy RÓWNYCH wersjach rozstrzyga porządek żądań — nowsza odpowiedź nadal może zmienić ekran.
  // Ustawia stateRef synchronicznie, żeby kolejne kandydaty w tym samym ticku porównywały się z nowym.
  const applyState = useCallback((st, { gen, stationId, order }) => {
    if (gen !== genRef.current) return false;
    if (!st || !stationId || st.station_id !== stationId || stationId !== selectedRef.current) return false;
    const cur = stateRef.current;
    if (cur && cur.station_id === st.station_id) {
      const v = Number(st.version ?? 0), cv = Number(cur.version ?? 0);
      const gv = Number(st.group_version ?? 0), cgv = Number(cur.group_version ?? 0);
      if (v < cv || (v === cv && gv < cgv)) return false;   // starszy odczyt / spóźniony wynik
      if (v === cv && gv === cgv && order <= stateAppliedOrderRef.current) return false;
    }
    stateAppliedOrderRef.current = Math.max(stateAppliedOrderRef.current, order);
    stateRef.current = st;
    setState(st);
    return true;
  }, []);

  const refreshState = useCallback(async () => {
    const id = selectedRef.current, gen = genRef.current;
    if (!id) return;
    const order = ++stateOrderRef.current;
    try {
      const st = await api.rpc.stationState(id);
      applyState(st, { gen, stationId: id, order });
    } catch (e) {
      if (gen !== genRef.current || id !== selectedRef.current || order < stateAppliedOrderRef.current) return;
      if (e?.fmCode === "FM_AUTH_REQUIRED" || e?.fmCode === "FM_FORBIDDEN") showToast(humanFmError(e, lang));
    }
  }, [api, applyState, showToast, lang]);

  // Lista spotkań grupy. Odczyt ma jawny limit czasu (wiszące API = błąd, nie „aktualne dane”).
  // Wyzwalacze automatyczne (Realtime/interwał) w trakcie pobierania planują JEDNO kolejne
  // odświeżenie zamiast serii równoległych; ręczne „Odśwież” zawsze wysyła nowe zapytanie.
  // Odpowiedź z poprzedniej generacji wyboru (np. z pierwszej wizyty na Auchan po powrocie
  // Auchan → Dino → Auchan) nie jest przyjmowana ani nie rozlicza liczników nowej generacji.
  const refreshMeetings = useCallback(async ({ manual = false } = {}) => {
    const gen = genRef.current, gid = stateRef.current?.group_id;
    if (!gid) return;
    if (mtgInflight.current.gen !== gen) { mtgInflight.current = { gen, count: 0 }; mtgPending.current = false; }
    if (!manual && mtgInflight.current.count > 0) { mtgPending.current = true; return; }
    const seq = ++mtgSeq.current;
    mtgInflight.current.count += 1;
    setMtg(m => (m.groupId === gid ? { ...m, loading: true } : { ...EMPTY_SCOPE, groupId: gid, loading: true }));
    let rows = null, failed = false;
    try { rows = await withReadTimeout(api.listMeetings(gid), LIST_TIMEOUT_MS); }
    catch { failed = true; }
    if (gen !== genRef.current) return;                      // odpowiedź z poprzedniej wizyty
    mtgInflight.current.count = Math.max(0, mtgInflight.current.count - 1);
    if (seq > mtgApplied.current && gid === stateRef.current?.group_id) {
      mtgApplied.current = seq;
      if (failed) setMtg(m => (m.groupId === gid ? { ...m, error: true, loading: false } : { ...EMPTY_SCOPE, groupId: gid, error: true }));
      else setMtg({ groupId: gid, rows: rows || [], at: Date.now(), error: false, loading: false });
    }
    if (mtgPending.current && mtgInflight.current.count === 0) { mtgPending.current = false; refreshMeetingsRef.current?.(); }
  }, [api]);
  refreshMeetingsRef.current = refreshMeetings;

  useEffect(() => { loadStations(); }, [loadStations]);
  useEffect(() => {
    if (!selectedId) { stateRef.current = null; setState(null); return; }
    const s = stations.find(x => x.station_id === selectedId);
    // Cache zachowuje generację i porządek POBRANIA. Nie nadawaj mu świeżej tożsamości przy renderze.
    // Po zmianie wyboru czekamy na stationState; stara lista służy tylko do wyboru stanowiska.
    if (s?.state && stationSnapshot.gen === genRef.current && Date.now() - stationSnapshot.requestedAt <= 15_000) {
      applyState(s.state, { gen: stationSnapshot.gen, stationId: selectedId, order: stationSnapshot.order });
    }
    refreshState();
  }, [selectedId, stationSnapshot, refreshState, applyState]);
  // Zmiana grupy = natychmiastowe porzucenie danych poprzedniej grupy (zanim przyjdzie odpowiedź).
  useEffect(() => {
    const gid = state?.group_id || null;
    setMtg(m => (m.groupId === gid ? m : { ...EMPTY_SCOPE, groupId: gid, loading: !!gid }));
  }, [state?.group_id]);
  useEffect(() => { refreshMeetings(); }, [state?.group_id, state?.version, state?.group_version, refreshMeetings]);
  useEffect(() => {
    const gid = state?.group_id, gen = genRef.current;
    if (!gid) { setGroupStations({ groupId: null, rows: [] }); return; }
    let alive = true;
    setGroupStations(g => (g.groupId === gid ? g : { groupId: gid, rows: [] }));
    api.listStations(gid)
      .then(rows => { if (alive && gen === genRef.current && gid === stateRef.current?.group_id) setGroupStations({ groupId: gid, rows: rows || [] }); })
      .catch(() => { /* etykiety opcjonalne */ });
    return () => { alive = false; };
  }, [api, state?.group_id]);
  useEffect(() => {
    // Realtime (zmiany z drugiego tabletu) + polling awaryjny: stan stanowiska zawsze,
    // lista przy każdej zmianie (koalescencja) oraz co POLL_MS, gdy jest otwarta.
    const unsub = api.subscribe(() => { refreshState(); refreshMeetings(); });
    const i = setInterval(() => { refreshState(); if (viewRef.current === "list") refreshMeetings(); }, POLL_MS);
    return () => { unsub(); clearInterval(i); };
  }, [api, refreshState, refreshMeetings]);
  useEffect(() => { if (view === "list") refreshMeetings({ manual: true }); }, [view, refreshMeetings]);
  useEffect(() => {
    const i = setInterval(() => setTick(x => x + 1), 1000);
    // Powrót łącza / powrót do karty = natychmiastowe odświeżenie (dane mogły się zestarzeć).
    const on = () => { setOnline(true); refreshState(); refreshMeetingsRef.current?.({ manual: true }); };
    const off = () => setOnline(false);
    const onVis = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") { refreshState(); refreshMeetingsRef.current?.({ manual: true }); } };
    window.addEventListener("online", on); window.addEventListener("offline", off);
    if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(i);
      window.removeEventListener("online", on); window.removeEventListener("offline", off);
      if (typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshState]);

  // Wejście/wyjście ze stanowiska = nowa generacja wyboru: wszystko, co było w locie (odczyty,
  // lista, wyniki operacji, etykiety), traci prawo do zmiany ekranu. Historia „Cofnij” też jest
  // per wybór. Powrót do listy stanowisk odświeża karty (i cache do zasiewu).
  function pick(id) {
    genRef.current += 1;
    selectedRef.current = id;
    stateRef.current = null;
    stateAppliedOrderRef.current = 0;
    mtgInflight.current = { gen: genRef.current, count: 0 };
    mtgPending.current = false;
    setSelectedId(id);
    setState(null);
    setView("station");
    setMtg(EMPTY_SCOPE);
    setGroupStations({ groupId: null, rows: [] });
    setLastAction(null);
    try { if (id) localStorage.setItem("fm_station_id", id); else localStorage.removeItem("fm_station_id"); } catch { /* noop */ }
    if (!id) loadStations();
  }

  // Jedna operacja = jeden klucz idempotencji; przy błędzie sieci ponawiamy z TYM SAMYM kluczem.
  // Cel operacji jest ZAMROŻONY przy starcie (stanowisko, oczekiwana wersja, klucz) — ponowienia
  // niczego nie zmieniają. Wynik wpływa na ekran, listę, „Cofnij” i komunikaty TYLKO, jeśli operator
  // nadal jest na tym samym stanowisku w tej samej generacji wyboru (review v2 8.09 — P1 #1).
  const act = useCallback(async (label, makeCall) => {
    if (busy || !online) return;
    const gen = genRef.current, stationId = selectedRef.current;
    const order = ++stateOrderRef.current;
    const expectedVersion = stateRef.current?.version ?? 0;
    const prevNr = stateRef.current?.current?.nr ?? null;
    const idem = newIdemKey();
    const live = () => gen === genRef.current && stationId === selectedRef.current;
    setBusy(true);
    let attempt = 0;
    try {
      for (;;) {
        try {
          const st = await makeCall(idem, expectedVersion);
          if (st && typeof st === "object" && st.station_id) applyState(st, { gen, stationId, order });
          else if (live()) await refreshState();
          if (live()) setLastAction({ ts: Date.now(), label, nr: prevNr, stationId });
          return st;
        } catch (e) {
          const network = e?.network || (e?.message && /fetch|network|Failed to fetch|Load failed|timeout|abort/i.test(e.message) && !e.fmCode);
          if (network && attempt < 2) { attempt++; await new Promise(r => setTimeout(r, 1500)); continue; }
          // FM_BUSY = blokada wiersza zajęta > 3 s (konwój) — ponów raz z tym samym kluczem (bezpieczne)
          if (e?.fmCode === "FM_BUSY" && attempt < 1) { attempt++; await new Promise(r => setTimeout(r, 400)); continue; }
          if (!live()) return null;               // operator już gdzie indziej — cudzy ekran zostaje nietknięty
          if (network) { await refreshState(); showToast(t.err_network); return null; }
          if (e?.fmCode === "FM_CONFLICT") await refreshState();
          showToast(humanFmError(e, lang));
          return null;
        }
      }
    } finally {
      setBusy(false);
      if (live()) refreshMeetingsRef.current?.();
    }
  }, [busy, online, applyState, refreshState, showToast, lang, t]);

  const undoLeft = lastAction ? Math.max(0, Math.ceil((lastAction.ts + UNDO_WINDOW_MS - Date.now()) / 1000)) : 0;
  // Cofnięcie: start zawsze (nie zmienia numeru); no_show/finish tylko gdy stanowisko wolne
  // i przywracany numer jest nadal ostatnio wywołanym w grupie (tablica nie może cofnąć numeru).
  // Tylko dla operacji wykonanej na TYM stanowisku w tym wyborze.
  const canUndo = undoLeft > 0 && lastAction?.stationId === selectedId && (lastAction?.label === "start"
    || ((lastAction?.label === "no_show" || lastAction?.label === "finish") && !state?.current && lastAction?.nr != null && lastAction.nr === state?.last_called_nr));

  // Wszystko, co pokazuje spotkania, bierze dane WYŁĄCZNIE z zakresu bieżącej grupy.
  const scope = mtg.groupId && mtg.groupId === state?.group_id ? mtg : { ...EMPTY_SCOPE, groupId: state?.group_id || null, loading: !!state?.group_id };
  const meetings = useMemo(() => scope.rows || [], [scope.rows]);
  const noShows = useMemo(() => meetings.filter(m => m.status === "no_show"), [meetings]);
  const upcoming = useMemo(() => {
    const last = state?.last_called_nr ?? 0;
    return meetings.filter(m => m.status === "planned" && m.nr > last).slice(0, 8);
  }, [meetings, state?.last_called_nr]);
  const readyReturnee = (state?.waiting_returnees || []).find(r => r.ready);
  const nextExceptionNr = Math.max(state?.last_called_nr || 0, ...meetings.map(m => m.nr || 0)) + 1;
  // Etykiety stanowisk grupy: z fm_stations (pełne), awaryjnie z listy „moich” stanowisk tej grupy.
  const stationList = groupStations.groupId === state?.group_id && groupStations.rows.length
    ? groupStations.rows
    : stations.filter(s => s.state?.group_id === state?.group_id);

  async function addException(name) {
    const r = await act("add_exception", async (idem) => { await api.rpc.addException(state.group_id, name, idem); return null; });
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
          {selected && state && (
            <SmallBtn tone={view === "list" ? "primary" : "ghost"} onClick={() => setView(v => (v === "list" ? "station" : "list"))} testId="btn-list">
              {view === "list" ? t.btn_back_station : `☰ ${t.btn_list}`}
            </SmallBtn>
          )}
          {selected && <SmallBtn onClick={() => pick("")}>{t.change_station}</SmallBtn>}
          <SmallBtn onClick={() => { pick(""); signOut?.(); }}>{t.logout}</SmallBtn>
        </div>
      </header>

      {!online && <div role="alert" style={{ background: C.red, color: "white", textAlign: "center", padding: "10px 12px", fontWeight: 700 }}>{t.offline}</div>}

      {!selected && (
        <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <h1 style={{ fontSize: 22, margin: "4px 0 14px" }}>{t.pick_station} <span style={{ fontSize: 14, fontWeight: 600, color: C.slate }} data-testid="stations-day">· {t.stations_for(fmtDatePL(warsawToday()))}</span></h1>
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

      {selected && !state && (
        // Wybrane stanowisko bez przyjętego stanu (świeży wybór, cache nieświeży, odczyt w drodze):
        // zamiast pokazywać cokolwiek z poprzedniego stanowiska — czekamy na odczyt.
        <main data-testid="station-loading" style={{ padding: 40, textAlign: "center", color: C.slate }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.retailer_name}{selected.group_label ? ` · ${selected.group_label}` : ""}</div>
          <div style={{ marginTop: 8 }}>{t.loading}</div>
        </main>
      )}

      {selected && state && view === "list" && (
        <main style={{ padding: "14px 16px 24px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box", flex: 1 }}>
          <StationHeader s={selected} state={state} t={t} lang={lang} />
          <MeetingListView scope={scope} stations={stationList} online={online} currentId={state.current?.id || state.returnee?.id || null}
            t={t} lang={lang} onRefresh={() => refreshMeetings({ manual: true })} onBack={() => setView("station")} initial={initial} />
        </main>
      )}

      {selected && state && view === "station" && (
        <main style={{ padding: "14px 16px 24px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box", flex: 1 }}>
          <StationHeader s={selected} state={state} t={t} lang={lang} />
          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 14, marginTop: 12 }}>
            <NowCard state={state} s={selected} t={t} />
            <NextCard state={state} upcoming={upcoming} t={t} />
          </div>

          <ActionBar
            state={state} busy={busy || !online} canUndo={canUndo} undoLeft={undoLeft} readyReturnee={readyReturnee} t={t}
            on={{
              open: () => act("open_station", (idem, v) => api.rpc.openStation(selectedId, v, idem)),
              callNext: () => act("call_next", (idem, v) => api.rpc.callNext(selectedId, v, idem)),
              start: () => act("start", (idem, v) => api.rpc.start(selectedId, v, idem)),
              finishNext: () => act("finish", (idem, v) => api.rpc.finishAndCallNext(selectedId, v, true, idem)),
              finish: () => act("finish", (idem, v) => api.rpc.finishAndCallNext(selectedId, v, false, idem)),
              noShow: () => act("no_show", (idem, v) => api.rpc.noShow(selectedId, v, idem)),
              undo: () => act("undo", (idem, v) => api.rpc.undo(selectedId, v, idem)),
              serveReturnee: () => readyReturnee && act("serve_returnee", (idem, v) => api.rpc.serveReturnee(selectedId, readyReturnee.id, v, idem)),
              finishReturnee: () => act("finish_returnee", (idem, v) => api.rpc.finishReturnee(selectedId, v, idem)),
              mode: (m) => act("set_mode", (idem, v) => api.rpc.setMode(selectedId, m, v, idem)),
              exception: () => setExcModal({ name: "", step: "form" }),
              list: () => setView("list"),
            }}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
            <ListCard title={t.returnees_title} empty={t.returnees_empty}>
              {(state.waiting_returnees || []).map(r => (
                <Row key={r.id} nr={r.nr} name={r.name}
                  sub={r.ready ? t.ready_hint : `${t.waits_for} ${r.return_after_nr}`}
                  right={<SmallBtn tone="ghost" disabled={busy} onClick={() => act("skip", async (idem) => { await api.rpc.skip(r.id, idem); return null; })}>{t.resigns}</SmallBtn>} />
              ))}
            </ListCard>
            <ListCard title={t.noshows_title} empty={t.noshows_empty}>
              {noShows.map(m => (
                <Row key={m.id} nr={m.nr} name={meetingName(m) || "—"} sub={statusLabel(lang, m.status)}
                  right={<SmallBtn tone="primary" disabled={busy} onClick={() => act("mark_returned", async (idem) => { await api.rpc.markReturned(m.id, idem); return null; })}>{t.returned}</SmallBtn>} />
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

// Nazwa stanowiska/grupy do wiersza identyfikacji: „Auchan Polska · stanowisko 1”
function whereLabel(s, t) {
  const grp = `${s.retailer_name}${s.group_label ? ` · ${s.group_label}` : ""}`;
  return `${grp} · ${t.station_short} ${s.station_label || s.station_idx}`;
}

function NowCard({ state, s, t }) {
  const cur = state.current, ret = state.returnee;
  const active = cur && ["called", "in_progress"].includes(cur.status);
  const fullName = { fontSize: 24, fontWeight: 700, marginTop: 8, lineHeight: 1.25, overflowWrap: "anywhere" };
  return (
    <section style={card} data-testid="now-card">
      <div style={eyebrow}>{t.now}</div>
      {ret ? (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.slate }}>{whereLabel(s, t)}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontSize: 84, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: C.blue }}>{ret.nr}</div>
            <Pill color={C.blue} bg={C.blueBg}>{t.returnee_pill}</Pill>
          </div>
          <div style={fullName}><span style={{ color: C.slate, fontWeight: 600 }}>{t.nr_label} {ret.nr} — </span>{ret.name || t.no_company}</div>
          <div style={{ color: C.slate, marginTop: 4 }}>{t.now_status.returnee} · {t.ongoing} {fmtElapsed(ret.started_at)}</div>
          <div style={hint}>{t.verify_hint}</div>
        </div>
      ) : active ? (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.slate }}>{whereLabel(s, t)}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: cur.status === "in_progress" ? C.green : C.amber }}>{cur.nr}</div>
            <Pill color={cur.status === "in_progress" ? C.green : C.amber} bg={cur.status === "in_progress" ? C.greenBg : C.amberBg} big>
              {cur.status === "in_progress" ? t.in_progress : t.called_waiting}
            </Pill>
          </div>
          <div style={fullName} data-testid="now-name"><span style={{ color: C.slate, fontWeight: 600 }}>{t.nr_label} {cur.nr} — </span>{cur.name || t.no_company}</div>
          <div style={{ color: C.slate, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
            {cur.status === "in_progress" ? `${t.now_status.in_progress} · ${t.ongoing} ${fmtElapsed(cur.started_at)}` : `${t.now_status.called} · ${t.since_call} ${fmtElapsed(cur.called_at)}`}
          </div>
          <div style={hint}>{t.verify_hint}</div>
        </div>
      ) : (
        <div style={{ color: C.muted, fontSize: 18, padding: "24px 0" }}>
          {state.mode === "free_entry" ? t.free_entry_now : state.mode === "open" ? t.station_free : state.mode === "closing" ? t.day_closed_now : t.station_closed}
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
          <div style={{ fontSize: 17, fontWeight: 700, overflowWrap: "anywhere", lineHeight: 1.3 }}>{nx.name || t.no_company}</div>
        </div>
      ) : <div style={{ color: C.muted, fontSize: 16 }}>{t.queue_end}</div>}
      {upcoming.length > 1 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          {upcoming.slice(1, 6).map(m => (
            <div key={m.id} style={{ display: "flex", gap: 10, fontSize: 13, padding: "4px 0", color: C.slate }}>
              <b style={{ width: 28, textAlign: "right", color: C.ink, fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>{m.nr}</b>
              <span title={meetingName(m)} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meetingName(m) || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Lista spotkań grupy (weryfikacja dostawcy) ───────────────────────────────
const STATUS_TONE = {
  planned: { color: C.slate, bg: C.bg },
  called: { color: C.amber, bg: C.amberBg },
  in_progress: { color: C.green, bg: C.greenBg },
  returned_in_progress: { color: C.green, bg: C.greenBg },
  done: { color: "#334155", bg: "#e2e8f0" },
  no_show: { color: C.red, bg: C.redBg },
  returned_waiting: { color: C.blue, bg: C.blueBg },
  skipped: { color: C.muted, bg: C.bg },
  cancelled: { color: C.muted, bg: C.bg },
};

function MeetingListView({ scope, stations, online, currentId, t, lang, onRefresh, onBack, initial = null }) {
  const [filter, setFilter] = useState(MEETING_FILTERS.includes(initial?.filter) ? initial.filter : "all");
  const [query, setQuery] = useState(initial?.query || "");
  const [openId, setOpenId] = useState(null);
  const [openInit, setOpenInit] = useState(initial?.openNr || null);
  const meetings = scope.rows || [];
  const hasData = scope.rows !== null;                 // dane TEJ grupy zostały wczytane
  useEffect(() => {
    if (!openInit) return;
    const m = meetings.find(x => String(x.nr) === String(openInit));
    if (m) { setOpenId(m.id); setOpenInit(null); }
  }, [openInit, meetings]);
  const counts = useMemo(() => countByFilter(meetings), [meetings]);
  const rows = useMemo(() => filterMeetings(meetings, { filter, query }), [meetings, filter, query]);
  // Nieaktualne = brak sieci LUB nieudany/wiszący odczyt LUB zbyt stare ostatnie udane odświeżenie.
  // Sama dostępność Wi-Fi NIE oznacza aktualnych danych (review 8.09 — P2).
  const stale = !online || scope.error || isDataStale(scope.at);
  const th = { textAlign: "left", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: C.muted, padding: "10px 10px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" };
  const td = { padding: "12px 10px", borderBottom: `1px solid ${C.line}`, verticalAlign: "top", fontSize: 16 };
  return (
    <section style={{ ...card, marginTop: 12 }} data-testid="meeting-list">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={eyebrow}>{t.list_title.toUpperCase()}{hasData ? ` · ${t.list_count(rows.length, meetings.length)}` : ""}</div>
          <div style={{ fontSize: 13, color: C.slate }}>{t.list_sub}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.muted }}>
          {scope.at && !stale && <span>{t.refreshed_at} {fmtClock(scope.at)}</span>}
          <SmallBtn onClick={onRefresh}>{scope.loading ? t.refreshing : t.refresh}</SmallBtn>
          <SmallBtn tone="primary" onClick={onBack}>{t.btn_back_station}</SmallBtn>
        </div>
      </div>

      {stale && (
        <div role="status" data-testid="stale" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: C.amberBg, border: "1px solid #fde68a", color: "#92400e", fontWeight: 700, fontSize: 14 }}>
          {hasData ? t.stale(scope.at ? fmtClock(scope.at) : null) : t.list_error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 320px", maxWidth: 520 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search_ph} inputMode="search" aria-label={t.search_ph} data-testid="search"
            style={{ width: "100%", boxSizing: "border-box", padding: "14px 44px 14px 14px", borderRadius: 12, border: `1.5px solid ${C.line}`, fontSize: 18, fontFamily: "inherit" }} />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t.search_clear} title={t.search_clear}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 36, height: 36, borderRadius: 999, border: "none", background: C.bg, color: C.slate, fontSize: 18, cursor: "pointer" }}>×</button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }} role="tablist" aria-label={t.col_status}>
        {MEETING_FILTERS.map(f => {
          const on = f === filter;
          return (
            <button key={f} type="button" role="tab" aria-selected={on} onClick={() => setFilter(f)} data-testid={`filter-${f}`}
              style={{ minHeight: 44, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${on ? C.teal : C.line}`, background: on ? C.teal : C.white, color: on ? "white" : C.slate, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              {t.filters[f]} <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>({counts[f]})</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{t.filters_hint}</div>

      {!hasData ? (
        // Brak danych TEJ grupy: ładowanie albo błąd — nigdy lista poprzedniej sieci
        // ani przedwczesne „brak spotkań” (review 8.09 — P1).
        <div data-testid="list-nodata" style={{ color: C.muted, fontSize: 15, padding: "18px 0 6px" }}>
          {scope.error ? t.list_error_body : t.list_loading}
        </div>
      ) : meetings.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 15, padding: "18px 0 6px" }}>{t.list_none}</div>
      ) : rows.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 15, padding: "18px 0 6px" }}>{t.list_empty}</div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 84 }}>{t.col_nr.toUpperCase()}</th>
                <th style={th}>{t.col_company.toUpperCase()}</th>
                <th style={{ ...th, width: 210 }}>{t.col_status.toUpperCase()}</th>
                <th style={{ ...th, width: 120 }}>{t.col_station.toUpperCase()}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(m => {
                const tone = STATUS_TONE[m.status] || STATUS_TONE.planned;
                const st = stationLabelFor(m.station_id, stations);
                const open = openId === m.id;
                const isCur = currentId && m.id === currentId;
                const hasTimes = m.called_at || m.started_at || m.ended_at;
                return [
                  <tr key={m.id} data-testid={`row-${m.nr}`} onClick={() => setOpenId(open ? null : m.id)} aria-expanded={open}
                    style={{ cursor: "pointer", background: open ? "#f8fafc" : "transparent", boxShadow: isCur ? `inset 4px 0 0 ${C.teal}` : "none" }}>
                    <td style={{ ...td, fontSize: 24, fontWeight: 900, fontVariantNumeric: "tabular-nums", textAlign: "right", paddingRight: 16 }}>{m.nr}</td>
                    <td style={{ ...td, fontWeight: 700, overflowWrap: "anywhere" }}>
                      {meetingName(m) || <span style={{ color: C.muted, fontWeight: 500 }}>{t.no_company}</span>}
                      {isException(m) && <span style={{ marginLeft: 8 }}><Pill color="#7c2d12" bg="#ffedd5">{t.exception_tag}</Pill></span>}
                      {isCur && <span style={{ marginLeft: 8 }}><Pill color={C.tealDark} bg="#ccfbf1">{t.current_tag}</Pill></span>}
                    </td>
                    <td style={td}><Pill color={tone.color} bg={tone.bg} big>{statusLabel(lang, m.status).toUpperCase()}</Pill></td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: st ? C.ink : C.muted }}>{st || "—"}</td>
                  </tr>,
                  open && (
                    <tr key={`${m.id}-d`} data-testid={`details-${m.nr}`}>
                      <td colSpan={4} style={{ ...td, background: "#f8fafc", fontSize: 14, color: C.slate, paddingTop: 0 }}>
                        {hasTimes || m.return_after_nr || m.note ? (
                          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                            <Kv k={t.details_called} v={fmtClock(m.called_at)} />
                            <Kv k={t.details_started} v={fmtClock(m.started_at)} />
                            <Kv k={t.details_ended} v={fmtClock(m.ended_at)} />
                            {m.return_after_nr != null && <Kv k={t.details_return_after} v={String(m.return_after_nr)} />}
                            {st && <Kv k={t.col_station} v={st} />}
                            {m.note && <Kv k={t.details_note} v={m.note} />}
                          </div>
                        ) : <span>{t.details_none}</span>}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{t.tap_details}</div>
        </div>
      )}
    </section>
  );
}

function Kv({ k, v }) {
  return <span><span style={{ color: C.muted }}>{k}:</span> <b style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>{v || "—"}</b></span>;
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
  } else if (mode === "closing") {
    // dzień zamknięty: tylko dokończenie trwającego spotkania, bez wywołań
    if (active && cur.status === "called") btns.push(<BigBtn key="start" tone="primary" disabled={busy} onClick={on.start}>{t.btn_start}</BigBtn>);
    if (active) { btns.push(<BigBtn key="f" tone="primary" disabled={busy} onClick={on.finish}>{t.btn_finish}</BigBtn>); btns.push(<BigBtn key="ns" tone="danger" disabled={busy} onClick={on.noShow}>{t.btn_no_show}</BigBtn>); }
    if (!active) btns.push(<BigBtn key="cl" tone="ghost" disabled={busy} onClick={() => on.mode("closed")}>{t.btn_close}</BigBtn>);
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
        <BigBtn tone="ghost" onClick={on.list} title={t.list_sub}>☰ {t.btn_list}</BigBtn>
        {mode !== "closed" && mode !== "closing" && <BigBtn tone="ghost" disabled={busy} onClick={on.exception}>{t.btn_exception}</BigBtn>}
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
        <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{name}</div>
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
const hint = { marginTop: 10, fontSize: 13, color: "#92400e", background: C.amberBg, border: "1px solid #fde68a", borderRadius: 10, padding: "8px 10px", lineHeight: 1.4 };
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
function SmallBtn({ children, onClick, disabled, tone = "ghost", testId }) {
  const primary = tone === "primary";
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId}
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
