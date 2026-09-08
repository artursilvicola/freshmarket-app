// [feat/staff-meeting-list] Podgląd deweloperski panelu obsługi z DANYMI TESTOWYMI W PAMIĘCI.
// Trasa /obsluga-demo istnieje TYLKO w trybie `import.meta.env.DEV` (App.jsx) — do zrzutów
// ekranu, instrukcji PDF i review. Nie dotyka Supabase, nie tworzy niczego w produkcyjnej bazie.
// Symulacja odwzorowuje kształt odpowiedzi RPC (fm_queue_my_stations / fm_queue_station_state)
// i wierszy fm_queue_meetings (+ companies.name) na tyle, ile potrzebuje panel.
import { useEffect, useMemo, useState } from "react";
import { Operator } from "./StaffPanel";
import { useStaffLang } from "./staffI18n";

const T0 = Date.now();
const min = (n) => new Date(T0 - n * 60_000).toISOString();

function fixture() {
  // Grupy: Auchan (2 stanowiska, wspólna kolejka), Dino · Owoce, Dino · Kwiaty (osobne grupy)
  const groups = {
    auchan: { id: "g-auchan", retailer_name: "Auchan Polska", label: null, gate: 1, last_called_nr: 12, version: 7 },
    dinoO: { id: "g-dino-o", retailer_name: "Dino Polska", label: "Owoce", gate: 2, last_called_nr: 3, version: 2 },
    dinoK: { id: "g-dino-k", retailer_name: "Dino Polska", label: "Kwiaty", gate: 2, last_called_nr: 0, version: 0 },
  };
  const stations = [
    { id: "s-au-1", group: "auchan", idx: 1, label: null, mode: "open", version: 9, current_meeting_id: "m-au-11" },
    { id: "s-au-2", group: "auchan", idx: 2, label: null, mode: "open", version: 6, current_meeting_id: "m-au-12" },
    { id: "s-di-o", group: "dinoO", idx: 1, label: null, mode: "open", version: 3, current_meeting_id: null },
    { id: "s-di-k", group: "dinoK", idx: 1, label: null, mode: "closed", version: 0, current_meeting_id: null },
  ];
  const M = (id, group, nr, name, status, extra = {}) => ({
    id, queue_group_id: groups[group].id, nr, status, source: "plan", company_id: `c-${id}`, companies: { name },
    station_id: null, called_at: null, started_at: null, ended_at: null, return_after_nr: null, note: null, ...extra,
  });
  const meetings = [
    M("m-au-1", "auchan", 1, "Sady Grójeckie Sp. z o.o.", "done", { station_id: "s-au-1", called_at: min(140), started_at: min(139), ended_at: min(121) }),
    M("m-au-2", "auchan", 2, "Fresh Berry Farm", "done", { station_id: "s-au-2", called_at: min(138), started_at: min(136), ended_at: min(118) }),
    M("m-au-3", "auchan", 3, "Vitalia Warzywa i Owoce", "no_show", { station_id: "s-au-1", called_at: min(120) }),
    M("m-au-4", "auchan", 4, "Owoce Sandomierskie S.A.", "done", { station_id: "s-au-1", called_at: min(118), started_at: min(117), ended_at: min(99) }),
    M("m-au-5", "auchan", 5, "Bio Planet Import", "done", { station_id: "s-au-2", called_at: min(117), started_at: min(116), ended_at: min(97) }),
    M("m-au-6", "auchan", 6, "Kaszubskie Truskawki", "skipped", { station_id: null }),
    M("m-au-7", "auchan", 7, "Green Valley Exotic Fruits Ltd.", "returned_waiting", { station_id: "s-au-2", called_at: min(96), return_after_nr: 11 }),
    M("m-au-8", "auchan", 8, "Pomidory z Podkarpacia", "done", { station_id: "s-au-1", called_at: min(98), started_at: min(97), ended_at: min(80) }),
    M("m-au-9", "auchan", 9, "Cytrus Trade Hiszpania", "cancelled"),
    M("m-au-10", "auchan", 10, "Ekologiczne Jabłka Łąckie Spółdzielnia Producentów Owoców", "done", { station_id: "s-au-2", called_at: min(79), started_at: min(78), ended_at: min(60) }),
    M("m-au-11", "auchan", 11, "Ziemniaki Mazowsze Sp. z o.o.", "in_progress", { station_id: "s-au-1", called_at: min(22), started_at: min(19) }),
    M("m-au-12", "auchan", 12, "Przykładowy Dostawca XYZ Sp. z o.o.", "called", { station_id: "s-au-2", called_at: min(2) }),
    M("m-au-13", "auchan", 13, "Winnica Słoneczna", "planned"),
    M("m-au-14", "auchan", 14, "Borówka Premium Export", "planned"),
    M("m-au-15", "auchan", 15, "Zioła Ogrodowe Anna Kowalska", "planned"),
    M("m-au-16", "auchan", 16, "Żółty Ogród — Kwiaty Cięte", "planned", { company_id: null, companies: null, exception_name: "Żółty Ogród — Kwiaty Cięte", source: "exception" }),
    M("m-do-1", "dinoO", 1, "Sady Grójeckie Sp. z o.o.", "done", { station_id: "s-di-o", called_at: min(60), started_at: min(59), ended_at: min(41) }),
    M("m-do-2", "dinoO", 2, "Fresh Berry Farm", "done", { station_id: "s-di-o", called_at: min(40), started_at: min(39), ended_at: min(21) }),
    M("m-do-3", "dinoO", 3, "Owoce Sandomierskie S.A.", "done", { station_id: "s-di-o", called_at: min(20), started_at: min(19), ended_at: min(3) }),
    M("m-do-4", "dinoO", 4, "Borówka Premium Export", "planned"),
    M("m-do-5", "dinoO", 5, "Pomidory z Podkarpacia", "planned"),
    M("m-dk-1", "dinoK", 1, "Żółty Ogród — Kwiaty Cięte", "planned"),
    M("m-dk-2", "dinoK", 2, "Kwiaciarnia Hurt Tulipan", "planned"),
  ];
  return { groups, stations, meetings };
}

// Minimalna maszyna stanów — tylko to, co potrzebne do klikania w podglądzie.
function makeDemoApi(db, notify) {
  const g = (st) => Object.values(db.groups).find(x => x.id === db.groups[st.group].id);
  const meetingsOf = (gid) => db.meetings.filter(m => m.queue_group_id === gid);
  const name = (m) => m?.companies?.name || m?.exception_name || null;
  const stationOf = (id) => { const s = db.stations.find(x => x.id === id); if (!s) { const e = new Error("FM_NOT_FOUND"); e.fmCode = "FM_NOT_FOUND"; throw e; } return s; };
  const fail = (code) => { const e = new Error(code); e.fmCode = code; throw e; };
  const state = (st) => {
    const grp = g(st);
    const cur = db.meetings.find(m => m.id === st.current_meeting_id) || null;
    const nextM = meetingsOf(grp.id).filter(m => m.status === "planned" && m.nr > grp.last_called_nr).sort((a, b) => a.nr - b.nr)[0] || null;
    const wr = meetingsOf(grp.id).filter(m => m.status === "returned_waiting").map(m => ({
      id: m.id, nr: m.nr, name: name(m), return_after_nr: m.return_after_nr,
      ready: m.return_after_nr == null || meetingsOf(grp.id).some(d => d.nr === m.return_after_nr && ["done", "no_show", "skipped", "cancelled"].includes(d.status)),
    }));
    return {
      station_id: st.id, group_id: grp.id, mode: st.mode, version: st.version, group_version: grp.version, last_called_nr: grp.last_called_nr,
      current: cur ? { id: cur.id, nr: cur.nr, status: cur.status, name: name(cur), called_at: cur.called_at, started_at: cur.started_at } : null,
      returnee: null, next: nextM ? { id: nextM.id, nr: nextM.nr, name: name(nextM) } : null,
      waiting_returnees: wr, remaining: meetingsOf(grp.id).filter(m => m.status === "planned" && m.nr > grp.last_called_nr).length,
    };
  };
  const bump = (st) => { st.version += 1; g(st).version += 1; notify(); };
  const withStation = (id, fn) => { const st = stationOf(id); fn(st, g(st)); bump(st); return state(st); };
  return {
    rpc: {
      myStations: async () => db.stations.map(st => {
        const grp = g(st);
        return {
          station_id: st.id, group_id: grp.id, retailer_name: grp.retailer_name, group_label: grp.label, gate: grp.gate,
          station_idx: st.idx, station_label: st.label, stations_in_group: db.stations.filter(x => x.group === st.group).length, state: state(st),
        };
      }),
      stationState: async (id) => state(stationOf(id)),
      openStation: async (id) => withStation(id, st => { st.mode = "open"; }),
      setMode: async (id, mode) => withStation(id, st => { if (st.current_meeting_id && mode !== "open") fail("FM_STATION_BUSY"); st.mode = mode; }),
      callNext: async (id) => withStation(id, (st, grp) => {
        if (st.mode !== "open") fail("FM_STATION_NOT_OPEN");
        if (st.current_meeting_id) fail("FM_STATION_BUSY");
        const nx = meetingsOf(grp.id).filter(m => m.status === "planned" && m.nr > grp.last_called_nr).sort((a, b) => a.nr - b.nr)[0];
        if (!nx) fail("FM_QUEUE_EMPTY");
        nx.status = "called"; nx.station_id = st.id; nx.called_at = new Date().toISOString(); grp.last_called_nr = nx.nr; st.current_meeting_id = nx.id;
      }),
      start: async (id) => withStation(id, st => { const m = db.meetings.find(x => x.id === st.current_meeting_id); if (!m || m.status !== "called") fail("FM_NO_CALLED_MEETING"); m.status = "in_progress"; m.started_at = new Date().toISOString(); }),
      finishAndCallNext: async (id, _v, callNext) => withStation(id, (st, grp) => {
        const m = db.meetings.find(x => x.id === st.current_meeting_id); if (!m) fail("FM_NO_ACTIVE_MEETING");
        m.status = "done"; m.ended_at = new Date().toISOString(); st.current_meeting_id = null;
        if (callNext) {
          const nx = meetingsOf(grp.id).filter(x => x.status === "planned" && x.nr > grp.last_called_nr).sort((a, b) => a.nr - b.nr)[0];
          if (nx) { nx.status = "called"; nx.station_id = st.id; nx.called_at = new Date().toISOString(); grp.last_called_nr = nx.nr; st.current_meeting_id = nx.id; }
        }
      }),
      noShow: async (id) => withStation(id, st => { const m = db.meetings.find(x => x.id === st.current_meeting_id); if (!m) fail("FM_NO_ACTIVE_MEETING"); m.status = "no_show"; st.current_meeting_id = null; }),
      undo: async () => fail("FM_UNDO_EXPIRED"),
      skip: async (mid) => { const m = db.meetings.find(x => x.id === mid); if (m) m.status = "skipped"; notify(); return null; },
      markReturned: async (mid) => { const m = db.meetings.find(x => x.id === mid); if (m) { m.status = "returned_waiting"; m.return_after_nr = db.groups.auchan.last_called_nr; } notify(); return null; },
      serveReturnee: async (id) => withStation(id, () => fail("FM_RETURNEE_BARRIER")),
      finishReturnee: async (id) => withStation(id, () => fail("FM_NO_RETURNEE")),
      addException: async (gid, nm) => {
        const nr = Math.max(0, ...meetingsOf(gid).map(m => m.nr)) + 1;
        db.meetings.push({ id: `m-exc-${nr}-${Date.now()}`, queue_group_id: gid, nr, status: "planned", source: "exception", company_id: null, companies: null, exception_name: nm, station_id: null, called_at: null, started_at: null, ended_at: null, return_after_nr: null, note: null });
        notify(); return null;
      },
    },
    listMeetings: async (gid) => { if (db.offline) { const e = new Error("Failed to fetch"); e.network = true; throw e; } return meetingsOf(gid).map(m => ({ ...m })); },
    listStations: async (gid) => db.stations.filter(s => db.groups[s.group].id === gid).map(s => ({ id: s.id, idx: s.idx, label: s.label, active: true })),
    subscribe: (cb) => { db.listeners.add(cb); return () => db.listeners.delete(cb); },
  };
}

export default function StaffDemo() {
  const { lang, setLang, t } = useStaffLang();
  const [tick, setTick] = useState(0);
  // Parametry URL do zrzutów: ?station=s-au-2&view=list&filter=done&q=12&open=10&offline=1&lang=en
  const initial = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return { station: p.get("station") || null, view: p.get("view") || null, filter: p.get("filter") || null, query: p.get("q") || "", openNr: p.get("open") || null, offline: p.get("offline") === "1", lang: p.get("lang") || null };
  }, []);
  useEffect(() => { if (initial.lang) setLang(initial.lang); }, [initial.lang, setLang]);
  const db = useMemo(() => ({ ...fixture(), listeners: new Set(), offline: initial.offline }), [initial.offline]);
  const api = useMemo(() => makeDemoApi(db, () => { db.listeners.forEach(cb => cb()); setTick(x => x + 1); }), [db]);
  const user = { id: "demo-staff", email: "obsluga-3@obsluga.freshmarket.eu" };
  const profile = { name: "OBSLUGA-3 (DEMO)" };
  // Pasek podglądu: tryb offline do zrzutu „dane mogą być nieaktualne”
  return (
    <div>
      <div style={{ background: "#7c2d12", color: "white", fontSize: 12, padding: "4px 12px", display: "flex", gap: 14, alignItems: "center", fontFamily: "system-ui, sans-serif" }}>
        <b>DEMO · dane testowe w pamięci (tylko DEV)</b>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" defaultChecked={initial.offline} onChange={e => { db.offline = e.target.checked; setTick(x => x + 1); }} data-testid="demo-offline" /> symuluj brak połączenia (lista)
        </label>
        <span style={{ opacity: 0.7 }}>zmiany: {tick}</span>
      </div>
      <Operator user={user} profile={profile} signOut={() => {}} isAdmin={false} lang={lang} setLang={setLang} t={t} api={api} initial={initial} />
    </div>
  );
}
