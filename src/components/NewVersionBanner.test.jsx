import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }) }));
import NewVersionBanner, { fetchRemoteBuildId } from "./NewVersionBanner.jsx";

const respond = (build, ok = true) => vi.fn(async () => ({ ok, json: async () => ({ build }) }));
let tree;
afterEach(() => { act(() => tree?.unmount()); vi.useRealTimers(); });

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
    const same = respond("b1");
    act(() => { tree = create(<NewVersionBanner currentBuildId="b1" firstCheckMs={1000} intervalMs={60000} fetchImpl={same} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
    const missing = respond(null, false);
    act(() => { tree = create(<NewVersionBanner currentBuildId="b1" firstCheckMs={1000} intervalMs={60000} fetchImpl={missing} />); });
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

  it("fetchRemoteBuildId czyta pole build", async () => {
    expect(await fetchRemoteBuildId(respond("abc"))).toBe("abc");
    expect(await fetchRemoteBuildId(respond(null, false))).toBeNull();
  });
});
