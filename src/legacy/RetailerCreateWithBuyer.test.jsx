// [fix/retailer-create-with-buyer] Testy formularza „Dodaj sieć” — port testów
// kontrolnych Codexa do repo, żeby chodziły pod `npm test`.
//
// Montujemy PRAWDZIWY PageAdminRetailers (import), nie wycinek źródła po offsetach:
// wycinanie rozsypuje się przy każdej edycji pliku i nie widzi reszty modułu.
// Podmieniamy tylko trzy funkcje z ../lib/db, czyli granicę z bazą.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
vi.mock("../components/supplier/FmMyQueue", () => ({ default: () => null }));
vi.mock("../components/fm/LateSelections.jsx", () => ({ BuyerLateSelections: () => null, AdminLateSelections: () => null }));

const db = vi.hoisted(() => ({ upsert: null, createBuyer: null }));
vi.mock("../lib/db", async (importOriginal) => ({
  ...(await importOriginal()),
  bulkUpsertRetailers: (...a) => db.upsert(...a),
  createBuyerAccount: (...a) => db.createBuyer(...a),
}));

import { PageAdminRetailers } from "./PreconnectFM.jsx";

const P = "admin.retailers.";
// Wszystkie id sieci, które poszły do zapisu — bez powtórzeń. Ma być dokładnie jedno.
const idSieci = () => [...new Set(db.upsert.mock.calls.flatMap(([rows]) => rows.map(r => r.id)))];
const BUYER_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
let tree;

function mount() {
  const notices = [];
  let rows = [];
  function Harness() {
    const [retailers, setRetailers] = React.useState([]);
    rows = retailers;
    return React.createElement(PageAdminRetailers, { retailers, setRetailers, fl: (...a) => notices.push(a) });
  }
  act(() => { tree = create(React.createElement(Harness)); });
  const button = key => tree.root.findAllByType("button").find(n => n.children.includes(P + key));
  const input = key => tree.root.findAllByType("input").find(n => n.props.placeholder === P + key);
  const fill = () => {
    act(() => button("header_add_btn").props.onClick());
    act(() => input("form_name_placeholder").props.onChange({ target: { value: "ZZZ TEST LOKALNY" } }));
    act(() => input("form_buyer_name_placeholder").props.onChange({ target: { value: "Test Kupiec" } }));
    act(() => input("form_buyer_email_placeholder").props.onChange({ target: { value: "kupiec@test.invalid" } }));
    const label = tree.root.findAllByType("label").find(n => n.children.includes(P + "cat_options.owoce"));
    act(() => label.findByType("input").props.onChange());
  };
  return { button, input, fill, notices, rows: () => rows };
}

beforeEach(() => {
  db.upsert = vi.fn(async (entries) => entries.map(({ id }) => ({ id })));
  db.createBuyer = vi.fn(async (payload) => ({ user_id: BUYER_ID, profile: { ...payload, id: BUYER_ID } }));
});
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

describe("Dodaj sieć — sieć i kupiec powstają razem", () => {
  it("obie operacje OK: sieć w stanie, konto kupca założone, formularz zamknięty", async () => {
    const h = mount();
    h.fill();
    await act(async () => { await h.button("form_add_btn").props.onClick(); });
    // sieć zapisuje się dwa razy: przy tworzeniu i w zapisie, który dopisuje kategorie
    // z kupca. Istotne jest, że dotyczy JEDNEJ sieci, nie ile razy poleciał upsert.
    expect(idSieci()).toEqual([h.rows()[0].id]);
    expect(db.createBuyer).toHaveBeenCalledTimes(1);
    expect(db.createBuyer.mock.calls[0][0].email).toBe("kupiec@test.invalid");
    expect(h.rows()).toHaveLength(1);
    expect(h.rows()[0].buyers[0].id).toBe(BUYER_ID);
    expect(h.notices.at(-1)[1]).toBe("success");
  });

  // bulkUpsertRetailers NIE rzuca przy błędzie — loguje i zwraca []
  it("niepotwierdzony zapis sieci zatrzymuje proces i NIE tworzy kupca", async () => {
    db.upsert = vi.fn(async () => []);
    const h = mount();
    h.fill();
    await act(async () => { await h.button("form_add_btn").props.onClick(); });
    expect(db.createBuyer).not.toHaveBeenCalled();
    expect(h.rows()).toHaveLength(0);
    expect(h.button("form_add_btn")).toBeTruthy();          // formularz zostaje otwarty
    expect(h.notices.some(([, kind]) => kind === "success")).toBe(false);
  });

  it("odmowa utworzenia kupca: sieć zostaje, ponowienie działa na TEJ SAMEJ sieci", async () => {
    let proba = 0;
    db.createBuyer = vi.fn(async (payload) => {
      if (++proba === 1) throw new Error("test: odmowa utworzenia kupca");
      return { user_id: BUYER_ID, profile: { ...payload, id: BUYER_ID } };
    });
    const h = mount();
    h.fill();
    await act(async () => { await h.button("form_add_btn").props.onClick(); });
    expect(h.rows()).toHaveLength(1);                        // sieć powstała i zostaje
    expect(h.button("form_add_btn")).toBeUndefined();        // formularz zamknięty
    expect(h.notices.some(([, kind]) => kind === "success")).toBe(false);

    await act(async () => { await h.button("save_btn").props.onClick(); });
    expect(idSieci()).toEqual([h.rows()[0].id]);             // ta sama sieć, nie druga
    expect(db.createBuyer).toHaveBeenCalledTimes(2);
    expect(db.createBuyer.mock.calls[0][0].retailer_id).toBe(db.createBuyer.mock.calls[1][0].retailer_id);
    expect(h.rows()).toHaveLength(1);
    expect(h.rows()[0].buyers[0].id).toBe(BUYER_ID);
    expect(h.notices.at(-1)[1]).toBe("success");
  });

  it("klik w „Zapisz zmiany” w trakcie tworzenia kupca NIE wysyła drugiego żądania", async () => {
    let odblokuj;
    db.createBuyer = vi.fn(async (payload) => {
      await new Promise(r => { odblokuj = r; });
      return { user_id: BUYER_ID, profile: { ...payload, id: BUYER_ID } };
    });
    const h = mount();
    h.fill();
    let operacja;
    await act(async () => { operacja = h.button("form_add_btn").props.onClick(); });
    expect(db.createBuyer).toHaveBeenCalledTimes(1);

    const zapisuje = h.button("saving");
    expect(zapisuje, "karta nowej sieci jest otwarta w trakcie tworzenia kupca").toBeTruthy();
    expect(zapisuje.props.disabled).toBe(true);
    // rygiel musi trzymać nawet z pominięciem disabled — stan Reacta jest asynchroniczny
    await act(async () => { zapisuje.props.onClick(); });
    expect(db.createBuyer).toHaveBeenCalledTimes(1);

    await act(async () => { odblokuj(); await operacja; });
  });
});
