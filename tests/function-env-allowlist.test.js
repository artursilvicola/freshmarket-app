// MARKETING_SEND_ALLOWLIST (próba na prawdziwych kontach, Codex 06.11): parsowanie listy adresów z env.
// [review 10a0c6a P1] pusta/nieustawiona = brak ograniczenia; niepusta z błędnym wpisem = BŁĘDNA (blokuje), nie „wszyscy”.
import { afterEach, describe, it, expect, vi } from "vitest";
import { parseEmailList, parseSendAllowlist, resolveEnvConfig } from "../netlify/functions/_shared/function-env.js";

afterEach(() => vi.unstubAllEnvs());

describe("parseSendAllowlist / MARKETING_SEND_ALLOWLIST", () => {
  it("separatory , ; i białe znaki; trim; małe litery; bez duplikatów", () => {
    expect(parseSendAllowlist(" Spiker.Artur@gmail.com, artur.silvicola@gmail.com ;SPIKER.ARTUR@gmail.com\n ,, ")).toEqual({ active: true, invalid: false, rejected: 0, addresses: ["spiker.artur@gmail.com", "artur.silvicola@gmail.com"] });
    expect(parseEmailList("a@x.pl;B@y.pl")).toEqual(["a@x.pl", "b@y.pl"]);
  });
  it("pusta/nieustawiona = nieaktywna (bez ograniczenia)", () => {
    for (const raw of ["", "   ", null, undefined]) expect(parseSendAllowlist(raw)).toEqual({ active: false, invalid: false, rejected: 0, addresses: [] });
  });
  it("[P1] wpis bez @ (literówka spiker.artur.gmail.com) = lista BŁĘDNA: active + invalid, poprawne adresy nie „ratują” konfiguracji", () => {
    expect(parseSendAllowlist("spiker.artur.gmail.com")).toEqual({ active: true, invalid: true, rejected: 1, addresses: [] });
    expect(parseSendAllowlist("spiker.artur.gmail.com, artur.silvicola@gmail.com")).toMatchObject({ active: true, invalid: true, rejected: 1, addresses: ["artur.silvicola@gmail.com"] });
    expect(parseSendAllowlist("a@b")).toMatchObject({ invalid: true }); // brak domeny z kropką
    expect(parseSendAllowlist("@x.pl")).toMatchObject({ invalid: true });
    expect(parseEmailList("spiker.artur.gmail.com")).toEqual([]);
  });
  it("resolveEnvConfig: nieustawiona → pusta lista i invalid=false; poprawna → adresy; błędna → invalid=true", () => {
    vi.stubEnv("MARKETING_SEND_ALLOWLIST", "");
    expect(resolveEnvConfig()).toMatchObject({ marketingSendAllowlist: [], marketingSendAllowlistInvalid: false });
    vi.stubEnv("MARKETING_SEND_ALLOWLIST", "spiker.artur@gmail.com,artur.silvicola@gmail.com");
    expect(resolveEnvConfig()).toMatchObject({ marketingSendAllowlist: ["spiker.artur@gmail.com", "artur.silvicola@gmail.com"], marketingSendAllowlistInvalid: false });
    vi.stubEnv("MARKETING_SEND_ALLOWLIST", "spiker.artur.gmail.com");
    expect(resolveEnvConfig()).toMatchObject({ marketingSendAllowlist: [], marketingSendAllowlistInvalid: true });
  });
});
