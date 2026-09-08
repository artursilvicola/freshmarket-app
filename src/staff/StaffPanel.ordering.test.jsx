// Regression coverage for snapshots with equal station/group versions.
// All calls are in memory. No Supabase requests or production writes.
import React from "react";
import { create, act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/fm-queue", () => ({ staffApi: {}, newIdemKey: () => "test-idem" }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("./StaffLoginPage", () => ({ default: () => null, LangToggle: () => null }));
vi.mock("../i18n", () => ({ default: { language: "pl", changeLanguage: () => {} } }));
import { Operator } from "./StaffPanel";
import { STAFF_DICT } from "./staffI18n";

let tree;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const clone = value => JSON.parse(JSON.stringify(value));
const textOf = node => typeof node === "string" ? node : (node.children || []).map(textOf).join("");
const button = label => tree.root.findAllByType("button").find(node => textOf(node).includes(label));
const canServe = lang => !!button(STAFF_DICT[lang].btn_serve_returnee);
const returnee = ready => ({ id: "returnee", nr: 5, name: "Firma powracająca", return_after_nr: 12, ready });

async function mount({ withReturnee = true } = {}) {
  const h = { lang: "pl", delayReads: false, delayCache: false, reads: [], caches: [], listeners: new Set() };
  h.state = {
    station_id: "auchan-1", group_id: "auchan", version: 5, group_version: 20,
    mode: "open", last_called_nr: 12, current: null, returnee: null, next: null, remaining: 0,
    waiting_returnees: withReturnee ? [returnee(false)] : [],
  };
  let meetingStatus = withReturnee ? "returned_waiting" : "no_show";
  h.api = {
    rpc: {
      myStations: () => {
        const snapshot = [{ station_id: h.state.station_id, group_id: h.state.group_id,
          retailer_name: "Auchan", station_idx: 1, state: clone(h.state) }];
        return h.delayCache ? new Promise(resolve => h.caches.push(() => resolve(snapshot))) : Promise.resolve(snapshot);
      },
      stationState: () => {
        const snapshot = clone(h.state);
        return h.delayReads ? new Promise(resolve => h.reads.push((value = snapshot) => resolve(value))) : Promise.resolve(snapshot);
      },
      markReturned: async () => {
        // 053 updates the meeting, not the station/group version.
        meetingStatus = "returned_waiting";
        h.state.waiting_returnees = [returnee(true)];
        return { id: "returnee", status: meetingStatus };
      },
    },
    listMeetings: async () => [{ id: "returnee", queue_group_id: "auchan", nr: 5, status: meetingStatus,
      companies: { name: "Firma powracająca" } }],
    listStations: async () => [{ id: h.state.station_id, idx: 1 }],
    subscribe: cb => { h.listeners.add(cb); return () => h.listeners.delete(cb); },
  };
  const props = () => ({ user: { id: "test" }, profile: { name: "Test" }, lang: h.lang, setLang() {},
    t: STAFF_DICT[h.lang], api: h.api, initial: { station: "auchan-1" } });
  await act(async () => { tree = create(<Operator {...props()} />); });
  h.emit = async () => { await act(async () => { h.listeners.forEach(cb => cb()); }); };
  h.language = async lang => { h.lang = lang; await act(async () => { tree.update(<Operator {...props()} />); }); };
  return h;
}

describe("kolejność stanu przy równych wersjach bazy", () => {
  it("przyjmuje nowsze ready i nie pozwala starszej odpowiedzi usunąć przycisku powrotu", async () => {
    const h = await mount();
    expect(canServe("pl")).toBe(false);
    h.delayReads = true;
    await h.emit();
    // Meeting 12 on the OTHER desk finishes: only ready changes in this desk's snapshot.
    h.state.waiting_returnees[0].ready = true;
    await h.emit();
    expect(h.reads).toHaveLength(2);
    await act(async () => { h.reads[1](); });
    expect(canServe("pl")).toBe(true);
    await act(async () => { h.reads[0](); });
    expect(canServe("pl")).toBe(true);
  });

  it("spóźniony zasiew myStations zachowuje porządek pobrania i nie nadpisuje nowszego odczytu", async () => {
    const h = await mount();
    h.delayCache = true;
    h.delayReads = true;
    await h.language("en"); // old cache snapshot and old direct read are now pending
    expect(h.caches).toHaveLength(1);
    h.state.waiting_returnees[0].ready = true;
    await h.emit();
    await act(async () => { h.reads.at(-1)(); });
    expect(canServe("en")).toBe(true);
    await act(async () => { h.caches[0](); }); // seeds before its follow-up direct read returns
    expect(canServe("en")).toBe(true);
    await act(async () => { h.reads[0](); });
    expect(canServe("en")).toBe(true);
  });

  it("odrzuca myStations rozpoczęte przed zmianą generacji i czeka na świeży odczyt", async () => {
    const h = await mount();
    h.delayCache = true;
    h.delayReads = true;
    await h.language("en");
    await act(async () => { button(STAFF_DICT.en.change_station).props.onClick(); });
    await act(async () => { button("Auchan").props.onClick(); });
    expect(tree.root.findAllByProps({ "data-testid": "station-loading" })).toHaveLength(1);
    await act(async () => { h.caches.forEach(resolve => resolve()); });
    expect(tree.root.findAllByProps({ "data-testid": "station-loading" })).toHaveLength(1);
    await act(async () => { h.reads.at(-1)({ ...clone(h.state), waiting_returnees: [returnee(true)] }); });
    expect(canServe("en")).toBe(true);
  });

  it("odczyt po markReturned bez zmiany wersji wygrywa z odczytem sprzed operacji", async () => {
    const h = await mount({ withReturnee: false });
    h.delayReads = true;
    await h.emit();
    await act(async () => { button(STAFF_DICT.pl.returned).props.onClick(); });
    expect(h.reads).toHaveLength(2);
    await act(async () => { h.reads[1](); });
    expect(canServe("pl")).toBe(true);
    await act(async () => { h.reads[0](); });
    expect(canServe("pl")).toBe(true);
  });

  it("rzeczywiście wyższa wersja bazy ma pierwszeństwo nad kolejnością wysłania", async () => {
    const h = await mount();
    h.delayReads = true;
    await h.emit();
    await h.emit();
    await act(async () => { h.reads[1](); });
    // Earlier request executes later on the server and observes a genuinely higher DB version.
    await act(async () => { h.reads[0]({ ...clone(h.state), version: 6, waiting_returnees: [returnee(true)] }); });
    expect(canServe("pl")).toBe(true);
  });
});
