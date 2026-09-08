// [feat/fm-queue] Dostawca → „Twoje spotkania B2B” → „Twoja kolej” (dzień eventu).
// Własne spotkania z fm_queue_meetings (RLS: company_id = app_company_id()) +
// publiczny snapshot tablicy (bez nazw innych firm). Polling — bez Realtime na telefonach.
// [fix/fm-queue-day-scoping] Karta jest ZWIĄZANA Z DNIEM PRODUKCYJNYM (`eventDate` = fm_settings.event_date):
// spotkania i snapshot tylko z tego dnia — próba generalna na kopii planu (21–22.09) nie trafia do
// uczestników. „PODEJDŹ” tylko po faktycznym wywołaniu; następny w kolejce widzi „przygotuj się”.
import { useEffect, useMemo, useState } from "react";
import { listMyFmQueueMeetings } from "../../lib/fm-queue";
import { groupsFromSnapshot, meetingStatusKey, nowNumbers } from "./fmMyQueueStatus";

const SNAP_MS = 8000, MINE_MS = 20000;

const TXT = {
  pl: {
    title: "Twoja kolej — na żywo", sub: "Numery na tablicy odświeżają się automatycznie. Podejdź do stanowiska, gdy Twój numer zostanie wywołany.",
    yourNr: "Twój numer", now: "TERAZ przy stanowisku", ahead: (n) => `przed Tobą ok. ${n} ${n === 1 ? "numer" : n < 5 ? "numery" : "numerów"}`,
    next_up: "JESTEŚ NASTĘPNY — przygotuj się, podejdź po wywołaniu", your_turn: "TWOJA KOLEJ — podejdź do stanowiska",
    in_progress: "spotkanie trwa", done: "zakończone", no_show: "nieobecność — zgłoś się do obsługi przy stanowisku",
    returned: "zgłoszono powrót — czekaj przy stanowisku, obsługa Cię wpuści", skipped: "pominięte", cancelled: "anulowane",
    closed: "stanowisko jeszcze nieotwarte", paused: "przerwa na stanowisku", free: "wolne wejście — podejdź bez numeru", gate: "GATE", board: "Tablica na telefonie ↗", offline: "Brak połączenia — dane mogą być nieaktualne",
  },
  en: {
    title: "Your turn — live", sub: "Board numbers refresh automatically. Go to the desk when your number is called.",
    yourNr: "Your number", now: "NOW at the desk", ahead: (n) => `about ${n} ${n === 1 ? "number" : "numbers"} ahead of you`,
    next_up: "YOU ARE NEXT — get ready, go to the desk once called", your_turn: "YOUR TURN — go to the desk",
    in_progress: "meeting in progress", done: "finished", no_show: "no-show — please see the staff at the desk",
    returned: "return registered — wait at the desk, staff will let you in", skipped: "skipped", cancelled: "cancelled",
    closed: "desk not open yet", paused: "desk on a break", free: "walk-in — approach without a number", gate: "GATE", board: "Board on your phone ↗", offline: "Connection lost — data may be outdated",
  },
};

const TONE = { your_turn: "#fbbf24", next_up: "#fde68a", in_progress: "#4ade80", no_show: "#fca5a5", returned: "#93c5fd", free: "#93c5fd" };

export default function FmMyQueue({ lang, eventDate }) {
  const t = TXT[String(lang || "pl").startsWith("pl") ? "pl" : "en"];
  const [mine, setMine] = useState(null);
  const [snap, setSnap] = useState(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!eventDate) return undefined;               // bez znanej daty produkcyjnej nie pokazujemy niczego
    let alive = true;
    const loadMine = () => listMyFmQueueMeetings(eventDate).then(r => alive && setMine(r)).catch(() => alive && setMine([]));
    const loadSnap = async () => {
      try {
        const r = await fetch(`/.netlify/functions/fm-queue-snapshot?date=${encodeURIComponent(eventDate)}`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = await r.json(); if (alive) { setSnap(j); setStale(false); }
      } catch { if (alive) setStale(true); }
    };
    loadMine(); loadSnap();
    const a = setInterval(loadMine, MINE_MS), b = setInterval(loadSnap, SNAP_MS);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [eventDate]);

  const groups = useMemo(() => groupsFromSnapshot(snap?.stations), [snap]);

  if (!eventDate || !mine || mine.length === 0) return null; // przed importem planu nic nie pokazujemy

  return (
    <section style={{ background: "#0f172a", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#f8fafc" }} data-testid="fm-my-queue">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{t.title}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.sub}</div>
        <a href={`/tablice?date=${encodeURIComponent(eventDate)}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", color: "#5eead4", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>{t.board}</a>
      </div>
      {stale && <div style={{ marginTop: 8, color: "#fca5a5", fontSize: 12, fontWeight: 700 }}>{t.offline}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 12 }}>
        {[...mine].sort((a, b) => a.nr - b.nr).map(m => {
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
