import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";
import pl from "../i18n/pl/legacy.json";
import en from "../i18n/en/legacy.json";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
// t/Trans zwracają klucz + parametry, żeby test widział, co trafia do tekstu.
const fmt = (key, opts) => {
  const vals = opts && Object.entries(opts).filter(([k]) => !["defaultValue"].includes(k));
  return vals && vals.length ? `${key}(${vals.map(([k, v]) => `${k}=${v}`).join(",")})` : key;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: fmt, i18n: { language: "pl" } }),
  Trans: ({ i18nKey, values }) => fmt(i18nKey, values),
}));
vi.mock("../lib/db", async (importOriginal) => ({
  ...(await importOriginal()),
  setCompanyTargetRetailers: vi.fn(async () => []),
}));
import { PageSupplierFM, FMAdminPreferencesView } from "./PreconnectFM.jsx";

const trees = [];
function render(node) {
  let tree;
  act(() => { tree = create(node); });
  trees.push(tree);
  return tree;
}
function text(tree) { return JSON.stringify(tree.toJSON()); }
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); });

const CHAINS = Array.from({ length: 12 }, (_, i) => ({ id: `ch${i + 1}`, name: `Sieć ${i + 1}`, country: "PL", cat: "owoce", stations: 1 }));
// Duplikat z 1 pakietem stoi PRZED właściwą firmą — jak KRZYŚ-MAR w bazie.
const DUP  = { id: "co-old", name: "P.W. KRZYŚ-MAR S.C.", fm_b2b_packages: 1, fm_b2b_enabled: false, account_status: "suspended" };
const MINE = { id: "co-new", name: "PRZEDSIĘBIORSTWO WIELOBRANŻOWE KRZYŚ-MAR S.C.", fm_b2b_packages: 2, fm_b2b_enabled: true, account_status: "active" };

function starsFor(n) {
  return Object.fromEntries(CHAINS.slice(0, n).map(c => [c.id, "star"]));
}
function supplierProps(stars, { packages = 2, companies = [DUP, MINE] } = {}) {
  const co = companies.find(c => c.id === "co-new");
  if (co) co.fm_b2b_packages = packages;
  return {
    fmId: "co-new", accountId: "co-new",
    fmSettings: { currentPhase: 2, schedulingOpen: true, planPublished: false },
    fmPrefs: { "co-new": starsFor(stars) }, setFmPrefs: vi.fn(),
    fmResps: {}, fmAlgo: null, fmSchedule: null, setFmSchedule: vi.fn(),
    subPage: "fm-sched", fmChains: CHAINS, fmSuppliers: [], companies, offers: [],
    previewFor: {}, retailers: [], confirmFmSelection: vi.fn(),
  };
}
function confirmButton(tree) {
  return tree.root.findAllByType("button").find(b =>
    JSON.stringify(b.children.map(c => (typeof c === "string" ? c : c.type))).includes("fm.supplier.confirm_btn_"));
}
function starButton(tree, chainId) {
  // przycisk ⭐/👍/○ stoi w wierszu sieci — szukamy po nazwie sieci w tym samym wierszu
  const name = CHAINS.find(c => c.id === chainId).name;
  const row = tree.root.findAll(n => n.type === "div" && n.findAll(x => x.type === "div" && x.children.includes(name)).length === 1
    && n.findAllByType("button").length === 1)[0];
  return row.findAllByType("button")[0];
}

describe("panel dostawcy — minimum 5 ⭐ vs limit z pakietów", () => {
  it("2 pakiety Business i 5 ⭐: licznik 5/10, status „minimum”, komunikat o 5 wolnych, potwierdzenie dostępne", () => {
    const tree = render(<PageSupplierFM {...supplierProps(5)}/>);
    const t = text(tree);
    expect(t).toContain("fm.supplier.stats_stars_format(count=5,max=10)");
    expect(t).toContain("fm.supplier.stats_status_min_reached");
    expect(t).toContain("fm.supplier.stats_status_label_more(count=5)");
    expect(t).toContain("fm.supplier.min_reached_alert_html(min=5,count=5,max=10,packages=2)");
    expect(t).not.toContain("fm.supplier.ready_alert_html");
    expect(t).not.toContain("fm.supplier.stats_status_ready");
    expect(t).toContain("fm.supplier.confirm_ready_more_title(count=5)");
    expect(t).toContain("fm.supplier.chains_hint(min=5,max=10)");
    expect(confirmButton(tree).props.disabled).toBe(false);
  });

  it("szóste kliknięcie przy 2 pakietach nadal daje ⭐ (limit 10), a przy 1 pakiecie już 👍", () => {
    const two = supplierProps(5);
    const tree = render(<PageSupplierFM {...two}/>);
    act(() => starButton(tree, "ch6").props.onClick());
    expect(two.setFmPrefs).toHaveBeenCalledTimes(1);
    expect(two.setFmPrefs.mock.calls[0][0]["co-new"].ch6).toBe("star");

    const one = supplierProps(5, { packages: 1, companies: [{ ...MINE }] });
    const tree1 = render(<PageSupplierFM {...one}/>);
    act(() => starButton(tree1, "ch6").props.onClick());
    expect(one.setFmPrefs.mock.calls[0][0]["co-new"].ch6).toBe("thumb");
  });

  it("pełna pula (10/10): zielone „Gotowe” z liczbą z pakietów, jedenaste kliknięcie = 👍", () => {
    const p = supplierProps(10);
    const tree = render(<PageSupplierFM {...p}/>);
    const t = text(tree);
    expect(t).toContain("fm.supplier.stats_stars_format(count=10,max=10)");
    expect(t).toContain("fm.supplier.stats_status_ready");
    expect(t).toContain("fm.supplier.ready_alert_html(max=10)");
    expect(t).not.toContain("fm.supplier.min_reached_alert_html");
    expect(t).toContain("fm.supplier.confirm_ready_title");
    act(() => starButton(tree, "ch11").props.onClick());
    expect(p.setFmPrefs.mock.calls[0][0]["co-new"].ch11).toBe("thumb");
  });

  it("poniżej minimum (4 ⭐): status „wybierz 5”, potwierdzenie zablokowane", () => {
    const tree = render(<PageSupplierFM {...supplierProps(4)}/>);
    const t = text(tree);
    expect(t).toContain("fm.supplier.stats_stars_format(count=4,max=10)");
    expect(t).toContain("fm.supplier.stats_status_pending(min=5)");
    expect(t).toContain("fm.supplier.confirm_not_ready_title(min=5)");
    expect(t).not.toContain("fm.supplier.min_reached_alert_html");
    expect(confirmButton(tree).props.disabled).toBe(true);
  });

  it("1 pakiet i 5 ⭐: 5/5, od razu „Gotowe” — bez komunikatu o wolnych wyborach", () => {
    const tree = render(<PageSupplierFM {...supplierProps(5, { packages: 1, companies: [{ ...MINE }] })}/>);
    const t = text(tree);
    expect(t).toContain("fm.supplier.stats_stars_format(count=5,max=5)");
    expect(t).toContain("fm.supplier.ready_alert_html(max=5)");
    expect(t).toContain("fm.supplier.stats_status_ready");
    expect(t).not.toContain("min_reached");
  });

  it("firma po dokładnym company_id konta — duplikat z 1 pakietem na liście nie obniża limitu", () => {
    // duplikat dostaje dodatkowo ten sam klucz legacy co konto — nadal wygrywa dokładne id
    const companies = [{ ...DUP, legacy_fm_id: "co-new" }, { ...MINE }];
    const tree = render(<PageSupplierFM {...supplierProps(5, { companies })}/>);
    expect(text(tree)).toContain("fm.supplier.stats_stars_format(count=5,max=10)");
  });
});

describe("admin — podgląd preferencji pokazuje limit z pakietów", () => {
  it("lista ⭐5/10 i nagłówek sekcji (5/10) dla firmy z 2 pakietami", () => {
    const fmSuppliers = [{ id: "co-new", name: MINE.name, pkg: "Business", country: "PL", products: "owoce" }];
    const tree = render(<FMAdminPreferencesView fmPrefs={{ "co-new": starsFor(5) }} fmResps={{}} retailers={[]} fmChains={CHAINS} fmSuppliers={fmSuppliers} companies={[DUP, { ...MINE, fm_b2b_packages: 2 }]}/>);
    const badge = tree.root.findAll(n => n.type === "span" && n.children.join("") === "⭐5/10");
    expect(badge).toHaveLength(1);
    const row = tree.root.findAll(n => n.type === "div" && typeof n.props.onClick === "function"
      && n.findAll(x => x.type === "div" && x.children.includes(MINE.name)).length > 0)[0];
    act(() => row.props.onClick());
    expect(text(tree)).toContain("fm.admin.prefs_view.supplier_stars_section_format(count=5,max=10)");
  });
});

describe("teksty PL/EN", () => {
  it("licznik i podpowiedzi mają dynamiczne {{min}}/{{max}}, stary klucz usunięty", () => {
    for (const j of [pl, en]) {
      const s = j.fm.supplier;
      expect(s.stats_stars_format).toBe("{{count}}/{{max}}");
      expect(s.stats_status_pending).toContain("{{min}}");
      expect(s.ready_alert_html).toContain("{{max}}");
      expect(s.min_reached_alert_html).toContain("{{count}}");
      expect(s.min_reached_alert_html).toContain("{{max}}");
      expect(s.confirm_not_ready_title).toContain("{{min}}");
      expect(s.confirm_ready_more_title).toContain("{{count}}");
      expect(s.chains_hint).toContain("{{max}}");
      expect(s.stars_remaining_hint).toBeUndefined();
      expect(j.fm.admin.prefs_view.supplier_stars_section_format).toContain("{{count}}/{{max}}");
      expect(j.supplier.dashboard.help_strip.fm_li_1_rest).not.toMatch(/maks\. 5|up to 5/);
    }
  });
});
