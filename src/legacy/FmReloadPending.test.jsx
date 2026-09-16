// [fix/security-hotfix] Regresja z review Codexa c3c1e66 (P2/3): „Odśwież teraz” nie może
// zgubić kliknięcia czekającego w kolejce zapisu wyborów. Harness jak ReviewV6ReloadPending
// Codexa: prawdziwy PageSupplierFM + NewVersionBanner, sieć i przeładowanie zamockowane.
import React, { useState } from "react";
import { create, act } from "react-test-renderer";
import { it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }), Trans: ({ i18nKey }) => i18nKey }));
vi.mock("../lib/db", async (original) => ({ ...(await original()), setCompanyTargetRetailers: vi.fn() }));
import { setCompanyTargetRetailers } from "../lib/db";
import { PageSupplierFM } from "./PreconnectFM.jsx";
import NewVersionBanner from "../components/NewVersionBanner.jsx";
import { _resetPendingWork } from "../lib/pending-work.js";

afterEach(() => { _resetPendingWork(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("przeładowanie czeka na wysłanie kliknięcia z kolejki; po zapisie A i B przeładowuje", async () => {
  vi.useFakeTimers();
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload }, confirm: vi.fn(() => false) });
  const requests = [];
  setCompanyTargetRetailers.mockImplementation((companyId, rows) => new Promise(resolve => requests.push({ rows, resolve })));
  const chains = ["A", "B"].map(n => ({ id: `reload-${n}`, name: `Reload Network ${n}`, country: "PL", cat: "owoce", stations: 1 }));
  const retailers = chains.map((c, i) => ({ id: 991001 + i, fm26ChainId: c.id, name: c.name }));
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ build: "new" }) }));
  let local;
  function Harness() {
    const [prefs, setPrefs] = useState({ "reload-company": {} });
    local = prefs["reload-company"];
    return <>
      <NewVersionBanner currentBuildId="old" firstCheckMs={1} intervalMs={60000} fetchImpl={fetchImpl} waitMs={5000} />
      <PageSupplierFM fmId="reload-company" accountId="reload-company" fmSettings={{ currentPhase: 2, schedulingOpen: true, planPublished: false }}
        fmPrefs={prefs} setFmPrefs={setPrefs} fmResps={{}} fmAlgo={null} fmSchedule={null} setFmSchedule={() => {}}
        subPage="fm-sched" fmChains={chains} fmSuppliers={[]} companies={[{ id: "reload-company", name: "Rev", fm_b2b_packages: 1, fm_b2b_enabled: true, account_status: "active" }]}
        offers={[]} previewFor={{}} retailers={retailers} confirmFmSelection={() => {}} />
    </>;
  }
  let tree;
  try {
    act(() => { tree = create(<Harness />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    for (const name of ["A", "B"]) {
      const row = tree.root.findAll(n => n.type === "div" && n.findAll(x => x.type === "div" && x.children.includes(`Reload Network ${name}`)).length === 1 && n.findAllByType("button").length === 1)[0];
      await act(async () => { row.findAllByType("button")[0].props.onClick(); });
    }
    expect(requests).toHaveLength(1);                                  // [A] w toku, [A,B] w kolejce
    expect(Object.keys(local).sort()).toEqual(["reload-A", "reload-B"]);
    const button = tree.root.findAllByType("button").find(b => b.children.includes("new_version.button"));
    await act(async () => { button.props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(reload).not.toHaveBeenCalled();                              // B jeszcze nie wysłane
    await act(async () => { requests[0].resolve(requests[0].rows); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(requests).toHaveLength(2);
    expect(requests[1].rows.map(r => r.retailer_id).sort()).toEqual([991001, 991002]);
    expect(reload).not.toHaveBeenCalled();                              // [A,B] w toku
    await act(async () => { requests[1].resolve(requests[1].rows); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(reload).toHaveBeenCalledTimes(1);                            // dopiero po zapisie ostatniej rewizji
    expect(window.confirm).not.toHaveBeenCalled();
  } finally { if (tree) act(() => tree.unmount()); }
});
