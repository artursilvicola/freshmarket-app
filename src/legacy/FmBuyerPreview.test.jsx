import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildFMData } from "../lib/fm-algo.js";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
import { PageBuyerFM } from "./PreconnectFM.jsx";

const trees = [];
function render(node) {
  let tree;
  act(() => { tree = create(node); });
  trees.push(tree);
  return tree;
}
function text(tree) { return JSON.stringify(tree.toJSON()); }
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); });

// Realna firma: klucz w module FM = UUID (legacy fmId nie istnieje).
const COMPANY = {
  id: "co-uuid-1",
  name: "Adam Gabler Ferment Garlic",
  country: "PL",
  city: "WARKA",
  fm_b2b_enabled: true,
  account_status: "active",
  description_short: "Producent czarnego czosnku z Warki.",
  description: "Czarny czosnek — całe główki, obrane ząbki, pasta, miód z czarnym czosnkiem.",
  types: ["producent"],
  categories: ["warzywa"],
  products: "Czarny czosnek",
  markets: "Polska, Niemcy",
  certs: [{ type: "HACCP" }, { type: "GHP" }, { type: "GMP" }],
  contacts: [{ role: "sales", name: "Adam Gabler", position: "Owner", phone: "+48 600 100 200", email: "adam@example.pl" }],
  profile_data: {
    trade: { main_markets: "EU", typical_volumes: "5 ton/tydzień", export_countries: ["DE"] },
    offer: { customer_types: ["retail"] },
  },
};
const SUPPLIER_FM = { id: COMPANY.id, companyId: COMPANY.id, name: COMPANY.name, pkg: "Business", country: "PL", products: "Czarny czosnek" };
const CHAINS = [{ id: "ch39", name: "Biedronka", stations: 1 }];

function props(overrides = {}) {
  const fmPrefs = { [SUPPLIER_FM.id]: { ch39: "star" } };
  const fmSuppliers = [SUPPLIER_FM];
  return {
    chainId: "ch39", fmChains: CHAINS, fmSuppliers, fmPrefs, fmResps: {},
    fmAlgo: buildFMData(fmPrefs, {}, CHAINS, fmSuppliers),
    fmSchedule: null,
    fmSettings: { currentPhase: 2, schedulingOpen: true, planPublished: false },
    setFmSettings: vi.fn(), setFmResps: vi.fn(), setFmSchedule: vi.fn(), setPreviewFor: vi.fn(),
    companies: [COMPANY], retailers: [], offers: [], sends: [],
    fmWishlists: {}, fmLateResps: {}, previewFor: {}, runtimeAccounts: [],
    ...overrides,
  };
}
const previewButton = (tree) => tree.root.findAllByType("button").find(b => b.children.includes("fm.buyer.preview_btn"));

describe("podgląd firmy przez kupca w module FM = pełny profil", () => {
  it("pokazuje dane z rekordu firmy: opis, certyfikaty, rynki, kontakt", () => {
    const tree = render(<PageBuyerFM {...props()}/>);
    const btn = previewButton(tree);
    expect(btn).toBeTruthy();
    act(() => btn.props.onClick());
    const t = text(tree);
    expect(t).toContain("Producent czarnego czosnku z Warki.");
    expect(t).toContain("HACCP");
    expect(t).toContain("GHP");
    expect(t).toContain("5 ton/tydzień");
    expect(t).toContain("Adam Gabler");
    // ubogi fallback („nazwa — produkty") nie może się pojawić
    expect(t).not.toContain("Adam Gabler Ferment Garlic — Czarny czosnek");
  });

  it("firma bez rekordu w companies nadal otwiera podgląd (fallback, bez wywrotki)", () => {
    const tree = render(<PageBuyerFM {...props({ companies: [] })}/>);
    act(() => previewButton(tree).props.onClick());
    const t = text(tree);
    expect(t).toContain("Adam Gabler Ferment Garlic — Czarny czosnek");
    expect(t).not.toContain("HACCP");
  });

  it("dopasowanie po companyId, gdy klucz FM to legacy fmId", () => {
    const legacySup = { ...SUPPLIER_FM, id: "s42", companyId: COMPANY.id };
    const fmPrefs = { s42: { ch39: "star" } };
    const tree = render(<PageBuyerFM {...props({
      fmSuppliers: [legacySup], fmPrefs,
      fmAlgo: buildFMData(fmPrefs, {}, CHAINS, [legacySup]),
    })}/>);
    act(() => previewButton(tree).props.onClick());
    expect(text(tree)).toContain("Producent czarnego czosnku z Warki.");
  });
});
