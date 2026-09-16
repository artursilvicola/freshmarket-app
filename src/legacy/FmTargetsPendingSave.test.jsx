// [fix/security-hotfix] Regresja z review Codexa 79b4b24 (P1/1): starsza odpowiedź
// serwera nie może cofnąć nowszych kliknięć ani zgubić wybranej sieci; potwierdzenie
// czeka na zapis ostatniej rewizji; po błędzie zapisu ponowne kliknięcie zapisuje
// aktualny stan. Harness na wzór ReviewV3PendingSave.test.jsx Codexa (bez sieci,
// bez danych klientów).
import React, { useState } from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
vi.mock("../lib/db", async (original) => ({ ...(await original()), setCompanyTargetRetailers: vi.fn() }));
import { setCompanyTargetRetailers } from "../lib/db";
import { PageSupplierFM } from "./PreconnectFM.jsx";

const NAMES = ["A", "B", "C", "D", "E", "F"];
const chains = NAMES.map(n => ({ id: `rev-${n}`, name: `Rev Network ${n}`, country: "PL", cat: "owoce", stations: 1 }));
const retailers = chains.map((c, i) => ({ id: 990301 + i, fm26ChainId: c.id, name: c.name }));
const company = { id: "rev-company", name: "Rev Company", fm_b2b_packages: 2, fm_b2b_enabled: true, account_status: "active" };

let tree, local, requests, confirmFn;
function Harness() {
  const [prefs, setPrefs] = useState({ "rev-company": {} });
  local = prefs["rev-company"];
  return <PageSupplierFM fmId="rev-company" accountId="rev-company"
    fmSettings={{ currentPhase: 2, schedulingOpen: true, planPublished: false }}
    fmPrefs={prefs} setFmPrefs={setPrefs} fmResps={{}} fmAlgo={null} fmSchedule={null}
    setFmSchedule={() => {}} subPage="fm-sched" fmChains={chains} fmSuppliers={[]}
    companies={[company]} offers={[]} previewFor={{}} retailers={retailers} confirmFmSelection={confirmFn} />;
}
function mount() {
  requests = [];
  confirmFn = vi.fn();
  setCompanyTargetRetailers.mockImplementation((companyId, rows) => new Promise((resolve, reject) => requests.push({ companyId, rows, resolve, reject })));
  act(() => { tree = create(<Harness />); });
}
afterEach(() => { act(() => tree.unmount()); setCompanyTargetRetailers.mockReset(); });
const row = (name) => tree.root.findAll(n => n.type === "div" && n.findAll(x => x.type === "div" && x.children.includes(`Rev Network ${name}`)).length === 1 && n.findAllByType("button").length === 1)[0];
const click = async (name) => { await act(async () => { row(name).findAllByType("button")[0].props.onClick(); }); };
const ids = (rows) => rows.map(r => r.retailer_id).sort();
const visible = () => Object.keys(local).sort();
const confirmButton = () => tree.root.findAllByType("button").find(b => typeof b.props.onClick === "function" && "disabled" in b.props && b.props.onClick.constructor.name === "AsyncFunction");
const hasError = () => JSON.stringify(tree.toJSON()).includes("fm.supplier.targets_save_failed");

describe("PageSupplierFM — zapisy wyborów a kolejność odpowiedzi serwera", () => {
  it("trzy kliknięcia z odpowiedziami pomiędzy: nic nie ginie, ostatni payload = A,B,C (scenariusz Codexa)", async () => {
    mount();
    await click("A");
    await click("B");
    expect(visible()).toEqual(["rev-A", "rev-B"]);
    await act(async () => { requests[0].resolve(requests[0].rows); }); // odpowiedź na [A] przychodzi, gdy UI ma już [A,B]
    expect(visible()).toEqual(["rev-A", "rev-B"]);                       // nie cofa B
    expect(requests).toHaveLength(2);
    await click("C");
    await act(async () => { requests[1].resolve(requests[1].rows); });
    expect(requests).toHaveLength(3);
    await act(async () => { requests[2].resolve(requests[2].rows); });
    expect(ids(requests[2].rows)).toEqual([990301, 990302, 990303]);
    expect(visible()).toEqual(["rev-A", "rev-B", "rev-C"]);
  });

  it("odpowiedź z bazy na OSTATNIĄ rewizję dopasowuje UI do stanu zapisanego (inna karta wygrała)", async () => {
    mount();
    await click("A");
    await act(async () => { requests[0].resolve([{ retailer_id: 990302, priority: 1000, note: "chain:rev-B" }]); }); // baza ma [B]
    expect(visible()).toEqual(["rev-B"]);
  });

  it("błąd zapisu: banner błędu, potwierdzenie zablokowane; kolejne kliknięcie zapisuje aktualny stan i czyści błąd", async () => {
    mount();
    await click("A");
    await act(async () => { requests[0].reject(new Error("boom")); });
    expect(hasError()).toBe(true);
    expect(confirmButton().props.disabled).toBe(true);
    await click("B");
    expect(hasError()).toBe(false);
    expect(requests).toHaveLength(2);
    expect(ids(requests[1].rows)).toEqual([990301, 990302]);
    await act(async () => { requests[1].resolve(requests[1].rows); });
    expect(visible()).toEqual(["rev-A", "rev-B"]);
    expect(hasError()).toBe(false);
  });

  it("kliknięcie w trakcie nieudanego zapisu nie ginie — idzie do zapisu jako następne", async () => {
    mount();
    await click("A");
    await click("B");               // czeka w kolejce, gdy [A] jeszcze trwa
    await act(async () => { requests[0].reject(new Error("boom")); });
    expect(requests).toHaveLength(2);
    expect(ids(requests[1].rows)).toEqual([990301, 990302]);
    await act(async () => { requests[1].resolve(requests[1].rows); });
    expect(visible()).toEqual(["rev-A", "rev-B"]);
  });

  it("„Potwierdź wybór” czeka na zapis ostatniej rewizji", async () => {
    mount();
    for (const n of ["A", "B", "C", "D", "E"]) await click(n);   // 5 ⭐ = gotowe do potwierdzenia
    expect(requests).toHaveLength(1);                             // [A] w toku, reszta czeka
    expect(confirmButton().props.disabled).toBe(true);            // trwa zapis
    let clicked;
    await act(async () => { clicked = confirmButton().props.onClick(); });
    expect(confirmFn).not.toHaveBeenCalled();
    await act(async () => { requests[0].resolve(requests[0].rows); });
    expect(requests).toHaveLength(2);
    expect(ids(requests[1].rows)).toEqual([990301, 990302, 990303, 990304, 990305]);
    expect(confirmFn).not.toHaveBeenCalled();                      // wciąż czeka na ostatnią rewizję
    await act(async () => { requests[1].resolve(requests[1].rows); });
    await act(async () => { await clicked; });
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(confirmButton().props.disabled).toBe(false);
  });
});
