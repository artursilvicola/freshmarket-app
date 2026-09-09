import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";
import pl from "../i18n/pl/legacy.json";
import en from "../i18n/en/legacy.json";
import { buildFMData } from "../lib/fm-algo.js";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
import { PageBuyerFM, PageAdminFM, FMAdminPreferencesView } from "./PreconnectFM.jsx";

const trees = [];
function render(node) {
  let tree;
  act(() => { tree = create(node); });
  trees.push(tree);
  return tree;
}
function text(tree) { return JSON.stringify(tree.toJSON()); }
function button(tree, key) {
  return tree.root.findAllByType("button").find(b => b.children.includes(key));
}
function props() {
  const fmChains = [{ id: "a", name: "Testowa sieć", stations: 1 }];
  const fmSuppliers = ["yes", "chance", "silent", "no"].map(id => ({ id, name: `Firma ${id}`, pkg: "Business" }));
  const fmPrefs = Object.fromEntries(fmSuppliers.map(s => [s.id, { a: "star" }]));
  const fmResps = { a: { yes: "want", chance: "chance", no: "remove" } };
  return {
    chainId: "a", fmChains, fmSuppliers, fmPrefs, fmResps,
    fmAlgo: buildFMData(fmPrefs, fmResps, fmChains, fmSuppliers),
    fmSchedule: null, fmSettings: { currentPhase: 2, schedulingOpen: true, planPublished: false },
    setFmSettings: vi.fn(), setFmResps: vi.fn(), setFmSchedule: vi.fn(), setPreviewFor: vi.fn(),
    companies: [], retailers: [], offers: [], sends: [], fmWishlists: {}, fmLateResps: {}, previewFor: {}, runtimeAccounts: [],
  };
}
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); });

describe("panel domyślnej szansy", () => {
  it("pokazuje automatyczną szansę bez udawania kliknięcia i bez zapisu odpowiedzi", () => {
    const input = props();
    const tree = render(<PageBuyerFM {...input}/>);
    // Jeden licznik + jeden wiersz firmy, której kupiec nie ocenił.
    expect(text(tree).match(/fm.default_chance.badge/g)).toHaveLength(2);
    expect(input.setFmResps).not.toHaveBeenCalled();
    expect(input.fmResps.a.silent).toBeUndefined();
    act(() => tree.update(<PageBuyerFM {...input} fmResps={{ a: { ...input.fmResps.a, silent: "remove" } }}/>));
    expect(text(tree).match(/fm.default_chance.badge/g)).toHaveLength(1);
  });

  it("admin ma osobną grupę automatycznych szans, nie razem z odmowami", () => {
    const tree = render(<FMAdminPreferencesView {...props()}/>);
    act(() => button(tree, "fm.admin.prefs_view.subview_chains").props.onClick());
    const automaticGroup = tree.root.findAllByType("div").find(d =>
      d.children.some(c => typeof c === "object" && c.props?.children === "fm.admin.prefs_view.chain_group_label_format")
      && d.findAll(n => n.type === "span" && n.children.includes("Firma silent")).length === 1);
    expect(automaticGroup).toBeTruthy();
    expect(automaticGroup.findAll(n => n.type === "span" && n.children.includes("Firma no"))).toHaveLength(0);
    expect(text(tree)).toContain("fm.default_chance.notice");
  });

  it("admin nie publikuje ani nie przelicza planu bez kompletnego odczytu", () => {
    const input = props();
    const tree = render(<PageAdminFM {...input} fmInputsReady={false} fmInputsError/>);
    expect(text(tree)).toContain("fm.default_chance.inputs_error");
    const publish = button(tree, "fm.admin.publish_btn_publish");
    expect(publish.props.disabled).toBe(true);
    act(() => publish.props.onClick());
    expect(input.setFmSettings).not.toHaveBeenCalled();
    act(() => button(tree, "fm.admin.tab_corrections").props.onClick());
    expect(button(tree, "fm.admin.corr_btn_rebuild").props.disabled).toBe(true);
  });

  it("przejście loading → ready tworzy draft, ale nigdy nie zapisuje istniejącego planu", () => {
    const input = props();
    const tree = render(<PageAdminFM {...input} fmInputsReady={false}/>);
    expect(text(tree)).toContain("fm.default_chance.inputs_loading");
    act(() => tree.update(<PageAdminFM {...input} fmInputsReady/>));
    expect(button(tree, "fm.admin.publish_btn_publish").props.disabled).toBe(false);
    expect(input.setFmSchedule).not.toHaveBeenCalled();
    act(() => tree.update(<PageAdminFM {...input} fmInputsReady={false} fmInputsError/>));
    expect(button(tree, "fm.admin.publish_btn_publish").props.disabled).toBe(true);
    expect(input.setFmSchedule).not.toHaveBeenCalled();
  });

  it("reguła i komunikaty błędu mają pełne tłumaczenia PL/EN", () => {
    expect(Object.keys(pl.fm.default_chance)).toEqual(Object.keys(en.fm.default_chance));
    for (const lang of [pl, en]) {
      for (const value of Object.values(lang.fm.default_chance)) expect(value.length).toBeGreaterThan(10);
      expect(lang.fm.buyer.card_interested_desc).not.toMatch(/wyłącznie pary|only pairs/);
    }
  });

  it("korekty pokazują także ostatni numer za lukami w kolejce", () => {
    const input = props();
    const plan = structuredClone(input.fmAlgo);
    plan.cq.a = Array(81).fill(null);
    plan.cq.a[0] = "yes";
    plan.cq.a[80] = "silent";
    plan.res = { yes: { m: ["a"], r: {} }, silent: { m: ["a"], r: {} } };
    plan.nums = { yes: { a: 1 }, silent: { a: 81 } };
    const tree = render(<PageAdminFM {...input} fmInputsReady fmSchedule={plan} fmSettings={{ ...input.fmSettings, currentPhase: 3 }}/>);
    act(() => button(tree, "fm.admin.tab_corrections").props.onClick());
    expect(tree.root.findAllByType("td").some(cell => cell.children.includes("81"))).toBe(true);
    expect(text(tree)).toContain("Firma silent");
  });
});
