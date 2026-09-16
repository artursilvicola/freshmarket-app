// [fix/security-hotfix] Regresje z review Codexa c3c1e66 (P2/3) i f504f09 (P2): „Odśwież teraz”
// nie może zgubić kliknięcia z kolejki ani niezapisanego (po błędzie) szkicu. Harness jak
// ReviewV6ReloadPending / ReviewV7FailedSaveReload Codexa: prawdziwy PageSupplierFM + NewVersionBanner,
// sieć i przeładowanie zamockowane. Pasek nie jest dziś zamontowany w App (osobne wdrożenie),
// ale komponent i jego kontrakt z rejestrem pending-work zostają przetestowane.
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

const chains = ["A", "B"].map(n => ({ id: `reload-${n}`, name: `Reload Network ${n}`, country: "PL", cat: "owoce", stations: 1 }));
const retailers = chains.map((c, i) => ({ id: 991001 + i, fm26ChainId: c.id, name: c.name }));
let local;
function Harness({ fetchImpl, waitMs }) {
  const [prefs, setPrefs] = useState({ "reload-company": {} });
  local = prefs["reload-company"];
  return <>
    <NewVersionBanner currentBuildId="old" firstCheckMs={1} intervalMs={60000} fetchImpl={fetchImpl} waitMs={waitMs} />
    <PageSupplierFM fmId="reload-company" accountId="reload-company" fmSettings={{ currentPhase: 2, schedulingOpen: true, planPublished: false }}
      fmPrefs={prefs} setFmPrefs={setPrefs} fmResps={{}} fmAlgo={null} fmSchedule={null} setFmSchedule={() => {}}
      subPage="fm-sched" fmChains={chains} fmSuppliers={[]} companies={[{ id: "reload-company", name: "Rev", fm_b2b_packages: 1, fm_b2b_enabled: true, account_status: "active" }]}
      offers={[]} previewFor={{}} retailers={retailers} confirmFmSelection={() => {}} />
  </>;
}
async function setup({ waitMs = 5000 } = {}) {
  vi.useFakeTimers();
  const reload = vi.fn(), confirm = vi.fn(() => false);
  vi.stubGlobal("window", { location: { reload }, confirm });
  const requests = [];
  setCompanyTargetRetailers.mockImplementation((companyId, rows) => new Promise((resolve, reject) => requests.push({ rows, resolve, reject })));
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ build: "new" }) }));
  let tree;
  act(() => { tree = create(<Harness fetchImpl={fetchImpl} waitMs={waitMs} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2); });
  const click = async (name) => {
    const row = tree.root.findAll(n => n.type === "div" && n.findAll(x => x.type === "div" && x.children.includes(`Reload Network ${name}`)).length === 1 && n.findAllByType("button").length === 1)[0];
    await act(async () => { row.findAllByType("button")[0].props.onClick(); });
  };
  const refresh = () => tree.root.findAllByType("button").find(b => b.children.includes("new_version.button") || b.children.includes("new_version.waiting"));
  return { tree, reload, confirm, requests, click, refresh };
}

it("przeładowanie czeka na wysłanie kliknięcia z kolejki; po zapisie A i B przeładowuje", async () => {
  const { tree, reload, confirm, requests, click, refresh } = await setup();
  try {
    await click("A"); await click("B");
    expect(requests).toHaveLength(1);
    expect(Object.keys(local).sort()).toEqual(["reload-A", "reload-B"]);
    await act(async () => { refresh().props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { requests[0].resolve(requests[0].rows); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(requests).toHaveLength(2);
    expect(requests[1].rows.map(r => r.retailer_id).sort()).toEqual([991001, 991002]);
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { requests[1].resolve(requests[1].rows); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  } finally { act(() => tree.unmount()); }
});

it("po nieudanym ostatnim zapisie NIE przeładowuje po cichu: po odczekaniu pyta, „Anuluj” zostawia szkic", async () => {
  const { tree, reload, confirm, requests, click, refresh } = await setup({ waitMs: 2000 });
  try {
    await click("A"); await click("B");
    await act(async () => { refresh().props.onClick(); });
    await act(async () => { requests[0].reject(new Error("network unavailable A")); });
    expect(requests).toHaveLength(2);
    await act(async () => { requests[1].reject(new Error("network unavailable A+B")); });
    expect(Object.keys(local).sort()).toEqual(["reload-A", "reload-B"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(reload).not.toHaveBeenCalled();                      // scenariusz Codexa f504f09
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(confirm).toHaveBeenCalledWith("new_version.confirm_unsaved");
    expect(reload).not.toHaveBeenCalled();                      // „Anuluj”
    expect(Object.keys(local).sort()).toEqual(["reload-A", "reload-B"]);  // szkic zostaje
    expect(refresh().props.disabled).toBe(false);               // można spróbować później
    // ponowne kliknięcie zapisuje bieżący stan i odblokowuje odświeżenie
    await click("A");                                           // A: star → thumb (nowa rewizja)
    expect(requests).toHaveLength(3);
    await act(async () => { requests[2].resolve(requests[2].rows); });
    await act(async () => { refresh().props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(reload).toHaveBeenCalledTimes(1);
  } finally { act(() => tree.unmount()); }
});
