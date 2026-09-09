// [review Codexa 8.09] Testy rzeczywistego komponentu `Operator` na kontrolowanych odpowiedziach API.
// Lista spotkań służy do WPUSZCZANIA dostawcy na spotkanie, więc pilnujemy trzech niezmienników:
//   1. wiersze zawsze należą do grupy z nagłówka (przełączenie sieci, spóźniona odpowiedź, błąd),
//   2. starsza odpowiedź nie nadpisuje nowszego statusu,
//   3. wiszący odczyt jest oznaczony jako nieaktualny mimo działającego Wi-Fi.
// Bez Supabase, bez danych produkcyjnych, bez zapisów.
import React from "react";
import { create, act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/fm-queue", () => ({ staffApi: {}, newIdemKey: () => "test-idem" }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({}) }));
vi.mock("./StaffLoginPage", () => ({ default: () => null, LangToggle: () => null }));
vi.mock("../i18n", () => ({ default: { language: "pl", changeLanguage: () => {} } }));

import { Operator } from "./StaffPanel";
import { STAFF_DICT } from "./staffI18n";
import { warsawToday } from "../lib/fm-date";

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

const textOf = (n) => (typeof n === "string" ? n : (n.children || []).map(textOf).join(""));
const button = (label) => tree.root.findAllByType("button").find(n => textOf(n).includes(label));
const listText = () => textOf(tree.root.findByProps({ "data-testid": "meeting-list" }));
const rowText = (nr) => textOf(tree.root.findByProps({ "data-testid": `row-${nr}` }));
const staleCount = () => tree.root.findAllByProps({ "data-testid": "stale" }).length;

const AUCHAN = "Dostawca tylko Auchan", DINO = "Dostawca tylko Dino";
const row = (gid, status = "planned") => ({
  id: `meeting-${gid}`, queue_group_id: gid, nr: 12, status,
  companies: { name: gid === "a" ? AUCHAN : DINO }, station_id: null,
});

async function mount() {
  const requests = [];
  const states = Object.fromEntries(["a", "b"].map(g => [g, {
    station_id: g, group_id: g, version: 1, group_version: 1, mode: "open", last_called_nr: 0,
    current: null, returnee: null, next: null, waiting_returnees: [], remaining: 1,
  }]));
  const api = {
    rpc: {
      myStations: vi.fn(async () => ["a", "b"].map(g => ({
        station_id: g, group_id: g, retailer_name: g === "a" ? "Auchan" : "Dino", station_idx: 1, state: states[g],
      }))),
      stationState: async id => states[id],
    },
    listMeetings: gid => new Promise((resolve, reject) => requests.push({ gid, resolve, reject, settled: false })),
    listStations: async gid => [{ id: gid, idx: 1 }],
    subscribe: () => () => {},
  };
  await act(async () => {
    tree = create(
      <Operator user={{ id: "test" }} profile={{ name: "Test" }} signOut={() => {}} isAdmin={false}
        lang="pl" setLang={() => {}} t={STAFF_DICT.pl} api={api} initial={{ station: "a", view: "list" }} />,
    );
  });
  async function settle(gid, status = "planned", fail = false) {
    await act(async () => {
      for (const r of requests.filter(r => r.gid === gid && !r.settled)) {
        r.settled = true;
        if (fail) r.reject(new Error("Network failure")); else r.resolve([row(gid, status)]);
      }
    });
  }
  async function switchToDino() {
    await act(async () => button("Zmień stanowisko").props.onClick());
    await act(async () => button("Dino").props.onClick());
    await act(async () => tree.root.findByProps({ "data-testid": "btn-list" }).props.onClick());
  }
  return { requests, settle, switchToDino, api };
}

describe("lista spotkań: dane zawsze z grupy pokazanej w nagłówku", () => {
  it("spóźniona odpowiedź Auchan nie podmienia listy Dino", async () => {
    const h = await mount();
    expect(h.requests.some(r => r.gid === "a")).toBe(true);
    await h.switchToDino();
    await h.settle("b");
    expect(listText()).toContain(DINO);
    await h.settle("a");
    expect(listText()).toContain(DINO);
    expect(listText()).not.toContain(AUCHAN);
  });

  it("błąd pobrania listy Dino nie zostawia na ekranie listy Auchan", async () => {
    const h = await mount();
    await h.settle("a");
    expect(listText()).toContain(AUCHAN);
    await h.switchToDino();
    await h.settle("b", "planned", true);
    expect(listText()).not.toContain(AUCHAN);
    expect(tree.root.findAllByProps({ "data-testid": "list-nodata" }).length).toBe(1);
    expect(staleCount()).toBe(1);
  });

  it("po nieudanym pobraniu udane odświeżenie pokazuje listę właściwej grupy i gasi ostrzeżenie", async () => {
    const h = await mount();
    await h.settle("a", "planned", true);
    expect(staleCount()).toBe(1);
    await act(async () => { button("Odśwież").props.onClick(); });
    await h.settle("a", "planned");
    expect(listText()).toContain(AUCHAN);
    expect(staleCount()).toBe(0);
  });

  it("przed nadejściem danych nowej grupy nie pokazujemy „brak spotkań”", async () => {
    const h = await mount();
    await h.settle("a");
    await h.switchToDino();
    expect(listText()).not.toContain(AUCHAN);
    expect(listText()).not.toContain(STAFF_DICT.pl.list_none);
    expect(tree.root.findAllByProps({ "data-testid": "list-nodata" }).length).toBe(1);
  });
});

describe("lista spotkań: kolejność i aktualność odpowiedzi", () => {
  it("starsza odpowiedź nie nadpisuje nowszego statusu w tej samej grupie", async () => {
    const h = await mount();
    await h.settle("a");
    await act(async () => { button("Odśwież").props.onClick(); });
    const old = h.requests.at(-1);
    await act(async () => { button("Odśwież").props.onClick(); });
    const recent = h.requests.at(-1);
    expect(old).not.toBe(recent);
    await act(async () => { recent.resolve([row("a", "done")]); });
    expect(rowText(12)).toContain("ZAKOŃCZONE");
    await act(async () => { old.resolve([row("a", "called")]); });
    expect(rowText(12)).toContain("ZAKOŃCZONE");
  });

  it("wiszący odczyt jest oznaczony jako nieaktualny mimo działającego Wi-Fi", async () => {
    const h = await mount();
    await h.settle("a");
    expect(staleCount()).toBe(0);
    await act(async () => { button("Odśwież").props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(h.requests.filter(r => !r.settled).length).toBeGreaterThan(0);
    expect(staleCount()).toBe(1);
    expect(listText()).toContain(AUCHAN);   // ostatni znany stan zostaje, ale z ostrzeżeniem
  });

});

// ── review v2 (8.09): jedna bramka dla odczytów, Realtime, listy i WYNIKÓW OPERACJI ─────────
// Mock z opóźnianymi odczytami stanu, opóźnianą listą i operacją „Rozpocznij spotkanie”.
async function mountLive() {
  const h = { delayReads: false, delayMeetings: false, reads: [], actions: [], meetings: [], subscribers: new Set() };
  const states = Object.fromEntries(["a", "b"].map(g => [g, {
    station_id: g, group_id: g, version: 1, group_version: 1, mode: "open", last_called_nr: 12,
    current: { id: `m-${g}`, nr: 12, name: `Firma ${g}`, status: "called", called_at: new Date().toISOString() },
    returnee: null, next: null, waiting_returnees: [], remaining: 1,
  }]));
  h.states = states;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const api = {
    rpc: {
      myStations: async () => ["a", "b"].map(g => ({ station_id: g, group_id: g, retailer_name: g === "a" ? "Auchan" : "Dino", station_idx: 1, state: clone(states[g]) })),
      stationState: id => {
        const value = clone(states[id]);
        if (h.delayReads) return new Promise(resolve => h.reads.push({ id, resolve: () => resolve(value) }));
        return Promise.resolve(value);
      },
      start: id => new Promise(resolve => h.actions.push({ id, resolve: () => {
        states[id] = { ...states[id], version: 2, current: { ...states[id].current, status: "in_progress" } };
        resolve(clone(states[id]));
      } })),
    },
    listMeetings: gid => {
      if (h.delayMeetings) return new Promise(resolve => h.meetings.push({ gid, resolve }));
      return Promise.resolve([{ id: `m-${gid}`, queue_group_id: gid, nr: 12, status: states[gid].current.status, companies: { name: `Firma ${gid}` } }]);
    },
    listStations: async gid => [{ id: gid, idx: 1 }],
    subscribe: cb => { h.subscribers.add(cb); return () => h.subscribers.delete(cb); },
  };
  h.emit = () => h.subscribers.forEach(cb => cb());
  h.api = api;
  await act(async () => {
    tree = create(<Operator user={{ id: "test" }} profile={{ name: "Test" }} signOut={() => {}} isAdmin={false}
      lang="pl" setLang={() => {}} t={STAFF_DICT.pl} api={api} initial={{ station: "a" }} />);
  });
  h.switchTo = async (name) => {
    await act(async () => { button("Zmień stanowisko").props.onClick(); });
    await act(async () => { button(name).props.onClick(); });
  };
  h.openList = async () => { await act(async () => { tree.root.findByProps({ "data-testid": "btn-list" }).props.onClick(); }); };
  return h;
}
const component = (name) => tree.root.find(n => typeof n.type === "function" && n.type.name === name);

describe("stan stanowiska: odczyty, Realtime i wyniki operacji przez jedną bramkę", () => {
  it("spóźniony wynik operacji z Auchan nie podmienia stanu ani listy pod nagłówkiem Dino", async () => {
    const h = await mountLive();
    await act(async () => { button("Rozpocznij spotkanie").props.onClick(); });
    expect(h.actions).toHaveLength(1);
    await h.switchTo("Dino");
    await h.openList();
    expect(listText()).toContain("Firma b");
    await act(async () => { h.actions[0].resolve(); });
    expect(component("StationHeader").props.s.retailer_name).toBe("Dino");
    expect(component("StationHeader").props.state.station_id).toBe("b");
    expect(listText()).not.toContain("Firma a");
    expect(tree.root.findAllByType("button").some(b => textOf(b).includes("Cofnij"))).toBe(false);
  });

  it("odczyt rozpoczęty przed operacją nie cofa na ekranie już rozpoczętego spotkania", async () => {
    const h = await mountLive();
    h.delayReads = true;
    await act(async () => { h.emit(); });
    expect(h.reads).toHaveLength(1);
    await act(async () => { button("Rozpocznij spotkanie").props.onClick(); });
    await act(async () => { h.actions[0].resolve(); });
    expect(component("NowCard").props.state.current.status).toBe("in_progress");
    await act(async () => { h.reads[0].resolve(); });
    expect(component("NowCard").props.state.current.status).toBe("in_progress");
    expect(component("NowCard").props.state.version).toBe(2);
  });

  it("przełączenie Auchan → Dino → Auchan unieważnia odczyt listy z pierwszej wizyty", async () => {
    const h = await mountLive();
    h.delayMeetings = true;
    await h.openList();
    const oldA = h.meetings.at(-1);
    await h.switchTo("Dino");
    await h.openList();
    await h.switchTo("Auchan");
    await h.openList();
    await act(async () => { oldA.resolve([{ id: "old-a", queue_group_id: "a", nr: 12, status: "called", companies: { name: "STARA WIZYTA" } }]); });
    expect(listText()).not.toContain("STARA WIZYTA");
    expect(tree.root.findAllByProps({ "data-testid": "list-nodata" }).length).toBe(1);   // wciąż czekamy na nowy odczyt
    await act(async () => { h.meetings.at(-1).resolve([{ id: "new-a", queue_group_id: "a", nr: 12, status: "called", companies: { name: "NOWA WIZYTA" } }]); });
    expect(listText()).toContain("NOWA WIZYTA");
  });

  it("seria 20 powiadomień Realtime w trakcie pobierania listy daje jedno kolejne pobranie", async () => {
    const h = await mountLive();
    h.delayMeetings = true;
    await h.openList();
    const firstCount = h.meetings.length;
    await act(async () => { for (let i = 0; i < 20; i++) h.emit(); });
    expect(h.meetings.length).toBe(firstCount);
    await act(async () => { h.meetings[0].resolve([]); });
    expect(h.meetings.length).toBe(firstCount + 1);
  });

  it("ponowienie operacji po błędzie sieci używa tego samego klucza, stanowiska i oczekiwanej wersji", async () => {
    const h = await mountLive();
    const calls = [];
    // podmieniamy start: pierwsza próba = błąd sieci, druga = sukces; rejestrujemy argumenty
    const startOrig = h.api.rpc.start;
    h.api.rpc.start = (id, v, idem) => {
      calls.push({ id, v, idem });
      if (calls.length === 1) { const e = new Error("network timeout"); e.network = true; return Promise.reject(e); }
      return startOrig(id, v, idem).then(x => x);
    };
    await act(async () => { button("Rozpocznij spotkanie").props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    await act(async () => { h.actions.at(-1).resolve(); });
    expect(component("NowCard").props.state.current.status).toBe("in_progress");
  });
});

// ── fix/fm-queue-day-scoping: dzień stanowisk = dzisiaj w Europe/Warsaw ─────────────────────
describe("dzień, o który panel pyta bazę", () => {
  it("myStations dostaje DZISIEJSZĄ datę (Europe/Warsaw), nie null — operator dnia testowego widzi swoje stanowiska", async () => {
    const h = await mount();
    const calls = h.api.rpc.myStations.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[0]).toBe(warsawToday());
    expect(warsawToday()).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });
  it("wybór stanowiska pokazuje, na który dzień są stanowiska", async () => {
    await mount();
    await act(async () => { button("Zmień stanowisko").props.onClick(); });
    const day = tree.root.findByProps({ "data-testid": "stations-day" });
    expect(textOf(day)).toContain(warsawToday().split("-").reverse().join("."));
  });
});
