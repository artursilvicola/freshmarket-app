import { describe, it, expect } from "vitest";
import {
  MEETING_FILTERS, MEETING_STATUSES, filterMeetings, countByFilter, matchesQuery, normalizeText,
  stationLabelFor, fmtClock, isException, meetingName, isDataStale, withReadTimeout, LIST_STALE_AFTER_MS,
} from "./meetingList.js";

const m = (nr, status, extra = {}) => ({ id: `m${nr}`, nr, status, source: "plan", company_id: `c${nr}`, companies: { name: `Firma ${nr}` }, ...extra });

// Auchan ×2: wspólna kolejka, dwa stanowisko — 11 trwa na st. 1, 12 wywołany na st. 2, 10 zakończony
const AUCHAN = [
  m(10, "done", { station_id: "s1", called_at: "2026-09-24T09:00:00Z", started_at: "2026-09-24T09:02:00Z", ended_at: "2026-09-24T09:20:00Z" }),
  m(11, "in_progress", { station_id: "s1", called_at: "2026-09-24T09:21:00Z", started_at: "2026-09-24T09:22:00Z" }),
  m(12, "called", { station_id: "s2", called_at: "2026-09-24T09:23:00Z" }),
  m(13, "planned"),
  m(9, "no_show", { station_id: "s2" }),
  m(8, "returned_waiting", { return_after_nr: 11 }),
  m(7, "skipped"),
  m(6, "cancelled"),
  m(14, "planned", { company_id: null, companies: null, exception_name: "Żółty Ogród sp. z o.o.", source: "exception" }),
];
const STATIONS = [{ id: "s1", idx: 1, label: null }, { id: "s2", idx: 2, label: "prawe" }];

describe("status pochodzi z rekordu, nie z numeru", () => {
  it("niższy numer w trakcie NIE jest traktowany jako zakończony (Auchan ×2)", () => {
    const active = filterMeetings(AUCHAN, { filter: "active" }).map(x => [x.nr, x.status]);
    expect(active).toEqual([[11, "in_progress"], [12, "called"]]);
    const done = filterMeetings(AUCHAN, { filter: "done" }).map(x => x.nr);
    expect(done).toEqual([10]);
    expect(done).not.toContain(11);
    // review 8.09: pominięte i anulowane NIE są „odbyte” — mają własny filtr
    expect(filterMeetings(AUCHAN, { filter: "dropped" }).map(x => x.nr)).toEqual([6, 7]);
  });
  it("wszystkie statusy z bazy mają swój filtr poza „wszystkie” (powracający-w-trakcie w dwóch)", () => {
    for (const s of MEETING_STATUSES) {
      const hit = MEETING_FILTERS.filter(f => f !== "all" && filterMeetings([m(1, s)], { filter: f }).length === 1);
      expect(hit.length, s).toBeGreaterThanOrEqual(1);
    }
    expect(filterMeetings([m(1, "returned_in_progress")], { filter: "active" })).toHaveLength(1);
    expect(filterMeetings([m(1, "returned_in_progress")], { filter: "absent" })).toHaveLength(1);
  });
  it("„wszystkie” zawiera pominięte, anulowane i wyjątek, posortowane po numerze", () => {
    expect(filterMeetings(AUCHAN).map(x => x.nr)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
  it("liczniki filtrów", () => {
    expect(countByFilter(AUCHAN)).toEqual({ all: 9, waiting: 2, active: 2, done: 1, dropped: 2, absent: 2 });
  });
});

describe("wyszukiwanie po numerze i nazwie", () => {
  it("numer: dokładny lub prefiks", () => {
    expect(filterMeetings(AUCHAN, { query: "12" }).map(x => x.nr)).toEqual([12]);
    expect(filterMeetings(AUCHAN, { query: "1" }).map(x => x.nr)).toEqual([10, 11, 12, 13, 14]);
    expect(filterMeetings(AUCHAN, { query: "99" })).toEqual([]);
  });
  it("nazwa: bez wielkości liter i polskich znaków, także dla wyjątku", () => {
    expect(filterMeetings(AUCHAN, { query: "zolty ogrod" }).map(x => x.nr)).toEqual([14]);
    expect(filterMeetings(AUCHAN, { query: "FIRMA 1" }).map(x => x.nr)).toEqual([10, 11, 12, 13]);
    expect(matchesQuery(m(3, "planned"), "  ")).toBe(true);
  });
  it("filtr i wyszukiwanie łączą się", () => {
    expect(filterMeetings(AUCHAN, { filter: "done", query: "firma 1" }).map(x => x.nr)).toEqual([10]);
    expect(filterMeetings(AUCHAN, { filter: "dropped", query: "firma" }).map(x => x.nr)).toEqual([6, 7]);
  });
  it("normalizeText", () => {
    expect(normalizeText("Żółć ŁĄKA ")).toBe("zolc laka");
    expect(normalizeText(null)).toBe("");
  });
});

describe("stanowisko, wyjątek, godziny", () => {
  it("etykieta stanowiska ze wspólnej kolejki; brak stanowiska → null", () => {
    expect(stationLabelFor("s1", STATIONS)).toBe("1");
    expect(stationLabelFor("s2", STATIONS)).toBe("prawe");
    expect(stationLabelFor(null, STATIONS)).toBeNull();
    expect(stationLabelFor("s9", STATIONS)).toBeNull();
    expect(stationLabelFor("st-1", [{ station_id: "st-1", station_idx: 1 }])).toBe("1");
  });
  it("wyjątek i nazwa", () => {
    expect(isException(AUCHAN[8])).toBe(true);
    expect(isException(AUCHAN[0])).toBe(false);
    expect(meetingName(AUCHAN[8])).toBe("Żółty Ogród sp. z o.o.");
    expect(meetingName({ company_name: "X" })).toBe("X");
    expect(meetingName({})).toBe("");
  });
  it("fmtClock", () => {
    expect(fmtClock(null)).toBe("");
    expect(fmtClock("nie-data")).toBe("");
    expect(fmtClock(new Date(2026, 8, 24, 9, 5, 7).toISOString())).toBe("09:05:07");
  });
});

// ── review 8.09: wiek danych i limit czasu odczytu ───────────────────────────
describe("nieaktualność danych i limit czasu odczytu", () => {
  it("isDataStale: brak odczytu = nie oznaczamy, świeży = nie, zbyt stary = tak", () => {
    const now = 1_000_000;
    expect(isDataStale(null, now)).toBe(false);
    expect(isDataStale(now - 1000, now)).toBe(false);
    expect(isDataStale(now - LIST_STALE_AFTER_MS - 1, now)).toBe(true);
    expect(isDataStale(new Date(now - LIST_STALE_AFTER_MS - 1), now)).toBe(true);
    expect(isDataStale("nie-liczba", now)).toBe(false);
  });
  it("withReadTimeout: wiszący odczyt kończy się błędem sieciowym, szybki przechodzi", async () => {
    await expect(withReadTimeout(new Promise(() => {}), 10)).rejects.toMatchObject({ network: true, timeout: true });
    await expect(withReadTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
    await expect(withReadTimeout(Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
  });
});
