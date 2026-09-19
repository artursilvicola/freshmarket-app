// [fix/fm-staff-list-relation] Panel „Dzień wydarzenia → Obsługa”: błąd odczytu kont jest widoczny
// i można go ponowić; „Brak kont obsługi” tylko po UDANYM odczycie; po utworzeniu konta i błędzie
// odświeżenia modal z PIN-em zostaje z informacją, żeby konta nie tworzyć ponownie.
// Po review Codexa (4589ebb): wiersze są powiązane z dniem odczytu — po zmianie dnia stare konta
// znikają, po błędzie zostają tylko do odczytu, starsza odpowiedź nie nadpisuje nowszej, brak tabeli
// w API to niedostępność, nie „Brak kont”. Po review 1e201ac: generacja obejmuje CAŁY przebieg
// odświeżania (spóźnione grupy/ustawienia poprzedniego dnia nie restartują odczytu kont ani nie
// nadpisują konfiguracji), ręczne ponowienia odporne na odpowiedzi w odwrotnej kolejności.
import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const M = vi.hoisted(() => ({
  listFmStaff: vi.fn(), listFmQueueGroups: vi.fn(async () => []), getFmQueueSettings: vi.fn(async () => null),
  assignRetailer: vi.fn(async () => ({})), updateFmStaff: vi.fn(async () => ({})),
}));
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }), auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } } }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ profile: { is_super_admin: true } }) }));
vi.mock("../../staff/staffUi", () => ({ MODE_LABEL: { closed: { pl: "zamknięte", bg: "#eee", color: "#333" } }, humanFmError: (e) => e?.message || String(e) }));
vi.mock("../../lib/fm-queue", () => ({
  listFmStaff: (...a) => M.listFmStaff(...a), listFmQueueGroups: (...a) => M.listFmQueueGroups(...a), getFmQueueSettings: (...a) => M.getFmQueueSettings(...a),
  isMissingObjectError: (e) => !!e && /Could not find the table|does not exist/i.test(e.message || ""),
  listFmQueueLog: vi.fn(async () => []), listFmQueueMeetings: vi.fn(async () => []), subscribeFmQueue: () => () => {},
  deleteFmQueueGroup: vi.fn(), deleteFmStation: vi.fn(), saveFmQueueSettings: vi.fn(), updateFmStaff: (...a) => M.updateFmStaff(...a), upsertFmQueueGroup: vi.fn(), upsertFmStation: vi.fn(),
  fmQueueRpc: { publicSnapshot: vi.fn(async () => null), assignRetailer: (...a) => M.assignRetailer(...a) },
}));
import FmEventDay from "./FmEventDay.jsx";

const tick = async () => { await act(async () => { await new Promise(r => setTimeout(r, 30)); }); };
const trees = [];
const RETAILERS = [{ id: "r1", name: "Biedronka", fm26Active: true, fm26ChainId: "ch1" }];
const GROUPS = [{ id: "g1", retailer_id: "r1", active: true, fm_stations: [], meetings_per_station: 60, event_date: "2026-09-24" }];
function render(retailers = []) { let tree; act(() => { tree = create(<FmEventDay retailers={retailers} eventDate="2026-09-24" />); }); trees.push(tree); return tree; }
const text = (tree) => JSON.stringify(tree.toJSON());
const button = (tree, re) => tree.root.findAllByType("button").find(b => re.test(b.children.filter(c => typeof c === "string").join("")));
const openStaffTab = async (tree) => { act(() => button(tree, /^Obsługa$/).props.onClick()); await tick(); };
const setDate = async (tree, value) => { act(() => tree.root.findAllByType("input").find(i => i.props.type === "date").props.onChange({ target: { value } })); await tick(); };
const checkboxes = (tree) => tree.root.findAllByType("input").filter(i => i.props.type === "checkbox");
const nameInputs = (tree) => tree.root.findAllByType("input").filter(i => i.props.style?.width === 110);
const PGRST200 = Object.assign(new Error("Could not find a relationship between 'fm_staff' and 'fm_queue_assignments' in the schema cache"), { code: "PGRST200" });
const PGRST205 = Object.assign(new Error("Could not find the table 'public.fm_staff' in the schema cache"), { code: "PGRST205" });
const ALEX = { id: "11111111-1111-4111-8111-111111111111", code: "KOORDYNATOR-ALEKSANDRA", display_name: "Aleksandra", event_date: "2026-09-24", fm_queue_assignments: [] };
const NEXT = { id: "22222222-2222-4222-8222-222222222222", code: "OBSLUGA-25", display_name: "Jutro", event_date: "2026-09-25", fm_queue_assignments: [] };

beforeEach(() => { M.listFmStaff.mockReset(); M.assignRetailer.mockClear(); M.updateFmStaff.mockClear(); M.listFmQueueGroups.mockReset(); M.listFmQueueGroups.mockResolvedValue([]); });
afterEach(() => { act(() => trees.splice(0).forEach(t => t.unmount())); delete globalThis.fetch; });

describe("Dzień wydarzenia → Obsługa: konta obsługi", () => {
  it("błąd odczytu (PGRST200) jest widoczny, bez „Brak kont”, i da się ponowić", async () => {
    M.listFmStaff.mockRejectedValueOnce(PGRST200).mockResolvedValueOnce([ALEX]);
    const tree = render(); await tick();
    await openStaffTab(tree);
    let t = text(tree);
    expect(t).toContain("Nie udało się odczytać kont obsługi");
    expect(t).toContain("Could not find a relationship");
    expect(t).not.toContain("Brak kont obsługi");
    await act(async () => { await button(tree, /Ponów odczyt/).props.onClick(); }); await tick();
    t = text(tree);
    expect(t).toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).not.toContain("Nie udało się odczytać kont obsługi");
    expect(button(tree, /^nowy PIN$/).props.disabled).toBe(false);
    expect(M.listFmStaff).toHaveBeenCalledTimes(2);
  });

  it("„Brak kont obsługi” pojawia się tylko po udanym odczycie z zerowym wynikiem", async () => {
    M.listFmStaff.mockResolvedValue([]);
    const tree = render(); await tick();
    await openStaffTab(tree);
    expect(text(tree)).toContain("Brak kont obsługi na ");
    expect(text(tree)).toContain("\"2026-09-24\",\".\"");
  });

  it("brak tabeli fm_staff w API (PGRST205) to niedostępność, nie „Brak kont”", async () => {
    M.listFmStaff.mockRejectedValue(PGRST205);
    const tree = render(); await tick();
    await openStaffTab(tree);
    const t = text(tree);
    expect(t).toContain("Nie udało się odczytać kont obsługi");
    expect(t).toContain("Tabela kont obsługi (fm_staff) nie jest dostępna w API");
    expect(t).not.toContain("Brak kont obsługi");
    expect(t).not.toContain("Wczytywanie kont");
  });

  it("konto bez przypisań jest na liście", async () => {
    M.listFmStaff.mockResolvedValue([ALEX]);
    const tree = render(); await tick();
    await openStaffTab(tree);
    expect(text(tree)).toContain("KOORDYNATOR-ALEKSANDRA");
    expect(text(tree)).not.toContain("Brak kont obsługi");
  });

  it("review: failed new-day load must not leave old-day account actions enabled", async () => {
    M.listFmStaff.mockResolvedValueOnce([ALEX]).mockRejectedValue(new Error("network failed"));
    const tree = render(RETAILERS); M.listFmQueueGroups.mockResolvedValue(GROUPS); await tick();
    await openStaffTab(tree);
    expect(button(tree, /^nowy PIN$/).props.disabled).toBe(false);
    await setDate(tree, "2026-09-25");
    expect(M.listFmStaff).toHaveBeenLastCalledWith("2026-09-25");
    const t = text(tree);
    // stary wiersz (24.09) nie jest pokazywany dla 25.09 — żadnej akcji, żadnego checkboxa przypisań
    expect(t).not.toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).toContain("Nie udało się odczytać kont obsługi");
    expect(t).not.toContain("Brak kont obsługi");
    const reset = button(tree, /^nowy PIN$/);
    expect(!reset || reset.props.disabled === true).toBe(true);
    expect(checkboxes(tree).length).toBe(0);
    expect(M.assignRetailer).not.toHaveBeenCalled();
  });

  it("zmiana dnia: stare konto znika natychmiast, a przypisanie dotyczy tylko konta z nowego dnia", async () => {
    M.listFmStaff.mockImplementation(async (d) => (d === "2026-09-24" ? [ALEX] : [NEXT]));
    const tree = render(RETAILERS); M.listFmQueueGroups.mockResolvedValue(GROUPS); await tick();
    await openStaffTab(tree);
    expect(text(tree)).toContain("KOORDYNATOR-ALEKSANDRA");
    await setDate(tree, "2026-09-25");
    const t = text(tree);
    expect(t).toContain("OBSLUGA-25");
    expect(t).not.toContain("KOORDYNATOR-ALEKSANDRA");
    const cb = checkboxes(tree);
    expect(cb.length).toBe(1);
    expect(cb[0].props.disabled).toBe(false);
    await act(async () => { await cb[0].props.onChange({ target: { checked: true } }); }); await tick();
    expect(M.assignRetailer).toHaveBeenCalledTimes(1);
    expect(M.assignRetailer).toHaveBeenCalledWith(NEXT.id, "r1", "2026-09-25", true);
  });

  it("starsza odpowiedź (poprzedni dzień) nie nadpisuje nowszej", async () => {
    let resolveOld;
    M.listFmStaff.mockImplementation((d) => (d === "2026-09-24" ? new Promise(r => { resolveOld = r; }) : Promise.resolve([NEXT])));
    const tree = render(); await tick();
    await openStaffTab(tree);
    expect(text(tree)).toContain("Wczytywanie kont");
    await setDate(tree, "2026-09-25");
    expect(text(tree)).toContain("OBSLUGA-25");
    await act(async () => { resolveOld([ALEX]); await new Promise(r => setTimeout(r, 10)); });
    const t = text(tree);
    expect(t).toContain("OBSLUGA-25");
    expect(t).not.toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).not.toContain("Nie udało się odczytać kont obsługi");
    expect(button(tree, /^nowy PIN$/).props.disabled).toBe(false);
  });

  it("review: late old-day groups must not restart staff load for the old day", async () => {
    let resolveOldGroups;
    M.listFmQueueGroups.mockImplementation(d => d === "2026-09-24"
      ? new Promise(resolve => { resolveOldGroups = resolve; })
      : Promise.resolve([]));
    M.listFmStaff.mockImplementation(async d => d === "2026-09-24" ? [ALEX] : [NEXT]);
    const tree = render(); await tick();
    await openStaffTab(tree);
    await setDate(tree, "2026-09-25");
    expect(text(tree)).toContain("OBSLUGA-25");
    await act(async () => { resolveOldGroups([]); });
    await tick();
    expect(tree.root.findAllByType("input").find(i => i.props.type === "date").props.value).toBe("2026-09-25");
    expect(text(tree)).toContain("OBSLUGA-25");
    expect(text(tree)).not.toContain("Wczytywanie kont");
  });

  it("spóźnione grupy i ustawienia poprzedniego dnia nie nadpisują konfiguracji nowego dnia", async () => {
    let resolveOldGroups, resolveOldSettings;
    M.listFmQueueGroups.mockImplementation(d => d === "2026-09-24" ? new Promise(r => { resolveOldGroups = r; }) : Promise.resolve([]));
    M.getFmQueueSettings.mockImplementation(d => d === "2026-09-24" ? new Promise(r => { resolveOldSettings = r; }) : Promise.resolve(null));
    M.listFmStaff.mockImplementation(async d => d === "2026-09-24" ? [ALEX] : [NEXT]);
    const tree = render(RETAILERS); await tick();
    await openStaffTab(tree);
    await setDate(tree, "2026-09-25");
    expect(text(tree)).toContain("OBSLUGA-25");
    await act(async () => { resolveOldGroups(GROUPS); resolveOldSettings({ test_mode: true }); await new Promise(r => setTimeout(r, 10)); });
    await tick();
    const t = text(tree);
    expect(t).toContain("OBSLUGA-25");
    expect(t).not.toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).not.toContain("TRYB TESTOWY");      // ustawienia 24.09 nie trafiły do widoku 25.09
    expect(checkboxes(tree).length).toBe(0);      // grupy 24.09 (Biedronka) nie trafiły do widoku 25.09
    expect(button(tree, /^nowy PIN$/).props.disabled).toBe(false);
    M.getFmQueueSettings.mockReset(); M.getFmQueueSettings.mockResolvedValue(null);
  });

  it("ręczne ponowienia: odpowiedź starszego ponowienia nie nadpisuje nowszego", async () => {
    let resolveFirstRetry;
    M.listFmStaff
      .mockRejectedValueOnce(PGRST200)
      .mockImplementationOnce(() => new Promise(r => { resolveFirstRetry = r; }))
      .mockResolvedValueOnce([ALEX]);
    const tree = render(); await tick();
    await openStaffTab(tree);
    expect(text(tree)).toContain("Nie udało się odczytać kont obsługi");
    // po 1. kliknięciu ramka błędu (i przycisk) znika na czas odczytu — 2. ponowienie tym samym handlerem
    const retry = button(tree, /Ponów odczyt/).props.onClick;
    act(() => { retry(); });                                  // ponowienie 1 — wisi
    await act(async () => { await retry(); }); await tick();  // ponowienie 2 — kończy się od razu
    expect(text(tree)).toContain("KOORDYNATOR-ALEKSANDRA");
    await act(async () => { resolveFirstRetry([]); await new Promise(r => setTimeout(r, 10)); });
    const t = text(tree);
    expect(t).toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).not.toContain("Brak kont obsługi");
    expect(button(tree, /^nowy PIN$/).props.disabled).toBe(false);
    expect(M.listFmStaff).toHaveBeenCalledTimes(3);
  });

  it("błąd ponowienia tego samego dnia: stan sprzed błędu tylko do odczytu, akcje zablokowane", async () => {
    M.listFmStaff.mockResolvedValueOnce([ALEX]).mockRejectedValue(new Error("network failed"));
    const tree = render(RETAILERS); M.listFmQueueGroups.mockResolvedValue(GROUPS); await tick();
    await openStaffTab(tree);
    expect(button(tree, /^nowy PIN$/).props.disabled).toBe(false);
    // legalna akcja (nowy PIN) → po niej odświeżenie listy tego samego dnia kończy się błędem
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: ALEX.id, code: ALEX.code, pin: "654321" }) }));
    await act(async () => { await button(tree, /^nowy PIN$/).props.onClick(); }); await tick();
    const t = text(tree);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(t).toContain("654321");
    expect(t).toContain("Nie udało się odczytać kont obsługi");
    expect(t).toContain("Poniżej stan sprzed błędu — tylko do odczytu");
    expect(t).toContain("KOORDYNATOR-ALEKSANDRA");
    expect(t).not.toContain("Brak kont obsługi");
    for (const b of [/^nowy PIN$/, /^zablokuj$/, /^usuń$/]) expect(button(tree, b).props.disabled).toBe(true);
    expect(nameInputs(tree)[0].props.disabled).toBe(true);
    expect(checkboxes(tree)[0].props.disabled).toBe(true);
    // obejście atrybutu disabled (np. wywołanie handlera) też nie wykonuje zapisu
    const fetchCalls = globalThis.fetch.mock.calls.length;
    await act(async () => { await checkboxes(tree)[0].props.onChange({ target: { checked: true } }); });
    await act(async () => { await nameInputs(tree)[0].props.onBlur({ target: { value: "Ola" } }); });
    await act(async () => { await button(tree, /^nowy PIN$/).props.onClick(); });
    expect(M.assignRetailer).not.toHaveBeenCalled();
    expect(M.updateFmStaff).not.toHaveBeenCalled();
    expect(globalThis.fetch.mock.calls.length).toBe(fetchCalls);
    expect(text(tree)).toContain("Lista kont nie jest aktualna");
  });

  it("utworzenie konta + błąd odświeżenia: PIN zostaje z informacją „nie twórz ponownie”", async () => {
    M.listFmStaff.mockResolvedValueOnce([]).mockRejectedValue(PGRST200);
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: ALEX.id, code: "KOORDYNATOR-ALEKSANDRA", pin: "123456" }) }));
    const tree = render(); await tick();
    await openStaffTab(tree);
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
    // do czasu udanego „Ponów odczyt” nie da się utworzyć kolejnego konta (ani przez przycisk, ani przez handler)
    expect(button(tree, /Utwórz konto/).props.disabled).toBe(true);
    await act(async () => { await button(tree, /Utwórz konto/).props.onClick(); });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
