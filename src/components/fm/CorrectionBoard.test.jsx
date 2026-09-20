import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/fm-corrections", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, loadCorrections: vi.fn(), loadCorrectionHistory: vi.fn(), commitCorrection: vi.fn() };
});
vi.mock("../../lib/supabase", () => ({ supabase: {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k, options) => options?.revision ? `${k} ${options.revision}` : k }) }));
import { commitCorrection, loadCorrections, loadCorrectionHistory } from "../../lib/fm-corrections";
import CorrectionBoard from "./CorrectionBoard";
const plan = { cq: { one: ["a", "b", null], two: ["c", null, null] }, res: { a: { m: ["one"] }, b: { m: ["one"] }, c: { m: ["two"] } }, overrides: {} };
const draft = (revision = 1, schedule = plan) => ({ id: 1, revision, schedule, approved: false });
const props = () => ({ data: plan, fmChains: [{ id: "one", name: "Retailer One" }, { id: "two", name: "Retailer Two" }], fmSuppliers: [{ id: "a", name: "Company Alpha Full Name" }, { id: "b", name: "Company Beta Full Name" }, { id: "c", name: "Company Gamma" }], fmResps: {}, inputsReady: true, canEdit: true, onApprove: vi.fn(), onDraftChange: vi.fn(), buildCandidate: vi.fn(() => plan) });
const history = [{ id: "change-2", revision: 2, action: "swap", details: { from: { cid: "one", pos: 0, sid: "a", company: "Company Alpha Full Name", chain: "Retailer One" }, to: { cid: "one", pos: 1, sid: "b", company: "Company Beta Full Name", chain: "Retailer One" } }, actor_name: "Administrator", created_at: "2026-09-20T12:00:00Z" }];
const trees = [];
const text = tree => JSON.stringify(tree.toJSON());
const button = (tree, key) => tree.root.findAllByType("button").find(x => x.children.includes("fm.board." + key));
const cell = (tree, id) => tree.root.findByProps({ "data-cell": id });
const click = async node => { await act(async () => { await node.props.onClick(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function render(p = props()) { let tree; await act(async () => { tree = create(<CorrectionBoard {...p}/>); }); trees.push(tree); return tree; }
async function proposeSwap(tree) { await click(cell(tree, "one:0")); await click(cell(tree, "one:1")); }
beforeEach(() => {
  vi.resetAllMocks(); loadCorrections.mockResolvedValue(draft()); loadCorrectionHistory.mockResolvedValue([]);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { act(() => trees.splice(0).forEach(t => t.unmount())); vi.unstubAllGlobals(); });

describe("confirmed, persistent correction board", () => {
  it("two clicks open a dialog with full names and positions; cancel leaves both table and history unchanged", async () => {
    const tree = await render(); await proposeSwap(tree);
    expect(tree.root.findByProps({ role: "dialog" })).toBeTruthy();
    expect(text(tree)).toContain("Company Alpha Full Name"); expect(text(tree)).toContain("Retailer One · #1"); expect(text(tree)).toContain("Retailer One · #2");
    expect(commitCorrection).not.toHaveBeenCalled();
    await click(button(tree, "cancel"));
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha"); expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("second click on the same cell clears selection without requesting a save", async () => {
    const tree = await render(); await click(cell(tree, "one:0")); await click(cell(tree, "one:0"));
    expect(cell(tree, "one:0").props["aria-pressed"]).toBe(false); expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("confirmation waits for a successful atomic save; repeated click sends one request", async () => {
    const p = props(), tree = await render(p); await proposeSwap(tree);
    const request = deferred(); commitCorrection.mockReturnValue(request.promise);
    const confirm = button(tree, "confirm"); let result;
    act(() => { result = confirm.props.onClick(); confirm.props.onClick(); });
    expect(commitCorrection).toHaveBeenCalledTimes(1);
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha"); expect(button(tree, "cancel").props.disabled).toBe(true);
    const next = draft(2, { ...plan, cq: { ...plan.cq, one: ["b", "a", null] } });
    loadCorrectionHistory.mockResolvedValue(history);
    await act(async () => { request.resolve(next); await result; });
    expect(cell(tree, "one:0").props.title).toContain("Company Beta");
    expect(text(tree)).toContain("Administrator"); expect(p.onApprove).not.toHaveBeenCalled();
    expect(commitCorrection.mock.calls[0][0]).toMatchObject({ action: "swap", revision: 1, details: { from: { cid: "one", pos: 0, sid: "a" }, to: { cid: "one", pos: 1, sid: "b" } } });
  });
  it("a failed save or revision conflict retains the confirmed board and requires refresh", async () => {
    const tree = await render(); await proposeSwap(tree);
    commitCorrection.mockRejectedValue(new Error("fm_correction_conflict")); await click(button(tree, "confirm"));
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha"); expect(cell(tree, "one:0").props.disabled).toBe(true);
    expect(text(tree)).toContain("fm.board.errors.fm_correction_conflict");
    loadCorrections.mockResolvedValue(draft(2, { ...plan, cq: { ...plan.cq, one: ["b", "a", null] } })); await click(button(tree, "reload"));
    expect(cell(tree, "one:0").props.disabled).toBe(false); expect(cell(tree, "one:0").props.title).toContain("Company Beta");
  });
  it("after a lost history read, the successful board stays and refresh obtains history", async () => {
    const tree = await render(); await proposeSwap(tree);
    commitCorrection.mockResolvedValue(draft(2, { ...plan, cq: { ...plan.cq, one: ["b", "a", null] } }));
    loadCorrectionHistory.mockRejectedValue(new Error("network")); await click(button(tree, "confirm"));
    expect(cell(tree, "one:0").props.title).toContain("Company Beta"); expect(cell(tree, "one:0").props.disabled).toBe(true);
    expect(commitCorrection).toHaveBeenCalledTimes(1);
  });
  it("a new panel reads saved board/history and offers undo, which also requires confirmation", async () => {
    loadCorrections.mockResolvedValue(draft(2)); loadCorrectionHistory.mockResolvedValue(history);
    const tree = await render(); await click(button(tree, "undo"));
    expect(commitCorrection).not.toHaveBeenCalled(); expect(text(tree)).toContain("fm.board.confirm_undo");
    commitCorrection.mockResolvedValue(draft(3)); await click(button(tree, "confirm"));
    expect(commitCorrection).toHaveBeenCalledWith(expect.objectContaining({ action: "undo", revision: 2, details: { undo_of: "change-2" } }));
  });
  it("moving to an empty cell is explicit, includes both retailers, and requires refusal acknowledgment", async () => {
    const p = props(); p.fmResps = { two: { a: "remove" } };
    const tree = await render(p); await click(cell(tree, "one:0")); await click(cell(tree, "two:5"));
    expect(text(tree)).toContain("fm.board.confirm_move"); expect(text(tree)).toContain("fm.board.cross_chain"); expect(text(tree)).toContain("Retailer Two · #6");
    expect(button(tree, "confirm").props.disabled).toBe(true);
    act(() => tree.root.findByType("input").props.onChange({ target: { checked: true } }));
    expect(button(tree, "confirm").props.disabled).toBe(false);
    commitCorrection.mockResolvedValue(draft(2)); await click(button(tree, "confirm"));
    expect(commitCorrection.mock.calls[0][0]).toMatchObject({ action: "move", details: { accept_rejections: true, to: { cid: "two", pos: 5, sid: null } } });
  });
  it.each(["initialize", "rebuild", "load_approved", "approve", "unlock"])("%s has explicit confirmation before any RPC", async action => {
    if (action === "initialize") loadCorrections.mockResolvedValue(null);
    if (action === "unlock") loadCorrections.mockResolvedValue({ ...draft(), approved: true });
    const p = props(), tree = await render(p); await click(button(tree, action));
    expect(commitCorrection).not.toHaveBeenCalled();
    expect(text(tree)).toContain("fm.board.confirm_" + action);
    await click(button(tree, "cancel")); expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("approval callback occurs only after the server confirms, never on failure", async () => {
    const p = props(), tree = await render(p); await click(button(tree, "approve"));
    commitCorrection.mockRejectedValue(new Error("network")); await click(button(tree, "confirm")); expect(p.onApprove).not.toHaveBeenCalled();
    await click(button(tree, "reload")); await click(button(tree, "approve"));
    commitCorrection.mockResolvedValue({ ...draft(2), approved: true }); await click(button(tree, "confirm"));
    expect(p.onApprove).toHaveBeenCalledWith(plan); expect(cell(tree, "one:0").props.disabled).toBe(true);
  });
  it("phase gate and load errors never permit editing", async () => {
    const p = props(); p.canEdit = false; const tree = await render(p);
    expect(cell(tree, "one:0").props.disabled).toBe(true); expect(button(tree, "approve").props.disabled).toBe(true);
    loadCorrections.mockRejectedValue(new Error("missing migration")); await click(button(tree, "reload"));
    expect(text(tree)).toContain("fm.board.errors.network"); expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("missing algorithm inputs block every mutation even when draft and history loaded", async () => {
    const p=props();p.inputsReady=false;loadCorrectionHistory.mockResolvedValue(history);
    const tree=await render(p);
    for(const action of ["undo","rebuild","load_approved","approve"]) expect(button(tree,action).props.disabled).toBe(true);
    expect(cell(tree,"one:0").props.disabled).toBe(true);expect(commitCorrection).not.toHaveBeenCalled();
  });
});
