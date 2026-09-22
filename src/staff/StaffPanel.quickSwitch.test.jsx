import React from "react";
import { create, act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/fm-queue", () => ({ staffApi: {}, newIdemKey: () => "quick-switch-idem" }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("./StaffLoginPage", () => ({ default: () => null, LangToggle: () => null }));
vi.mock("../i18n", () => ({ default: { language: "pl", changeLanguage: () => {} } }));
import { Operator } from "./StaffPanel";
import { STAFF_DICT } from "./staffI18n";

let tree;
const textOf = n => typeof n === "string" ? n : (n.children || []).map(textOf).join("");
const text = () => textOf(tree.root);
const quick = id => tree.root.findByProps({ "data-testid": `quick-station-${id}` });
const button = label => tree.root.findAllByType("button").find(n => textOf(n).startsWith(label));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const click = async node => { await act(async () => { await node.props.onClick(); }); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem() {} });
});
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount({ lang = "pl", empty = false, view = "station" } = {}) {
  const assigned = [
    { station_id: "a1", group_id: "a", retailer_name: "Auchan", station_idx: 1 },
    { station_id: "a2", group_id: "a", retailer_name: "Auchan", station_idx: 2 },
    { station_id: "d", group_id: "d", retailer_name: "Dino", station_idx: 1 },
    { station_id: "c", group_id: "c", retailer_name: "Carrefour", station_idx: 1 },
    { station_id: "r", group_id: "r", retailer_name: "Arhelan", station_idx: 1 },
  ];
  const states = Object.fromEntries(assigned.map(s => [s.station_id, {
    station_id: s.station_id, group_id: s.group_id, version: 1, group_version: 1, mode: "open",
    current: { id: `meeting-${s.station_id}`, nr: 12, status: "called", name: `Firma ${s.station_id}` },
    next: { id: `next-${s.station_id}`, nr: 13, name: `Następna ${s.station_id}` },
    returnee: null, waiting_returnees: [], last_called_nr: 12,
  }]));
  const api = {
    rpc: {
      myStations: vi.fn(async () => empty ? [] : assigned.map(s => ({ ...s, state: structuredClone(states[s.station_id]) }))),
      stationState: vi.fn(async id => structuredClone(states[id])),
      start: vi.fn(async (id, version) => ({ ...structuredClone(states[id]), version: version + 1,
        current: { ...states[id].current, status: "in_progress" } })),
    },
    listMeetings: vi.fn(async gid => [{ id: `list-${gid}`, queue_group_id: gid, nr: 12, status: "called", companies: { name: `Lista ${gid}` } }]),
    listStations: async gid => assigned.filter(s => s.group_id === gid).map(s => ({ id: s.station_id, idx: s.station_idx })),
    subscribe: () => () => {},
  };
  await act(async () => { tree = create(<Operator user={{ id: "test" }} profile={{ name: "Test" }}
    signOut={() => {}} isAdmin={false} lang={lang} setLang={() => {}} t={STAFF_DICT[lang]} api={api}
    initial={empty ? null : { station: "a1", view }} />); });
  return { api, states };
}

describe("one-tap staff station switching", () => {
  it("shows all five assigned desks and distinguishes two desks of one retailer", async () => {
    await mount();
    const nav = tree.root.findByType("nav");
    expect(nav.findAllByType("button")).toHaveLength(5);
    expect(textOf(quick("a1"))).toContain("AuchanStanowisko 1");
    expect(textOf(quick("a2"))).toContain("AuchanStanowisko 2");
    expect(quick("a1").props["aria-pressed"]).toBe(true);
    expect(quick("a2").props["aria-pressed"]).toBe(false);
    expect(textOf(nav)).not.toContain("Biedronka");
  });

  it("one tap selects a retailer without opening the picker or changing any meeting", async () => {
    const h = await mount(), pending = deferred();
    h.api.rpc.stationState.mockImplementationOnce(() => pending.promise);
    await click(quick("d"));
    expect(quick("d").props["aria-pressed"]).toBe(true);
    expect(text()).not.toContain("Firma a1");
    expect(tree.root.findAllByProps({ "data-testid": "station-loading" })).toHaveLength(1);
    expect(button("Rozpocznij spotkanie")).toBeUndefined();
    await act(async () => { pending.resolve(h.states.d); });
    expect(text()).toContain("Firma d");
    expect(h.api.rpc.start).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenLastCalledWith("fm_station_id", "d");
  });

  it("late reads from a previous visit cannot replace the new visit or another retailer", async () => {
    const h = await mount(), oldDino = deferred(), newDino = deferred();
    h.api.rpc.stationState.mockImplementationOnce(() => oldDino.promise);
    await click(quick("d"));
    await click(quick("c"));
    expect(text()).toContain("Firma c");
    h.api.rpc.stationState.mockImplementationOnce(() => newDino.promise);
    await click(quick("d"));
    await act(async () => { newDino.resolve({ ...h.states.d, current: { ...h.states.d.current, name: "Nowy odczyt Dino" } }); });
    await act(async () => { oldDino.resolve({ ...h.states.d, current: { ...h.states.d.current, name: "Nieaktualny odczyt Dino" } }); });
    expect(text()).toContain("Nowy odczyt Dino");
    expect(text()).not.toContain("Nieaktualny odczyt Dino");
    expect(text()).not.toContain("Firma c");
  });

  it("an in-flight action remains bound to its original desk, then new actions target the new desk", async () => {
    const h = await mount(), pending = deferred();
    h.api.rpc.start.mockImplementationOnce(() => pending.promise);
    let action;
    await act(async () => { action = button("Rozpocznij spotkanie").props.onClick(); });
    await click(quick("d"));
    expect(text()).toContain("Firma d");
    expect(button("Rozpocznij spotkanie").props.disabled).toBe(true);
    await act(async () => { pending.resolve({ ...h.states.a1, version: 2, current: { ...h.states.a1.current, status: "in_progress" } }); await action; });
    expect(text()).toContain("Firma d");
    expect(text()).not.toContain("Firma a1");
    expect(button("Cofnij")).toBeUndefined();
    await click(button("Rozpocznij spotkanie"));
    expect(h.api.rpc.start.mock.calls.map(args => args[0])).toEqual(["a1", "d"]);
  });

  it("switches directly from a retailer's list to the next retailer's controls", async () => {
    await mount({ view: "list" });
    expect(text()).toContain("Lista a");
    await click(quick("d"));
    expect(tree.root.findAllByProps({ "data-testid": "meeting-list" })).toHaveLength(0);
    expect(text()).not.toContain("Lista a");
    expect(text()).toContain("Firma d");
    expect(button("Rozpocznij spotkanie")).toBeTruthy();
  });

  it("tapping the active desk does not reset the list or send another request", async () => {
    const h = await mount({ view: "list" });
    h.api.rpc.stationState.mockClear();
    await click(quick("a1"));
    expect(text()).toContain("Lista a");
    expect(h.api.rpc.stationState).not.toHaveBeenCalled();
  });

  it("closes a previous desk's exception form on navigation", async () => {
    await mount();
    await click(button("+ Wyjątek"));
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
    await click(quick("d"));
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });

  it("uses English labels and still switches by the actual station id", async () => {
    await mount({ lang: "en" });
    expect(tree.root.findByType("nav").props["aria-label"]).toBe("Your retailers — tap to switch");
    expect(textOf(quick("a2"))).toContain("Desk 2");
    await click(quick("a2"));
    expect(quick("a2").props["aria-pressed"]).toBe(true);
    expect(text()).toContain("Firma a2");
  });

  it("does not invent retailers when the operator has no assigned stations", async () => {
    await mount({ empty: true });
    expect(tree.root.findAllByType("nav")).toHaveLength(0);
    expect(text()).toContain(STAFF_DICT.pl.no_stations);
  });
});
