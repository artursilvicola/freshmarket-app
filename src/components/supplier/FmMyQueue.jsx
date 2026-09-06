// [feat/fm-queue] Dostawca → „Twoje spotkania B2B” → „Twoja kolej” (dzień eventu).
// Własne spotkania z fm_queue_meetings (RLS: company_id = app_company_id()) +
// publiczny snapshot tablicy (bez nazw innych firm). Polling — bez Realtime na telefonach.
import { useEffect, useMemo, useState } from "react";
import { listMyFmQueueMeetings } from "../../lib/fm-queue";

const SNAP_MS = 8000, MINE_MS = 20000;

const TXT = {
  pl: {
    title: "Twoja kolej — na żywo", sub: "Numery na tablicy odświeżają się automatycznie. Podejdź do stanowiska, gdy Twój numer jest wywołany.",
    yourNr: "Twój numer", now: "TERAZ przy stanowisku", ahead: (n) => `przed Tobą ok. ${n} ${n === 1 ? "numer" : n < 5 ? "numery" : "numerów"}`,
    your_turn: "TWOJA KOLEJ — podejdź do stanowiska", in_progress: "spotkanie trwa", done: "zakończone", no_show: "nieobecność — zgłoś się do obsługi przy stanowisku",
    returned: "zgłoszono powrót — czekaj przy stanowisku, obsługa Cię wpuści", skipped: "pominięte", cancelled: "anulowane",
    closed: "stanowisko jeszcze nieotwarte", paused: "przerwa na stanowisku", free: "wolne wejście — podejdź bez numeru", gate: "GATE", board: "Tablica na telefonie ↗", offline: "Brak połączenia — dane mogą być nieaktualne",
  },
  en: {
    title: "Your turn — live", sub: "Board numbers refresh automatically. Go to the desk when your number is called.",
    yourNr: "Your number", now: "NOW at the desk", ahead: (n) => `about ${n} ${n === 1 ? "number" : "numbers"} ahead of you`,
    your_turn: "YOUR TURN — go to the desk", in_progress: "meeting in progress", done: "finished", no_show: "no-show — please see the staff at the desk",
    returned: "return registered — wait at the desk, staff will let you in", skipped: "skipped", cancelled: "cancelled",
    closed: "desk not open yet", paused: "desk on a break", free: "walk-in — approach without a number", gate: "GATE", board: "Board on your phone ↗", offline: "Connection lost — data may be outdated",
  },
};

export default function FmMyQueue({ lang }) {
  const t = TXT[String(lang || "pl").startsWith("pl") ? "pl" : "en"];
  const [mine, setMine] = useState(null);
  const [snap, setSnap] = useState(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const loadMine = () => listMyFmQueueMeetings().then(r => alive && setMine(r)).catch(() => alive && setMine([]));
    const loadSnap = async () => {
      try {
        const r = await fetch("/.netlify/functions/fm-queue-snapshot", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = await r.json(); if (alive) { setSnap(j); setStale(false); }
      } catch { if (alive) setStale(true); }
    };
    loadMine(); loadSnap();
    const a = setInterval(loadMine, MINE_MS), b = setInterval(loadSnap, SNAP_MS);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, []);

  const groups = useMemo(() => {
    const m = {};
    for (const s of snap?.stations || []) {
      const g = (m[s.group_id] ||= { ...s, stations: [] });
      g.stations.push(s);
      g.anyOpen = g.anyOpen || s.mode === "open";
      g.anyFree = g.anyFree || s.mode === "free_entry";
      g.anyPaused = g.anyPaused || s.mode === "paused";
    }
    return m;
  }, [snap]);

  if (!mine || mine.length === 0) return null; // przed importem planu nic nie pokazujemy

  return (
    <section style={{ background: "#0f172a", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#f8fafc" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{t.title}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.sub}</div>
        <a href="/tablica" target="_blank" rel="noreferrer" style={{ marginLeft: "auto", color: "#5eead4", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>{t.board}</a>
      </div>
      {stale && <div style={{ marginTop: 8, color: "#fca5a5", fontSize: 12, fontWeight: 700 }}>{t.offline}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 12 }}>
        {[...mine].sort((a, b) => a.nr - b.nr).map(m => {
          const g = groups[m.queue_group_id];
          const last = g?.last_called_nr ?? 0;
          let status, tone = "#94a3b8";
          if (m.status === "called") { status = t.your_turn; tone = "#fbbf24"; }
          else if (m.status === "in_progress" || m.status === "returned_in_progress") { status = t.in_progress; tone = "#4ade80"; }
          else if (m.status === "done") status = t.done;
          else if (m.status === "no_show") { status = t.no_show; tone = "#fca5a5"; }
          else if (m.status === "returned_waiting") { status = t.returned; tone = "#93c5fd"; }
          else if (m.status === "skipped") status = t.skipped;
          else if (m.status === "cancelled") status = t.cancelled;
          else if (!g) status = t.closed;
          else if (g.anyFree && !g.anyOpen) { status = t.free; tone = "#93c5fd"; }
          else if (!g.anyOpen) status = g.anyPaused ? t.paused : t.closed;
          else { const ahead = Math.max(0, m.nr - last - 1); status = ahead === 0 ? t.your_turn : t.ahead(ahead); tone = ahead <= 2 ? "#fbbf24" : "#e2e8f0"; }
          return (
            <div key={m.id} style={{ background: "#1e293b", borderRadius: 12, padding: "12px 14px", border: `1.5px solid ${m.status === "called" ? "#fbbf24" : "#334155"}` }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{g ? `${g.retailer_name}${g.group_label ? ` · ${g.group_label}` : ""}` : "—"}{g?.gate ? <span style={{ marginLeft: 8, fontSize: 11, color: "#fbbf24" }}>{t.gate} {g.gate}</span> : null}</div>
              <div style={{ display: "flex", gap: 18, alignItems: "baseline", marginTop: 6 }}>
                <div><div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#94a3b8" }}>{t.yourNr.toUpperCase()}</div><div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{m.nr}</div></div>
                <div><div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#94a3b8" }}>{t.now.toUpperCase()}</div><div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "#4ade80" }}>{g?.anyOpen && last ? last : "—"}</div></div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: tone }}>{status}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
