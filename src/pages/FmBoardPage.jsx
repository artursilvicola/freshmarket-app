// [feat/fm-queue] /tablica — publiczna tablica numerków (rzutnik 1024×768 + telefony).
// Dane: WYŁĄCZNIE publiczny snapshot (bez nazw firm): /.netlify/functions/fm-queue-snapshot
// (CDN cache 5 s) z fallbackiem na RPC fm_queue_public_snapshot przez anon.
// Parametry URL: ?gate=1|2  ?rotate=9 (s)  ?perPage=12  ?page=N (bez rotacji)  ?date=YYYY-MM-DD
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { MODE_LABEL, splitPages } from "../staff/staffUi";

const POLL_MS = 5000;

export default function FmBoardPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const gateFilter = params.get("gate") ? Number(params.get("gate")) : null;
  const fixedPage = params.get("page") ? Math.max(1, Number(params.get("page"))) : null;
  const dateParam = params.get("date");
  const [snap, setSnap] = useState(null);
  const [stale, setStale] = useState(false);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(new Date());
  const lastOk = useRef(0);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 760;

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const u = `/.netlify/functions/fm-queue-snapshot${dateParam ? `?date=${encodeURIComponent(dateParam)}` : ""}`;
        const r = await fetch(u, { cache: "no-store" });
        if (!r.ok) throw new Error("snapshot http " + r.status);
        const j = await r.json();
        if (!alive) return;
        setSnap(j); lastOk.current = Date.now(); setStale(false);
      } catch {
        try {
          const { data, error } = await supabase.rpc("fm_queue_public_snapshot", { p_event_date: dateParam || null });
          if (error) throw error;
          if (!alive) return;
          setSnap(data); lastOk.current = Date.now(); setStale(false);
        } catch {
          if (alive && Date.now() - lastOk.current > 20_000) setStale(true);
        }
      }
    }
    load();
    const t = setInterval(load, POLL_MS);
    const c = setInterval(() => setNow(new Date()), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(c); };
  }, [dateParam]);

  const rotateS = Number(params.get("rotate")) || snap?.settings?.rotation_s || 9;
  const perPage = Number(params.get("perPage")) || snap?.settings?.per_page || 12;
  const pinned = new Set(snap?.settings?.pinned || []);

  const rows = useMemo(() => {
    const st = (snap?.stations || []).filter(s => s.group_active && s.station_active);
    const list = gateFilter ? st.filter(s => s.gate === gateFilter) : st;
    return list.sort((a, b) =>
      (pinned.has(b.group_id) - pinned.has(a.group_id)) ||
      ((a.gate ?? 9) - (b.gate ?? 9)) ||
      a.retailer_name.localeCompare(b.retailer_name, "pl") ||
      String(a.group_label || "").localeCompare(String(b.group_label || ""), "pl") ||
      (a.station_idx - b.station_idx));
  }, [snap, gateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = useMemo(() => (isMobile ? [rows] : splitPages(rows, perPage)), [rows, perPage, isMobile]);
  useEffect(() => {
    if (isMobile || fixedPage || pages.length <= 1) return;
    const t = setInterval(() => setPage(p => (p + 1) % pages.length), Math.max(3, rotateS) * 1000);
    return () => clearInterval(t);
  }, [pages.length, rotateS, fixedPage, isMobile]);
  const pageIdx = fixedPage ? Math.min(fixedPage - 1, pages.length - 1) : Math.min(page, pages.length - 1);
  const shown = pages[pageIdx] || [];
  const closedAll = Boolean(snap?.settings?.closed_all_at);

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", color: "#f8fafc", fontFamily: "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 18, padding: isMobile ? "12px 14px" : "14px 28px", borderBottom: "2px solid #1e293b" }}>
        <div style={{ fontWeight: 900, fontSize: isMobile ? 18 : 26, letterSpacing: "0.06em" }}>FRESH MARKET 2026</div>
        <div style={{ fontSize: isMobile ? 13 : 18, color: "#94a3b8" }}>Spotkania B2B · B2B meetings{gateFilter ? ` · GATE ${gateFilter}` : ""}</div>
        <div style={{ marginLeft: "auto", fontSize: isMobile ? 18 : 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </header>

      {stale && <div style={{ background: "#7f1d1d", color: "white", textAlign: "center", padding: 8, fontWeight: 700 }}>Brak połączenia — dane mogą być nieaktualne / Connection lost — data may be outdated</div>}
      {closedAll && rows.length > 0 && <div style={{ background: "#1e293b", color: "#e2e8f0", textAlign: "center", padding: 10, fontWeight: 700, fontSize: isMobile ? 14 : 20 }}>Spotkania B2B zakończone — dziękujemy! · B2B meetings are over — thank you!</div>}

      <main style={{ flex: 1, padding: isMobile ? "10px 12px" : "16px 28px", display: "flex", flexDirection: "column" }}>
        {!snap && <div style={{ color: "#94a3b8", fontSize: 22, padding: 40, textAlign: "center" }}>Ładowanie… / Loading…</div>}
        {snap && rows.length === 0 && <div style={{ color: "#94a3b8", fontSize: 22, padding: 40, textAlign: "center" }}>Tablica jeszcze nieaktywna · Board not active yet</div>}
        {rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 8 : "10px 26px", alignContent: "start" }}>
            <ColHead isMobile={isMobile} />
            {!isMobile && <ColHead isMobile={isMobile} />}
            {shown.map((s, i) => <BoardRow key={s.station_id} s={s} isMobile={isMobile} showGate={!gateFilter && (i === 0 || shown[i - 1].gate !== s.gate)} />)}
          </div>
        )}
      </main>

      <footer style={{ display: "flex", alignItems: "center", gap: 16, padding: isMobile ? "8px 14px" : "10px 28px", borderTop: "2px solid #1e293b", color: "#94a3b8", fontSize: isMobile ? 12 : 16 }}>
        <span><b style={{ color: "#f8fafc" }}>TERAZ / NOW</b> = numer przy stanowisku · number at the desk</span>
        <span><b style={{ color: "#f8fafc" }}>NASTĘPNY / NEXT</b> = przygotuj się · get ready</span>
        {pages.length > 1 && !isMobile && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {pages.map((_, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 999, background: i === pageIdx ? "#f8fafc" : "#334155" }} />)}
            <span style={{ marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>{pageIdx + 1}/{pages.length}</span>
          </span>
        )}
      </footer>
    </div>
  );
}

function ColHead({ isMobile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 72px 64px" : "1fr 130px 110px 150px", gap: 10, fontSize: isMobile ? 11 : 13, letterSpacing: "0.12em", color: "#64748b", fontWeight: 800, padding: "0 6px" }}>
      <div>SIEĆ · RETAILER</div><div style={{ textAlign: "center" }}>TERAZ<br />NOW</div><div style={{ textAlign: "center" }}>NASTĘPNY<br />NEXT</div>{!isMobile && <div style={{ textAlign: "center" }}>STATUS</div>}
    </div>
  );
}

function BoardRow({ s, isMobile, showGate }) {
  const ml = MODE_LABEL[s.mode] || MODE_LABEL.closed;
  const open = s.mode === "open";
  const nowNr = open && s.current_nr ? s.current_nr : null;
  const nextNr = open ? s.next_nr : null;
  const name = `${s.retailer_name}${s.group_label ? ` · ${s.group_label}` : ""}`;
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 72px 64px" : "1fr 130px 110px 150px", gap: 10, alignItems: "center", background: open ? "#0f172a" : "#0b1120", border: `1.5px solid ${open ? "#1e3a8a" : "#1e293b"}`, borderRadius: 14, padding: isMobile ? "8px 10px" : "8px 12px", minHeight: isMobile ? 56 : 68 }}>
      <div style={{ minWidth: 0 }}>
        {showGate && s.gate && <div style={{ fontSize: 11, color: "#fbbf24", fontWeight: 800, letterSpacing: "0.12em" }}>GATE {s.gate}</div>}
        <div style={{ fontSize: isMobile ? 16 : 22, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: open ? "#f8fafc" : "#94a3b8" }}>{name}</div>
        {s.station_label && <div style={{ fontSize: 12, color: "#64748b" }}>{s.station_label}</div>}
      </div>
      <div style={{ textAlign: "center", fontSize: isMobile ? 34 : 54, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: nowNr ? "#4ade80" : "#334155" }}>{nowNr ?? "—"}</div>
      <div style={{ textAlign: "center", fontSize: isMobile ? 24 : 36, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: nextNr ? "#fbbf24" : "#334155" }}>{nextNr ?? "—"}</div>
      {!isMobile && (
        <div style={{ textAlign: "center" }}>
          <span style={{ display: "inline-block", padding: "5px 10px", borderRadius: 999, background: open ? "rgba(74,222,128,0.15)" : s.mode === "free_entry" ? "rgba(96,165,250,0.18)" : s.mode === "paused" ? "rgba(251,191,36,0.18)" : "#1e293b", color: open ? "#4ade80" : s.mode === "free_entry" ? "#93c5fd" : s.mode === "paused" ? "#fbbf24" : "#94a3b8", fontWeight: 800, fontSize: 12, letterSpacing: "0.06em" }}>
            {ml.pl} / {ml.en}
          </span>
        </div>
      )}
    </div>
  );
}
