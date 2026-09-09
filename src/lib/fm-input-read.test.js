import { describe, it, expect, vi } from "vitest";
import { readAllFmInputRows } from "./fm-input-read.js";

function queryFrom(fetchPage) {
  return () => ({ range: (from, to) => ({ abortSignal: signal => {
    expect(signal).toBeInstanceOf(AbortSignal);
    return fetchPage(from, to);
  } }) });
}

describe("kompletny odczyt wejścia algorytmu", () => {
  it("poprawna pusta odpowiedź naprawdę oznacza brak decyzji", async () => {
    await expect(readAllFmInputRows(queryFrom(() => ({ data: [], error: null, count: 0 })))).resolves.toEqual([]);
  });

  it("pobiera także odmowy poza pierwszym tysiącem wierszy", async () => {
    const rows = Array.from({ length: 1251 }, (_, id) => ({ id, zone: id === 1250 ? "remove" : "want" }));
    const fetchPage = vi.fn((from, to) => ({ data: rows.slice(from, to + 1), count: rows.length }));
    const result = await readAllFmInputRows(queryFrom(fetchPage));
    expect(result).toEqual(rows);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result[1250].zone).toBe("remove");
  });

  it("obsługuje limit serwera mniejszy niż zamówiona strona", async () => {
    const rows = Array.from({ length: 231 }, (_, id) => ({ id }));
    const fetchPage = vi.fn(from => ({ data: rows.slice(from, from + 100), count: rows.length }));
    expect(await readAllFmInputRows(queryFrom(fetchPage))).toEqual(rows);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("błąd bazy nie zostaje zamieniony na pustą listę", async () => {
    const error = { code: "42501", message: "permission denied" };
    await expect(readAllFmInputRows(queryFrom(() => ({ data: null, error })))).rejects.toBe(error);
  });

  it("awaria drugiej strony odrzuca całość, nie zwraca częściowych odpowiedzi", async () => {
    const error = new Error("offline");
    await expect(readAllFmInputRows(queryFrom(from => {
      if (from) throw error;
      return { data: [{ id: 1 }], count: 2 };
    }))).rejects.toBe(error);
  });

  it("zmiana liczby rekordów podczas pobierania wymaga ponowienia", async () => {
    await expect(readAllFmInputRows(queryFrom(from => ({ data: [{ id: from }], count: from ? 3 : 2 })))).rejects.toThrow("FM_INPUTS_CHANGED");
  });

  it.each([
    { data: [], count: 1 },
    { data: [], count: null },
    { data: null, count: 0 },
    { data: [{ id: 1 }], count: 0 },
  ])("niekompletna odpowiedź %j blokuje plan", async page => {
    await expect(readAllFmInputRows(queryFrom(() => page))).rejects.toThrow("FM_INPUTS_INCOMPLETE");
  });
});
