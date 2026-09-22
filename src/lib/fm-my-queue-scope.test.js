import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] }));
vi.mock("./supabase", () => ({ supabase: { from(table) {
  const call = { table, filters: [] }; state.calls.push(call);
  const query = {
    select() { return query; }, order() { return query; }, abortSignal() { return query; },
    eq(column, value) { call.filters.push([column, value]); return query; },
    then(resolve, reject) {
      // An admin can read all companies and dates. Only actual query filters narrow the result.
      const rows = [
        { company_id: "a", event_date: "2026-09-24", nr: 58 },
        { company_id: "b", event_date: "2026-09-24", nr: 1 },
        { company_id: "a", event_date: "2026-09-22", nr: 99 },
      ].filter(row => call.filters.every(([column, value]) => row[column.split(".").at(-1)] === value));
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return query;
} } }));
import { listMyFmQueueMeetings } from "./fm-queue.js";
beforeEach(() => { state.calls.length = 0; });

describe("listMyFmQueueMeetings — explicit company and event date", () => {
  it("an admin preview reads only the viewed company's production numbers", async () => {
    expect(await listMyFmQueueMeetings("2026-09-24", { companyId: "a" })).toEqual([
      { company_id: "a", event_date: "2026-09-24", nr: 58 },
    ]);
    expect(await listMyFmQueueMeetings("2026-09-24", { companyId: "b" })).toEqual([
      { company_id: "b", event_date: "2026-09-24", nr: 1 },
    ]);
  });
  it("missing company or date never falls back to an unrestricted read", async () => {
    expect(await listMyFmQueueMeetings("2026-09-24")).toEqual([]);
    expect(await listMyFmQueueMeetings(null, { companyId: "a" })).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});
