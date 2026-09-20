// [fix/fm-queue-capacity-save] upsertFmStation: częściowa edycja stanowiska (aktywne / etykieta) jako UPDATE po id,
// nowe stanowisko jako INSERT — ten sam błąd co dla grup (c78b885): partial upsert = INSERT bez queue_group_id (NOT NULL).
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
      const error = state.error || (call.method === "upsert" && !call.row.queue_group_id
        ? { code: "23502", message: "queue_group_id is required for insert" } : null);
      return Promise.resolve({ data: error ? null : { id: "station-1", ...call.row }, error });
    },
  };
  return q;
} } }));

import { upsertFmStation } from "./fm-queue";
beforeEach(() => { state.calls = []; state.error = null; });

describe("station partial edits", () => {
  it("toggles active / sets label by UPDATE on id without resending the group", async () => {
    expect(await upsertFmStation({ id: "station-1", active: false, mode: "open" })).toEqual({ id: "station-1", active: false });
    expect(state.calls).toEqual([{ table: "fm_stations", method: "update", row: { active: false }, filter: ["id", "station-1"] }]);
    state.calls = [];
    await upsertFmStation({ id: "station-1", label: "lewe" });
    expect(state.calls[0]).toEqual({ table: "fm_stations", method: "update", row: { label: "lewe" }, filter: ["id", "station-1"] });
  });
  it("still creates a new station with its group and idx", async () => {
    await upsertFmStation({ queue_group_id: "group-1", idx: 2 });
    expect(state.calls[0]).toEqual({ table: "fm_stations", method: "insert", row: { queue_group_id: "group-1", idx: 2 } });
  });
  it.each(["42501", "PGRST116", "23505"])("surfaces failed writes (%s) instead of success", async code => {
    state.error = { code, message: "write failed" };
    await expect(upsertFmStation({ id: "station-1", active: true })).rejects.toEqual(state.error);
    expect(state.calls).toHaveLength(1);
  });
});
