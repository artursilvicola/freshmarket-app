// [fix/fm-queue-capacity-save] Stanowiska w „Dzień wydarzenia → Stanowiska”: osobny przełącznik
// aktywności, osobny przycisk zmiany etykiety i usunięcie — zmiana nazwy NIGDY nie wyłącza stanowiska
// (review Codexa b53f406: klik/dwuklik na jednym elemencie). Kontrolki zablokowane na czas zapisu.
import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({ save: vi.fn(), del: vi.fn(), groups: [] }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ profile: { is_super_admin: true } }) }));
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) } }));
vi.mock("../../staff/staffUi", () => ({ MODE_LABEL: {}, humanFmError: e => e?.message || String(e) }));
vi.mock("../../lib/fm-queue", () => ({
  listFmQueueGroups: async () => m.groups,
  listFmStaff: async () => [], getFmQueueSettings: async () => null,
  fmQueueRpc: { publicSnapshot: async () => null },
  upsertFmStation: (...args) => m.save(...args), upsertFmQueueGroup: vi.fn(),
  deleteFmQueueGroup: vi.fn(), deleteFmStation: (...args) => m.del(...args), isMissingObjectError: () => false,
  listFmQueueLog: async () => [], listFmQueueMeetings: async () => [],
  saveFmQueueSettings: vi.fn(), subscribeFmQueue: () => () => {}, updateFmStaff: vi.fn(),
}));
import FmEventDay from "./FmEventDay";

const RETAILERS = [{ id: 1, name: "TEST", fm26Active: true, fm26ChainId: "test" }];
const group = (stations) => [{ id: "g", retailer_id: 1, active: true, meetings_per_station: 60, fm_stations: stations }];
let tree;
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
async function render(stations = [{ id: "s", idx: 1, active: true, label: null }]) {
  m.groups = group(stations);
  await act(async () => { tree = create(<FmEventDay retailers={RETAILERS} />); });
  await tick();
}
const checkbox = (id) => tree.root.findAllByType("input").find(n => n.props.type === "checkbox" && n.props["aria-label"]?.startsWith("Stanowisko") && tree.root.findAll(x => x.props?.["data-testid"] === `station-${id}`)[0].findAll(y => y === n).length);
const pencil = (id) => tree.root.findAll(x => x.props?.["data-testid"] === `station-${id}`)[0].findAll(n => n.type === "button" && n.props.title === "Zmień etykietę stanowiska")[0];
const trash = (id) => tree.root.findAll(x => x.props?.["data-testid"] === `station-${id}`)[0].findAll(n => n.type === "button" && n.props.title === "Usuń stanowisko")[0];

beforeEach(() => { m.save.mockReset(); m.del.mockReset(); m.save.mockResolvedValue({}); m.del.mockResolvedValue({}); vi.stubGlobal("window", { prompt: vi.fn(() => "Lewe"), confirm: vi.fn(() => true) }); });
afterEach(() => { act(() => tree?.unmount()); tree = null; vi.unstubAllGlobals(); });

describe("stanowiska: osobne kontrolki", () => {
  it("żaden element stanowiska nie łączy klik/dwuklik; zmiana etykiety zapisuje TYLKO etykietę", async () => {
    await render();
    expect(tree.root.findAll(n => n.props?.onDoubleClick)).toHaveLength(0);
    let finish; m.save.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    await act(async () => { pencil("s").props.onClick(); });
    expect(window.prompt).toHaveBeenCalledTimes(1);
    expect(m.save.mock.calls).toEqual([[{ id: "s", label: "Lewe" }]]);   // bez active:false
    await act(async () => { finish({}); }); await tick();
  });

  it("anulowanie promptu albo ta sama etykieta = brak zapisu i brak zmiany aktywności", async () => {
    await render([{ id: "s", idx: 1, active: true, label: "Lewe" }]);
    window.prompt.mockReturnValueOnce(null);
    await act(async () => { pencil("s").props.onClick(); });
    window.prompt.mockReturnValueOnce("Lewe");
    await act(async () => { pencil("s").props.onClick(); });
    expect(m.save).not.toHaveBeenCalled();
    expect(checkbox("s").props.checked).toBe(true);
  });

  it("przełącznik aktywności zapisuje TYLKO active", async () => {
    await render();
    await act(async () => { checkbox("s").props.onChange(); }); await tick();
    expect(m.save.mock.calls).toEqual([[{ id: "s", active: false }]]);
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it("w trakcie zapisu przełącznik, ołówek, usuwanie i „+” są zablokowane, a kolejne kliknięcia nic nie zapisują", async () => {
    await render([{ id: "s", idx: 1, active: true, label: null }, { id: "s2", idx: 2, active: true, label: null }]);
    let finish; m.save.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    await act(async () => { checkbox("s").props.onChange(); });                   // zapis w toku
    expect(checkbox("s").props.disabled).toBe(true);
    expect(pencil("s").props.disabled).toBe(true);
    expect(trash("s").props.disabled).toBe(true);
    expect(tree.root.findAllByType("button").find(b => b.children.includes("+")).props.disabled).toBe(true);
    await act(async () => { pencil("s").props.onClick(); checkbox("s2").props.onChange(); trash("s2").props.onClick(); });   // obejście atrybutu disabled
    expect(m.save).toHaveBeenCalledTimes(1);
    expect(m.del).not.toHaveBeenCalled();
    await act(async () => { finish({}); }); await tick();
    expect(checkbox("s").props.disabled).toBe(false);
    expect(pencil("s").props.disabled).toBe(false);
  });

  it("usunięcie: tylko przy > 1 stanowisku, po potwierdzeniu, bez zmiany aktywności", async () => {
    await render();
    expect(trash("s")).toBeUndefined();
    act(() => tree.unmount()); tree = null;
    await render([{ id: "s", idx: 1, active: true, label: null }, { id: "s2", idx: 2, active: true, label: null }]);
    window.confirm.mockReturnValueOnce(false);
    await act(async () => { trash("s2").props.onClick(); });
    expect(m.del).not.toHaveBeenCalled();
    await act(async () => { trash("s2").props.onClick(); }); await tick();
    expect(m.del.mock.calls).toEqual([["s2"]]);
    expect(m.save).not.toHaveBeenCalled();
  });
});
