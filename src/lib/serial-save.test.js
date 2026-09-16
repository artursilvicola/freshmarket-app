import { describe, it, expect, vi } from "vitest";
import { createSerialSaver } from "./serial-save.js";

const tick = () => new Promise(r => setTimeout(r, 0));

describe("szeregowanie zapisów wyborów (createSerialSaver)", () => {
  it("szybkie kliknięcia: zapisy nie nakładają się, ostatni stan wygrywa", async () => {
    const calls = [];
    let release;
    const saveFn = vi.fn(payload => new Promise(res => { calls.push(payload); release = res; }));
    const saver = createSerialSaver(saveFn);
    saver.save(["a"]);
    saver.save(["a", "b"]);
    saver.save(["a", "b", "c"]);
    expect(saveFn).toHaveBeenCalledTimes(1); // pierwszy w toku, reszta czeka
    release(); await tick(); await tick();
    expect(saveFn).toHaveBeenCalledTimes(2); // stan pośredni ["a","b"] pominięty
    expect(calls[1]).toEqual(["a", "b", "c"]);
    release(); await tick();
    expect(await saver.flush()).toBeNull();
    expect(saver.busy).toBe(false);
  });

  it("błąd zapisu trafia do onError i do flush(), kolejny zapis czyści błąd", async () => {
    const onError = vi.fn();
    let fail = true;
    const saver = createSerialSaver(async () => { if (fail) throw new Error("fm_inputs_locked"); }, { onError });
    saver.save(["x"]);
    const err = await saver.flush();
    expect(err?.message).toBe("fm_inputs_locked");
    expect(onError).toHaveBeenCalledTimes(1);
    fail = false;
    saver.save(["y"]);
    expect(await saver.flush()).toBeNull();
  });
});
