import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/fm-corrections", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, loadCorrections: vi.fn(), loadCorrectionHistory: vi.fn(), commitCorrection: vi.fn() };
});
vi.mock("../../lib/supabase", () => ({ supabase: {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k, options) => options?.revision ? `${k} ${options.revision}` : options?.count != null ? `${k} ${options.count}` : k }) }));
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
const doubleClick = async node => {
  await act(async () => node.props.onClick({ detail: 1 }));
  await act(async () => node.props.onClick({ detail: 2 }));
  await act(async () => node.props.onDoubleClick());
};
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function render(p = props()) { let tree; await act(async () => { tree = create(<CorrectionBoard {...p}/>); }); trees.push(tree); return tree; }
async function proposeSwap(tree) { await doubleClick(cell(tree, "one:0")); await click(cell(tree, "one:1")); }
beforeEach(() => {
  vi.resetAllMocks(); loadCorrections.mockResolvedValue(draft()); loadCorrectionHistory.mockResolvedValue([]);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { act(() => trees.splice(0).forEach(t => t.unmount())); vi.unstubAllGlobals(); });

describe("confirmed, persistent correction board", () => {
  it("double-click followed by a destination opens a dialog; cancel leaves table and history unchanged", async () => {
    const tree = await render(); await proposeSwap(tree);
    expect(tree.root.findByProps({ role: "dialog" })).toBeTruthy();
    expect(text(tree)).toContain("Company Alpha Full Name"); expect(text(tree)).toContain("Retailer One · #1"); expect(text(tree)).toContain("Retailer One · #2");
    expect(commitCorrection).not.toHaveBeenCalled();
    await click(button(tree, "cancel"));
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha"); expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("repeated single clicks only inspect a company and never arm a move", async () => {
    const tree = await render(); await click(cell(tree, "one:0")); await click(cell(tree, "one:0"));
    expect(cell(tree, "one:0").props["aria-pressed"]).toBe(true);
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
    await click(cell(tree, "one:1"));
    expect(cell(tree, "one:0").props["aria-pressed"]).toBe(false);
    expect(cell(tree, "one:1").props["aria-pressed"]).toBe(true);
    expect(cell(tree, "one:1").props["data-move-source"]).toBe(false);
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("inspection highlights every occurrence and counts meetings even outside the retailer filter", async () => {
    loadCorrections.mockResolvedValue(draft(1, { ...plan, cq: { one: ["a", "b"], two: ["c", null, "a"] } }));
    const tree = await render();
    const preview = () => tree.root.findByProps({ "aria-label": "fm.board.company_preview" });
    const height = preview().props.style.height;
    await click(cell(tree, "one:0"));
    expect(preview().props.style.height).toBe(height);
    expect(cell(tree, "one:0").props["aria-pressed"]).toBe(true);
    expect(cell(tree, "two:2").props["aria-pressed"]).toBe(true);
    expect(text(tree)).toContain("fm.board.meeting_count 2");
    act(() => tree.root.findByType("select").props.onChange({ target: { value: "one" } }));
    expect(preview().findAllByType("span").some(x => x.children.join("") === "Retailer Two · #3")).toBe(true);
    expect(text(tree)).toContain("fm.board.meeting_count 2");
    expect(tree.root.findAllByProps({ "data-cell": "two:2" })).toHaveLength(0);
    expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("native double-click arms only; a destination double-click opens just one confirmation without saving", async () => {
    const tree = await render(); await doubleClick(cell(tree, "one:0"));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(true);
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    await doubleClick(cell(tree, "one:0"));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(true);
    await doubleClick(cell(tree, "one:1"));
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
    expect(commitCorrection).not.toHaveBeenCalled();
    await click(button(tree, "cancel"));
    expect(cell(tree, "one:0").props["aria-pressed"]).toBe(true);
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
  });
  it("explicit move button and Escape support the same safe flow without a mouse double-click", async () => {
    const tree = await render(); await click(cell(tree, "one:0"));
    await click(button(tree, "start_move"));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(true);
    act(() => tree.root.findByType("section").props.onKeyDown({ key: "Escape", preventDefault: vi.fn() }));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
    expect(cell(tree, "one:0").props["aria-pressed"]).toBe(true);
    await click(button(tree, "start_move")); await click(button(tree, "cancel_move"));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
    expect(commitCorrection).not.toHaveBeenCalled();
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
    expect(cell(tree, "one:1").props["aria-pressed"]).toBe(true);
    expect(tree.root.findByProps({ "aria-label": "fm.board.company_preview" }).findAllByType("span").some(x => x.children.join("") === "Retailer One · #2")).toBe(true);
    expect(text(tree)).toContain("Administrator"); expect(p.onApprove).not.toHaveBeenCalled();
    expect(commitCorrection.mock.calls[0][0]).toMatchObject({ action: "swap", revision: 1, details: { from: { cid: "one", pos: 0, sid: "a" }, to: { cid: "one", pos: 1, sid: "b" } } });
    await click(button(tree, "start_move"));
    expect(cell(tree, "one:1").props["data-move-source"]).toBe(true);
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
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
    const tree = await render(p); await doubleClick(cell(tree, "one:0")); await click(cell(tree, "two:5"));
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
    expect(p.onApprove).toHaveBeenCalledWith(plan); expect(cell(tree, "one:0").props.disabled).toBe(false);
    await doubleClick(cell(tree, "one:0"));
    expect(cell(tree, "one:0").props["aria-pressed"]).toBe(true);
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
    expect(text(tree)).toContain("fm.board.confirm_unlock");
    expect(commitCorrection).toHaveBeenCalledTimes(2);
  });
  it("phase gate and load errors never permit editing", async () => {
    const p = props(); p.canEdit = false; const tree = await render(p);
    expect(cell(tree, "one:0").props.disabled).toBe(false); expect(button(tree, "approve").props.disabled).toBe(true);
    await doubleClick(cell(tree, "one:0"));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
    expect(button(tree, "start_move").props.disabled).toBe(true);
    loadCorrections.mockRejectedValue(new Error("missing migration")); await click(button(tree, "reload"));
    expect(text(tree)).toContain("fm.board.errors.network"); expect(commitCorrection).not.toHaveBeenCalled();
  });
  it("missing algorithm inputs block every mutation even when draft and history loaded", async () => {
    const p=props();p.inputsReady=false;loadCorrectionHistory.mockResolvedValue(history);
    const tree=await render(p);
    for(const action of ["undo","rebuild","load_approved","approve"]) expect(button(tree,action).props.disabled).toBe(true);
    expect(cell(tree,"one:0").props.disabled).toBe(true);expect(commitCorrection).not.toHaveBeenCalled();
  });
  it.each(["double-click", "button"])("%s on an uninitialized board guides through snapshot then arms the same meeting", async method => {
    loadCorrections.mockResolvedValue(null);
    const p = props(), tree = await render(p);
    await click(cell(tree, "one:0"));
    expect(button(tree, "start_move").props.disabled).toBe(false);
    if (method === "double-click") await doubleClick(cell(tree, "one:0")); else await click(button(tree, "start_move"));
    expect(text(tree)).toContain("fm.board.confirm_initialize");
    expect(commitCorrection).not.toHaveBeenCalled();
    await click(button(tree, "cancel"));
    expect(commitCorrection).not.toHaveBeenCalled();
    await click(button(tree, "start_move"));
    commitCorrection.mockResolvedValue(draft());
    await click(button(tree, "confirm"));
    expect(commitCorrection).toHaveBeenCalledTimes(1);
    expect(commitCorrection.mock.calls[0][0]).toMatchObject({ action: "initialize", revision: 0, schedule: plan });
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(true);
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha");
    await click(cell(tree, "one:1"));
    expect(text(tree)).toContain("fm.board.confirm_swap");
    expect(commitCorrection).toHaveBeenCalledTimes(1);
    expect(p.onApprove).not.toHaveBeenCalled();
  });
  it("a failed snapshot never arms editing or removes a meeting", async () => {
    loadCorrections.mockResolvedValue(null);
    const tree = await render(); await doubleClick(cell(tree, "one:0"));
    commitCorrection.mockRejectedValue(new Error("fm_correction_conflict"));
    await click(button(tree, "confirm"));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(false);
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha");
    expect(button(tree, "start_move").props.disabled).toBe(true);
  });
  it("move on an approved plan offers unlock, then arms only after successful confirmation", async () => {
    loadCorrections.mockResolvedValue({ ...draft(2), approved: true });
    const tree = await render(); await doubleClick(cell(tree, "one:0"));
    expect(text(tree)).toContain("fm.board.confirm_unlock");
    expect(commitCorrection).not.toHaveBeenCalled();
    commitCorrection.mockResolvedValue(draft(3));
    await click(button(tree, "confirm"));
    expect(commitCorrection).toHaveBeenCalledWith(expect.objectContaining({ action: "unlock", revision: 2 }));
    expect(cell(tree, "one:0").props["data-move-source"]).toBe(true);
  });
  it("removal names the exact meeting, supports cancellation, and only updates after confirmed save", async () => {
    const twoMeetings = { ...plan, cq: { one: ["a", "b", null], two: ["c", null, "a"] } };
    loadCorrections.mockResolvedValue(draft(1, twoMeetings));
    const p = props(), tree = await render(p); await click(cell(tree, "one:0")); await click(button(tree, "remove_meeting"));
    const dialog = tree.root.findByProps({ role: "dialog" });
    expect(text(tree)).toContain("fm.board.confirm_remove");
    expect(dialog.findByType("strong").children.join("")).toBe("Company Alpha Full Name");
    expect(dialog.findAllByType("p").some(x => x.children.includes("Retailer One · #1"))).toBe(true);
    expect(commitCorrection).not.toHaveBeenCalled();
    await click(button(tree, "cancel")); expect(commitCorrection).not.toHaveBeenCalled();
    await click(button(tree, "remove_meeting"));
    const request = deferred(); commitCorrection.mockReturnValue(request.promise);
    let result; act(() => { result = button(tree, "confirm").props.onClick(); });
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha");
    const next = draft(2, { ...twoMeetings, cq: { ...twoMeetings.cq, one: [null, "b", null] } });
    const removal = { ...history[0], action: "remove", details: { from: history[0].details.from } };
    loadCorrectionHistory.mockResolvedValue([removal]);
    await act(async () => { request.resolve(next); await result; });
    expect(commitCorrection.mock.calls[0][0]).toMatchObject({ action: "remove", revision: 1, details: { from: { cid: "one", pos: 0, sid: "a" } } });
    expect(cell(tree, "one:0").props.title).toBe("fm.board.empty_cell");
    expect(cell(tree, "one:1").props.title).toContain("Company Beta");
    expect(cell(tree, "two:2").props.title).toContain("Company Alpha");
    expect(text(tree)).toContain("fm.board.action_remove");
    expect(text(tree)).toContain("fm.board.meeting_count 1");
    expect(p.onApprove).not.toHaveBeenCalled();
    await click(button(tree, "undo"));
    expect(text(tree)).toContain("fm.board.confirm_undo");
    loadCorrectionHistory.mockResolvedValue([{ ...history[0], id: "undo-3", action: "undo", details: { undo_of: removal.id, undo_revision: 2, original: removal.details } }, removal]);
    commitCorrection.mockResolvedValue(draft(3, twoMeetings)); await click(button(tree, "confirm"));
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha");
    expect(text(tree)).toContain("fm.board.restored_meeting");
  });
  it("first removal requires a separate confirmation after initializing the snapshot", async () => {
    loadCorrections.mockResolvedValue(null); const tree = await render();
    await click(cell(tree, "one:0")); await click(button(tree, "remove_meeting"));
    expect(text(tree)).toContain("fm.board.confirm_initialize");
    commitCorrection.mockResolvedValue(draft()); await click(button(tree, "confirm"));
    expect(commitCorrection).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain("fm.board.confirm_remove");
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha");
    await click(button(tree, "cancel")); expect(commitCorrection).toHaveBeenCalledTimes(1);
  });
  it("failed removal keeps the meeting and freezes further edits until refresh", async () => {
    const tree = await render(); await click(cell(tree, "one:0")); await click(button(tree, "remove_meeting"));
    commitCorrection.mockRejectedValue(new Error("fm_correction_conflict")); await click(button(tree, "confirm"));
    expect(cell(tree, "one:0").props.title).toContain("Company Alpha");
    expect(button(tree, "remove_meeting").props.disabled).toBe(true);
    expect(text(tree)).toContain("fm.board.errors.fm_correction_conflict");
  });
});
