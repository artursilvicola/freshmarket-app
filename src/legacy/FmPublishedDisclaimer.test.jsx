import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
const language = vi.hoisted(() => ({ value: "pl" }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: key => key, i18n: { language: language.value } }), Trans: ({ i18nKey }) => i18nKey }));
vi.mock("../components/supplier/FmMyQueue", () => ({ default: () => null }));
vi.mock("../components/fm/LateSelections.jsx", () => ({ BuyerLateSelections: () => null, AdminLateSelections: () => null }));
import { PageSupplierFM, PageBuyerFM } from "./PreconnectFM.jsx";
import MeetingDisclaimer from "../components/fm/MeetingDisclaimer.jsx";
const trees = [];
function render(node) { let tree; act(() => { tree = create(node); }); trees.push(tree); return tree; }
const text = tree => JSON.stringify(tree.toJSON());
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); language.value = "pl"; });
function props(published, phase = published ? 4 : 3) {
  const plan = { res: { s1: { m: ["ch1"] } }, nums: { s1: { ch1: 7 } }, cq: { ch1: [null, null, null, null, null, null, "s1"] } };
  return { fmId: "s1", accountId: "s1", chainId: "ch1", subPage: "fm-wyniki", fmPrefs: { s1: { ch1: "star" } }, fmResps: {}, fmSettings: { schedulingOpen: true, planPublished: published, currentPhase: phase }, fmSchedule: plan, fmAlgo: plan, fmChains: [{ id: "ch1", name: "Sieć testowa", country: "PL" }], fmSuppliers: [{ id: "s1", name: "Firma testowa", country: "PL", pkg: "Business" }], companies: [{ id: "s1", fm_b2b_packages: 1 }], retailers: [], offers: [], sends: [], fmWishlists: {}, previewFor: {}, setFmPrefs: vi.fn(), setFmResps: vi.fn(), setFmSchedule: vi.fn(), setFmWishlists: vi.fn() };
}

describe("published participant information", () => {
  it.each([false, true])("supplier and buyer see their notice after publication (admin preview=%s)", async viewerIsAdmin => {
    const p = props(true), before = JSON.stringify(p);
    const supplier = render(<PageSupplierFM {...p} viewerIsAdmin={viewerIsAdmin}/>);
    const buyer = render(<PageBuyerFM {...p} viewerIsAdmin={viewerIsAdmin}/>);
    await act(async () => {});
    expect(supplier.root.findAllByProps({ "data-testid": "fm-meeting-notice" })).toHaveLength(1);
    expect(buyer.root.findAllByProps({ "data-testid": "fm-meeting-notice" })).toHaveLength(1);
    expect(text(supplier)).toContain("PreConnect");
    expect(text(buyer)).not.toContain("PreConnect");
    expect(text(buyer)).not.toContain("Biedronka");
    expect(text(buyer)).not.toContain("płatności");
    expect(text(supplier).indexOf("fm.supplier.wyniki_card_title")).toBeLessThan(text(supplier).indexOf("fm-meeting-notice"));
    expect(text(buyer).indexOf("fm.buyer.final_card_title_published")).toBeLessThan(text(buyer).indexOf("fm-meeting-notice"));
    expect(JSON.stringify(p)).toBe(before);
    for (const fn of [p.setFmPrefs, p.setFmResps, p.setFmSchedule, p.setFmWishlists]) expect(fn).not.toHaveBeenCalled();
  });
  it.each([2, 3, 4])("does not show a final notice before publication, including phase %s", phase => {
    const p = props(false, phase);
    expect(text(render(<PageSupplierFM {...p}/>))).not.toContain("fm-meeting-notice");
    expect(text(render(<PageBuyerFM {...p}/>))).not.toContain("fm-meeting-notice");
  });
  it("does not show the notice in the supplier's phase 3 algorithm preview", () => {
    expect(text(render(<PageSupplierFM {...props(false)} subPage="fm-algo" previewFor={{ s1: true }}/>))).not.toContain("fm-meeting-notice");
  });
  it.each(["supplier", "buyer"])("updates %s copy and contact labels on language change", audience => {
    const tree = render(<MeetingDisclaimer audience={audience}/>);
    expect(text(tree)).toContain("Pomoc po polsku");
    language.value = "en-GB";
    act(() => tree.update(<MeetingDisclaimer audience={audience}/>));
    expect(text(tree)).toContain("Help in Polish");
    expect(text(tree)).toContain("Help in English");
    expect(text(tree)).not.toContain("Pomoc po polsku");
    const links = tree.root.findAllByType("a").map(a => a.props.href);
    for (const href of ["mailto:oksana@freshmarket.eu", "tel:+48509086949", "mailto:jagoda.knadel@freshmarket.eu", "tel:+48603811818", "https://wa.me/48603811818", "https://b2b.freshmarket.eu/tablice"]) expect(links).toContain(href);
    expect(tree.root.findAllByType("input")).toHaveLength(0);
  });
});
