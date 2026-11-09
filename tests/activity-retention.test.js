// [feat/admin-activity] Funkcja zaplanowana retencji: woła wyłącznie purge_app_visits (service_role),
// nie zwraca danych osobowych, brak migracji = pominięcie, błąd = 500. Harmonogram w netlify.toml.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({ calls: [], result: { data: 3, error: null } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: async (name, args) => { state.calls.push([name, args]); return state.result; } }) }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => ({ supabaseUrl: "https://fake.test", supabaseServiceRoleKey: "svc" }),
  missingEnvNames: () => [], envErrorPayload: () => ({}),
}));
import { handler } from "../netlify/functions/activity-retention.js";

describe("activity-retention", () => {
  beforeEach(() => { state.calls = []; state.result = { data: 3, error: null }; vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("usuwa stare wizyty i zwraca tylko liczbę", async () => {
    const r = await handler({});
    expect(state.calls).toEqual([["purge_app_visits", undefined]]);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ deleted: 3 });
  });

  it("brak migracji: pominięcie bez błędu; inny błąd: 500 bez szczegółów", async () => {
    state.result = { data: null, error: { code: "PGRST202", message: "x" } };
    expect(JSON.parse((await handler({})).body)).toEqual({ skipped: "migration_missing" });
    state.result = { data: null, error: { code: "XX000", message: "awaria" } };
    const r = await handler({});
    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: "purge_failed" });
  });

  it("netlify.toml uruchamia funkcję codziennie", () => {
    const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8").split("\r\n").join("\n");
    expect(toml).toMatch(/\[functions\."activity-retention"\]\s*\n(?:\s*#.*\n)*\s*schedule = "@daily"/);
  });
});
