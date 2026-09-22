import React from "react";
import { create, act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/fm-queue", () => ({ staffApi: {}, newIdemKey: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("./StaffLoginPage", () => ({ default: () => null, LangToggle: () => null }));
vi.mock("../i18n", () => ({ default: { language: "pl", changeLanguage: () => {} } }));
import { newIdemKey } from "../lib/fm-queue";
import { Operator } from "./StaffPanel";
import { STAFF_DICT } from "./staffI18n";

let tree, serial;
const textOf = n => typeof n === "string" ? n : (n.children || []).map(textOf).join("");
const text = () => textOf(tree.root);
const button = label => tree.root.findAllByType("button").find(n => textOf(n).startsWith(label));
const click = async label => {
  const b = button(label);
  expect(b, label).toBeTruthy();
  expect(b.props.disabled, label).not.toBe(true);
  await act(async () => { await b.props.onClick(); });
};
const dialog = () => tree.root.findAllByProps({ role: "dialog" });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const returnee = (patch = {}) => ({ id: "returnee-a", nr: 2, name: "Firma powracająca", ready: false, return_after_nr: 12, ...patch });
const baseState = () => ({
  station_id: "a", group_id: "group-a", version: 10, group_version: 5, mode: "open",
  last_called_nr: 12, current: { id: "current-a", nr: 12, status: "in_progress", name: "Bieżąca firma" },
  next: { id: "next-a", nr: 13, name: "Kolejna firma" }, returnee: null, waiting_returnees: [returnee()],
});
beforeEach(() => {
  vi.useFakeTimers();
  serial = 0;
  newIdemKey.mockImplementation(() => `test-operation-${++serial}`);
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = null; vi.useRealTimers(); vi.unstubAllGlobals();
});

async function mount(patch = {}, { picker = false, lang = "pl" } = {}) {
  let st = { ...baseState(), ...patch }, notify;
  const other = { ...baseState(), station_id: "b", group_id: "group-b", waiting_returnees: [], current: null };
  const read = id => structuredClone(id === "b" ? other : st);
  const api = {
    rpc: {
      stationState: vi.fn(async id => read(id)),
      myStations: vi.fn(async () => ["a", "b"].map(id => ({
        station_id: id, group_id: id === "a" ? "group-a" : "group-b",
        retailer_name: id === "a" ? "Dino" : "Carrefour", station_idx: 1, state: read(id),
      }))),
      finishAndCallNext: vi.fn(async (id, version, callNext) => {
        expect(id).toBe("a"); expect(version).toBe(st.version);
        st = { ...st, version: st.version + 1, current: callNext ? { ...st.next, status: "called" } : null,
          last_called_nr: callNext ? 13 : st.last_called_nr,
          waiting_returnees: st.waiting_returnees.map(r => ({ ...r, ready: true })) };
        return read(id);
      }),
      serveReturnee: vi.fn(async (id, meetingId, version) => {
        expect(id).toBe("a"); expect(version).toBe(st.version); expect(st.current).toBeNull();
        const ret = st.waiting_returnees.find(r => r.id === meetingId);
        expect(ret?.ready).toBe(true);
        st = { ...st, version: st.version + 1, returnee: { ...ret, status: "returned_in_progress" },
          waiting_returnees: st.waiting_returnees.filter(r => r.id !== meetingId) };
        return read(id);
      }),
      callNext: vi.fn(async () => { st = { ...st, version: st.version + 1, last_called_nr: 13, current: { ...st.next, status: "called" } }; return read("a"); }),
    },
    listMeetings: async () => [],
    listStations: async () => [],
    subscribe: fn => { notify = fn; return () => {}; },
  };
  await act(async () => { tree = create(<Operator user={{ id: "op" }} profile={{ name: "Operator" }}
    signOut={() => {}} isAdmin={false} lang={lang} setLang={() => {}} t={STAFF_DICT[lang]} api={api}
    initial={picker ? null : { station: "a" }} />); });
  return {
    api, state: () => st, set: patch => { st = { ...st, ...patch }; },
    refresh: async () => { await act(async () => { notify(); }); },
  };
}

describe("returnee reminder is private to staff and preserves forward-only queue", () => {
  it("shows a persistent name/number/barrier and cancel does not mutate anything", async () => {
    const h = await mount();
    expect(textOf(tree.root.findByProps({ "data-testid": "returnee-reminder" }))).toContain("Numer 2 — Firma powracająca");
    expect(text()).toContain("czeka na zakończenie spotkania nr 12");
    await click("Zakończ i wywołaj następny");
    expect(dialog()).toHaveLength(1);
    expect(textOf(dialog()[0])).toContain("Tylko dla obsługi");
    expect(h.api.rpc.finishAndCallNext).not.toHaveBeenCalled();
    await click("Anuluj");
    expect(dialog()).toHaveLength(0);
    expect(h.api.rpc.finishAndCallNext).not.toHaveBeenCalled();
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
  });

  it("finishes the barrier without calling next, then serves the exact returnee with the returned version", async () => {
    const h = await mount();
    await click("Zakończ i wywołaj następny");
    await click("Zakończ i obsłuż powracającego");
    expect(h.api.rpc.finishAndCallNext).toHaveBeenCalledWith("a", 10, false, expect.any(String));
    expect(h.api.rpc.serveReturnee).toHaveBeenCalledWith("a", "returnee-a", 11, expect.any(String));
    expect(h.api.rpc.finishAndCallNext.mock.calls[0][3]).not.toBe(h.api.rpc.serveReturnee.mock.calls[0][3]);
    expect(h.api.rpc.callNext).not.toHaveBeenCalled();
    expect(h.state().last_called_nr).toBe(12);
    expect(h.state().returnee.nr).toBe(2);
    expect(text()).toContain("POWRACAJĄCY · POZA TABLICĄ");
  });

  it("allows explicitly choosing the next public number and leaves the reminder", async () => {
    const h = await mount();
    await click("Zakończ i wywołaj następny");
    const next = dialog()[0].findAllByType("button").find(n => textOf(n).startsWith("Zakończ i wywołaj następny"));
    await act(async () => { await next.props.onClick(); });
    expect(h.api.rpc.finishAndCallNext).toHaveBeenCalledWith("a", 10, true, expect.any(String));
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
    expect(h.state().last_called_nr).toBe(13);
    expect(text()).toContain("Czekają powracający: 1");
  });

  it("does not offer early entry before another barrier meeting finishes", async () => {
    const h = await mount({ waiting_returnees: [returnee({ return_after_nr: 13 })] });
    expect(button("Obsłuż powracającego")).toBeUndefined();
    await click("Zakończ i wywołaj następny");
    expect(dialog()).toHaveLength(0);
    expect(h.api.rpc.finishAndCallNext).toHaveBeenCalledWith("a", 10, true, expect.any(String));
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
  });

  it("prompts before skipping a ready returnee at an empty desk; primary option only serves", async () => {
    const h = await mount({ current: null, waiting_returnees: [returnee({ ready: true })] });
    await click("Wywołaj następny");
    const serve = dialog()[0].findAllByType("button")[0];
    await act(async () => { await serve.props.onClick(); });
    expect(h.api.rpc.serveReturnee).toHaveBeenCalledTimes(1);
    expect(h.api.rpc.callNext).not.toHaveBeenCalled();
    expect(h.api.rpc.finishAndCallNext).not.toHaveBeenCalled();
  });

  it("invalidates the dialog when another operator changes the desk", async () => {
    const h = await mount();
    await click("Zakończ i wywołaj następny");
    const staleClick = dialog()[0].findAllByType("button")[0].props.onClick;
    h.set({ version: 11, current: { id: "other", nr: 13, status: "in_progress" } });
    await h.refresh();
    expect(dialog()[0].findAllByType("button")[0].props.disabled).toBe(true);
    await act(async () => { await staleClick(); });
    expect(h.api.rpc.finishAndCallNext).not.toHaveBeenCalled();
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
  });

  it("clears the old network's dialog after changing the selected desk", async () => {
    const h = await mount();
    await click("Zakończ i wywołaj następny");
    await click("Zmień stanowisko");
    await click("Carrefour");
    expect(dialog()).toHaveLength(0);
    expect(text()).not.toContain("Firma powracająca");
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
  });

  it("shows per-network returnee counters and refreshes the station picker", async () => {
    const h = await mount({}, { picker: true });
    expect(textOf(tree.root.findByProps({ "data-testid": "returnee-count-a" }))).toContain("1");
    expect(tree.root.findAllByProps({ "data-testid": "returnee-count-b" })).toHaveLength(0);
    h.set({ waiting_returnees: [returnee(), returnee({ id: "r2", nr: 3 })] });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(textOf(tree.root.findByProps({ "data-testid": "returnee-count-a" }))).toContain("2");
  });

  it("on a serve failure keeps the finished meeting and never calls another number", async () => {
    const h = await mount();
    h.api.rpc.serveReturnee.mockRejectedValue(Object.assign(new Error("FM_BAD_STATUS"), { fmCode: "FM_BAD_STATUS" }));
    await click("Zakończ i wywołaj następny");
    await click("Zakończ i obsłuż powracającego");
    expect(h.state().current).toBeNull();
    expect(h.state().last_called_nr).toBe(12);
    expect(h.api.rpc.callNext).not.toHaveBeenCalled();
    expect(h.api.rpc.finishAndCallNext).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Stanowisko wolne");
    expect(text()).toContain("Czekają powracający: 1");
  });

  it("retries only the serve step with the identical key/version after a lost response", async () => {
    const h = await mount();
    const realServe = h.api.rpc.serveReturnee.getMockImplementation();
    let accepted;
    h.api.rpc.serveReturnee.mockImplementationOnce(async (...args) => {
      accepted = await realServe(...args);
      throw Object.assign(new Error("network"), { network: true });
    }).mockImplementation(async () => accepted);
    await click("Zakończ i wywołaj następny");
    let pending;
    await act(async () => { pending = button("Zakończ i obsłuż powracającego").props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await pending; });
    expect(h.api.rpc.finishAndCallNext).toHaveBeenCalledTimes(1);
    expect(h.api.rpc.serveReturnee).toHaveBeenCalledTimes(2);
    expect(h.api.rpc.serveReturnee.mock.calls[1]).toEqual(h.api.rpc.serveReturnee.mock.calls[0]);
    expect(h.state().last_called_nr).toBe(12);
  });

  it("does not serve after changing networks while the finish response is pending", async () => {
    const h = await mount(), d = deferred();
    const finish = h.api.rpc.finishAndCallNext.getMockImplementation();
    h.api.rpc.finishAndCallNext.mockImplementation(async (...args) => { const result = await finish(...args); await d.promise; return result; });
    await click("Zakończ i wywołaj następny");
    let pending;
    await act(async () => { pending = button("Zakończ i obsłuż powracającego").props.onClick(); });
    await click("Zmień stanowisko");
    await click("Carrefour");
    await act(async () => { d.resolve(); await pending; });
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
    expect(text()).not.toContain("Firma powracająca");
  });

  it("renders the reminder and decision in English too", async () => {
    await mount({}, { lang: "en" });
    expect(text()).toContain("Returnees waiting: 1");
    await click("Finish & call next");
    expect(textOf(dialog()[0])).toContain("Staff only");
    expect(textOf(dialog()[0])).toContain("Finish and serve returnee");
  });

  it("does not finish twice after two rapid taps on the confirmation", async () => {
    const h = await mount(), d = deferred();
    const finish = h.api.rpc.finishAndCallNext.getMockImplementation();
    h.api.rpc.finishAndCallNext.mockImplementation(async (...args) => { await d.promise; return finish(...args); });
    await click("Zakończ i wywołaj następny");
    const confirm = button("Zakończ i obsłuż powracającego").props.onClick;
    let first, second;
    await act(async () => { first = confirm(); second = confirm(); });
    expect(h.api.rpc.finishAndCallNext).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(); await Promise.all([first, second]); });
    expect(h.api.rpc.serveReturnee).toHaveBeenCalledTimes(1);
  });

  it("does not serve when the server says the barrier is still unsatisfied after finishing", async () => {
    const h = await mount();
    h.api.rpc.finishAndCallNext.mockImplementation(async () => {
      h.set({ version: 11, current: null, waiting_returnees: [returnee({ ready: false, return_after_nr: 14 })] });
      return structuredClone(h.state());
    });
    await click("Zakończ i wywołaj następny");
    await click("Zakończ i obsłuż powracającego");
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
    expect(h.api.rpc.callNext).not.toHaveBeenCalled();
    expect(text()).toContain("Stan stanowiska zmienił się");
  });

  it("offers an eligible returnee instead of one whose barrier is on another desk", async () => {
    const h = await mount({ waiting_returnees: [returnee({ return_after_nr: 14 }), returnee({ id: "r3", nr: 3, ready: true })] });
    await click("Zakończ i wywołaj następny");
    expect(textOf(dialog()[0])).toContain("Numer 3");
    await click("Zakończ i obsłuż powracającego");
    expect(h.api.rpc.serveReturnee).toHaveBeenCalledWith("a", "r3", 11, expect.any(String));
  });

  it("a rejected finish never proceeds to serving or calling next", async () => {
    const h = await mount();
    h.api.rpc.finishAndCallNext.mockRejectedValue(Object.assign(new Error("FM_CONFLICT"), { fmCode: "FM_CONFLICT" }));
    await click("Zakończ i wywołaj następny");
    await click("Zakończ i obsłuż powracającego");
    expect(h.api.rpc.serveReturnee).not.toHaveBeenCalled();
    expect(h.api.rpc.callNext).not.toHaveBeenCalled();
    expect(h.state().current.nr).toBe(12);
  });
});
