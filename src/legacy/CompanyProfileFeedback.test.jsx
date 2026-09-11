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
const CO = { id: "co-1", name: "wierniccy.co", nip: "PL5223215504", country: "PL", logo: null, contacts: [], certs: [], profile_data: {} };
function props(co, fl = vi.fn()) {
  return {
    co, companyId: co.id, setCo: vi.fn(), fl,
    aiModal: null, setAiModal: vi.fn(), aiLoad: false, runAI: vi.fn(),
    offers: [], retailers: [], hiddenRetailers: [], setHiddenRetailers: vi.fn(),
  };
}
const saveButton = (tree) => tree.root.findAllByType("button").find(b => b.children.includes("supplier.company.actions.save_btn"));
const blockersBox = (tree) => tree.root.findAll(n => n.props && n.props["data-testid"] === "save-blockers");

describe("Profil firmy — wymagania przed zapisem widoczne przy przycisku", () => {
  it("bez logo: ramka nad „Zapisz profil” z powodem, zapis zatrzymany z komunikatem, bez zapisu do bazy", async () => {
    const fl = vi.fn();
    const tree = render(<PageCompany {...props(CO, fl)}/>);
    expect(blockersBox(tree)).toHaveLength(1);
    expect(text(tree)).toContain("supplier.company.actions.blocked_title");
    expect(text(tree)).toContain("supplier.company.toasts.logo_required");
    await act(async () => { await saveButton(tree).props.onClick(); });
    expect(fl).toHaveBeenCalledWith("supplier.company.toasts.logo_required", "warning");
    expect(updateCompany).not.toHaveBeenCalled();
  });

  it("z logo i NIP: brak ramki, zapis idzie do bazy i kończy się potwierdzeniem", async () => {
    const fl = vi.fn();
    const tree = render(<PageCompany {...props({ ...CO, logo: "https://x/logo.png" }, fl)}/>);
    expect(blockersBox(tree)).toHaveLength(0);
    await act(async () => { await saveButton(tree).props.onClick(); });
    expect(updateCompany).toHaveBeenCalledTimes(1);
    expect(updateCompany.mock.calls[0][0]).toBe("co-1");
    expect(fl).toHaveBeenCalledWith("supplier.company.toasts.saved");
  });

  it("wpisany opis nie ginie, gdy rekord firmy odświeży się w tle (ten sam id)", () => {
    const tree = render(<PageCompany {...props(CO)}/>);
    const ta = tree.root.findAllByType("textarea")[0];
    act(() => ta.props.onChange({ target: { value: "opis proba 11.09 godz 14:51" } }));
    act(() => tree.update(<PageCompany {...props({ ...CO, updated_at: "2026-09-11T12:54:00Z" })}/>));
    const values = tree.root.findAllByType("textarea").map(n => n.props.value);
    expect(values).toContain("opis proba 11.09 godz 14:51");
  });
});
