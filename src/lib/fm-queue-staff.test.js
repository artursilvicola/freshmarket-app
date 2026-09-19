// [fix/fm-staff-list-relation] listFmStaff: dwa odczyty (fm_staff + fm_queue_assignments) zamiast
// embedu po nieistniejącej relacji; błędy relacji/uprawnień/transportu NIE są „brakiem modułu”.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Atrapa klienta: rejestruje wywołania i zwraca zaprogramowane odpowiedzi per tabela.
const state = vi.hoisted(() => ({ responses: {}, calls: [] }));
vi.mock("./supabase", () => ({
  supabase: {
    from: (table) => {
      const call = { table, ops: [] }; state.calls.push(call);
      const chain = {
        select: (...a) => { call.ops.push(["select", ...a]); return chain; },
        order: (...a) => { call.ops.push(["order", ...a]); return chain; },
        eq: (...a) => { call.ops.push(["eq", ...a]); return chain; },
        in: (...a) => { call.ops.push(["in", ...a]); return chain; },
        then: (resolve, reject) => { const r = state.responses[table]; return Promise.resolve(typeof r === "function" ? r(call) : (r || { data: [], error: null })).then(resolve, reject); },
      };
      return chain;
    },
  },
}));
import { listFmStaff, isMissingObjectError } from "./fm-queue";

const PGRST200 = { code: "PGRST200", message: "Could not find a relationship between 'fm_staff' and 'fm_queue_assignments' in the schema cache", details: "Searched for a foreign key relationship between 'fm_staff' and 'fm_queue_assignments' in the schema 'public', but no matches were found." };
const A = { id: "11111111-1111-4111-8111-111111111111", code: "KOORDYNATOR-ALEKSANDRA", event_date: "2026-09-24" };
const B = { id: "22222222-2222-4222-8222-222222222222", code: "OBSLUGA-1", event_date: "2026-09-24" };

beforeEach(() => { state.responses = {}; state.calls.length = 0; });

describe("listFmStaff — konta i przypisania osobno", () => {
  it("łączy przypisania po operator_id bez mieszania kont; konto bez przypisań zostaje z pustą listą", async () => {
    state.responses.fm_staff = { data: [A, B], error: null };
    state.responses.fm_queue_assignments = { data: [{ operator_id: B.id, queue_group_id: "g1" }, { operator_id: B.id, queue_group_id: "g2" }], error: null };
    const rows = await listFmStaff("2026-09-24");
    expect(rows.map(r => r.code)).toEqual(["KOORDYNATOR-ALEKSANDRA", "OBSLUGA-1"]);
    expect(rows[0].fm_queue_assignments).toEqual([]);
    expect(rows[1].fm_queue_assignments).toEqual([{ queue_group_id: "g1" }, { queue_group_id: "g2" }]);
    const staffCall = state.calls.find(c => c.table === "fm_staff");
    expect(staffCall.ops).toEqual(expect.arrayContaining([["select", "*"], ["order", "code"], ["eq", "event_date", "2026-09-24"]]));
    expect(staffCall.ops.find(o => o[0] === "select")[1]).not.toMatch(/fm_queue_assignments/);
    const asgCall = state.calls.find(c => c.table === "fm_queue_assignments");
    expect(asgCall.ops).toEqual(expect.arrayContaining([["select", "operator_id, queue_group_id"], ["in", "operator_id", [A.id, B.id]]]));
  });

  it("bez kont: brak zapytania o przypisania (żadnego pustego IN)", async () => {
    state.responses.fm_staff = { data: [], error: null };
    expect(await listFmStaff("2026-09-24")).toEqual([]);
    expect(state.calls.some(c => c.table === "fm_queue_assignments")).toBe(false);
  });

  it("PGRST200 (brak relacji) z pierwszego odczytu jest błędem, nie pustą listą", async () => {
    state.responses.fm_staff = { data: null, error: PGRST200 };
    await expect(listFmStaff("2026-09-24")).rejects.toMatchObject({ code: "PGRST200" });
  });

  it("błąd drugiego odczytu (przypisania) nie daje pustego sukcesu", async () => {
    state.responses.fm_staff = { data: [A], error: null };
    state.responses.fm_queue_assignments = { data: null, error: { code: "42501", message: "permission denied for table fm_queue_assignments" } };
    await expect(listFmStaff("2026-09-24")).rejects.toMatchObject({ code: "42501" });
  });

  it("zgodność ze stanem przed migracją 053: brak TABELI nadal daje pustą listę", async () => {
    state.responses.fm_staff = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.fm_staff' in the schema cache" } };
    expect(await listFmStaff("2026-09-24")).toEqual([]);
    state.responses.fm_staff = { data: null, error: { code: "42P01", message: 'relation "public.fm_staff" does not exist' } };
    expect(await listFmStaff("2026-09-24")).toEqual([]);
  });
});

describe("isMissingObjectError — tylko brak tabeli/funkcji", () => {
  it("rozpoznaje brak obiektu, a NIE błąd relacji, uprawnień czy transportu", () => {
    expect(isMissingObjectError({ code: "PGRST205", message: "Could not find the table 'public.x' in the schema cache" })).toBe(true);
    expect(isMissingObjectError({ code: "PGRST202", message: "Could not find the function public.f in the schema cache" })).toBe(true);
    expect(isMissingObjectError({ code: "42P01", message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingObjectError({ message: 'relation "public.x" does not exist' })).toBe(true);
    expect(isMissingObjectError(PGRST200)).toBe(false);
    expect(isMissingObjectError({ code: "PGRST201", message: "Could not embed because more than one relationship was found in the schema cache" })).toBe(false);
    expect(isMissingObjectError({ code: "42501", message: "permission denied for table fm_staff" })).toBe(false);
    expect(isMissingObjectError({ code: "PGRST003", message: "upstream request timeout" })).toBe(false);
    expect(isMissingObjectError(null)).toBe(false);
  });
});
