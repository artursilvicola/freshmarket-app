// [feat/fm-queue] Admin → Spotkania B2B → „Dzień wydarzenia”.
// Konfiguracja grup/stanowisk (pojemność algorytmu), konta obsługi (kod + PIN),
// przypisania, Otwórz dzień (import planu), podgląd na żywo, ustawienia tablicy, log.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import {
  deleteFmQueueGroup, deleteFmStation, fmQueueRpc, getFmQueueSettings, listFmQueueGroups, listFmQueueLog, listFmStaff,
  saveFmQueueSettings, subscribeFmQueue, updateFmStaff, upsertFmQueueGroup, upsertFmStation,
} from "../../lib/fm-queue";
import { FM_MEETINGS_PER_STATION } from "../../lib/fm-algo";
import { MODE_LABEL, humanFmError } from "../../staff/staffUi";

const T = "#0d9488";

async function adminStaffCall(body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Brak sesji admina.");
  const r = await fetch("/.netlify/functions/admin-staff", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export default function FmEventDay({ retailers, eventDate: eventDateProp, onQueueConfigChanged }) {
  // Kontami obsługi (tworzenie/PIN/blokada/usunięcie) zarządza TYLKO super admin — funkcja
  // admin-staff sprawdza to po stronie serwera; UI tylko chowa przyciski.
  const { profile } = useAuth();
  const isSuper = Boolean(profile?.is_super_admin);
  const [eventDate, setEventDate] = useState(eventDateProp || "2026-09-24");
  const [sub, setSub] = useState("stanowiska");
  const [groups, setGroups] = useState([]);
  const [staff, setStaff] = useState([]);
  const [settings, setSettings] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState(null); // {tone, text}
  const [busy, setBusy] = useState(false);
  const [pinModal, setPinModal] = useState(null); // {code, pin}
  const [dayReport, setDayReport] = useState(null);
  const [dbMissing, setDbMissing] = useState(false);

  const say = (text, tone = "ok") => { setMsg({ text, tone }); setTimeout(() => setMsg(m => (m?.text === text ? null : m)), 6000); };
  const fmRetailers = useMemo(() => (retailers || []).filter(r => r.fm26Active && r.fm26ChainId).sort((a, b) => a.name.localeCompare(b.name, "pl")), [retailers]);

  const reload = useCallback(async () => {
    try {
      const [g, s, st] = await Promise.all([listFmQueueGroups(eventDate), listFmStaff(eventDate), getFmQueueSettings(eventDate)]);
      setGroups(g); setStaff(s); setSettings(st);
      // brak tabel = migracja 053 nie zaaplikowana
      const probe = await supabase.from("fm_queue_groups").select("id").limit(1);
      setDbMissing(Boolean(probe.error && /does not exist|schema cache/i.test(probe.error.message || "")));
      onQueueConfigChanged?.();
    } catch (e) { say(humanFmError(e), "error"); }
  }, [eventDate, onQueueConfigChanged]);
  const reloadLive = useCallback(async () => {
    try { setSnapshot(await fmQueueRpc.publicSnapshot(eventDate)); } catch { /* przed migracją */ }
  }, [eventDate]);

  useEffect(() => { reload(); reloadLive(); }, [reload, reloadLive]);
  useEffect(() => {
    if (sub !== "live") return;
    const unsub = subscribeFmQueue(() => reloadLive());
    const t = setInterval(reloadLive, 5000);
    return () => { unsub(); clearInterval(t); };
  }, [sub, reloadLive]);
  useEffect(() => { if (sub === "log") listFmQueueLog(eventDate, 300).then(setLog).catch(() => {}); }, [sub, eventDate]);

  const run = async (fn, okText) => {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); if (okText) say(typeof okText === "function" ? okText(r) : okText); await reload(); await reloadLive(); return r; }
    catch (e) { say(humanFmError(e), "error"); }
    finally { setBusy(false); }
  };

  // ── stanowiska ──
  const groupsByRetailer = useMemo(() => {
    const m = {};
    for (const g of groups) (m[g.retailer_id] ||= []).push(g);
    return m;
  }, [groups]);
  const capacityOf = (rid) => (groupsByRetailer[rid] || []).filter(g => g.active).reduce((s, g) => s + g.fm_stations.filter(x => x.active).length * g.meetings_per_station, 0);
  const stationsOf = (rid) => (groupsByRetailer[rid] || []).filter(g => g.active).reduce((s, g) => s + g.fm_stations.filter(x => x.active).length, 0);

  async function createMissingGroups() {
    await run(async () => {
      let n = 0;
      for (const r of fmRetailers) {
        if (groupsByRetailer[r.id]?.length) continue;
        const g = await upsertFmQueueGroup({ event_date: eventDate, retailer_id: r.id, gate: r.fmGate ?? r.fm_gate ?? null, meetings_per_station: FM_MEETINGS_PER_STATION });
        await upsertFmStation({ queue_group_id: g.id, idx: 1 });
        n++;
      }
      return n;
    }, (n) => `Utworzono ${n} grup (po 1 stanowisku).`);
  }
  const patchGroup = (g, patch) => run(() => upsertFmQueueGroup({ id: g.id, ...patch }));
  const addStation = (g) => run(() => upsertFmStation({ queue_group_id: g.id, idx: Math.max(0, ...g.fm_stations.map(s => s.idx)) + 1 }));
  const addSplit = (r) => {
    const label = window.prompt(`Nowa grupa (osobna kolejka) dla ${r.name} — etykieta, np. "Kwiaty":`);
    if (!label) return;
    const cats = window.prompt("Kategorie firm kierowane do tej grupy (po przecinku, np. kwiaty):", "") || "";
    run(async () => {
      const g = await upsertFmQueueGroup({ event_date: eventDate, retailer_id: r.id, label: label.trim(), categories: cats.split(",").map(s => s.trim()).filter(Boolean), gate: r.fmGate ?? null, meetings_per_station: FM_MEETINGS_PER_STATION });
      await upsertFmStation({ queue_group_id: g.id, idx: 1 });
    }, "Dodano grupę.");
  };

  // ── obsługa ──
  const [newStaff, setNewStaff] = useState({ code: "", display_name: "" });
  async function createStaff() {
    const code = newStaff.code.trim().toUpperCase();
    if (code.length < 3) { say("Kod: min. 3 znaki.", "error"); return; }
    await run(async () => {
      const j = await adminStaffCall({ action: "create", code, display_name: newStaff.display_name.trim() || null, event_date: eventDate });
      setPinModal({ code: j.code, pin: j.pin });
      setNewStaff({ code: "", display_name: "" });
    });
  }
  const staffAction = (row, action) => run(async () => {
    if (action === "delete" && !window.confirm(`Usunąć konto ${row.code}? Operacja nieodwracalna.`)) return;
    const j = await adminStaffCall({ action, id: row.id });
    if (j.pin) setPinModal({ code: j.code, pin: j.pin });
  }, action === "reset_pin" ? null : "Zapisano.");
  const assignedRetailers = (row) => {
    const gids = new Set((row.fm_queue_assignments || []).map(a => a.queue_group_id));
    return new Set(groups.filter(g => gids.has(g.id)).map(g => g.retailer_id));
  };

  const retailerName = (rid) => (retailers || []).find(r => r.id === rid)?.name || `#${rid}`;

  return (
    <div style={{ fontSize: 12.5, color: "#1e293b" }}>
      {dbMissing && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", marginBottom: 12, color: "#991b1b" }}>
          Tabele modułu kolejek nie istnieją — migracje <code>052_staff_role.sql</code> i <code>053_fm_queue.sql</code> nie są jeszcze zaaplikowane (po review bezpieczeństwa).
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label>Data eventu <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} style={inp} /></label>
        <div style={{ display: "flex", gap: 0, background: "#f1f5f9", borderRadius: 8, padding: 3 }}>
          {[["stanowiska", "Stanowiska"], ["obsluga", "Obsługa"], ["live", "Na żywo"], ["ustawienia", "Tablica i dzień"], ["log", "Log"]].map(([k, l]) => (
            <button key={k} onClick={() => setSub(k)} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: sub === k ? "white" : "transparent", fontWeight: sub === k ? 700 : 500, cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: sub === k ? "#1e293b" : "#64748b" }}>{l}</button>
          ))}
        </div>
        {msg && <span style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 8, background: msg.tone === "error" ? "#fef2f2" : "#ecfdf5", color: msg.tone === "error" ? "#991b1b" : "#065f46", fontWeight: 600 }}>{msg.text}</span>}
      </div>

      {sub === "stanowiska" && (
        <div>
          <p style={{ color: "#64748b", margin: "0 0 10px", lineHeight: 1.5 }}>
            Pojemność sieci w algorytmie = <b>spotkania/stanowisko × aktywne stanowiska</b> (domyślnie {FM_MEETINGS_PER_STATION}/stanowisko: 1 stanowisko → {FM_MEETINGS_PER_STATION}, 2 równoległe → {2 * FM_MEETINGS_PER_STATION}). Sieć bez konfiguracji liczona jest jako 1 stanowisko i dostaje ostrzeżenie w planie; plan ponad pojemność → ostrzeżenie „pojemność wyczerpana” przed zatwierdzeniem.
            Osobna grupa (np. Dino · Kwiaty) = osobna kolejka i numeracja; kilka stanowisk w jednej grupie = wspólna kolejka (Auchan ×2).
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Btn onClick={createMissingGroups} disabled={busy || dbMissing}>Utwórz grupy dla sieci FM bez konfiguracji ({fmRetailers.filter(r => !groupsByRetailer[r.id]?.length).length})</Btn>
            <Btn ghost onClick={reload} disabled={busy}>Odśwież</Btn>
          </div>
          <table style={tbl}>
            <thead><tr>{["Sieć", "Grupa", "Gate", "Kategorie (split)", "Spotk./stan.", "Stanowiska", "Aktywna", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {fmRetailers.map(r => {
                const gs = groupsByRetailer[r.id] || [];
                if (gs.length === 0) return (
                  <tr key={r.id}><td style={td}><b>{r.name}</b></td><td style={td} colSpan={6}><span style={{ color: "#b45309" }}>brak konfiguracji → 1 stanowisko (fallback)</span></td>
                    <td style={td}><Btn sm ghost disabled={busy || dbMissing} onClick={() => run(async () => { const g = await upsertFmQueueGroup({ event_date: eventDate, retailer_id: r.id, gate: r.fmGate ?? null, meetings_per_station: FM_MEETINGS_PER_STATION }); await upsertFmStation({ queue_group_id: g.id, idx: 1 }); }, "Utworzono.")}>Utwórz</Btn></td></tr>
                );
                return gs.map((g, i) => (
                  <tr key={g.id} style={{ background: g.active ? "white" : "#f8fafc" }}>
                    <td style={td}>{i === 0 && <><b>{r.name}</b><div style={{ color: "#64748b", fontSize: 11 }}>pojemność {capacityOf(r.id)} · {stationsOf(r.id)} st.</div></>}</td>
                    <td style={td}><input defaultValue={g.label || ""} placeholder="(główna)" onBlur={e => e.target.value !== (g.label || "") && patchGroup(g, { label: e.target.value })} style={{ ...inp, width: 100 }} /></td>
                    <td style={td}><select value={g.gate ?? ""} onChange={e => patchGroup(g, { gate: e.target.value ? Number(e.target.value) : null })} style={inp}><option value="">—</option><option value="1">1</option><option value="2">2</option></select></td>
                    <td style={td}><input defaultValue={(g.categories || []).join(", ")} placeholder="wszystkie" onBlur={e => patchGroup(g, { categories: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} style={{ ...inp, width: 130 }} /></td>
                    <td style={td}><input type="number" min={1} max={200} defaultValue={g.meetings_per_station} onBlur={e => Number(e.target.value) !== g.meetings_per_station && patchGroup(g, { meetings_per_station: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} style={{ ...inp, width: 60 }} /></td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {g.fm_stations.map(s => (
                          <span key={s.id} title="kliknij: aktywne/nieaktywne · podwójnie: etykieta" onClick={() => run(() => upsertFmStation({ id: s.id, active: !s.active }))}
                            onDoubleClick={() => { const l = window.prompt("Etykieta stanowiska (np. „lewe”):", s.label || ""); if (l !== null) run(() => upsertFmStation({ id: s.id, label: l || null })); }}
                            style={{ padding: "3px 8px", borderRadius: 999, border: `1px solid ${s.active ? "#99f6e4" : "#e2e8f0"}`, background: s.active ? "#f0fdfa" : "#f1f5f9", color: s.active ? "#0f766e" : "#94a3b8", cursor: "pointer", fontWeight: 700, userSelect: "none" }}>
                            {s.label || `#${s.idx}`}{g.fm_stations.length > 1 && <span onClick={(e) => { e.stopPropagation(); if (window.confirm("Usunąć stanowisko?")) run(() => deleteFmStation(s.id)); }} style={{ marginLeft: 6, color: "#94a3b8" }}>×</span>}
                          </span>
                        ))}
                        <Btn sm ghost disabled={busy} onClick={() => addStation(g)}>+</Btn>
                      </div>
                    </td>
                    <td style={td}><input type="checkbox" checked={g.active} onChange={e => patchGroup(g, { active: e.target.checked })} /></td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {i === 0 && <Btn sm ghost disabled={busy} onClick={() => addSplit(r)}>+ grupa</Btn>}
                      {gs.length > 1 && <Btn sm ghost disabled={busy} onClick={() => window.confirm(`Usunąć grupę ${g.label || "(główna)"}?`) && run(() => deleteFmQueueGroup(g.id), "Usunięto.")}>usuń</Btn>}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}

      {sub === "obsluga" && (
        <div>
          <p style={{ color: "#64748b", margin: "0 0 10px", lineHeight: 1.5 }}>
            Konto obsługi = kod + 6-cyfrowy PIN (pokazywany <b>tylko raz</b> przy utworzeniu / resecie; reset unieważnia sesje i odpina tablet). Konto działa <b>tylko w dniu eventu</b> ({eventDate}) i tylko na tablecie, na którym zalogowano się pierwszy raz. Logowanie: <code>b2b.freshmarket.eu/obsluga</code>. Przypisz operatora do sieci — widzi i obsługuje tylko ich stanowiska.
            {!isSuper && <><br /><b style={{ color: "#b45309" }}>Tworzenie, reset PIN-u, blokada i usuwanie kont wymagają uprawnień super administratora.</b></>}
          </p>
          {isSuper && (
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginBottom: 12, padding: 10, background: "#f8fafc", borderRadius: 10 }}>
            <label>Kod<br /><input value={newStaff.code} onChange={e => setNewStaff(s => ({ ...s, code: e.target.value.toUpperCase() }))} placeholder="OBSLUGA-1" style={inp} /></label>
            <label>Imię (opcjonalnie)<br /><input value={newStaff.display_name} onChange={e => setNewStaff(s => ({ ...s, display_name: e.target.value }))} style={inp} /></label>
            <Btn onClick={createStaff} disabled={busy || dbMissing}>Utwórz konto → pokaż PIN</Btn>
          </div>
          )}
          <table style={tbl}>
            <thead><tr>{["Kod", "Imię", "Dzień", "Status", "Ostatnie logowanie / tablet", "Przypisane sieci", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {staff.map(row => {
                const asg = assignedRetailers(row);
                const locked = row.locked_until && new Date(row.locked_until) > new Date();
                return (
                  <tr key={row.id}>
                    <td style={td}><b>{row.code}</b></td>
                    <td style={td}><input defaultValue={row.display_name || ""} onBlur={e => e.target.value !== (row.display_name || "") && run(() => updateFmStaff(row.id, { display_name: e.target.value || null }))} style={{ ...inp, width: 110 }} /></td>
                    <td style={td}>{row.event_date}</td>
                    <td style={td}>{row.blocked ? <b style={{ color: "#dc2626" }}>zablokowane</b> : locked ? <span style={{ color: "#b45309" }}>lockout do {new Date(row.locked_until).toLocaleTimeString("pl-PL")}</span> : <span style={{ color: "#059669" }}>aktywne</span>}</td>
                    <td style={td}>{row.last_login_at ? new Date(row.last_login_at).toLocaleString("pl-PL") : "—"}{row.device_id ? <div style={{ fontSize: 10, color: "#64748b" }}>tablet przypięty</div> : null}</td>
                    <td style={td}>
                      {(
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 360 }}>
                          {fmRetailers.filter(r => groupsByRetailer[r.id]?.length).map(r => (
                            <label key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 999, border: `1px solid ${asg.has(r.id) ? "#99f6e4" : "#e2e8f0"}`, background: asg.has(r.id) ? "#f0fdfa" : "white", fontSize: 11, cursor: "pointer" }}>
                              <input type="checkbox" checked={asg.has(r.id)} disabled={busy} onChange={e => run(() => fmQueueRpc.assignRetailer(row.id, r.id, eventDate, e.target.checked))} style={{ margin: 0 }} />{r.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {isSuper && <>
                        <Btn sm ghost disabled={busy} onClick={() => staffAction(row, "reset_pin")}>nowy PIN</Btn>{" "}
                        <Btn sm ghost disabled={busy} onClick={() => staffAction(row, row.blocked ? "unblock" : "block")}>{row.blocked ? "odblokuj" : "zablokuj"}</Btn>{" "}
                        <Btn sm ghost disabled={busy} onClick={() => staffAction(row, "delete")}>usuń</Btn>
                      </>}
                    </td>
                  </tr>
                );
              })}
              {staff.length === 0 && <tr><td style={td} colSpan={7}><span style={{ color: "#94a3b8" }}>Brak kont obsługi na {eventDate}.</span></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sub === "live" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
            <Btn ghost onClick={reloadLive}>Odśwież</Btn>
            <span style={{ color: "#64748b" }}>{snapshot?.generated_at ? `stan z ${new Date(snapshot.generated_at).toLocaleTimeString("pl-PL")}` : "—"}</span>
            <a href="/tablica" target="_blank" rel="noreferrer" style={{ marginLeft: "auto", color: T, fontWeight: 700 }}>otwórz tablicę ↗</a>
          </div>
          <table style={tbl}>
            <thead><tr>{["Gate", "Sieć", "Stanowisko", "Tryb", "Ostatnio wywołany", "TERAZ", "NASTĘPNY", "Powracający"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {(snapshot?.stations || []).map(s => {
                const ml = MODE_LABEL[s.mode] || MODE_LABEL.closed;
                return (
                  <tr key={s.station_id}>
                    <td style={td}>{s.gate || "—"}</td><td style={td}><b>{s.retailer_name}</b>{s.group_label ? ` · ${s.group_label}` : ""}</td>
                    <td style={td}>{s.station_label || `#${s.station_idx}`}{!s.station_active && " (nieakt.)"}</td>
                    <td style={td}><span style={{ padding: "2px 8px", borderRadius: 999, background: ml.bg, color: ml.color, fontWeight: 700, fontSize: 11 }}>{ml.pl}</span></td>
                    <td style={td}>{s.last_called_nr || "—"}</td>
                    <td style={{ ...td, fontWeight: 800, fontSize: 15 }}>{s.current_nr || "—"} <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{s.current_status || ""}</span></td>
                    <td style={td}>{s.next_nr || "—"}</td>
                    <td style={td}>{s.busy_private ? "obsługa poza tablicą" : ""}</td>
                  </tr>
                );
              })}
              {!snapshot?.stations?.length && <tr><td style={td} colSpan={8}><span style={{ color: "#94a3b8" }}>Brak aktywnych stanowisk.</span></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sub === "ustawienia" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={box}>
            <h4 style={h4}>Dzień eventu</h4>
            <p style={{ color: "#64748b", lineHeight: 1.5 }}>„Otwórz dzień” importuje <b>opublikowany plan</b> dla tej daty (fm_settings z fazą „opublikowany”, numerki ze <code>schedule.nums</code>) do kolejek — każdą parę firma × sieć z jej numerem. Grupy, które mają już spotkania z planu, są pomijane; „Synchronizuj (force)” dopisuje nowe pary i aktualizuje zmienione numery tylko dla spotkań jeszcze niewywołanych, konflikty numerów raportuje. Stanowiska pozostają ZAMKNIĘTE — otwiera je obsługa ręcznie.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn disabled={busy || dbMissing} onClick={() => window.confirm(`Zaimportować opublikowany plan spotkań do kolejek na ${eventDate}?`) && run(() => fmQueueRpc.openDay(eventDate, false).then(r => { setDayReport(r); return r; }), (r) => `Import: ${r.inserted} spotkań, ${r.groups_created} nowych grup, pominięte grupy: ${r.skipped_groups}, problemy: ${r.problems?.length || 0}.`)}>Otwórz dzień (import planu)</Btn>
              <Btn ghost disabled={busy || dbMissing} onClick={() => window.confirm(`Zsynchronizować plan z kolejkami na ${eventDate}? Zmienione numery zostaną zaktualizowane tylko dla spotkań jeszcze niewywołanych.`) && run(() => fmQueueRpc.openDay(eventDate, true).then(r => { setDayReport(r); return r; }), (r) => `Synchronizacja: +${r.inserted} nowych, ${r.updated} zmienionych numerów, ${r.unchanged} bez zmian, problemy: ${r.problems?.length || 0}.`)}>Synchronizuj (force)</Btn>
              <Btn ghost disabled={busy || dbMissing} onClick={() => window.confirm("Zamknąć WSZYSTKIE stanowiska (koniec spotkań 17:00)?") && run(() => fmQueueRpc.closeAll(eventDate), (r) => `Zamknięto ${r.closed} stanowisk.`)}>Zamknij wszystkie stanowiska</Btn>
            </div>
            {dayReport?.problems?.length > 0 && (
              <div style={{ marginTop: 10, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", maxHeight: 220, overflow: "auto" }}>
                <b>Do decyzji admina ({dayReport.problems.length}):</b>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {dayReport.problems.map((p, i) => <li key={i}><code>{p.reason}</code> — firma {String(p.sid || "").slice(0, 8)}… × sieć {p.cid}, nr {p.nr}</li>)}
                </ul>
                <div style={{ color: "#64748b", marginTop: 4 }}>unrouted = split bez jednoznacznej kategorii (uzupełnij kategorie firmy/grupy i uruchom „Synchronizuj”); nr_conflict = numer zajęty przez inną firmę; missing_supplier/chain = brak mapowania; locked_status = spotkanie już wywołane.</div>
              </div>
            )}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
              <Btn ghost disabled={busy || dbMissing} onClick={() => { const c = window.prompt(`Reset dnia ${eventDate} (TYLKO próba generalna / dzień testowy): usuwa wszystkie spotkania kolejek i zeruje numery. Wpisz dokładnie: RESET ${eventDate}`); if (c === `RESET ${eventDate}`) run(() => fmQueueRpc.resetDay(eventDate), (r) => `Reset: usunięto ${r.deleted_meetings} spotkań.`); }}>Reset dnia testowego…</Btn>
              <span style={{ color: "#64748b", marginLeft: 8 }}>zablokowany, gdy w tym dniu były już wywołania</span>
            </div>
            {settings?.day_opened_at && <div style={{ marginTop: 8, color: "#64748b" }}>Dzień otwarty: {new Date(settings.day_opened_at).toLocaleString("pl-PL")}{settings.closed_all_at ? ` · zamknięty: ${new Date(settings.closed_all_at).toLocaleString("pl-PL")}` : ""}</div>}
          </div>
          <div style={box}>
            <h4 style={h4}>Tablica (rzutnik / telefony)</h4>
            <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <label>Rotacja stron (s)<br /><input type="number" min={3} max={60} defaultValue={settings?.board_rotation_s ?? 9} id="fmq-rot" style={{ ...inp, width: 70 }} /></label>
              <label>Pozycji na stronę<br /><input type="number" min={4} max={40} defaultValue={settings?.board_items_per_page ?? 12} id="fmq-pp" style={{ ...inp, width: 70 }} /></label>
              <Btn disabled={busy || dbMissing} onClick={() => run(() => saveFmQueueSettings({ event_date: eventDate, board_rotation_s: Number(document.getElementById("fmq-rot").value) || 9, board_items_per_page: Number(document.getElementById("fmq-pp").value) || 12 }), "Zapisano.")}>Zapisz</Btn>
            </div>
            <div style={{ marginTop: 10, lineHeight: 1.8 }}>
              Linki: <a href="/tablica" target="_blank" rel="noreferrer">/tablica</a> (wszystko) · <a href="/tablica?gate=1" target="_blank" rel="noreferrer">/tablica?gate=1</a> · <a href="/tablica?gate=2" target="_blank" rel="noreferrer">/tablica?gate=2</a><br />
              <span style={{ color: "#64748b" }}>Parametry: <code>?rotate=8</code> sekundy, <code>?perPage=10</code>, <code>?page=2</code> (stała strona, bez rotacji). Kiosk: Edge/Chrome <code>--kiosk https://b2b.freshmarket.eu/tablica?gate=1</code>.</span>
            </div>
          </div>
        </div>
      )}

      {sub === "log" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Btn ghost onClick={() => listFmQueueLog(eventDate, 300).then(setLog)}>Odśwież</Btn>
            <Btn ghost onClick={() => {
              const head = ["ts", "action", "nr", "from", "to", "group", "station", "operator", "device", "payload"];
              const rows = log.map(l => [l.ts, l.action, l.nr ?? "", l.from_status ?? "", l.to_status ?? "", l.queue_group_id ?? "", l.station_id ?? "", l.operator_id ?? "", l.device_id ?? "", JSON.stringify(l.payload || {})]);
              const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
              const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); a.download = `fm-kolejki-log-${eventDate}.csv`; a.click();
            }}>Eksport CSV</Btn>
          </div>
          <table style={tbl}>
            <thead><tr>{["Czas", "Akcja", "Nr", "Z → do", "Sieć", "Operator"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {log.map(l => {
                const g = groups.find(x => x.id === l.queue_group_id);
                const op = staff.find(s => s.id === l.operator_id);
                return (
                  <tr key={l.id}>
                    <td style={td}>{new Date(l.ts).toLocaleTimeString("pl-PL")}</td><td style={td}><b>{l.action}</b></td><td style={td}>{l.nr ?? ""}</td>
                    <td style={td}>{l.from_status || "—"} → {l.to_status || "—"}</td>
                    <td style={td}>{g ? `${retailerName(g.retailer_id)}${g.label ? ` · ${g.label}` : ""}` : ""}</td>
                    <td style={td}>{op?.code || (l.operator_id ? "admin" : "")}</td>
                  </tr>
                );
              })}
              {log.length === 0 && <tr><td style={td} colSpan={6}><span style={{ color: "#94a3b8" }}>Brak wpisów.</span></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pinModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setPinModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: "26px 30px", width: 380, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 12, letterSpacing: "0.1em", color: "#64748b", fontWeight: 700 }}>KOD OPERATORA</div>
            <div style={{ fontSize: 22, fontWeight: 800, margin: "4px 0 14px" }}>{pinModal.code}</div>
            <div style={{ fontSize: 12, letterSpacing: "0.1em", color: "#64748b", fontWeight: 700 }}>PIN</div>
            <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "0.25em", fontVariantNumeric: "tabular-nums", margin: "4px 0 10px" }}>{pinModal.pin}</div>
            <div style={{ color: "#991b1b", fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>PIN jest pokazywany <b>tylko teraz</b> — nie jest zapisany w bazie ani w logach. Przekaż go osobie z obsługi (np. na kartce z kodem). Zgubiony PIN = „nowy PIN”.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Btn ghost onClick={() => navigator.clipboard?.writeText(`${pinModal.code} PIN ${pinModal.pin}`)}>Kopiuj</Btn>
              <Btn onClick={() => setPinModal(null)}>Zamknij</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Btn({ children, onClick, disabled, ghost, sm }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ padding: sm ? "3px 9px" : "7px 14px", borderRadius: 8, border: `1px solid ${ghost ? "#e2e8f0" : T}`, background: ghost ? "white" : T, color: ghost ? "#475569" : "white", fontSize: sm ? 11 : 12, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit" }}>
      {children}
    </button>
  );
}
const inp = { padding: "5px 8px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit", background: "white" };
const tbl = { width: "100%", borderCollapse: "collapse", background: "white", borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0" };
const th = { textAlign: "left", padding: "7px 9px", background: "#f8fafc", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e2e8f0" };
const td = { padding: "6px 9px", borderBottom: "1px solid #f1f5f9", verticalAlign: "middle" };
const box = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" };
const h4 = { margin: "0 0 8px", fontSize: 14 };
