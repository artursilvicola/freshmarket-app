import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => key, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
const updateCompany = vi.fn(async (id, patch) => ({ id, ...patch }));
vi.mock("../lib/db", async (importOriginal) => ({
  ...(await importOriginal()),
  updateCompany: (...args) => updateCompany(...args),
  saveCompanyContacts: vi.fn(async () => []),
  saveCompanyCerts: vi.fn(async () => []),
}));
import { PageCompany } from "./PreconnectFM.jsx";

const trees = [];
function render(node) {
  let tree;
  act(() => { tree = create(node); });
  trees.push(tree);
  return tree;
}
afterEach(() => {
  act(() => trees.splice(0).forEach(tree => tree.unmount()));
  updateCompany.mockClear();
});
const text = (tree) => JSON.stringify(tree.toJSON());
// Zgłoszenie 17.09 (koordynatorka wierniccy.co): opis PL i EN wpisywane w to samo pole →
// zostawał tylko język wpisany jako drugi. Firma jak Fungi Team: opis PL, asortyment w „Produktach”.
const CO = {
  id: "co-fungi", name: "Fungi Team P&P Rymuza", nip: "PL8231671939", country: "PL", logo: "https://x/logo.png",
  contacts: [], certs: [], profile_data: {},
  description_short: "Nowoczesna produkcja grzybów",
  description: "Nowoczesna pieczarkarnia w Kowiesach, 24 komory uprawowe.",
  description_short_en: "", description_en: "",
  categories: ["warzywa"], types: ["producent"],
  products: "Grzyby, pieczarki Agaricus bisporus.",
};
function props(co, fl = vi.fn()) {
  return {
    co, companyId: co.id, setCo: vi.fn(), fl,
    aiModal: null, setAiModal: vi.fn(), aiLoad: false, runAI: vi.fn(),
    offers: [], retailers: [], hiddenRetailers: [], setHiddenRetailers: vi.fn(),
  };
}
const saveButton = (tree) => tree.root.findAllByType("button").find(b => b.children.includes("supplier.company.actions.save_btn"));
const enBox = (tree) => tree.root.find(n => n.props && n.props["data-testid"] === "desc-en");
const textareasIn = (node) => node.findAllByType("textarea");

describe("Profil firmy — osobne pola na angielską wersję opisu", () => {
  it("formularz ma pola PL i osobne pola EN z istniejącymi wartościami", () => {
    const tree = render(<PageCompany {...props({ ...CO, description_short_en: "Modern mushroom production", description_en: "A modern mushroom farm in Kowiesy." })}/>);
    const t = text(tree);
    expect(t).toContain("supplier.company.desc.short_en_label");
    expect(t).toContain("supplier.company.desc.standard_en_label");
    expect(t).toContain("supplier.company.desc.en_intro");
    const [shortEn, longEn] = textareasIn(enBox(tree));
    expect(shortEn.props.value).toBe("Modern mushroom production");
    expect(longEn.props.value).toBe("A modern mushroom farm in Kowiesy.");
    // pola PL nietknięte
    const all = tree.root.findAllByType("textarea");
    expect(all.find(ta => ta.props.value === "Nowoczesna produkcja grzybów")).toBeTruthy();
    expect(all.find(ta => ta.props.value === "Nowoczesna pieczarkarnia w Kowiesach, 24 komory uprawowe.")).toBeTruthy();
  });

  it("wpisanie EN nie nadpisuje PL: zapis wysyła obie wersje do bazy", async () => {
    const tree = render(<PageCompany {...props(CO)}/>);
    const [shortEn, longEn] = textareasIn(enBox(tree));
    act(() => shortEn.props.onChange({ target: { value: "Modern mushroom production" } }));
    act(() => longEn.props.onChange({ target: { value: "A modern mushroom farm in Kowiesy with 24 growing rooms." } }));
    await act(async () => { await saveButton(tree).props.onClick(); });
    expect(updateCompany).toHaveBeenCalledTimes(1);
    const patch = updateCompany.mock.calls[0][1];
    expect(patch.description_short).toBe("Nowoczesna produkcja grzybów");
    expect(patch.description).toBe("Nowoczesna pieczarkarnia w Kowiesach, 24 komory uprawowe.");
    expect(patch.description_short_en).toBe("Modern mushroom production");
    expect(patch.description_en).toBe("A modern mushroom farm in Kowiesy with 24 growing rooms.");
  });

  it("puste pola EN zapisują się jako null, spacje nie liczą się jako tekst — także w obiekcie dla setCo (drugi zapis)", async () => {
    const p = props({ ...CO, description_en: "   ", description_short: "  Nowoczesna produkcja grzybów  " });
    const tree = render(<PageCompany {...p}/>);
    await act(async () => { await saveButton(tree).props.onClick(); });
    const patch = updateCompany.mock.calls[0][1];
    expect(patch.description_short_en).toBeNull();
    expect(patch.description_en).toBeNull();
    expect(patch.description_short).toBe("Nowoczesna produkcja grzybów");
    // drugi mechanizm zapisu (setCo → setCompanies → bulk upsert) dostaje te same znormalizowane wartości
    expect(p.setCo).toHaveBeenCalledTimes(1);
    const saved = p.setCo.mock.calls[0][0];
    expect(saved.description_en).toBeNull();
    expect(saved.description_short_en).toBeNull();
    expect(saved.description_short).toBe("Nowoczesna produkcja grzybów");
  });

  it("„Podgląd – widok kupca” z profilu dostawcy pokazuje asortyment z pola „Produkty” (druga część zgłoszenia 17.09)", () => {
    const tree = render(<PageCompany {...props(CO)}/>);
    const previewBtn = tree.root.findAllByType("button").find(b => b.children.includes("supplier.company.actions.preview_buyer"));
    expect(previewBtn).toBeTruthy();
    act(() => previewBtn.props.onClick());
    const t = text(tree);
    expect(t).toContain("common.company_preview.modal_title");
    expect(t).toContain("common.company_preview.offer_products_label");
    expect(t).toContain("Grzyby, pieczarki Agaricus bisporus.");
  });
});
