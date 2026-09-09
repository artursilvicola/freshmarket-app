import { describe, it, expect } from "vitest";
import { warsawToday, fmtDatePL } from "./fm-date.js";

describe("warsawToday — dzień w strefie eventu, jak is_staff() w bazie", () => {
  it("granica północy liczona w Europe/Warsaw (CEST = UTC+2), nie w UTC", () => {
    expect(warsawToday(new Date("2026-09-21T21:59:00Z"))).toBe("2026-09-21");
    expect(warsawToday(new Date("2026-09-21T22:00:00Z"))).toBe("2026-09-22");
    expect(warsawToday(new Date("2026-09-23T23:30:00Z"))).toBe("2026-09-24");
  });
  it("format YYYY-MM-DD zgodny z kolumną date", () => {
    expect(warsawToday(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
    expect(warsawToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("fmtDatePL", () => {
    expect(fmtDatePL("2026-09-24")).toBe("24.09.2026");
    expect(fmtDatePL(null)).toBe("");
    expect(fmtDatePL("x")).toBe("x");
  });
});
