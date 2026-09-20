import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [], error: null }));
vi.mock("./supabase", () => ({ supabase: { from(table) {
  const call = { table }; state.calls.push(call);
  const q = {
    update(row) { call.method = "update"; call.row = row; return q; },
    insert(row) { call.method = "insert"; call.row = row; return q; },
    upsert(row) { call.method = "upsert"; call.row = row; return q; },
    eq(key, value) { call.filter = [key, value]; return q; },
    select() { return q; },
    single() {
      const error = state.error || (call.method === "upsert" && !call.row.event_date
        ? { code: "23502", message: "event_date is required for insert" } : null);
      return Promise.resolve({ data: error ? null : { id: "group-1", ...call.row }, error });
    },
  };
  return q;
} } }));

import { upsertFmQueueGroup } from "./fm-queue";
beforeEach(() => { state.calls = []; state.error = null; });

describe("queue group partial edits", () => {
  it("saves capacity without resending required creation fields or other configuration", async () => {
    expect(await upsertFmQueueGroup({ id: "group-1", meetings_per_station: 50, last_called_nr: 0 }))
      .toEqual({ id: "group-1", meetings_per_station: 50 });
    expect(state.calls).toEqual([{ table: "fm_queue_groups", method: "update",
      row: { meetings_per_station: 50 }, filter: ["id", "group-1"] }]);
  });
  it("still creates new groups with their date and retailer", async () => {
    await upsertFmQueueGroup({ event_date: "2026-09-24", retailer_id: 1, label: "", meetings_per_station: 60 });
    expect(state.calls[0]).toEqual({ table: "fm_queue_groups", method: "insert",
      row: { event_date: "2026-09-24", retailer_id: 1, label: null, meetings_per_station: 60 } });
  });
  it.each(["42501", "PGRST116", "23514"])("surfaces failed writes (%s) instead of success", async code => {
    state.error = { code, message: "write failed" };
    await expect(upsertFmQueueGroup({ id: "group-1", meetings_per_station: 50 }))
      .rejects.toEqual(state.error);
    expect(state.calls).toHaveLength(1);
  });
});
