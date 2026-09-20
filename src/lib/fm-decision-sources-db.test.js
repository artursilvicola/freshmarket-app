// [feat/fm-decision-source] getFmDecisionSources: admin czyta tabelę (z autorem i czasem),
// dostawca/kupiec WYŁĄCZNIE RPC fm_my_decision_sources (bez autora i czasu); brak obiektów
// w bazie (front przed migracją) = pusta lista.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ table: null, rpc: null, calls: [] }));
vi.mock("./supabase", () => ({
  supabase: {
    from: (table) => {
      const call = { kind: "from", table, ops: [] }; state.calls.push(call);
      const chain = {
        select: (...a) => { call.ops.push(["select", ...a]); return chain; },
        order: (...a) => { call.ops.push(["order", ...a]); return chain; },
        range: (...a) => { call.ops.push(["range", ...a]); return chain; },
        abortSignal: () => chain,
        then: (resolve, reject) => Promise.resolve(typeof state.table === "function" ? state.table(call) : state.table).then(resolve, reject),
      };
      return chain;
    },
    rpc: (name, args) => { state.calls.push({ kind: "rpc", name, args }); return Promise.resolve(state.rpc); },
  },
}));
vi.mock("../i18n", () => ({ default: { language: "pl", t: (k) => k } }));
import { getFmDecisionSources } from "./db.js";

beforeEach(() => { state.table = null; state.rpc = null; state.calls.length = 0; });

describe("getFmDecisionSources", () => {
  it("admin: tabela z autorem (profil) i czasem, stronicowanie z licznikiem", async () => {
    const rows = [{ entity: "target", company_id: "c", retailer_id: 1, source: "admin", source_user_id: "u", source_at: "2026-09-20T10:00:00Z", author: { name: "Oksana" } }];
    state.table = { data: rows, error: null, count: 1 };
    const out = await getFmDecisionSources({ admin: true });
    expect(out).toEqual(rows);
    const call = state.calls.find(c => c.kind === "from");
    expect(call.table).toBe("fm_decision_sources");
    expect(call.ops.find(o => o[0] === "select")[1]).toMatch(/source_user_id, source_at, author:profiles!fm_decision_sources_source_user_fkey\(name, email\)/);
    expect(state.calls.some(c => c.kind === "rpc")).toBe(false);
  });

  it("dostawca / kupiec: wyłącznie RPC fm_my_decision_sources, bez odczytu tabeli", async () => {
    state.rpc = { data: [{ entity: "resp", company_id: "c", retailer_id: 1, decision: "remove", source: "admin" }], error: null };
    const out = await getFmDecisionSources({ admin: false });
    expect(out).toEqual([{ entity: "resp", company_id: "c", retailer_id: 1, decision: "remove", source: "admin" }]);
    expect(out[0]).not.toHaveProperty("source_user_id");
    expect(out[0]).not.toHaveProperty("source_at");
    expect(state.calls).toEqual([{ kind: "rpc", name: "fm_my_decision_sources", args: undefined }]);
    expect(await getFmDecisionSources()).toEqual(out);   // domyślnie ścieżka użytkownika
  });

  it("brak tabeli / funkcji (front przed migracją) → pusta lista; inne błędy → wyjątek", async () => {
    state.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function public.fm_my_decision_sources in the schema cache" } };
    expect(await getFmDecisionSources()).toEqual([]);
    state.table = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.fm_decision_sources' in the schema cache" } };
    expect(await getFmDecisionSources({ admin: true })).toEqual([]);
    state.rpc = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(getFmDecisionSources()).rejects.toMatchObject({ code: "42501" });
  });
});
