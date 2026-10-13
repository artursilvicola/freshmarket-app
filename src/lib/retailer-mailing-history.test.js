import { describe, expect, it } from "vitest";
import { buildRetailerMailingHistory as history, retailerMailingStamp as stamp, formatRetailerMailingStamp as format } from "./retailer-mailing-history.js";

const sent = (id, extra = {}) => ({ id, retailerId: 1, status: "sent", emailSentAt: "2026-10-06T12:14:22Z", resendMessageIds: ["mail-a", "mail-b"], resendBuyerCount: 2, ...extra });

describe("retailer mailing history", () => {
  it("groups a batch with several proposals and buyers into one entry, not one per credit or email", () => {
    const rows = [sent(1), sent(2, { status: "read" }), sent(3, { status: "refunded" })];
    const before = JSON.stringify(rows);
    const entries = history(rows, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0].sends).toHaveLength(3);
    expect(entries[0].buyerCount).toBe(2);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("keeps retailers separate and accepts numeric/string IDs", () => {
    expect(history([sent(1), sent(2, { retailerId: 2 })], "1")[0].sends.map(s => s.id)).toEqual([1]);
    expect(history([sent(1)], null)).toEqual([]);
  });

  it("does not mistake panel dates, read dates, planning or supplier notifications for mailings", () => {
    const rows = ["approved", "sent", "read", "opened", "unread_expired"].map((status, id) => ({
      id, retailerId: 1, status, sentAt: "2026-10-13T12:00:00Z", sendDate: "2026-10-13",
      plannedMailingAt: "2026-11-03", readAt: "2026-10-13", supplierNotifiedAt: "2026-10-13",
    }));
    expect(history(rows, 1)).toEqual([]);
  });

  it("sorts newest first using actual instants even with different offsets", () => {
    const entries = history([
      sent(1, { emailSentAt: "2026-10-06T14:30:00+02:00", resendMessageIds: ["a"] }),
      sent(2, { emailSentAt: "2026-10-06T13:00:00Z", resendMessageIds: ["b"] }),
    ], 1);
    expect(entries.map(e => e.sends[0].id)).toEqual([2, 1]);
  });

  it("handles PostgreSQL timestamps, snake case and nested legacy data", () => {
    const row = { data: { id: 1, retailerId: 1, email_sent_at: "2026-10-06 12:14:22.123456+00", resend_message_id: "a" } };
    expect(history([row], 1)[0].stamp.value).toBe("2026-10-06T12:14:22.123Z");
  });

  it("prefers precise email time over mailingSentAt date and never invents midnight", () => {
    expect(stamp(sent(1, { mailingSentAt: "2026-10-06" })).kind).toBe("instant");
    const date = stamp({ mailingSentAt: "2026-10-06" });
    expect(date.kind).toBe("date");
    expect(format(date)).toBe("06.10.2026");
    expect(format(stamp({ emailSentAt: "2026-10-06", email_sent_at: "2026-10-06T12:14:22Z" }))).toContain("14:14");
  });

  it("uses Warsaw time including summer/winter time and midnight rollover", () => {
    expect(format(stamp(sent(1)))).toBe("06.10.2026, 14:14");
    expect(format(stamp({ emailSentAt: "2026-12-01T12:14:22Z" }), "en")).toBe("01/12/2026, 13:14");
    expect(format(stamp({ emailSentAt: "2026-10-06T23:14:22Z" }))).toBe("07.10.2026, 01:14");
  });

  it("ignores malformed dates and timezone-less timestamps instead of guessing the browser timezone", () => {
    for (const value of ["bad", "2026-02-30", "2026-10-06T12:14:22", "", null]) {
      expect(stamp({ emailSentAt: value })).toBeNull();
    }
  });

  it("retains undated confirmed mailings without borrowing the panel date", () => {
    const entries = history([sent(1, { emailSentAt: null, sentAt: "2026-10-06" })], 1);
    expect(entries).toHaveLength(1);
    expect(entries[0].stamp).toBeNull();
    expect(entries[0].buyerCount).toBe(2);
  });

  it("does not invent batches by merging legacy date-only records with no provider IDs", () => {
    const entries = history([1, 2].map(id => ({ id, retailerId: 1, mailingSentAt: "2026-10-06" })), 1);
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.incomplete && e.buyerCount === null)).toBe(true);
  });

  it("deduplicates rows and joins shared provider IDs including transitive subsets", () => {
    const entries = history([sent(1, { resendMessageIds: ["a"] }), sent(2, { resendMessageIds: ["b"] }),
      sent(3, { resendMessageIds: ["a", "b"] }), sent(3)], 1);
    expect(entries).toHaveLength(1);
    expect(entries[0].sends).toHaveLength(3);
    expect(entries[0].buyerCount).toBe(2);
  });

  it("does not multiply recipient counts per proposal or read live buyer profiles", () => {
    expect(history([sent(1, { resendBuyerCount: 3 }), sent(2, { resendBuyerCount: 3 })], 1)[0].buyerCount).toBe(3);
    expect(history([{ id: 1, retailerId: 1, resendBuyerEmails: ["test@example.invalid"] }], 1)[0].buyerCount).toBe(1);
  });

  it("uses precise stamps in a mixed legacy batch, but flags conflicting saved times", () => {
    expect(history([sent(1), sent(2, { emailSentAt: "2026-10-06" })], 1)[0].conflictingDates).toBe(false);
    expect(history([sent(1), sent(2, { emailSentAt: "2026-10-07T12:00:00Z" })], 1)[0].conflictingDates).toBe(true);
  });

  it("matches a legacy UTC date to a precise timestamp even after Warsaw midnight", () => {
    const entry = history([sent(1, { emailSentAt: "2026-10-06T23:14:22Z" }),
      sent(2, { emailSentAt: null, mailingSentAt: "2026-10-06" })], 1)[0];
    expect(entry.conflictingDates).toBe(false);
    expect(format(entry.stamp)).toBe("07.10.2026, 01:14");
  });

  it("does not sort an unknown UTC hour before a known Warsaw time just after midnight", () => {
    const entries = history([sent(1, { emailSentAt: "2026-10-06T23:14:22Z", resendMessageIds: ["a"] }),
      sent(2, { emailSentAt: null, mailingSentAt: "2026-10-06", resendMessageIds: ["b"] })], 1);
    expect(entries[0].stamp.kind).toBe("date");
  });
});
