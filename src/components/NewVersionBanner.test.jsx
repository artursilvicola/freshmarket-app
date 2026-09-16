import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }) }));
import NewVersionBanner, { fetchRemoteBuildId, reloadWhenIdle } from "./NewVersionBanner.jsx";
import { registerPendingWork, _resetPendingWork } from "../lib/pending-work.js";

const respond = (build, ok = true) => vi.fn(async () => ({ ok, json: async () => ({ build }) }));
let tree;
afterEach(() => { act(() => tree?.unmount()); tree = null; _resetPendingWork(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const mountOutdated = async (props = {}) => {
  vi.useFakeTimers();
  act(() => { tree = create(<NewVersionBanner currentBuildId="b1" firstCheckMs={1000} intervalMs={60000} fetchImpl={respond("b2")} waitMs={2000} {...props} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  return tree.root.findByType("button");
};

describe("pasek „nowa wersja — odśwież”", () => {
  it("inny build na serwerze → pasek po pierwszym sprawdzeniu", async () => {
    vi.useFakeTimers();
    const fetchImpl = respond("b2");
    act(() => { tree = create(<NewVersionBanner currentBuildId="b1" firstCheckMs={1000} intervalMs={60000} fetchImpl={fetchImpl} />); });
    expect(tree.toJSON()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toEqual({ cache: "no-store" });
    expect(JSON.stringify(tree.toJSON())).toContain("new_version.text");
    expect(tree.root.findByType("button").children).toContain("new_version.button");
  });

  it("ten sam build → nic; brak pliku (404) → nic", async () => {
    vi.useFakeTimers();
    act(() => { tree = create(<NewVersionBanner currentBuildId="b1" firstCheckMs={1000} intervalMs={60000} fetchImpl={respond("b1")} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
    act(() => { tree = create(<NewVersionBanner currentBuildId="b1" firstCheckMs={1000} intervalMs={60000} fetchImpl={respond(null, false)} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(tree.toJSON()).toBeNull();
  });

  it("build „dev” (lokalnie / testy) nie sprawdza w ogóle", async () => {
    vi.useFakeTimers();
    const fetchImpl = respond("b2");
    act(() => { tree = create(<NewVersionBanner currentBuildId="dev" firstCheckMs={1000} fetchImpl={fetchImpl} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("„Odśwież teraz” czeka, aż zapis w toku się skończy, i dopiero wtedy przeładowuje", async () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload }, confirm: vi.fn(() => true) });
    let busy = true;
    registerPendingWork(() => busy);
    const button = await mountOutdated();
    await act(async () => { button.props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(reload).not.toHaveBeenCalled();
    expect(tree.root.findByType("button").children).toContain("new_version.waiting");
    busy = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("niezapisany formularz po odczekaniu → pytanie; „Anuluj” = bez przeładowania, przycisk znów aktywny", async () => {
    const reload = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { location: { reload }, confirm });
    registerPendingWork(() => true);
    const button = await mountOutdated({ waitMs: 1000 });
    await act(async () => { button.props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(confirm).toHaveBeenCalledWith("new_version.confirm_unsaved");
    expect(reload).not.toHaveBeenCalled();
    expect(tree.root.findByType("button").props.disabled).toBe(false);
  });

  it("reloadWhenIdle: bez zaległości przeładowuje od razu; z zaległościami i zgodą — po pytaniu", async () => {
    const reloadFn = vi.fn();
    expect(await reloadWhenIdle({ waitMs: 10, confirmFn: () => false, reloadFn, t: k => k })).toBe(true);
    expect(reloadFn).toHaveBeenCalledTimes(1);
    registerPendingWork(() => true);
    const confirmFn = vi.fn(() => true);
    expect(await reloadWhenIdle({ waitMs: 10, confirmFn, reloadFn, t: k => k })).toBe(true);
    expect(confirmFn).toHaveBeenCalledWith("new_version.confirm_unsaved");
    expect(reloadFn).toHaveBeenCalledTimes(2);
  });

  it("fetchRemoteBuildId czyta pole build", async () => {
    expect(await fetchRemoteBuildId(respond("abc"))).toBe("abc");
    expect(await fetchRemoteBuildId(respond(null, false))).toBeNull();
  });
});
