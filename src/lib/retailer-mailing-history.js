export const MAILING_TIME_ZONE = "Europe/Warsaw";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MAILING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

function calendarDay(date) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseStamp(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  if (raw === day) return { kind: "date", value: day, day };
  // SQL timestamptz uses a space and may use +00 instead of +00:00.
  const iso = raw.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return null;
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return null;
  return { kind: "instant", value: instant.toISOString(), day: calendarDay(instant) };
}

export function retailerMailingStamp(send) {
  const data = send?.data || {};
  const stamps = [send?.emailSentAt, data.emailSentAt, send?.email_sent_at, data.email_sent_at,
    send?.mailingSentAt, data.mailingSentAt].map(parseStamp).filter(Boolean);
  // Never substitute sentAt/sendDate (panel), planned dates, reads or supplier notifications.
  return stamps.find(s => s.kind === "instant") || stamps[0] || null;
}

function messageIds(send) {
  const data = send?.data || {};
  return [...new Set([
    ...(Array.isArray(send?.resendMessageIds) ? send.resendMessageIds : []),
    ...(Array.isArray(data.resendMessageIds) ? data.resendMessageIds : []),
    send?.resendMessageId, send?.resend_message_id, data.resendMessageId, data.resend_message_id,
  ].filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))].sort();
}

function buyerCount(send) {
  const data = send?.data || {};
  const counts = [send?.resendBuyerCount, data.resendBuyerCount,
    Array.isArray(send?.resendBuyerEmails) ? send.resendBuyerEmails.length : 0,
    Array.isArray(data.resendBuyerEmails) ? data.resendBuyerEmails.length : 0,
  ].map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  return counts.length ? Math.max(...counts) : null;
}

function newestStamp(a, b) {
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  // Legacy day stamps were stored in UTC. Without an hour, use the end of
  // that UTC day for ordering, not midnight in the browser's timezone.
  const latestPossible = s => Date.parse(s.kind === "date" ? `${s.value}T23:59:59.999Z` : s.value);
  return latestPossible(b) - latestPossible(a);
}

/** Read-only reconstruction from saved delivery markers, not an audit of failed attempts. */
export function buildRetailerMailingHistory(sends, retailerId) {
  if (retailerId == null || retailerId === "") return [];
  const groups = [];
  const seen = new Set();
  for (const [index, send] of (sends || []).entries()) {
    if (!send || String(send.retailerId ?? send.data?.retailerId ?? "") !== String(retailerId)) continue;
    const id = send.id ?? send.data?.id;
    const rowKey = id == null ? `row:${index}` : `send:${id}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const ids = messageIds(send);
    const stamp = retailerMailingStamp(send);
    const count = buyerCount(send);
    if (!ids.length && !stamp && !count) continue;
    // Shared provider IDs identify a mailing, even when rows retain different subsets.
    // Without IDs, do not guess that two proposals on the same day were one mailing.
    const matching = groups.filter(g => ids.some(id => g.messageIds.has(id)));
    const group = matching[0] || { key: rowKey, messageIds: new Set(), sends: [], stamps: [], buyerCount: null };
    if (!matching.length) groups.push(group);
    for (const other of matching.slice(1)) {
      other.messageIds.forEach(id => group.messageIds.add(id));
      group.sends.push(...other.sends);
      group.stamps.push(...other.stamps);
      group.buyerCount = Math.max(group.buyerCount || 0, other.buyerCount || 0) || null;
      groups.splice(groups.indexOf(other), 1);
    }
    ids.forEach(id => group.messageIds.add(id));
    group.sends.push(send);
    if (stamp) group.stamps.push(stamp);
    group.buyerCount = Math.max(group.buyerCount || 0, count || 0) || null;
  }
  return groups.map(g => {
    const stamps = [...new Map(g.stamps.map(s => [s.value, s])).values()];
    // Use a precise timestamp where older rows in the same mailing have only its date.
    const precise = stamps.filter(s => s.kind === "instant");
    const candidates = stamps.filter(s => s.kind === "instant" || !precise.some(p => p.value.slice(0, 10) === s.day));
    candidates.sort(newestStamp);
    return {
      key: g.key, sends: g.sends, stamp: candidates[0] || null,
      conflictingDates: candidates.length > 1,
      incomplete: !g.messageIds.size,
      buyerCount: Math.max(g.messageIds.size, g.buyerCount || 0) || null,
    };
  }).sort((a, b) => newestStamp(a.stamp, b.stamp) || a.key.localeCompare(b.key));
}

export function formatRetailerMailingStamp(stamp, language = "pl") {
  if (!stamp) return null;
  const locale = language.toLowerCase().startsWith("en") ? "en-GB" : "pl-PL";
  if (stamp.kind === "date") {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" })
      .format(new Date(`${stamp.value}T00:00:00Z`));
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: MAILING_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(stamp.value));
}
