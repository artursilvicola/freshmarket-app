// [fix/fm-staff-list-relation] Panel „Dzień wydarzenia → Obsługa”: błąd odczytu kont jest widoczny
// i można go ponowić; „Brak kont obsługi” tylko po UDANYM odczycie; po utworzeniu konta i błędzie
// odświeżenia modal z PIN-em zostaje z informacją, żeby konta nie tworzyć ponownie.
import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const M = vi.hoisted(() => ({ listFmStaff: vi.fn(), listFmQueueGroups: vi.fn(async () => []), getFmQueueSettings: vi.fn(async () => null) }));
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }), auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } } }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ profile: { is_super_admin: true } }) }));
vi.mock("../../staff/staffUi", () => ({ MODE_LABEL: { closed: { pl: "zamknięte", bg: "#eee", color: "#333" } }, humanFmError: (e) => e?.message || String(e) }));
vi.mock("../../lib/fm-queue", () => ({
  listFmStaff: (...a) => M.listFmStaff(...a), listFmQueueGroups: (...a) => M.listFmQueueGroups(...a), getFmQueueSettings: (...a) => M.getFmQueueSettings(...a),
  isMissingObjectError: (e) => !!e && /Could not find the table|does not exist/i.test(e.message || ""),
  listFmQueueLog: vi.fn(async () => []), listFmQueueMeetings: vi.fn(async () => []), subscribeFmQueue: () => () => {},
  deleteFmQueueGroup: vi.fn(), deleteFmStation: vi.fn(), saveFmQueueSettings: vi.fn(), updateFmStaff: vi.fn(), upsertFmQueueGroup: vi.fn(), upsertFmStation: vi.fn(),
  fmQueueRpc: { publicSnapshot: vi.fn(async () => null), assignRetailer: vi.fn() },
}));
import FmEventDay from "./FmEventDay.jsx";

const tick = async () => { await act(async () => { await new Promise(r => setTimeout(r, 30)); }); };
const trees = [];
function render() { let tree; act(() => { tree = create(<FmEventDay retailers={[]} eventDate="2026-09-24" />); }); trees.push(tree); return tree; }
const text = (tree) => JSON.stringify(tree.toJSON());
const button = (tree, re) => tree.root.findAllByType("button").find(b => re.test(b.children.filter(c => typeof c === "string").join("")));
const PGRST200 = Object.assign(new Error("Could not find a relationship between 'fm_staff' and 'fm_queue_assignments' in the schema cache"), { code: "PGRST200" });
const ALEX = { id: "11111111-1111-4111-8111-111111111111", code: "KOORDYNATOR-ALEKSANDRA", display_name: "Aleksandra", event_date: "2026-09-24", fm_queue_assignments: [] };

beforeEach(() => { M.listFmStaff.mockReset(); });
afterEach(() => { act(() => trees.splice(0).forEach(t => t.unmount())); delete globalThis.fetch; });

describe("Dzień wydarzenia → Obsługa: konta obsługi", () => {
  it("błąd odczytu (PGRST200) jest widoczny, bez „Brak kont”, i da się ponowić", async () => {
    M.listFmStaff.mockRejectedValueOnce(PGRST200).mockResolvedValueOnce([ALEX]);
    const tree = render(); await tick();
    act(() => button(tree, /^Obsługa$/).props.onClick()); await tick();
    let t = text(tree);
    expect(t).toContain("Nie udało się odczytać kont obsługi");
    expect(t).toContain("Could not find a relationship");
    expect(t).not.toContain("Brak kont obsługi");
    act(() => button(tree, /Ponów odczyt/).props.onClick()); await tick();
    t = text(tree);
    expect(t).toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).not.toContain("Nie udało się odczytać kont obsługi");
    expect(M.listFmStaff).toHaveBeenCalledTimes(2);
  });

  it("„Brak kont obsługi” pojawia się tylko po udanym odczycie z zerowym wynikiem", async () => {
    M.listFmStaff.mockResolvedValue([]);
    const tree = render(); await tick();
    act(() => button(tree, /^Obsługa$/).props.onClick()); await tick();
    expect(text(tree)).toContain("Brak kont obsługi na ");
    expect(text(tree)).toContain("\"2026-09-24\",\".\"");
  });

  it("konto bez przypisań jest na liście", async () => {
    M.listFmStaff.mockResolvedValue([ALEX]);
    const tree = render(); await tick();
    act(() => button(tree, /^Obsługa$/).props.onClick()); await tick();
    expect(text(tree)).toContain("KOORDYNATOR-ALEKSANDRA");
    expect(text(tree)).not.toContain("Brak kont obsługi");
  });

  it("utworzenie konta + błąd odświeżenia: PIN zostaje z informacją „nie twórz ponownie”", async () => {
    M.listFmStaff.mockResolvedValueOnce([]).mockRejectedValue(PGRST200);
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: ALEX.id, code: "KOORDYNATOR-ALEKSANDRA", pin: "123456" }) }));
    const tree = render(); await tick();
    act(() => button(tree, /^Obsługa$/).props.onClick()); await tick();
    const codeInput = tree.root.findAllByType("input").find(i => i.props.placeholder === "OBSLUGA-1");
    act(() => codeInput.props.onChange({ target: { value: "koordynator-aleksandra" } }));
    await act(async () => { await button(tree, /Utwórz konto/).props.onClick(); }); await tick();
    const t = text(tree);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({ action: "create", code: "KOORDYNATOR-ALEKSANDRA", event_date: "2026-09-24" });
    expect(t).toContain("123456");
    expect(t).toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).toContain("zostało utworzone, ale nie udało się odświeżyć listy");
    expect(t).toContain("Nie twórz go ponownie");
    expect(t).not.toContain("Brak kont obsługi");
  });
});
