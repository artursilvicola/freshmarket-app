import { describe, expect, it, vi } from "vitest";
vi.mock("./supabase", () => ({ supabase: {} }));
import { describeChange, undoCandidate } from "./fm-corrections";
import pl from "../i18n/pl/legacy.json";
import en from "../i18n/en/legacy.json";
const plan = { cq: { one: ["a", "b"], two: [null, null, "a"] } };
describe("correction proposals", () => {
  it("does not mutate the plan, flags spacing and shows full coordinates", () => {
    const before = JSON.stringify(plan);
    const result = describeChange(plan, { cid: "one", pos: 0 }, { cid: "one", pos: 1 }, [{ id: "a", name: "Alpha" }], [{ id: "one", name: "One" }, { id: "two", name: "Two" }]);
    expect(result.a.company).toBe("Alpha"); expect(result.warnings).toHaveLength(1);
    expect(JSON.stringify(plan)).toBe(before);
  });
  it("prevents duplicate company/retailer meetings and ignores same-company swap", () => {
    expect(() => describeChange(plan, { cid: "one", pos: 0 }, { cid: "two", pos: 0 }, [], [])).toThrow("fm_correction_duplicate");
    expect(describeChange(plan, { cid: "one", pos: 0 }, { cid: "two", pos: 2 }, [], [])).toBe(null);
  });
  it("undo selects the latest un-reverted operation, never erases the history", () => {
    const rows = [{ id: "u", action: "undo", details: { undo_of: "second" } }, { id: "second", action: "move" }, { id: "first", action: "swap" }, { id: "start", action: "initialize" }];
    expect(undoCandidate(rows)?.id).toBe("first"); expect(rows).toHaveLength(4);
  });
  it("PL/EN contain matching confirmation, history and error messages", () => {
    expect(Object.keys(pl.fm.board).sort()).toEqual(Object.keys(en.fm.board).sort());
    expect(Object.keys(pl.fm.board.errors).sort()).toEqual(Object.keys(en.fm.board.errors).sort());
  });
});
