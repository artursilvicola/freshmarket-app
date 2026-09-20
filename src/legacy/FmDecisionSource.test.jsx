// [feat/fm-decision-source] Oznaczenie „Wybrane przez administratora” w panelach:
// dostawca widzi je tylko przy WŁASNYM wyborze sieci ustawionym przez admina (nigdy przy
// decyzji kupca o sobie ani przy cudzych wyborach), kupiec tylko przy WŁASNEJ decyzji
// ustawionej przez admina (nigdy przy wyborach dostawców), admin widzi obie strony z autorem.
import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { groupDecisionSources } from "../lib/fm-decision-sources.js";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
vi.mock("../lib/db", async (importOriginal) => ({
  ...(await importOriginal()),
  setCompanyTargetRetailers: vi.fn(async () => [{ retailer_id: 100, priority: 1000, note: "chain:ch1" }, { retailer_id: 101, priority: 100, note: "chain:ch2" }, { retailer_id: 102, priority: 100, note: "chain:ch3" }]),
  saveFmResp: vi.fn(async () => ({})),
}));
import * as db from "../lib/db";
import { createDecisionSourceStore } from "../lib/fm-decision-sources-store.js";
import { PageSupplierFM, PageBuyerFM, FMAdminPreferencesView } from "./PreconnectFM.jsx";

// Panel + PRAWDZIWY magazyn źródeł (jak w App): stan źródeł i decyzji trzymane w harnessie.
function BuyerHarness({ fetchRows, onStore, ...props }) {
  const [src, setSrc] = React.useState({ target: {}, resp: {} });
  const [fmResps, setFmResps] = React.useState(props.fmResps);
  const store = React.useMemo(() => { const s = createDecisionSourceStore({ fetchRows, onChange: setSrc, setTimer: () => {} }); onStore?.(s); return s; }, []);
  return <PageBuyerFM {...props} fmResps={fmResps} setFmResps={setFmResps} decisionSources={src} onDecisionSourcesChanged={store.handle} />;
}
function SupplierHarness({ fetchRows, onStore, ...props }) {
  const [src, setSrc] = React.useState({ target: {}, resp: {} });
  const [fmPrefs, setFmPrefs] = React.useState(props.fmPrefs);
  const store = React.useMemo(() => { const s = createDecisionSourceStore({ fetchRows, onChange: setSrc, setTimer: () => {} }); onStore?.(s); return s; }, []);
  return <PageSupplierFM {...props} fmPrefs={fmPrefs} setFmPrefs={setFmPrefs} decisionSources={src} onDecisionSourcesChanged={store.handle} />;
}

const trees = [];
function render(node) { let tree; act(() => { tree = create(node); }); trees.push(tree); return tree; }
const text = (tree) => JSON.stringify(tree.toJSON());
const count = (tree, s) => (text(tree).match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); });
beforeEach(() => { db.setCompanyTargetRetailers.mockClear(); db.saveFmResp.mockClear(); });

const CHAINS = [{ id: "ch1", name: "Sieć 1", country: "PL", cat: "owoce", stations: 1 }, { id: "ch2", name: "Sieć 2", country: "PL", cat: "owoce", stations: 1 }, { id: "ch3", name: "Sieć 3", country: "PL", cat: "owoce", stations: 1 }];
const RETAILERS = [{ id: 100, name: "Sieć 1", fm26ChainId: "ch1", fm26Active: true }, { id: 101, name: "Sieć 2", fm26ChainId: "ch2", fm26Active: true }, { id: 102, name: "Sieć 3", fm26ChainId: "ch3", fm26Active: true }];
const MINE = { id: "co-new", name: "Moja Firma", fm_b2b_packages: 2, fm_b2b_enabled: true, account_status: "active" };
const OTHER = { id: "co-other", name: "Cudza Firma", fm_b2b_packages: 1, fm_b2b_enabled: true, account_status: "active" };
const ADMIN_ID = "aaaaaaaa-0000-4000-8000-000000000000";
const SOURCES = groupDecisionSources([
  { entity: "target", company_id: "co-new", retailer_id: 100, decision: "star", source: "admin", source_user_id: ADMIN_ID, source_at: "2026-09-20T10:00:00Z", author: { name: "Oksana" } },
  { entity: "target", company_id: "co-new", retailer_id: 101, decision: "thumb", source: "supplier", source_user_id: "s", source_at: "2026-09-20T10:00:00Z" },
  { entity: "resp", company_id: "co-new", retailer_id: 100, decision: "remove", source: "admin", source_user_id: ADMIN_ID, source_at: "2026-09-20T10:01:00Z", author: { name: "Oksana" } },
  { entity: "target", company_id: "co-other", retailer_id: 100, decision: "star", source: "admin", source_user_id: ADMIN_ID, source_at: "2026-09-20T10:02:00Z" },
  { entity: "resp", company_id: "co-other", retailer_id: 100, decision: "want", source: "buyer", source_user_id: "b", source_at: "2026-09-20T10:03:00Z" },
]);
const BADGE = "fm.decision_source.admin_badge\"";   // dokładny klucz (bez wariantów _target/_resp)

function supplierProps(extra = {}) {
  return {
    fmId: "co-new", accountId: "co-new",
    fmSettings: { currentPhase: 2, schedulingOpen: true, planPublished: false },
    fmPrefs: { "co-new": { ch1: "star", ch2: "thumb" } }, setFmPrefs: vi.fn(),
    fmResps: { ch1: { "co-new": "remove" } }, fmAlgo: null, fmSchedule: null, setFmSchedule: vi.fn(),
    subPage: "fm-sched", fmChains: CHAINS, fmSuppliers: [], companies: [OTHER, MINE], offers: [],
    previewFor: {}, retailers: RETAILERS, confirmFmSelection: vi.fn(), decisionSources: SOURCES, ...extra,
  };
}
function buyerProps(extra = {}) {
  const fmSuppliers = [{ id: "s1", name: "Moja Firma", pkg: "Business", companyId: "co-new", country: "PL", products: "" }, { id: "s2", name: "Cudza Firma", pkg: "Business", companyId: "co-other", country: "PL", products: "" }];
  return {
    chainId: "ch1", fmChains: CHAINS, fmSuppliers, fmPrefs: { s1: { ch1: "star" }, s2: { ch1: "star" } }, fmResps: { ch1: { s1: "remove", s2: "want" } },
    fmAlgo: null, fmSchedule: null, fmSettings: { currentPhase: 2, schedulingOpen: true, planPublished: false },
    setFmResps: vi.fn(), setFmWishlists: vi.fn(), setFmLateResps: vi.fn(),
    companies: [{ id: "co-new", fmId: "s1" }, { id: "co-other", fmId: "s2" }], retailers: RETAILERS, offers: [], sends: [], fmWishlists: {}, fmLateResps: {}, previewFor: {},
    decisionSources: SOURCES, ...extra,
  };
}

describe("oznaczenie „Wybrane przez administratora”", () => {
  it("dostawca: tylko przy własnym wyborze ustawionym przez admina (Sieć 1), bez autora; nie przy decyzji kupca o nim ani przy cudzych wyborach", () => {
    const tree = render(<PageSupplierFM {...supplierProps()} />);
    expect(count(tree, BADGE)).toBe(1);
    expect(text(tree)).not.toContain("decision-source-meta");
    expect(text(tree)).not.toContain("Oksana");
    expect(text(tree)).not.toContain("admin_badge_resp");
  });

  it("dostawca bez żadnego wpisu admina — zero oznaczeń; brak danych (null) — zero oznaczeń", () => {
    const only = groupDecisionSources([{ entity: "target", company_id: "co-new", retailer_id: 100, source: "supplier", source_at: "2026-09-20T10:00:00Z" }]);
    expect(count(render(<PageSupplierFM {...supplierProps({ decisionSources: only })} />), BADGE)).toBe(0);
    expect(count(render(<PageSupplierFM {...supplierProps({ decisionSources: null })} />), BADGE)).toBe(0);
  });

  it("administrator w podglądzie konta dostawcy widzi dodatkowo autora i czas", () => {
    const tree = render(<PageSupplierFM {...supplierProps({ viewerIsAdmin: true })} />);
    expect(count(tree, BADGE)).toBe(1);
    expect(count(tree, "decision-source-meta")).toBe(1);   // autor/czas: tekst z i18n (tu mock zwraca klucz) — treść sprawdza DecisionSourceBadge.test
  });

  it("po udanym zapisie wyborów panel dostawcy prosi o odświeżenie źródeł", async () => {
    const onDecisionSourcesChanged = vi.fn();
    const tree = render(<PageSupplierFM {...supplierProps({ onDecisionSourcesChanged })} />);
    const unselected = tree.root.findAllByType("button").find(b => b.children.includes("○"));
    expect(unselected).toBeTruthy();
    await act(async () => { unselected.props.onClick(); await new Promise(r => setTimeout(r, 30)); });
    expect(onDecisionSourcesChanged).toHaveBeenCalled();
  });

  it("kupiec: tylko przy własnej decyzji ustawionej przez admina (Moja Firma), bez autora; nie przy wyborach dostawców (Cudza Firma ma wybór admina)", () => {
    const tree = render(<PageBuyerFM {...buyerProps()} />);
    expect(count(tree, BADGE)).toBe(1);
    expect(text(tree)).not.toContain("decision-source-meta");
    expect(text(tree)).not.toContain("admin_badge_target");
    // oznaczenie stoi w wierszu „Moja Firma” (decyzja „Nie chcę” ustawiona przez admina), nie w wierszu „Cudza Firma”
    const rows = tree.root.findAll(n => n.type === "div" && n.children.some(c => c?.props?.children === "Moja Firma" || (Array.isArray(c?.props?.children) && c.props.children.includes("Moja Firma"))));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("kupiec bez wpisów admina / z decyzją własną — zero oznaczeń", () => {
    const own = groupDecisionSources([{ entity: "resp", company_id: "co-new", retailer_id: 100, source: "buyer", source_at: "2026-09-20T10:00:00Z" }]);
    expect(count(render(<PageBuyerFM {...buyerProps({ decisionSources: own })} />), BADGE)).toBe(0);
    expect(count(render(<PageBuyerFM {...buyerProps({ decisionSources: null })} />), BADGE)).toBe(0);
  });

  it("administrator w podglądzie kupca widzi autora i czas", () => {
    const tree = render(<PageBuyerFM {...buyerProps({ viewerIsAdmin: true })} />);
    expect(count(tree, BADGE)).toBe(1);
    expect(count(tree, "decision-source-meta")).toBe(1);
  });

  it("widok admina „Dane wejściowe”, domyślna zakładka „Dostawcy”: oznaczenia przy sieciach głównych i rezerwowych wybranej firmy", () => {
    const fmSuppliers = buyerProps().fmSuppliers;
    const tree = render(<FMAdminPreferencesView fmPrefs={{ s1: { ch1: "star", ch2: "thumb" }, s2: { ch1: "star" } }} fmResps={{ ch1: { s1: "remove", s2: "want" } }} retailers={RETAILERS} fmChains={CHAINS} fmSuppliers={fmSuppliers} companies={[]} decisionSources={SOURCES} />);
    // klik w wiersz listy dostawców: pierwszy węzeł z tym tekstem (lista renderuje się przed szczegółami) → najbliższy przodek z onClick
    const clickRow = (name) => { let node = tree.root.findAll(n => typeof n.type === "string" && n.children.includes(name))[0]; while (node && !node.props.onClick) node = node.parent; act(() => node.props.onClick()); };
    // domyślnie „Dostawcy”; wybór Mojej Firmy (wybór Sieci 1 przez admina + decyzja kupca Sieci 1 przez admina; Sieć 2 własny wybór)
    clickRow("Moja Firma");
    let t = text(tree);
    expect(t).toContain("fm.decision_source.admin_badge_target");
    expect(t).toContain("fm.decision_source.admin_badge_resp");
    expect(count(tree, "decision-source-meta")).toBe(2);           // Sieć 1: target + resp; Sieć 2: nic
    // Cudza Firma: tylko wybór admina (decyzja kupca własna)
    clickRow("Cudza Firma");
    t = text(tree);
    expect(t).toContain("fm.decision_source.admin_badge_target");
    expect(t).not.toContain("fm.decision_source.admin_badge_resp");
    expect(count(tree, "decision-source-meta")).toBe(1);
  });

  it("widok admina „Dane wejściowe”, zakładka „Sieci”: obie strony pary z nazwą strony", () => {
    const fmSuppliers = buyerProps().fmSuppliers;
    const tree = render(<FMAdminPreferencesView fmPrefs={{ s1: { ch1: "star" }, s2: { ch1: "star" } }} fmResps={{ ch1: { s1: "remove", s2: "want" } }} retailers={RETAILERS} fmChains={[CHAINS[0]]} fmSuppliers={fmSuppliers} companies={[]} decisionSources={SOURCES} />);
    act(() => tree.root.findAllByType("button").find(b => b.children.includes("fm.admin.prefs_view.subview_chains")).props.onClick());
    const t = text(tree);
    expect(t).toContain("fm.decision_source.admin_badge_target");   // wybór Cudzej Firmy ustawiony przez admina
    expect(t).toContain("fm.decision_source.admin_badge_resp");     // decyzja kupca o Mojej Firmie ustawiona przez admina
    expect(count(tree, "decision-source-meta")).toBe(3);           // Moja: target+resp, Cudza: target
  });

  it("[review 7f3343e/1] kupiec: zapis odrzucony (fm_inputs_locked) → decyzja admina wraca RAZEM z oznaczeniem", async () => {
    const ADMIN_ROWS = [{ entity: "resp", company_id: "co-new", retailer_id: 100, decision: "remove", source: "admin" }];
    let store; const tree = render(<BuyerHarness {...buyerProps({ decisionSources: undefined })} fetchRows={async () => ADMIN_ROWS} onStore={(s) => { store = s; }} />);
    await act(async () => { await store.refetch(); });
    expect(count(tree, BADGE)).toBe(1);
    db.saveFmResp.mockRejectedValueOnce(Object.assign(new Error("fm_inputs_locked"), { code: "P0001", hint: "Etap zbierania wyborów jest zamknięty" }));
    // przycisk w WIERSZU „Moja Firma” (nie polegamy na kolejności listy)
    const rowButton = (name, key) => { let node = tree.root.findAll(n => typeof n.type === "string" && n.children.includes(name))[0]; while (node && !node.findAll(b => b.type === "button" && b.children.includes(key)).length) node = node.parent; return node.findAll(b => b.type === "button" && b.children.includes(key))[0]; };
    expect(String(rowButton("Moja Firma", "fm.buyer.btn_remove").props.style.border)).toMatch(/^2px/);   // stan wyjściowy: „Nie chcę” (admin)
    await act(async () => { rowButton("Moja Firma", "fm.buyer.btn_want").props.onClick(); await new Promise(r => setTimeout(r, 30)); });
    expect(count(tree, BADGE)).toBe(1);                       // oznaczenie przywrócone
    expect(store.pendingCount()).toBe(0);
    expect(db.saveFmResp).toHaveBeenCalledTimes(1);
    expect(db.saveFmResp.mock.calls[0][0]).toMatchObject({ retailer_id: 100, supplier_company_id: "co-new", zone: "want" });
    // decyzja cofnięta do „remove”: „Chcę” niezaznaczone (1px), „Nie chcę” zaznaczone (2px)
    expect(String(rowButton("Moja Firma", "fm.buyer.btn_want").props.style.border)).toMatch(/^1px/);
    expect(String(rowButton("Moja Firma", "fm.buyer.btn_remove").props.style.border)).toMatch(/^2px/);
  });

  it("[review 7f3343e/2] kupiec: odczyt sprzed edycji, który wraca po zmianie, nie przywraca oznaczenia — także gdy odczyt po zapisie zawodzi", async () => {
    const ADMIN_ROWS = [{ entity: "resp", company_id: "co-new", retailer_id: 100, decision: "remove", source: "admin" }];
    let resolveEarly; let calls = 0;
    const fetchRows = () => { calls += 1; return calls === 1 ? new Promise(r => { resolveEarly = r; }) : Promise.reject(new Error("network")); };
    let store; const tree = render(<BuyerHarness {...buyerProps({ decisionSources: undefined })} fetchRows={fetchRows} onStore={(s) => { store = s; }} />);
    const early = store.refetch();                                   // odczyt w toku (sprzed edycji)
    let node = tree.root.findAll(n => typeof n.type === "string" && n.children.includes("Moja Firma"))[0];
    while (node && !node.findAll(b => b.type === "button" && b.children.includes("fm.buyer.btn_chance")).length) node = node.parent;
    const chanceBtn = node.findAll(b => b.type === "button" && b.children.includes("fm.buyer.btn_chance"))[0];   // wiersz „Moja Firma”
    await act(async () => { chanceBtn.props.onClick(); await new Promise(r => setTimeout(r, 30)); });   // zapis OK → settle + odczyt (błąd)
    expect(db.saveFmResp.mock.calls.at(-1)[0]).toMatchObject({ supplier_company_id: "co-new", zone: "chance" });
    await act(async () => { resolveEarly(ADMIN_ROWS); await early; });                                   // spóźniony stary odczyt
    expect(count(tree, BADGE)).toBe(0);                              // admin NIE wrócił
    expect(store.pendingCount()).toBe(0);
  });

  it("[review 7f3343e/1] dostawca: zapis odrzucony → oznaczenie przy sieci ustawionej przez admina wraca", async () => {
    const ADMIN_ROWS = [{ entity: "target", company_id: "co-new", retailer_id: 100, decision: "star", source: "admin" }];
    let store; const tree = render(<SupplierHarness {...supplierProps({ decisionSources: undefined })} fetchRows={async () => ADMIN_ROWS} onStore={(s) => { store = s; }} />);
    await act(async () => { await store.refetch(); });
    expect(count(tree, BADGE)).toBe(1);
    db.setCompanyTargetRetailers.mockRejectedValueOnce(Object.assign(new Error("fm_inputs_locked"), { code: "P0001" }));
    const starBtn = tree.root.findAllByType("button").find(b => b.children.includes("⭐"));   // Sieć 1 (wybór admina) → rezerwowa
    await act(async () => { starBtn.props.onClick(); await new Promise(r => setTimeout(r, 30)); });
    expect(count(tree, BADGE)).toBe(1);                              // przywrócone po odrzuceniu
    expect(store.pendingCount()).toBe(0);
    expect(text(tree)).toContain("errors.db.fm_inputs_locked");    // baner błędu zapisu (etap zamknięty)
  });

  // ── review a75ca3f: nakładające się edycje z mieszanym wynikiem zapisów ────────────────────────
  const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; };
  const LOCKED = () => Object.assign(new Error("fm_inputs_locked"), { code: "P0001" });
  const tick = (ms = 20) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
  const cardHasBadge = (tree, chainName) => { let node = tree.root.findAll(n => typeof n.type === "string" && n.children.includes(chainName))[0]; while (node && !node.findAll(b => b.type === "button" && (b.children.includes("⭐") || b.children.includes("👍") || b.children.includes("○"))).length) node = node.parent; return node.findAll(n => n.props?.["data-testid"] === "decision-source-admin").length; };
  const starOf = (tree, chainName) => { let node = tree.root.findAll(n => typeof n.type === "string" && n.children.includes(chainName))[0]; while (node && !node.findAll(b => b.type === "button" && b.children.includes("⭐")).length) node = node.parent; return node.findAll(b => b.type === "button" && b.children.includes("⭐"))[0]; };

  it.each([
    ["ok", "ok", [false, false]],
    ["fail", "fail", [true, true]],
    ["fail", "ok", [false, false]],
    ["ok", "fail", [false, true]],
  ])("[review a75ca3f/1] dostawca zmienia dwie sieci admina; zapis 1: %s, zapis 2: %s → oznaczenia wg przyjętych zapisów", async (first, second, expected) => {
    const ADMIN_ROWS = [{ entity: "target", company_id: "co-new", retailer_id: 100, decision: "star", source: "admin" }, { entity: "target", company_id: "co-new", retailer_id: 101, decision: "star", source: "admin" }];
    let reads = 0;
    let store; const tree = render(<SupplierHarness {...supplierProps({ fmPrefs: { "co-new": { ch1: "star", ch2: "star" } }, decisionSources: undefined })} fetchRows={() => (++reads === 1 ? Promise.resolve(ADMIN_ROWS) : Promise.reject(new Error("read down")))} onStore={(s) => { store = s; }} />);
    await act(async () => { await store.refetch(); });
    expect([cardHasBadge(tree, "Sieć 1"), cardHasBadge(tree, "Sieć 2")]).toEqual([1, 1]);
    const d1 = deferred(), d2 = deferred();
    db.setCompanyTargetRetailers.mockImplementationOnce((cid, rows) => d1.p.then(() => rows)).mockImplementationOnce((cid, rows) => d2.p.then(() => rows));
    await act(async () => { starOf(tree, "Sieć 1").props.onClick(); });   // zapis 1 w toku (Sieć 1 → rezerwowa)
    await act(async () => { starOf(tree, "Sieć 2").props.onClick(); });   // zapis 2 czeka w kolejce (cała lista: Sieć 1 i 2 rezerwowe)
    expect([cardHasBadge(tree, "Sieć 1"), cardHasBadge(tree, "Sieć 2")]).toEqual([0, 0]);
    await act(async () => { first === "ok" ? d1.resolve() : d1.reject(LOCKED()); }); await tick();
    await act(async () => { second === "ok" ? d2.resolve() : d2.reject(LOCKED()); }); await tick();
    expect([cardHasBadge(tree, "Sieć 1") === 1, cardHasBadge(tree, "Sieć 2") === 1]).toEqual(expected);
    expect(store.pendingCount()).toBe(0);
    expect(db.setCompanyTargetRetailers).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["ok", "fail", "fm.buyer.btn_want"],     // „Chcę” przyjęte, „Daj szansę” odrzucone → panel: Chcę, BEZ oznaczenia admina
    ["fail", "ok", "fm.buyer.btn_chance"],   // „Chcę” odrzucone, „Daj szansę” przyjęte → panel: Daj szansę, bez oznaczenia
    ["fail", "fail", "fm.buyer.btn_remove"], // oba odrzucone → panel: Nie chcę (admin) Z oznaczeniem
    ["ok", "ok", "fm.buyer.btn_chance"],
  ])("[review a75ca3f/2] kupiec klika „Chcę” potem „Daj szansę”; zapis 1: %s, zapis 2: %s → decyzja %s", async (first, second, selectedKey) => {
    const ADMIN_ROWS = [{ entity: "resp", company_id: "co-new", retailer_id: 100, decision: "remove", source: "admin" }];
    let reads = 0;
    let store; const tree = render(<BuyerHarness {...buyerProps({ decisionSources: undefined })} fetchRows={() => (++reads === 1 ? Promise.resolve(ADMIN_ROWS) : Promise.reject(new Error("read down")))} onStore={(s) => { store = s; }} />);
    await act(async () => { await store.refetch(); });
    expect(count(tree, BADGE)).toBe(1);
    const rowButton = (name, key) => { let node = tree.root.findAll(n => typeof n.type === "string" && n.children.includes(name))[0]; while (node && !node.findAll(b => b.type === "button" && b.children.includes(key)).length) node = node.parent; return node.findAll(b => b.type === "button" && b.children.includes(key))[0]; };
    const d1 = deferred(), d2 = deferred();
    db.saveFmResp.mockImplementationOnce(() => d1.p).mockImplementationOnce(() => d2.p);
    await act(async () => { rowButton("Moja Firma", "fm.buyer.btn_want").props.onClick(); });
    await act(async () => { rowButton("Moja Firma", "fm.buyer.btn_chance").props.onClick(); });
    expect(count(tree, BADGE)).toBe(0);
    await act(async () => { first === "ok" ? d1.resolve({}) : d1.reject(LOCKED()); }); await tick();
    await act(async () => { second === "ok" ? d2.resolve({}) : d2.reject(LOCKED()); }); await tick();
    expect(count(tree, BADGE)).toBe(first === "fail" && second === "fail" ? 1 : 0);
    for (const key of ["fm.buyer.btn_want", "fm.buyer.btn_chance", "fm.buyer.btn_remove"]) expect(String(rowButton("Moja Firma", key).props.style.border)).toMatch(key === selectedKey ? /^2px/ : /^1px/);
    expect(store.pendingCount()).toBe(0);
  });

  it("własna zmiana w panelach unieważnia oznaczenie tej pary natychmiast (bez czekania na odczyt)", async () => {
    const onDecisionSourcesChanged = vi.fn((o) => (o?.invalidate ? { key: "target|co-new|102", rev: 1, pair: o.invalidate } : null));   // jak magazyn: invalidate → token
    const sup = render(<PageSupplierFM {...supplierProps({ onDecisionSourcesChanged })} />);
    const unselected = sup.root.findAllByType("button").find(b => b.children.includes("○"));
    await act(async () => { unselected.props.onClick(); await new Promise(r => setTimeout(r, 30)); });
    expect(onDecisionSourcesChanged.mock.calls[0][0]).toEqual({ invalidate: { entity: "target", companyId: "co-new", retailerId: 102 }, refetch: false });
    expect(onDecisionSourcesChanged.mock.calls.some(c => c.length === 0)).toBe(true);   // po zapisie pełny odczyt
  });
});
