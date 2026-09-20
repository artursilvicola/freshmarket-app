// [feat/fm-decision-source] Oznaczenie „Wybrane przez administratora” w panelach:
// dostawca widzi je tylko przy WŁASNYM wyborze sieci ustawionym przez admina (nigdy przy
// decyzji kupca o sobie ani przy cudzych wyborach), kupiec tylko przy WŁASNEJ decyzji
// ustawionej przez admina (nigdy przy wyborach dostawców), admin widzi obie strony z autorem.
import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";
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
}));
import { PageSupplierFM, PageBuyerFM, FMAdminPreferencesView } from "./PreconnectFM.jsx";

const trees = [];
function render(node) { let tree; act(() => { tree = create(node); }); trees.push(tree); return tree; }
const text = (tree) => JSON.stringify(tree.toJSON());
const count = (tree, s) => (text(tree).match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); });

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

  it("własna zmiana w panelach unieważnia oznaczenie tej pary natychmiast (bez czekania na odczyt)", async () => {
    const onDecisionSourcesChanged = vi.fn();
    const sup = render(<PageSupplierFM {...supplierProps({ onDecisionSourcesChanged })} />);
    const unselected = sup.root.findAllByType("button").find(b => b.children.includes("○"));
    await act(async () => { unselected.props.onClick(); await new Promise(r => setTimeout(r, 30)); });
    expect(onDecisionSourcesChanged.mock.calls[0][0]).toEqual({ invalidate: { entity: "target", companyId: "co-new", retailerId: 102 }, refetch: false });
    expect(onDecisionSourcesChanged.mock.calls.some(c => c.length === 0)).toBe(true);   // po zapisie pełny odczyt
  });
});
