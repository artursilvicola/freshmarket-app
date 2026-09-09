// [feat/fm-queue] Dostawca → „Twoje spotkania B2B” → „Twoja kolej” (dzień eventu).
// Własne spotkania z fm_queue_meetings (RLS: company_id = app_company_id()) +
// publiczny snapshot tablicy (bez nazw innych firm). Polling — bez Realtime na telefonach.
// [fix/fm-queue-day-scoping] Karta jest ZWIĄZANA Z DNIEM PRODUKCYJNYM (`eventDate` = fm_settings.event_date):
// spotkania i snapshot tylko z tego dnia — próba generalna na kopii planu (21–22.09) nie trafia do
// uczestników. „PODEJDŹ” tylko po faktycznym wywołaniu; następny w kolejce widzi „przygotuj się”.
// [review release 9.09] Oba odczyty mają ZAKRES DATY + generację (zmiana daty natychmiast chowa
// poprzedni numer), osobne sekwencje (starsza odpowiedź nigdy nie przywraca „podejdź” po „zakończone”),
// limit czasu 10 s, brak równoległych odczytów tego samego źródła i ostrzeżenie o nieaktualności
// z wieku danych obu źródeł — sukces snapshotu nie maskuje wiszącego odczytu spotkań.
import { useEffect, useMemo, useRef, useState } from "react";
import { listMyFmQueueMeetings } from "../../lib/fm-queue";
import { LIST_TIMEOUT_MS, isDataStale, withReadTimeout } from "../../lib/fm-read";
import { groupsFromSnapshot, meetingStatusKey, nowNumbers } from "./fmMyQueueStatus";

export const SNAP_MS = 8000, MINE_MS = 20000;
const EMPTY = { date: null, rows: null, at: null, error: false };

const TXT = {
  pl: {
    title: "Twoja kolej — na żywo", sub: "Numery na tablicy odświeżają się automatycznie. Podejdź do stanowiska, gdy Twój numer zostanie wywołany.",
    yourNr: "Twój numer", now: "TERAZ przy stanowisku", ahead: (n) => `przed Tobą ok. ${n} ${n === 1 ? "numer" : n < 5 ? "numery" : "numerów"}`,
    next_up: "JESTEŚ NASTĘPNY — przygotuj się, podejdź po wywołaniu", your_turn: "TWOJA KOLEJ — podejdź do stanowiska",
    in_progress: "spotkanie trwa", done: "zakończone", no_show: "nieobecność — zgłoś się do obsługi przy stanowisku",
    returned: "zgłoszono powrót — czekaj przy stanowisku, obsługa Cię wpuści", skipped: "pominięte", cancelled: "anulowane",
    closed: "stanowisko jeszcze nieotwarte", closing: "kolejka zamykana — trwa ostatnie spotkanie, nowe numery nie będą wywoływane; zgłoś się do obsługi",
    paused: "przerwa na stanowisku", free: "wolne wejście — podejdź bez numeru", gate: "GATE", board: "Tablica na telefonie ↗",
    offline: "Dane mogą być nieaktualne — sprawdź tablicę przy stanowisku",
  },
  en: {
    title: "Your turn — live", sub: "Board numbers refresh automatically. Go to the desk when your number is called.",
    yourNr: "Your number", now: "NOW at the desk", ahead: (n) => `about ${n} ${n === 1 ? "number" : "numbers"} ahead of you`,
    next_up: "YOU ARE NEXT — get ready, go to the desk once called", your_turn: "YOUR TURN — go to the desk",
    in_progress: "meeting in progress", done: "finished", no_show: "no-show — please see the staff at the desk",
    returned: "return registered — wait at the desk, staff will let you in", skipped: "skipped", cancelled: "cancelled",
    closed: "desk not open yet", closing: "queue closing — last meeting in progress, no new numbers will be called; please see the staff",
    paused: "desk on a break", free: "walk-in — approach without a number", gate: "GATE", board: "Board on your phone ↗",
    offline: "Data may be outdated — check the board at the desk",
  },
};

const TONE = { your_turn: "#fbbf24", next_up: "#fde68a", in_progress: "#4ade80", no_show: "#fca5a5", returned: "#93c5fd", free: "#93c5fd", closing: "#fca5a5" };

export default function FmMyQueue({ lang, eventDate }) {
  const t = TXT[String(lang || "pl").startsWith("pl") ? "pl" : "en"];
  const [mine, setMine] = useState(EMPTY);   // { date, rows, at, error }
  const [snap, setSnap] = useState(EMPTY);   // { date, rows: snapshot, at, error }
  const [, setTick] = useState(0);
  const genRef = useRef(0);
  const seq = useRef({ mine: 0, snap: 0 });
  const applied = useRef({ mine: 0, snap: 0 });
  const inflight = useRef({ mine: false, snap: false });

  useEffect(() => {
    if (!eventDate) return undefined;               // bez znanej daty produkcyjnej nie pokazujemy niczego
    const gen = ++genRef.current;
    seq.current = { mine: 0, snap: 0 }; applied.current = { mine: 0, snap: 0 }; inflight.current = { mine: false, snap: false };
    setMine({ ...EMPTY, date: eventDate });
    setSnap({ ...EMPTY, date: eventDate });
    const live = () => gen === genRef.current;
    // Jeden odczyt na źródło naraz; spóźniona odpowiedź (starsza sekwencja albo inna data/generacja)
    // nigdy nie nadpisuje nowszej.
    const read = async (source, fetcher, setScope) => {
      if (inflight.current[source]) return;
      const n = ++seq.current[source];
      inflight.current[source] = true;
      let rows = null, failed = false;
      try { rows = await withReadTimeout(fetcher(), LIST_TIMEOUT_MS); } catch { failed = true; }
      if (!live()) return;
      inflight.current[source] = false;
      if (n <= applied.current[source]) return;
      applied.current[source] = n;
      setScope(prev => (failed
        ? { ...(prev.date === eventDate ? prev : { ...EMPTY, date: eventDate }), date: eventDate, error: true }
        : { date: eventDate, rows, at: Date.now(), error: false }));
    };
    const loadMine = () => read("mine", () => listMyFmQueueMeetings(eventDate), setMine);
    const loadSnap = () => read("snap", async () => {
      const r = await fetch(`/.netlify/functions/fm-queue-snapshot?date=${encodeURIComponent(eventDate)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`snapshot ${r.status}`);
      return r.json();
    }, setSnap);
    loadMine(); loadSnap();
    const a = setInterval(loadMine, MINE_MS), b = setInterval(loadSnap, SNAP_MS), c = setInterval(() => setTick(x => x + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [eventDate]);

  // Render TYLKO z danych bieżącej daty — po zmianie daty poprzedni numer znika natychmiast.
  const mineRows = mine.date === eventDate ? mine.rows : null;
  const snapData = snap.date === eventDate ? snap.rows : null;
  const groups = useMemo(() => groupsFromSnapshot(snapData?.stations, snapData?.settings), [snapData]);
  const stale = (mine.date === eventDate && (mine.error || isDataStale(mine.at)))
    || (snap.date === eventDate && (snap.error || isDataStale(snap.at)));

  if (!eventDate || !mineRows || mineRows.length === 0) return null; // przed importem planu nic nie pokazujemy

  return (
    <section style={{ background: "#0f172a", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#f8fafc" }} data-testid="fm-my-queue" data-date={eventDate}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{t.title}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.sub}</div>
        <a href={`/tablice?date=${encodeURIComponent(eventDate)}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", color: "#5eead4", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>{t.board}</a>
      </div>
      {stale && <div data-testid="my-queue-stale" style={{ marginTop: 8, color: "#fca5a5", fontSize: 12, fontWeight: 700 }}>{t.offline}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 12 }}>
        {[...mineRows].sort((a, b) => a.nr - b.nr).map(m => {
          const g = groups[m.queue_group_id];
          const { key, n } = meetingStatusKey(m, g);
          const status = key === "ahead" ? t.ahead(n) : t[key];
          const tone = TONE[key] || (key === "ahead" && n <= 2 ? "#fbbf24" : key === "ahead" ? "#e2e8f0" : "#94a3b8");
          const now = nowNumbers(g);
          return (
            <div key={m.id} data-testid={`my-meeting-${m.nr}`} style={{ background: "#1e293b", borderRadius: 12, padding: "12px 14px", border: `1.5px solid ${m.status === "called" ? "#fbbf24" : "#334155"}` }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{g ? `${g.retailer_name}${g.group_label ? ` · ${g.group_label}` : ""}` : "—"}{g?.gate ? <span style={{ marginLeft: 8, fontSize: 11, color: "#fbbf24" }}>{t.gate} {g.gate}</span> : null}</div>
              <div style={{ display: "flex", gap: 18, alignItems: "baseline", marginTop: 6 }}>
                <div><div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#94a3b8" }}>{t.yourNr.toUpperCase()}</div><div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{m.nr}</div></div>
                <div><div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#94a3b8" }}>{t.now.toUpperCase()}</div><div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "#4ade80" }}>{now.length ? now.join(" · ") : "—"}</div></div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: tone }} data-status={key}>{status}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
