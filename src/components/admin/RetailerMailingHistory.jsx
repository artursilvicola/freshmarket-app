import { useEffect, useId, useMemo, useRef, useState } from "react";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildRetailerMailingHistory, formatRetailerMailingStamp, MAILING_TIME_ZONE } from "../../lib/retailer-mailing-history.js";
import { loadRetailerEmailHistory } from "../../lib/db.js";
import "./RetailerMailingHistory.css";

// [feat/email-open-history] Historia per odbiorca (legacy_send_messages + rejestr zdarzeń)
// jest doczytywana dopiero po rozwinięciu panelu — jedna sieć, jedno RPC, tylko admin.
// Otwarcie piksela i wejście do aplikacji to RÓŻNE zdarzenia i są pokazywane osobno.
function fmtInstant(value, language) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const locale = language.toLowerCase().startsWith("en") ? "en-GB" : "pl-PL";
  return new Intl.DateTimeFormat(locale, {
    timeZone: MAILING_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

export function recipientsForEntry(entry, history) {
  const messages = history?.messages || [];
  // Najpierw po identyfikatorach wiadomości tego mailingu (jednoznaczne); przecięcie
  // propozycji tylko wtedy, gdy wpis nie ma identyfikatorów (stare zapisy).
  const mids = new Set((entry?.messageIds || []).map(String));
  if (mids.size) return messages.filter(m => mids.has(String(m.resend_message_id)));
  const ids = new Set(entry?.sends.map(s => String(s.id ?? s.data?.id)).filter(Boolean));
  return messages.filter(m => (m.legacy_ids || []).some(id => ids.has(String(id))));
}

export function appReadsForEntry(entry, history) {
  const ids = new Set(entry?.sends.map(s => String(s.id ?? s.data?.id)).filter(Boolean));
  return (history?.app_reads || []).filter(r => ids.has(String(r.legacy_id)));
}

// Stan odczytu POJEDYNCZEJ propozycji wg zapisu w legacy_sends (status + znaczniki z
// mark_legacy_send_seen). Dziala takze dla mailingow sprzed historii per kupiec, bo czyta
// to, co juz jest w bazie. Nie mowi, KTORY kupiec — to robi tabela odbiorcow nizej.
export function proposalReadState(send) {
  const row = send?.data ? { ...send.data, ...send } : (send || {});
  const status = typeof row.status === "string" ? row.status : null;
  const readAt = row.readAt || null;
  const openedAt = row.emailOpenedAt || row.email_opened_at || null;
  if (status === "read_manual" || (status === "read" && typeof row.readType === "string" && row.readType.startsWith("manual"))) {
    return { kind: "manual", at: readAt || row.seenAt || null, openedAt };
  }
  if (status === "read") return { kind: "app", at: readAt || row.seenAt || null, openedAt };
  if (status === "opened") return { kind: "email", at: openedAt || row.seenAt || null, openedAt };
  if (status === "unread_expired") return { kind: "expired", at: null, openedAt };
  if (status === "rejected") return { kind: "rejected", at: null, openedAt };
  if (status === "sent") return { kind: "none", at: null, openedAt };
  return { kind: "unknown", at: null, openedAt };
}

export function recipientStatus(m, t, p) {
  if (m.last_event_error) return t(p + "status_error", { error: m.last_event_error });
  if (m.bounced_at) return t(p + "status_bounced");
  if (m.complained_at) return t(p + "status_complained");
  if (m.delayed_at && !m.delivered_at) return t(p + "status_delayed");
  return t(p + "status_ok");
}

export default function RetailerMailingHistory({ retailerId, retailerName, sends, offers = [], companies = [], loadHistory = loadRetailerEmailHistory }) {
  const { t, i18n } = useTranslation("legacy");
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState({ state: "idle", data: null });
  const regionId = useId();
  const entries = useMemo(() => buildRetailerMailingHistory(sends, retailerId), [sends, retailerId]);
  const p = "admin.mailing_history.";
  const incompleteDates = entries.some(entry => !entry.stamp || entry.stamp.kind === "date" || entry.conflictingDates);
  const latest = entries.find(entry => entry.stamp && !entry.conflictingDates);
  const dateLabel = entry => !entry?.stamp ? t(p + "unknown_date")
    : entry.conflictingDates ? t(p + "conflicting_dates")
    : `${formatRetailerMailingStamp(entry.stamp, i18n.language)}${entry.stamp.kind === "date" ? ` (${t(p + "unknown_time")})` : ""}`;
  const proposal = send => {
    const row = send.data ? { ...send.data, ...send } : send;
    const offer = offers.find(o => String(o.id) === String(row.offerId));
    const supplierId = row.supplierId || offer?.supplierId;
    const company = supplierId == null ? null : companies.find(c =>
      [c.id, c.legacy_supplier_id, c.fmId, c.fmId ? `sup-${c.fmId}` : null]
        .some(id => id != null && String(id) === String(supplierId)));
    return {
      title: offer?.title || offer?.product || t(p + "proposal_id", { id: row.offerId ?? row.id ?? "?" }),
      supplier: company?.name || t(p + "unknown_supplier"),
    };
  };
  const proposalTitleById = id => {
    const send = (sends || []).find(s => String(s.id ?? s.data?.id) === String(id));
    return send ? proposal(send).title : t(p + "proposal_id", { id });
  };

  // Jedno doczytanie na sieć, dopiero po rozwinięciu. Stan wczytywania NIE jest
  // zależnością efektu — inaczej zmiana „idle → loading" uruchamiałaby sprzątanie
  // i anulowała właśnie wystartowane żądanie.
  const fetchedFor = useRef(null);
  useEffect(() => {
    if (!open || fetchedFor.current === retailerId) return;
    fetchedFor.current = retailerId;
    let cancelled = false;
    setHistory({ state: "loading", data: null });
    const fail = () => { if (cancelled) return; fetchedFor.current = null; setHistory({ state: "error", data: null }); };
    Promise.resolve().then(() => loadHistory(retailerId)).then(data => {
      if (cancelled) return;
      if (data) setHistory({ state: "ready", data }); else fail();
    }).catch(fail);
    return () => { cancelled = true; };
  }, [open, loadHistory, retailerId]);

  const fmt = v => fmtInstant(v, i18n.language);

  return (
    <div className="fm-mailing-history">
      <div className="fm-mailing-history__summary">
        <span>
          <strong>{t(p + (incompleteDates && latest ? "last_dated" : "last"))}:</strong>{" "}
          {entries.length ? dateLabel(latest) : t(p + "none")}
        </span>
        <button type="button" className="fm-mailing-history__toggle" onClick={() => setOpen(value => !value)}
          aria-expanded={open} aria-controls={regionId}
          aria-label={t(p + "toggle", { retailer: retailerName })} title={t(p + "title")}>
          <History size={14} aria-hidden="true"/>{t(p + "title")}
          {open ? <ChevronUp size={13} aria-hidden="true"/> : <ChevronDown size={13} aria-hidden="true"/>}
        </button>
      </div>
      {open && <section id={regionId} aria-label={t(p + "toggle", { retailer: retailerName })} className="fm-mailing-history__details">
        <p className="fm-mailing-history__note">{t(p + "source_note")}</p>
        {incompleteDates && <p className="fm-mailing-history__warning">{t(p + "incomplete_dates")}</p>}
        {history.state === "loading" && <p className="fm-mailing-history__note" role="status">{t(p + "recipients_loading")}</p>}
        {history.state === "error" && <p className="fm-mailing-history__warning" role="alert">{t(p + "recipients_error")}</p>}
        {!entries.length ? <p>{t(p + "empty")}</p> : entries.map(entry => {
          const recipients = history.state === "ready" ? recipientsForEntry(entry, history.data) : [];
          const appReads = history.state === "ready" ? appReadsForEntry(entry, history.data) : [];
          return (
            <div key={entry.key} className="fm-mailing-history__entry">
              <div className="fm-mailing-history__entry-heading">
                <strong>{dateLabel(entry)}</strong>
                <span>{t(p + "proposals")}: {entry.sends.length}</span>
                <span>{t(p + "buyers")}: {entry.buyerCount == null ? t(p + "unknown_count")
                  : entry.buyerCountIsMinimum ? t(p + "count_minimum", { count: entry.buyerCount }) : entry.buyerCount}</span>
              </div>
              {entry.incomplete && <p className="fm-mailing-history__note">{t(p + "unlinked")}</p>}
              <ul className="fm-mailing-history__proposals">
                {entry.sends.map((send, index) => {
                  const item = proposal(send);
                  const state = proposalReadState(send);
                  const at = fmt(state.at);
                  const label = at ? t(p + `read_${state.kind}`, { at }) : t(p + `read_${state.kind}_nodate`);
                  const extra = state.kind === "app" || state.kind === "manual" ? fmt(state.openedAt) : null;
                  return (
                    <li key={send.id ?? send.data?.id ?? index}>
                      <span>{item.title}</span>
                      <span>{item.supplier}</span>
                      <span className={`fm-mailing-history__read fm-mailing-history__read--${state.kind}`}>
                        {label}{extra ? `; ${t(p + "read_email", { at: extra })}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {history.state === "ready" && (
                <div className="fm-mailing-history__recipients">
                  <h4>{t(p + "recipients")}</h4>
                  {!recipients.length ? <p className="fm-mailing-history__note">{t(p + "recipients_none")}</p> : (
                    <table className="fm-mailing-history__table">
                      <thead>
                        <tr>
                          <th>{t(p + "col_buyer")}</th><th>{t(p + "col_email")}</th><th>{t(p + "col_sent")}</th>
                          <th>{t(p + "col_delivered")}</th><th>{t(p + "col_first_open")}</th><th>{t(p + "col_last_open")}</th><th>{t(p + "col_status")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipients.map(m => (
                          <tr key={m.resend_message_id}>
                            <td>{m.buyer_name || (m.buyer_profile_id ? m.buyer_email_now : m.to_email)}</td>
                            <td>{m.to_email}</td>
                            <td>{fmt(m.sent_at)}</td>
                            <td>{fmt(m.delivered_at) || t(p + "not_delivered_yet")}</td>
                            <td>{fmt(m.first_opened_at) || t(p + "no_open_recorded")}</td>
                            <td>{m.last_opened_at ? `${fmt(m.last_opened_at)} (${t(p + "open_count", { count: m.open_count || 0 })})` : "—"}</td>
                            <td>{recipientStatus(m, t, p)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="fm-mailing-history__note">{t(p + "pixel_note")}</p>

                  <h4>{t(p + "app_reads")}</h4>
                  <p className="fm-mailing-history__note">{t(p + "app_reads_note")}</p>
                  {!appReads.length ? <p className="fm-mailing-history__note">{t(p + "app_reads_none")}</p> : (
                    <table className="fm-mailing-history__table">
                      <thead>
                        <tr>
                          <th>{t(p + "col_buyer")}</th><th>{t(p + "col_proposal")}</th><th>{t(p + "col_channel")}</th>
                          <th>{t(p + "col_first_read")}</th><th>{t(p + "col_last_read")}</th><th>{t(p + "col_read_count")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appReads.map(r => (
                          <tr key={`${r.legacy_id}:${r.channel}:${r.buyer_profile_id || "admin"}`}>
                            <td>{r.reader_role === "admin" || !r.buyer_profile_id ? t(p + "app_reader_admin") : (r.buyer_name || r.buyer_email_now || t(p + "recipient_unknown_buyer"))}</td>
                            <td>{proposalTitleById(r.legacy_id)}</td>
                            <td>{t(p + `app_channel_${r.channel}`)}</td>
                            <td>{fmt(r.first_read_at)}</td>
                            <td>{fmt(r.last_read_at)}</td>
                            <td>{r.read_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>}
    </div>
  );
}
