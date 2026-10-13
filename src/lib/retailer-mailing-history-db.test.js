import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), order: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { from: query.from } }));
vi.mock("../i18n", () => ({ default: { t: key => key } }));
import { loadLegacySends } from "./db.js";
import { buildRetailerMailingHistory } from "./retailer-mailing-history.js";

beforeEach(() => {
  vi.clearAllMocks();
  query.from.mockReturnValue({ select: query.select });
  query.select.mockReturnValue({ order: query.order });
});

describe("saved delivery metadata reaches admin history", () => {
  it("retains the original sender's dedicated-column-only confirmation without inventing a date", async () => {
    query.order.mockResolvedValue({ data: [{ resend_message_id: "old-provider-id", data: {
      id: 1, retailerId: 42, status: "read", sentAt: "2026-09-01", readAt: "2026-09-03",
    } }], error: null });
    const sends = await loadLegacySends();
    expect(query.from).toHaveBeenCalledWith("legacy_sends");
    expect(query.select).toHaveBeenCalledWith("data, resend_message_id");
    const entries = buildRetailerMailingHistory(sends, 42);
    expect(entries).toHaveLength(1);
    expect(entries[0].stamp).toBeNull();
    expect(entries[0].buyerCount).toBe(1);
    expect(entries[0].incomplete).toBe(false);
  });

  it("preserves modern timestamps, all message IDs and read/billing fields", async () => {
    const data = { id: 1, retailerId: 42, status: "read", chargeAt: "2026-10-06", supplierNotifiedAt: "2026-10-06",
      resendMessageIds: ["one", "two"], emailSentAt: "2026-10-06T12:00:00Z" };
    query.order.mockResolvedValue({ data: [{ data, resend_message_id: "one" }], error: null });
    const rows = await loadLegacySends();
    expect(rows[0]).toMatchObject(data);
    expect(buildRetailerMailingHistory(rows, 42)[0].buyerCount).toBe(2);
    expect(data).not.toHaveProperty("resend_message_id");
  });

  it("does not turn an unsent record into a mailing or erase JSON-only legacy IDs", async () => {
    query.order.mockResolvedValue({ data: [
      { data: { id: 1, retailerId: 42, status: "sent" }, resend_message_id: null },
      { data: { id: 2, retailerId: 42, resendMessageId: "json-only" }, resend_message_id: null },
    ], error: null });
    const entries = buildRetailerMailingHistory(await loadLegacySends(), 42);
    expect(entries).toHaveLength(1);
    expect(entries[0].sends[0].id).toBe(2);
  });
});
