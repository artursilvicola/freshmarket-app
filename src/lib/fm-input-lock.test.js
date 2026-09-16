import { describe, it, expect } from "vitest";
import { isFmInputsLockedError } from "./fm-input-lock.js";

describe("rozpoznanie blokady zapisów wyborów (fm_inputs_locked)", () => {
  it("błąd PostgREST z triggera 054", () => {
    expect(isFmInputsLockedError({ code: "P0001", message: "fm_inputs_locked", hint: "Etap zbierania wyborów jest zamknięty (algo_phase=matching)." })).toBe(true);
    expect(isFmInputsLockedError(new Error("fm_inputs_locked"))).toBe(true);
  });

  it("inne błędy (RLS, sieć) nie są blokadą fazy", () => {
    expect(isFmInputsLockedError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(isFmInputsLockedError(new Error("Failed to fetch"))).toBe(false);
    expect(isFmInputsLockedError(null)).toBe(false);
  });
});
