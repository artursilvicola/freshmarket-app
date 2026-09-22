import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
import FmBoardPage from "./FmBoardPage";
import { supabase } from "../lib/supabase";

let tree, fetchMock;
const textOf = n => typeof n === "string" ? n : (n.children || []).map(textOf).join("");
const pageText = () => textOf(tree.root);
const snapshot = mode => ({
  event_date: "2026-09-22", settings: {}, stations: [{
    station_id: "dino-1", group_id: "dino", retailer_name: "Dino Polska", gate: 1,
    group_active: true, station_active: true, station_idx: 1,
    mode, current_nr: 7, next_nr: 8,
  }],
});
const response = mode => ({ ok: true, json: async () => snapshot(mode) });
const mount = async () => { await act(async () => { tree = create(<FmBoardPage />); }); };
const advance = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const emit = async (target, event) => { await act(async () => { target.dispatchEvent(new Event(event)); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T13:00:00Z"));
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    innerWidth: 390, location: { search: "?date=2026-09-22" },
  }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  fetchMock = vi.fn().mockResolvedValue(response("closed"));
  vi.stubGlobal("fetch", fetchMock);
  supabase.rpc.mockReset();
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("public queue board: mode visibility and live updates", () => {
  it.each([390, 1920])("shows free entry and Gate on a %s px screen", async width => {
    window.innerWidth = width;
    fetchMock.mockResolvedValue(response("free_entry"));
    await mount();
    expect(pageText()).toContain("Dino Polska");
    expect(pageText()).toContain("GATE 1");
    expect(pageText()).toContain("WOLNE WEJŚCIE / WALK-IN");
    // Free entry must not display leftover queue numbers from a previous mode.
    expect(tree.root.findAllByType("div").filter(n => n.children.length === 1 && ["7", "8"].includes(n.children[0]))).toHaveLength(0);
  });

  it("polls the selected date every 5 seconds and updates the mobile status and read time", async () => {
    fetchMock.mockResolvedValueOnce(response("open")).mockResolvedValue(response("free_entry"));
    await mount();
    expect(pageText()).toContain("OTWARTE / OPEN");
    expect(pageText()).toContain("22.09.2026");
    const before = pageText();
    await advance(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/.netlify/functions/fm-queue-snapshot?date=2026-09-22", { cache: "no-store" });
    expect(pageText()).toContain("WOLNE WEJŚCIE / WALK-IN");
    expect(pageText()).not.toBe(before);
    expect(pageText()).toContain(new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    fetchMock.mockResolvedValue(response("paused"));
    await advance(5000);
    expect(pageText()).toContain("PRZERWA / BREAK");
  });

  it("refreshes immediately on focus, reconnection and returning to a visible tab", async () => {
    await mount();
    await emit(window, "focus");
    await emit(window, "online");
    document.visibilityState = "hidden";
    await emit(document, "visibilitychange");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    document.visibilityState = "visible";
    await emit(document, "visibilitychange");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not let a delayed older response overwrite free entry", async () => {
    let finishOld;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValue(response("free_entry"));
    await mount();
    await advance(5000);
    expect(pageText()).toContain("WOLNE WEJŚCIE / WALK-IN");
    await act(async () => { finishOld(response("open")); });
    expect(pageText()).toContain("WOLNE WEJŚCIE / WALK-IN");
    expect(pageText()).not.toContain("OTWARTE / OPEN");
  });

  it("also rejects a delayed older fallback RPC response", async () => {
    let finishOld;
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response("free_entry"));
    supabase.rpc.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    await mount();
    await advance(5000);
    await act(async () => { finishOld({ data: snapshot("open"), error: null }); });
    expect(pageText()).toContain("WOLNE WEJŚCIE / WALK-IN");
  });

  it("marks repeated failed reads stale and recovers when internet returns", async () => {
    await mount();
    fetchMock.mockRejectedValue(new Error("offline"));
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("offline") });
    await advance(25000);
    expect(pageText()).toContain("Brak połączenia");
    fetchMock.mockResolvedValue(response("free_entry"));
    await emit(window, "online");
    expect(pageText()).not.toContain("Brak połączenia");
    expect(pageText()).toContain("WOLNE WEJŚCIE / WALK-IN");
  });

  it("stops polling and removes event listeners on unmount", async () => {
    await mount();
    act(() => tree.unmount());
    tree = null;
    await emit(window, "focus");
    await emit(window, "online");
    await emit(document, "visibilitychange");
    await advance(15000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
