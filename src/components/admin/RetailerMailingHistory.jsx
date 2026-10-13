import { useId, useMemo, useState } from "react";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildRetailerMailingHistory, formatRetailerMailingStamp } from "../../lib/retailer-mailing-history.js";
import "./RetailerMailingHistory.css";

export default function RetailerMailingHistory({ retailerId, retailerName, sends, offers = [], companies = [] }) {
  const { t, i18n } = useTranslation("legacy");
  const [open, setOpen] = useState(false);
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
        {!entries.length ? <p>{t(p + "empty")}</p> : entries.map(entry => (
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
                return <li key={send.id ?? send.data?.id ?? index}><span>{item.title}</span><span>{item.supplier}</span></li>;
              })}
            </ul>
          </div>
        ))}
      </section>}
    </div>
  );
}
