// MARKETING_SEND_ALLOWLIST (próba na prawdziwych kontach, Codex 06.11): parsowanie listy adresów z env.
import { afterEach, describe, it, expect, vi } from "vitest";
import { parseEmailList, resolveEnvConfig } from "../netlify/functions/_shared/function-env.js";

afterEach(() => vi.unstubAllEnvs());

describe("parseEmailList / MARKETING_SEND_ALLOWLIST", () => {
  it("separatory , ; i białe znaki; trim; małe litery; bez duplikatów i śmieci bez @", () => {
    expect(parseEmailList(" Spiker.Artur@gmail.com, artur.silvicola@gmail.com ;SPIKER.ARTUR@gmail.com\n bez-malpy ,, ")).toEqual(["spiker.artur@gmail.com", "artur.silvicola@gmail.com"]);
    expect(parseEmailList("")).toEqual([]); expect(parseEmailList(null)).toEqual([]); expect(parseEmailList(undefined)).toEqual([]);
  });
  it("resolveEnvConfig: nieustawiona = pusta lista (bez ograniczenia); ustawiona = tablica adresów", () => {
    vi.stubEnv("MARKETING_SEND_ALLOWLIST", "");
    expect(resolveEnvConfig().marketingSendAllowlist).toEqual([]);
    vi.stubEnv("MARKETING_SEND_ALLOWLIST", "spiker.artur@gmail.com,artur.silvicola@gmail.com");
    expect(resolveEnvConfig().marketingSendAllowlist).toEqual(["spiker.artur@gmail.com", "artur.silvicola@gmail.com"]);
  });
});
