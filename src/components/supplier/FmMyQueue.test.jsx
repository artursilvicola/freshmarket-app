// [review release 9.09 — Codex] Karta „Twoja kolej” u dostawcy: prawdziwy komponent, atrapy
// warstwy danych, bez Supabase. Trzy niezmienniki + zabezpieczenia odczytu:
//   1. zmiana daty natychmiast chowa numer poprzedniego dnia (zanim nadejdzie nowy odczyt),
//   2. starsza odpowiedź pollingu nie przywraca „podejdź” po odebraniu „zakończone”,
//   3. wiszący/nieudany odczyt = ostrzeżenie o nieaktualności (sukces snapshotu go nie maskuje).
import React from "react";
import { create, act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../lib/fm-queue", () => ({ listMyFmQueueMeetings: api.list }));
import FmMyQueue, { MINE_MS, SNAP_MS } from "./FmMyQueue.jsx";

let tree;
const meeting = (nr, status = "called") => ({ id: `m${nr}`, nr, status, queue_group_id: "g" });
const snapshot = (date, over = {}) => ({ event_date: date, settings: { closed_all_at: null }, stations: [{ group_id: "g", retailer_name: "TEST", mode: "open", current_nr: 12, last_called_nr: 12, ...over }] });
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const byTestId = (id) => tree.root.findAllByProps({ "data-testid": id });
const byStatus = (s) => tree.root.findAllByProps({ "data-status": s });
async function mount(date, lang = "pl") { await act(async () => { tree = create(<FmMyQueue lang={lang} eventDate={date} />); }); }
async function update(date, lang = "pl") { await act(async () => { tree.update(<FmMyQueue lang={lang} eventDate={date} />); }); }
const textOf = (n) => (typeof n === "string" ? n : (n.children || []).map(textOf).join(""));

beforeEach(() => {
  vi.useFakeTimers();
  api.list.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, json: async () => snapshot(String(url).split("date=")[1]) })));
});
afterEach(() => { if (tree) act(() => tree.unmount()); tree = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("karta dostawcy — zakres daty", () => {
  it("zmiana daty natychmiast usuwa spotkania poprzedniego dnia, zanim nadejdzie nowy odczyt", async () => {
    api.list.mockResolvedValueOnce([meeting(99)]).mockImplementationOnce(() => new Promise(() => {}));
    await mount("2026-09-21");
    expect(byTestId("my-meeting-99")).toHaveLength(1);
    await update("2026-09-24");
    expect(byTestId("my-meeting-99")).toHaveLength(0);
    expect(byTestId("fm-my-queue")).toHaveLength(0);
  });
  it("odczyt poprzedniej daty, który nadejdzie po zmianie, nie jest przyjmowany", async () => {
    const old = deferred();
    api.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce([meeting(7, "planned")]);
    await mount("2026-09-21");
    await update("2026-09-24");
    expect(byTestId("my-meeting-7")).toHaveLength(1);
    await act(async () => { old.resolve([meeting(99)]); });
    expect(byTestId("my-meeting-99")).toHaveLength(0);
    expect(byTestId("my-meeting-7")).toHaveLength(1);
    expect(byTestId("fm-my-queue")[0].props["data-date"]).toBe("2026-09-24");
  });
  it("bez daty produkcyjnej karta się nie renderuje i nie pobiera danych", async () => {
    await mount(null);
    expect(byTestId("fm-my-queue")).toHaveLength(0);
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe("karta dostawcy — kolejność i aktualność odczytów", () => {
  it("starsza odpowiedź pollingowa nie przywraca wezwania po odebraniu statusu done", async () => {
    const old = deferred();
    api.list.mockReturnValueOnce(old.promise).mockResolvedValue([meeting(12, "done")]);
    await mount("2026-09-24");
    await act(async () => { await vi.advanceTimersByTimeAsync(MINE_MS); });
    expect(byStatus("done")).toHaveLength(1);
    await act(async () => { old.resolve([meeting(12, "called")]); });
    expect(byStatus("your_turn")).toHaveLength(0);
    expect(byStatus("done")).toHaveLength(1);
  });
  it("wiszący odczyt spotkań daje ostrzeżenie mimo poprawnego snapshotu; po udanym odczycie gaśnie", async () => {
    const hang = deferred();
    api.list.mockResolvedValueOnce([meeting(12, "called")]).mockReturnValueOnce(hang.promise).mockResolvedValue([meeting(12, "called")]);
    await mount("2026-09-24");
    expect(byTestId("my-queue-stale")).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINE_MS + 11_000); });   // 2. odczyt wisi > 10 s → timeout
    expect(byTestId("my-queue-stale")).toHaveLength(1);
    expect(byTestId("my-meeting-12")).toHaveLength(1);                                  // ostatni znany stan zostaje
    await act(async () => { await vi.advanceTimersByTimeAsync(MINE_MS); });             // 3. odczyt OK
    expect(byTestId("my-queue-stale")).toHaveLength(0);
  });
  it("błąd snapshotu daje ostrzeżenie, a udany odczyt spotkań go nie maskuje", async () => {
    api.list.mockResolvedValue([meeting(12, "called")]);
    fetch.mockImplementation(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    await mount("2026-09-24");
    expect(byTestId("my-queue-stale")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINE_MS); });
    expect(byTestId("my-queue-stale")).toHaveLength(1);
  });
  it("w trakcie wiszącego odczytu interwał nie tworzy równoległych zapytań", async () => {
    api.list.mockImplementation(() => new Promise(() => {}));
    await mount("2026-09-24");
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(api.list).toHaveBeenCalledTimes(1);
  });
  it("snapshot: starsza odpowiedź nie nadpisuje nowszej (closing ≠ open)", async () => {
    api.list.mockResolvedValue([meeting(13, "planned")]);
    const first = deferred();
    fetch.mockImplementationOnce(() => first.promise).mockImplementation(async (url) => ({ ok: true, json: async () => snapshot(String(url).split("date=")[1], { mode: "closing" }) }));
    await mount("2026-09-24");
    await act(async () => { await vi.advanceTimersByTimeAsync(SNAP_MS + 11_000); });   // 1. wisi → timeout; 2. closing
    expect(byStatus("closing")).toHaveLength(1);
    await act(async () => { first.resolve({ ok: true, json: async () => snapshot("2026-09-24") }); });
    expect(byStatus("closing")).toHaveLength(1);
    expect(byStatus("next_up")).toHaveLength(0);
  });
});

describe("karta dostawcy — zamykanie kolejki i języki", () => {
  it("zamykana grupa nie przygotowuje kolejnego dostawcy, ale pokazuje trwające spotkanie", async () => {
    api.list.mockResolvedValue([meeting(13, "planned")]);
    fetch.mockImplementation(async (url) => ({ ok: true, json: async () => snapshot(String(url).split("date=")[1], { mode: "closing" }) }));
    await mount("2026-09-24");
    expect(byStatus("next_up")).toHaveLength(0);
    expect(byStatus("closing")).toHaveLength(1);
    expect(textOf(byTestId("my-meeting-13")[0])).toContain("12");   // TERAZ nadal pokazuje trwający numer
  });
  it("„Zamknij wszystkie” (closed_all_at) blokuje zapowiedź nawet przy stanowisku open", async () => {
    api.list.mockResolvedValue([meeting(13, "planned")]);
    fetch.mockImplementation(async (url) => ({ ok: true, json: async () => ({ ...snapshot(String(url).split("date=")[1]), settings: { closed_all_at: "2026-09-24T15:00:00Z" } }) }));
    await mount("2026-09-24");
    expect(byStatus("next_up")).toHaveLength(0);
    expect(byStatus("closing")).toHaveLength(1);
  });
  it("komunikaty PL/EN dla zamykania i nieaktualności", async () => {
    api.list.mockResolvedValue([meeting(13, "planned")]);
    fetch.mockImplementation(async (url) => ({ ok: true, json: async () => snapshot(String(url).split("date=")[1], { mode: "closing" }) }));
    await mount("2026-09-24", "pl");
    expect(textOf(byStatus("closing")[0])).toMatch(/zamykana/);
    await update("2026-09-24", "en");
    expect(textOf(byStatus("closing")[0])).toMatch(/closing/);
  });
});

// ── review 9.09 (uwagi eksploatacyjne Codexa): anulowanie transportu + komunikat pierwszego błędu ──
describe("karta dostawcy — anulowanie transportu", () => {
  it("limit czasu przerywa fetch snapshotu (sygnał abort), a kolejne cykle nie zostawiają wiszących żądań", async () => {
    api.list.mockResolvedValue([meeting(12, "called")]);
    const signals = [];
    fetch.mockImplementation((url, init) => { signals.push(init.signal); return new Promise(() => {}); });   // snapshot wisi
    await mount("2026-09-24");
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });                 // timeout 10 s → abort
    expect(signals[0].aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * SNAP_MS + 12_000); }); // dwa kolejne cykle pollingu
    expect(signals.length).toBeGreaterThanOrEqual(3);
    expect(signals.filter(s => !s.aborted).length).toBeLessThanOrEqual(1);              // najwyżej jedno żywe żądanie
    expect(byTestId("my-queue-stale")).toHaveLength(1);
  });
  it("odczyt spotkań dostaje sygnał, a zmiana daty anuluje żądanie w locie", async () => {
    const seen = [];
    api.list.mockImplementation((date, opts) => { seen.push({ date, signal: opts?.signal }); return new Promise(() => {}); });
    await mount("2026-09-21");
    expect(seen[0].signal).toBeTruthy();
    expect(seen[0].signal.aborted).toBe(false);
    await update("2026-09-24");
    expect(seen[0].signal.aborted).toBe(true);
    expect(seen.at(-1).date).toBe("2026-09-24");
    expect(seen.at(-1).signal.aborted).toBe(false);
  });
  it("demontaż karty anuluje żądania w locie", async () => {
    const seen = [];
    api.list.mockImplementation((date, opts) => { seen.push(opts.signal); return new Promise(() => {}); });
    await mount("2026-09-24");
    await act(async () => { tree.unmount(); });
    tree = undefined;
    expect(seen[0].aborted).toBe(true);
  });
});

describe("karta dostawcy — pierwszy błąd odczytu", () => {
  it("nieudany pierwszy odczyt pokazuje komunikat z linkiem do tablicy z datą, bez cudzych numerów", async () => {
    api.list.mockRejectedValueOnce(new Error("network")).mockResolvedValue([meeting(12, "called")]);
    await mount("2026-09-24");
    expect(byTestId("my-queue-error")).toHaveLength(1);
    expect(byTestId("fm-my-queue")).toHaveLength(0);
    const link = byTestId("my-queue-error")[0].findByType("a");
    expect(link.props.href).toBe("/tablice?date=2026-09-24");
    await act(async () => { await vi.advanceTimersByTimeAsync(MINE_MS); });               // ponowienie OK
    expect(byTestId("my-queue-error")).toHaveLength(0);
    expect(byTestId("my-meeting-12")).toHaveLength(1);
  });
  it("udana pusta lista (przed importem planu) nadal chowa kartę i nie pokazuje błędu", async () => {
    api.list.mockResolvedValue([]);
    await mount("2026-09-24");
    expect(byTestId("my-queue-error")).toHaveLength(0);
    expect(byTestId("fm-my-queue")).toHaveLength(0);
  });
  it("komunikat błędu PL/EN", async () => {
    api.list.mockRejectedValue(new Error("network"));
    await mount("2026-09-24", "pl");
    expect(textOf(byTestId("my-queue-error")[0])).toMatch(/Nie udało się pobrać/);
    await update("2026-09-24", "en");
    expect(textOf(byTestId("my-queue-error")[0])).toMatch(/Could not load/);
  });
});
