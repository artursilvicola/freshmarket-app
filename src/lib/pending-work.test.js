import { describe, it, expect, vi, afterEach } from "vitest";
import { registerPendingWork, hasPendingWork, waitForIdle, _resetPendingWork } from "./pending-work.js";

afterEach(() => { _resetPendingWork(); vi.useRealTimers(); });

describe("rejestr niedokończonej pracy w karcie", () => {
  it("rejestracja / wyrejestrowanie i zbiorczy stan", () => {
    expect(hasPendingWork()).toBe(false);
    let busy = true;
    const off = registerPendingWork(() => busy);
    expect(hasPendingWork()).toBe(true);
    busy = false;
    expect(hasPendingWork()).toBe(false);
    busy = true;
    off();
    expect(hasPendingWork()).toBe(false);
  });

  it("waitForIdle czeka na koniec pracy, a po timeoucie zwraca false", async () => {
    vi.useFakeTimers();
    let busy = true;
    registerPendingWork(() => busy);
    const p = waitForIdle(1000, 100);
    await vi.advanceTimersByTimeAsync(350);
    busy = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toBe(true);
    busy = true;
    const p2 = waitForIdle(500, 100);
    await vi.advanceTimersByTimeAsync(700);
    expect(await p2).toBe(false);
  });

  it("zepsuty check nie blokuje", () => {
    registerPendingWork(() => { throw new Error("x"); });
    expect(hasPendingWork()).toBe(false);
  });
});
