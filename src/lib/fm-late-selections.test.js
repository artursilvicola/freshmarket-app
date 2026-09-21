import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ calls: [], response: () => ({ data: [], error: null }) }));
vi.mock("./supabase", () => ({ supabase: { from(table) {
  const call = { table, ops: [] }; mock.calls.push(call);
  const chain = { then: (resolve, reject) => Promise.resolve(mock.response(call)).then(resolve, reject) };
  for (const name of ["select", "order", "eq", "range", "upsert", "delete", "single"]) {
    chain[name] = (...args) => { call.ops.push([name, ...args]); return chain; };
  }
  return chain;
} } }));
import { loadLateSelections, saveLateSelection, setLateAccess } from "./fm-late-selections";

beforeEach(() => { mock.calls = []; mock.response = () => ({ data: [], error: null }); });

describe("separate late requests data layer", () => {
  it("reads all pages and restricts both reads to the buyer's retailer", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    mock.response = call => ({ data: call.table === "fm_late_selection_access" ? [{ retailer_id: 100, enabled: true }]
      : call.ops.find(op => op[0] === "range")[1] === 0 ? page : [{ id: 500 }], error: null });
    const result = await loadLateSelections(100);
    expect(result.rows).toHaveLength(501);
    expect(result.access).toEqual([{ retailer_id: 100, enabled: true }]);
    expect(mock.calls.every(c => c.ops.some(op => op[0] === "eq" && op[1] === "retailer_id" && op[2] === 100))).toBe(true);
    expect(mock.calls.filter(c => c.table === "fm_late_resps").map(c => c.ops.find(op => op[0] === "range"))).toEqual([["range", 0, 499], ["range", 500, 999]]);
  });

  it("does not turn a missing migration or failed page into an empty inbox", async () => {
    const failure = { code: "PGRST205", message: "missing table" };
    mock.response = () => ({ data: null, error: failure });
    await expect(loadLateSelections()).rejects.toEqual(failure);
    expect(mock.calls.every(c => !c.ops.some(op => op[0] === "eq"))).toBe(true);
  });

  it("writes only the access table and late request table, never algorithm inputs", async () => {
    mock.response = () => ({ data: { id: "saved" }, error: null });
    await setLateAccess(100, true);
    await saveLateSelection(100, "supplier", "want");
    await saveLateSelection(100, "supplier", "chance");
    expect(mock.calls.map(c => c.table)).toEqual(["fm_late_selection_access", "fm_late_resps", "fm_late_resps"]);
    expect(mock.calls.every(c => c.ops.some(op => op[0] === "single"))).toBe(true);
    expect(mock.calls[1].ops.find(op => op[0] === "upsert")[1]).toMatchObject({ retailer_id: 100, supplier_legacy_id: "supplier", zone: "want" });
  });

  it("requires confirmation of the deleted pair; a zero-row RLS delete is an error", async () => {
    mock.response = () => ({ data: null, error: { code: "PGRST116" } });
    await expect(saveLateSelection(100, "supplier", null)).rejects.toMatchObject({ code: "PGRST116" });
    expect(mock.calls[0].ops).toEqual([["delete"], ["eq", "retailer_id", 100], ["eq", "supplier_legacy_id", "supplier"], ["select", "id"], ["single"]]);
    mock.response = () => ({ data: { id: "deleted" }, error: null });
    await expect(saveLateSelection(100, "supplier", null)).resolves.toBe(null);
  });

  it("rejects an unsupported response without sending any request", async () => {
    await expect(saveLateSelection(100, "supplier", "maybe")).rejects.toThrow("invalid_late_selection");
    expect(mock.calls).toHaveLength(0);
  });
});
