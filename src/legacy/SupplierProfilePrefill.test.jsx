import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
// zapis profilu: zwraca wiersz jak PostgREST po normalizacji (trim, puste → null)
const updateOwnSupplierProfile = vi.fn(async (_id, patch) => ({
  id: "u1",
  name: patch.name.trim(),
  phone: patch.phone.trim() || null,
  position: patch.position.trim() || null,
}));
vi.mock("../lib/db", async (importOriginal) => ({
  ...(await importOriginal()),
  updateOwnSupplierProfile: (...args) => updateOwnSupplierProfile(...args),
}));
import { PageSupplierProfile } from "./PreconnectFM.jsx";

const trees = [];
function render(node) {
  let tree;
  act(() => { tree = create(node); });
  trees.push(tree);
  return tree;
}
afterEach(() => {
  act(() => trees.splice(0).forEach(tree => tree.unmount()));
  updateOwnSupplierProfile.mockClear();
});
// pola w kolejności renderu: imię i nazwisko, stanowisko, firma, e-mail, telefon (dalej pola hasła)
const values = (tree) => tree.root.findAllByType("input").map(i => i.props.value);
const ACCOUNT = {
  id: "co-1", role: "supplier",
  name: "PRZEDSIĘBIORSTWO WIELOBRANŻOWE KRZYŚ-MAR S.C.", email: "a@krzysmar.eu",
  personName: "Agnieszka Piechaczek", phone: "696774645", position: "Handlowiec",
};

describe("Mój profil dostawcy — dane osoby po zalogowaniu", () => {
  it("wypełnia imię/stanowisko/telefon z profilu, a w polu osoby nie ma nazwy firmy", () => {
    const tree = render(<PageSupplierProfile account={ACCOUNT} co={{ name: ACCOUNT.name }} fl={vi.fn()}/>);
    const v = values(tree);
    expect(v[0]).toBe("Agnieszka Piechaczek");
    expect(v[1]).toBe("Handlowiec");
    expect(v[2]).toBe(ACCOUNT.name);
    expect(v[3]).toBe("a@krzysmar.eu");
    expect(v[4]).toBe("696774645");
  });

  it("account bez danych osoby (stary kształt) → puste pola zamiast nazwy firmy", () => {
    const tree = render(<PageSupplierProfile account={{ id: "co-1", name: "Firma X", email: "x@x.pl" }} co={null} fl={vi.fn()}/>);
    const v = values(tree);
    expect(v[0]).toBe("");
    expect(v[1]).toBe("");
    expect(v[4]).toBe("");
  });

  it("profil doczytany po zamontowaniu wypełnia formularz, ale nie kasuje edycji w toku", () => {
    const tree = render(<PageSupplierProfile account={{ ...ACCOUNT, personName: "", phone: "", position: "" }} co={null} fl={vi.fn()}/>);
    expect(values(tree)[0]).toBe("");
    act(() => tree.update(<PageSupplierProfile account={ACCOUNT} co={null} fl={vi.fn()}/>));
    expect(values(tree)[0]).toBe("Agnieszka Piechaczek");
    expect(values(tree)[4]).toBe("696774645");
    const phone = tree.root.findAllByType("input")[4];
    act(() => phone.props.onChange({ target: { value: "111222333" } }));
    act(() => tree.update(<PageSupplierProfile account={{ ...ACCOUNT, phone: "999" }} co={null} fl={vi.fn()}/>));
    expect(values(tree)[4]).toBe("111222333");
  });

  it("zapis wywołuje aktualizację profilu i oddaje zapisane dane do onSaved (account bez ponownego logowania)", async () => {
    const fl = vi.fn();
    const onSaved = vi.fn();
    const tree = render(<PageSupplierProfile account={ACCOUNT} co={null} fl={fl} onSaved={onSaved}/>);
    const phone = tree.root.findAllByType("input")[4];
    act(() => phone.props.onChange({ target: { value: " 600 700 800 " } }));
    const save = tree.root.findAllByType("button").find(b => b.children.includes("supplier.profile.save_button"));
    await act(async () => { await save.props.onClick(); });
    expect(updateOwnSupplierProfile).toHaveBeenCalledWith("co-1", { name: "Agnieszka Piechaczek", phone: " 600 700 800 ", position: "Handlowiec" });
    expect(onSaved).toHaveBeenCalledWith({ name: "Agnieszka Piechaczek", phone: "600 700 800", position: "Handlowiec" });
    expect(fl).toHaveBeenCalledWith("supplier.profile.toasts.saved");
    // po zapisie formularz przyjmuje odświeżony account (np. z refreshProfile)
    act(() => tree.update(<PageSupplierProfile account={{ ...ACCOUNT, phone: "600 700 800" }} co={null} fl={fl} onSaved={onSaved}/>));
    expect(values(tree)[4]).toBe("600 700 800");
  });
});
