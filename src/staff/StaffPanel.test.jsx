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
      myStations: async () => ["a", "b"].map(g => ({
        station_id: g, group_id: g, retailer_name: g === "a" ? "Auchan" : "Dino", station_idx: 1, state: states[g],
      })),
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

  it("automatyczne odświeżenia w trakcie pobierania nie tworzą serii równoległych zapytań", async () => {
    const h = await mount();
    await h.settle("a");
    const before = h.requests.length;
    await act(async () => { button("Odśwież").props.onClick(); });          // jedno wiszące
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });   // interwał 10 s jeszcze nie minął
    expect(h.requests.length).toBe(before + 1);
  });
});
