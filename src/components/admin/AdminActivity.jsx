// [feat/admin-activity] Zakładka administratora „Aktywność” (wersja 1).
// Dziennik wejść kupców i dostawców + istniejące rejestry maili PreConnect i marketingu
// + wyświetlenia propozycji w aplikacji. Tylko odczyt (poza jawnym oznaczeniem konta
// testowego). Dane i eksport wyłącznie dla administratora — guard is_admin() w SQL.
//
// Słownictwo celowo ostrożne: „brak zarejestrowanego wejścia/otwarcia”, nie „nie wszedł /
// nie przeczytał”. Żadne zdarzenie nie jest przedstawiane jako dowód zainteresowania zakupem.
// Każde zdarzenie jest liczone według własnej daty (raport i oś czasu z tego samego źródła SQL).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadAdminActivityReport, loadAdminActivityEvents, setActivityTestAccount } from "../../lib/db.js";

const DAY = 864e5;
export const PERIODS = [7, 30, 90];
// Oś czasu i eksport pobierają zdarzenia JEDNYM wywołaniem RPC (jedna migawka danych w bazie).
// Łączenie stron z osobnych wywołań mogłoby zdublować lub zgubić zdarzenie dopisane w międzyczasie.
export const TIMELINE_LIMIT = 1000;
export const EXPORT_MAX = 50000;
const TZ = "Europe/Warsaw";

export function fmtDateTime(iso, lang = "pl") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(lang === "en" ? "en-GB" : "pl-PL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function accountOrg(a) {
  return (a?.role === "buyer" ? a?.retailer_name : a?.company_name) || "";
}

export function filterAccounts(accounts, { role = "all", query = "", showTest = false, onlyWithEvents = false } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (accounts || []).filter((a) => {
    if (!showTest && a.is_test) return false;
    if (role !== "all" && a.role !== role) return false;
    if (onlyWithEvents && !(a.events > 0)) return false;
    if (!q) return true;
    return [accountOrg(a), a.name, a.email].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

// Komórka CSV: średnik jako separator (Excel PL), cudzysłowy, ochrona przed formułami.
export function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvJoin = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";

export function eventLabel(ev, t) {
  const d = ev?.detail || {};
  switch (ev?.kind) {
    case "visit": return d.hit_count > 1 ? t("admin.activity.ev.visit_multi", { n: d.hit_count }) : t("admin.activity.ev.visit");
    case "email_sent": return ev.source === "marketing"
      ? t("admin.activity.ev.sent_marketing", { campaign: d.campaign || "" })
      : t("admin.activity.ev.sent_preconnect", { n: d.proposals || 0 });
    case "email_delivered": return t("admin.activity.ev.delivered");
    case "email_opened": return t("admin.activity.ev.opened");
    case "email_bounced": return t("admin.activity.ev.bounced");
    case "email_complained": return t("admin.activity.ev.complained");
    // rejestr zna tylko pierwsze i ostatnie wyświetlenie — bez liczby wyświetleń (licznik nie jest dokładny)
    case "app_view_first": return t("admin.activity.ev.app_view_first");
    case "app_view_last": return t("admin.activity.ev.app_view_last");
    default: return t("admin.activity.ev.other");
  }
}

// Zakres przekazywany do RPC: komentarz w nagłówku i nazwa pliku eksportu opisują dokładnie ten okres.
export function periodLine(meta, t, lang) {
  if (!meta?.from || !meta?.to) return "";
  return t("admin.activity.period_line", { from: fmtDateTime(meta.from, lang), to: fmtDateTime(meta.to, lang) });
}

export function buildSummaryCsv(accounts, meta, t, lang) {
  const head = ["role", "org", "person", "email", "test", "visits", "last_visit", "sent", "delivered", "opened", "last_opened", "viewed", "legacy_last_active", "legacy_shared"]
    .map((k) => t("admin.activity.csv." + k));
  const rows = accounts.map((a) => [
    t("admin.activity.role." + a.role), accountOrg(a), a.name, a.email, a.is_test ? t("admin.activity.yes") : "",
    a.visits, a.last_visit_at ? fmtDateTime(a.last_visit_at, lang) : t("admin.activity.no_visit"),
    a.emails_sent, a.emails_delivered, a.emails_opened, fmtDateTime(a.last_opened_at, lang),
    a.role === "buyer" ? a.proposals_viewed : "",
    fmtDateTime(a.legacy_last_active_at, lang),
    a.legacy_last_active_at ? a.legacy_last_active_shared : "",
  ]);
  return csvJoin([[periodLine(meta, t, lang)], [t("admin.activity.csv.note")], head, ...rows]);
}

export function buildEventsCsv(events, accountsById, meta, t, lang) {
  const head = ["at", "role", "org", "person", "email", "event", "source"].map((k) => t("admin.activity.csv." + k));
  const rows = [];
  for (const ev of events) {
    const a = accountsById.get(ev.profile_id);
    if (!a) continue;
    rows.push([fmtDateTime(ev.at, lang), t("admin.activity.role." + a.role), accountOrg(a), a.name, a.email,
      eventLabel(ev, t), ev.source ? t("admin.activity.source." + ev.source) : ""]);
  }
  return csvJoin([[periodLine(meta, t, lang)], [t("admin.activity.csv.note")], head, ...rows]);
}

// Wszystkie zdarzenia wskazanych kont z JEDNEJ migawki — eksport nigdy nie jest po cichu obcięty.
export async function loadAllEvents({ from, to, profileIds, load = loadAdminActivityEvents, max = EXPORT_MAX }) {
  const r = await load({ from, to, profileIds, limit: max, offset: 0 });
  const total = Number(r?.total) || 0;
  const events = r?.events || [];
  if (total > max) { const e = new Error("too_many_events"); e.total = total; throw e; }
  if (events.length !== total) { const e = new Error("incomplete_events"); e.total = total; e.got = events.length; throw e; }
  return events;
}

function download(name, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function rangeFor(period, customFrom, customTo, now = Date.now()) {
  if (period === "custom") {
    if (!customFrom || !customTo) return null;
    const from = new Date(customFrom + "T00:00:00");
    const to = new Date(new Date(customTo + "T00:00:00").getTime() + DAY);
    if (!(from < to)) return null;
    return { from: from.toISOString(), to: to.toISOString() };
  }
  return { from: new Date(now - Number(period) * DAY).toISOString(), to: new Date(now).toISOString() };
}

const box = { background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 12 };
const th = { textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 600, padding: "8px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const td = { fontSize: 12, padding: "8px 8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const muted = { color: "#94a3b8" };
const btn = (active) => ({ border: "1px solid " + (active ? "#0d9488" : "#cbd5e1"), background: active ? "#0d9488" : "white", color: active ? "white" : "#334155", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" });

export default function AdminActivity({ fl = () => {} }) {
  const { t, i18n } = useTranslation("legacy");
  const lang = (i18n?.language || "pl").startsWith("en") ? "en" : "pl";
  const [period, setPeriod] = useState(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
  const [showTest, setShowTest] = useState(false);
  const [onlyWithEvents, setOnlyWithEvents] = useState(false);
  const [report, setReport] = useState(null);
  const [range, setRange] = useState(null);           // zakres, dla którego jest `report`
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [timeline, setTimeline] = useState(null);     // { profileId, events, total, loading, error }
  const [needDates, setNeedDates] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);
  const tlSeq = useRef(0);

  const load = useCallback(async () => {
    const want = rangeFor(period, customFrom, customTo);
    const my = ++seq.current;                          // unieważnia każde wcześniejsze żądanie
    if (!want) {                                       // niepełny własny okres: brak raportu = brak eksportu
      setReport(null); setRange(null); setError(null); setLoading(false);
      setOpen(null); setTimeline(null); setNeedDates(true);
      return;
    }
    setNeedDates(false);
    setLoading(true); setError(null);
    try {
      const r = await loadAdminActivityReport(want);
      if (my !== seq.current) return;                 // spóźniona odpowiedź dla poprzedniego zakresu
      setReport(r); setRange({ from: r?.meta?.from || want.from, to: r?.meta?.to || want.to });
      setOpen(null); setTimeline(null);
    } catch (e) {
      if (my !== seq.current) return;
      setError(e?.message || String(e)); setReport(null); setRange(null);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const loadTimeline = useCallback(async (profileId) => {
    if (!range) return;
    const my = ++tlSeq.current;
    setTimeline({ profileId, events: [], total: null, loading: true, error: null });
    try {
      const r = await loadAdminActivityEvents({ from: range.from, to: range.to, profileIds: [profileId], limit: TIMELINE_LIMIT, offset: 0 });
      if (my !== tlSeq.current) return;
      setTimeline({ profileId, events: r?.events || [], total: Number(r?.total) || 0, loading: false, error: null });
    } catch (e) {
      if (my !== tlSeq.current) return;
      setTimeline((prev) => ({ ...(prev || {}), profileId, loading: false, error: e?.message || String(e) }));
    }
  }, [range]);

  const accounts = useMemo(() => report?.accounts || [], [report]);
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.profile_id, a])), [accounts]);
  const rows = useMemo(() => filterAccounts(accounts, { role, query, showTest, onlyWithEvents }), [accounts, role, query, showTest, onlyWithEvents]);
  const meta = report?.meta || {};
  const withVisit = rows.filter((a) => a.visits > 0).length;
  const ready = !!report && !loading && !error;
  const stamp = new Date().toISOString().slice(0, 10);

  const toggleRow = (a) => {
    if (open === a.profile_id) { setOpen(null); setTimeline(null); return; }
    setOpen(a.profile_id); loadTimeline(a.profile_id);
  };

  const toggleTest = async (a) => {
    setBusy(a.profile_id);
    try {
      await setActivityTestAccount(a.profile_id, !a.is_test);
      fl(t(a.is_test ? "admin.activity.test_unmarked" : "admin.activity.test_marked"), "success");
      await load();
    } catch (e) { fl(e?.message || String(e), "error"); }
    finally { setBusy(null); }
  };

  const exportEvents = async () => {
    if (!ready || !range) return;
    setExporting(true);
    try {
      const events = await loadAllEvents({ from: range.from, to: range.to, profileIds: rows.map((a) => a.profile_id) });
      download(`aktywnosc-zdarzenia-${stamp}.csv`, buildEventsCsv(events, accountsById, meta, t, lang));
    } catch (e) {
      fl(e?.message === "too_many_events" ? t("admin.activity.export_too_many", { n: e.total }) : t("admin.activity.export_failed", { message: e?.message || String(e) }), "error");
    } finally { setExporting(false); }
  };

  return (
    <div data-testid="admin-activity">
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>{t("admin.activity.title")}</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#475569" }}>{t("admin.activity.intro")}</p>

      <div style={{ ...box, background: "#f8fafc" }} data-testid="activity-collecting">
        {report && meta.enabled === false && (
          <div data-testid="activity-disabled" style={{ fontSize: 13, fontWeight: 700, color: "#b45309", marginBottom: 4 }}>{t("admin.activity.disabled")}</div>
        )}
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {meta.collecting_since
            ? t("admin.activity.collecting_since", { date: fmtDateTime(meta.collecting_since, lang) })
            : t("admin.activity.collecting_none")}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{t("admin.activity.retention")}</div>
      </div>

      {/* Krótkie ostrzeżenie + rozwijane „Ograniczenia pomiaru” (domyślnie zwinięte — więcej firm od razu widocznych). */}
      <div style={{ marginBottom: 12, fontSize: 12, color: "#713f12", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 10px" }} data-testid="activity-disclaimer">
        <span data-testid="activity-disclaimer-short">⚠ {t("admin.activity.disclaimer_short")}</span>
        <button type="button" data-testid="activity-limits-toggle" aria-expanded={limitsOpen} aria-controls="activity-limits"
          onClick={() => setLimitsOpen((v) => !v)}
          style={{ border: "none", background: "none", padding: 0, color: "#0d9488", textDecoration: "underline", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          {t("admin.activity.limits_toggle")} {limitsOpen ? "▴" : "▾"}
        </button>
        {limitsOpen && (
          <ul id="activity-limits" data-testid="activity-limits" style={{ flexBasis: "100%", margin: "6px 0 0", padding: "8px 12px 8px 26px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, color: "#713f12", lineHeight: 1.5 }}>
            {["incomplete", "visit", "opened", "delivered", "app_view", "dates", "no_intent", "mail_scope"].map((k) => <li key={k}>{t("admin.activity.disclaimer." + k)}</li>)}
          </ul>
        )}
      </div>

      <div style={{ ...box, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {PERIODS.map((d) => <button key={d} type="button" style={btn(period === d)} onClick={() => setPeriod(d)} data-testid={`activity-period-${d}`}>{t("admin.activity.period_days", { n: d })}</button>)}
        <button type="button" style={btn(period === "custom")} onClick={() => setPeriod("custom")}>{t("admin.activity.period_custom")}</button>
        {period === "custom" && (
          <>
            <input type="date" aria-label={t("admin.activity.from")} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" aria-label={t("admin.activity.to")} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        <select aria-label={t("admin.activity.role_filter")} value={role} onChange={(e) => setRole(e.target.value)} style={{ fontSize: 12, padding: "5px 6px" }}>
          <option value="all">{t("admin.activity.role_all")}</option>
          <option value="buyer">{t("admin.activity.role_buyers")}</option>
          <option value="supplier">{t("admin.activity.role_suppliers")}</option>
        </select>
        <input type="search" placeholder={t("admin.activity.search")} value={query} onChange={(e) => setQuery(e.target.value)} style={{ fontSize: 12, padding: "5px 8px", minWidth: 180 }} />
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} data-testid="activity-show-test" /> {t("admin.activity.show_test")}</label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={onlyWithEvents} onChange={(e) => setOnlyWithEvents(e.target.checked)} /> {t("admin.activity.only_with_events")}</label>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn(false)} onClick={load} disabled={loading}>{t("admin.activity.refresh")}</button>
        <button type="button" style={btn(false)} data-testid="activity-export-summary" disabled={!ready}
          onClick={() => download(`aktywnosc-podsumowanie-${stamp}.csv`, buildSummaryCsv(rows, meta, t, lang))}>{t("admin.activity.export_summary")}</button>
        <button type="button" style={btn(false)} data-testid="activity-export-events" disabled={!ready || exporting}
          onClick={exportEvents}>{exporting ? t("admin.activity.exporting") : t("admin.activity.export_events")}</button>
      </div>

      {error && <div style={{ ...box, borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 13 }}>{t("admin.activity.error", { message: error })}</div>}
      {needDates && <div style={{ ...box, fontSize: 13, color: "#475569" }} data-testid="activity-need-dates">{t("admin.activity.need_dates")}</div>}
      {loading && <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }} data-testid="activity-loading">{t("admin.activity.loading")}</div>}

      {report && !error && (
        <>
          <div style={{ fontSize: 12, color: "#475569", margin: "0 0 8px" }} data-testid="activity-summary">
            <strong>{periodLine(meta, t, lang)}</strong>{" · "}
            {t("admin.activity.summary", { total: rows.length, with_visit: withVisit, without_visit: rows.length - withVisit })}
          </div>
          <div style={{ ...box, padding: 0, overflowX: "auto", opacity: loading ? 0.5 : 1 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={th}>{t("admin.activity.col.org")}</th>
                  <th style={th}>{t("admin.activity.col.person")}</th>
                  <th style={th}>{t("admin.activity.col.role")}</th>
                  <th style={th}>{t("admin.activity.col.visits")}</th>
                  <th style={th}>{t("admin.activity.col.last_visit")}</th>
                  <th style={th} title={t("admin.activity.col.emails_hint")}>{t("admin.activity.col.emails")}</th>
                  <th style={th} title={t("admin.activity.col.viewed_hint")}>{t("admin.activity.col.viewed")}</th>
                  <th style={th} title={t("admin.activity.col.legacy_hint")}>{t("admin.activity.col.legacy")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td style={{ ...td, ...muted }} colSpan={8}>{t("admin.activity.empty")}</td></tr>}
                {rows.map((a) => {
                  const isOpen = open === a.profile_id;
                  const tl = isOpen && timeline?.profileId === a.profile_id ? timeline : null;
                  return (
                    <React.Fragment key={a.profile_id}>
                      <tr data-testid={`activity-row-${a.profile_id}`} onClick={() => toggleRow(a)} style={{ cursor: "pointer", background: isOpen ? "#f0fdfa" : undefined }}>
                        <td style={td}>
                          {accountOrg(a) || <span style={muted}>—</span>}
                          {a.is_test && <span data-testid="activity-test-badge" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#7c2d12", background: "#fed7aa", borderRadius: 6, padding: "1px 6px" }}>{t("admin.activity.test_badge")}</span>}
                          {a.active === false && <span style={{ marginLeft: 6, fontSize: 10, ...muted }}>{t("admin.activity.inactive")}</span>}
                        </td>
                        <td style={td}>{a.name || ""}<div style={{ fontSize: 11, ...muted }}>{a.email}</div></td>
                        <td style={td}>{t("admin.activity.role." + a.role)}</td>
                        <td style={td}>{a.visits}</td>
                        <td style={td}>{a.last_visit_at ? fmtDateTime(a.last_visit_at, lang) : <span style={muted}>{t("admin.activity.no_visit")}</span>}</td>
                        <td style={td}>
                          {a.emails_sent + a.emails_delivered + a.emails_opened > 0
                            ? <>
                                {t("admin.activity.emails_counts", { sent: a.emails_sent, delivered: a.emails_delivered, opened: a.emails_opened })}
                                {a.emails_opened === 0 && <div style={{ fontSize: 11, ...muted }}>{t("admin.activity.no_open")}</div>}
                              </>
                            : <span style={muted}>—</span>}
                        </td>
                        <td style={td}>{a.role === "buyer" ? (a.proposals_viewed || <span style={muted}>0</span>) : <span style={muted}>—</span>}</td>
                        <td style={td}>
                          {a.legacy_last_active_at ? fmtDateTime(a.legacy_last_active_at, lang) : <span style={muted}>—</span>}
                          {a.legacy_last_active_at && a.legacy_last_active_shared > 1 && (
                            <div style={{ fontSize: 11, color: "#b45309" }}>{t("admin.activity.legacy_shared", { n: a.legacy_last_active_shared })}</div>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr data-testid={`activity-timeline-${a.profile_id}`}>
                          <td style={{ ...td, background: "#f8fafc" }} colSpan={8}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                              <strong style={{ fontSize: 12 }}>{t("admin.activity.timeline")}</strong>
                              <span style={{ flex: 1 }} />
                              <button type="button" style={btn(false)} disabled={busy === a.profile_id} data-testid="activity-toggle-test"
                                onClick={(e) => { e.stopPropagation(); toggleTest(a); }}>
                                {t(a.is_test ? "admin.activity.unmark_test" : "admin.activity.mark_test")}
                              </button>
                            </div>
                            {tl?.error && <div style={{ fontSize: 12, color: "#991b1b" }}>{t("admin.activity.error", { message: tl.error })}</div>}
                            {tl && !tl.error && tl.events.length === 0 && !tl.loading && <div style={{ fontSize: 12, ...muted }}>{t("admin.activity.timeline_empty")}</div>}
                            {tl && tl.events.length > 0 && (
                              <table style={{ borderCollapse: "collapse" }}>
                                <tbody>
                                  {tl.events.map((ev, i) => (
                                    <tr key={i}>
                                      <td style={{ ...td, whiteSpace: "nowrap", color: "#475569" }}>{fmtDateTime(ev.at, lang)}</td>
                                      <td style={td}>{eventLabel(ev, t)}</td>
                                      <td style={{ ...td, ...muted }}>{ev.source ? t("admin.activity.source." + ev.source) : ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {tl?.loading && <div style={{ fontSize: 12, ...muted }}>{t("admin.activity.loading")}</div>}
                            {tl && !tl.loading && tl.total > tl.events.length && (
                              <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }} data-testid="activity-timeline-partial">
                                {t("admin.activity.timeline_partial", { shown: tl.events.length, total: tl.total })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
