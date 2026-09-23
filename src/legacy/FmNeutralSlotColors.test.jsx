// [fix/fm-neutral-slot-colors] Numer spotkania to pozycja w kolejce, nie ocena.
// Dostawca nie może widzieć czerwieni ani podpisu „Późna” przy swoim spotkaniu.
// Widok KUPCA zostaje ze strefami — inna publiczność, świadomie poza zakresem.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }), Trans: ({ i18nKey }) => i18nKey }));
vi.mock("../components/supplier/FmMyQueue", () => ({ default: () => null }));
vi.mock("../components/fm/LateSelections.jsx", () => ({ BuyerLateSelections: () => null, AdminLateSelections: () => null }));
import { PageSupplierFM, PageBuyerFM } from "./PreconnectFM.jsx";

const trees = [];
function render(node) { let tree; act(() => { tree = create(node); }); trees.push(tree); return tree; }
const text = tree => JSON.stringify(tree.toJSON());
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); });

// nr 50 = strefa „red” w starej logice (>35) — dokładnie przypadek ze zgłoszenia
const RED_HEXES = ["#dc2626", "#fee2e2", "#fca5a5"];
const ZONE_KEYS = ["fm.supplier.zone_green", "fm.supplier.zone_orange", "fm.supplier.zone_red"];

function props(published, phase = published ? 4 : 3) {
  const plan = { res: { s1: { m: ["ch1"] } }, nums: { s1: { ch1: 50 } }, cq: { ch1: Array(49).fill(null).concat(["s1"]) } };
  return { fmId: "s1", accountId: "s1", chainId: "ch1", subPage: "fm-wyniki",
    fmPrefs: { s1: { ch1: "star" } }, fmResps: { ch1: { s1: "yes" } },
    fmSettings: { schedulingOpen: true, planPublished: published, currentPhase: phase },
    fmSchedule: plan, fmAlgo: plan,
    fmChains: [{ id: "ch1", name: "Sieć testowa", country: "PL" }],
    fmSuppliers: [{ id: "s1", name: "Firma testowa", country: "PL", pkg: "Business" }],
    companies: [{ id: "s1", fm_b2b_packages: 1 }],
    retailers: [], offers: [], sends: [], fmWishlists: {}, previewFor: {},
    setFmPrefs: vi.fn(), setFmResps: vi.fn(), setFmSchedule: vi.fn(), setFmWishlists: vi.fn() };
}

describe("numer spotkania bez oceny pozycji", () => {
  it("finalny harmonogram dostawcy: numer 50 bez czerwieni", () => {
    const out = text(render(<PageSupplierFM {...props(true)}/>));
    expect(out).toContain("fm.supplier.wyniki_card_title");
    expect(out).toContain("50");
    for (const hex of RED_HEXES) expect(out).not.toContain(hex);
  });

  it("podgląd fazy 3 u dostawcy: bez czerwieni i bez podpisu Dobra/Średnia/Późna", () => {
    // previewFor.suppliers — inaczej komponent pokazuje ekran blokady i test nic nie sprawdza
    const out = text(render(<PageSupplierFM {...props(false)} subPage="fm-algo" previewFor={{ suppliers: ["s1"] }}/>));
    expect(out).toContain("fm.supplier.algo_card_title");
    expect(out).toContain("50");
    for (const hex of RED_HEXES) expect(out).not.toContain(hex);
    for (const key of ZONE_KEYS) expect(out).not.toContain(key);
  });

  it("widok kupca celowo NIE jest zmieniony — strefy zostają", () => {
    const out = text(render(<PageBuyerFM {...props(true)}/>));
    expect(RED_HEXES.some(hex => out.includes(hex))).toBe(true);
  });
});
