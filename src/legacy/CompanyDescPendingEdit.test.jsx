// Review Codexa 17.09 (P1, ReviewCompanyDescPending.test.jsx): formularz „Profil firmy” jest
// edytowalny w trakcie zapisu (UPDATE → kontakty → certyfikaty). Odpowiedź wcześniejszego zapisu
// nie może nadpisać nowszego tekstu ani oznaczyć go jako zapisany.
import React from "react";
import { create, act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => ({ finishContacts: null }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: k => k } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: k => k, i18n: { language: "pl" } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
const updateCompany = vi.fn(async (id, patch) => ({ id, ...patch }));
vi.mock("../lib/db", async (importOriginal) => ({
  ...(await importOriginal()),
  updateCompany: (...args) => updateCompany(...args),
  saveCompanyContacts: vi.fn(() => new Promise(resolve => { pending.finishContacts = resolve; })),
  saveCompanyCerts: vi.fn(async () => []),
}));
import { PageCompany } from "./PreconnectFM.jsx";

const CO = {
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "Local review fixture",
  country: "PL", contacts: [], certs: [], profile_data: {}, categories: [], types: [],
  description: "Polski opis.", description_short: "Skrot PL.",
  description_en: "English version A.", description_short_en: "Short EN.",
};
const trees = [];
function render(co, setCo = vi.fn(), fl = vi.fn()) {
  let tree;
  act(() => { tree = create(<PageCompany co={co} companyId={co.id}
    setCo={setCo} fl={fl} aiModal={null} setAiModal={vi.fn()}
    aiLoad={false} runAI={vi.fn()} offers={[]} retailers={[]}
    hiddenRetailers={[]} setHiddenRetailers={vi.fn()}/>); });
  trees.push(tree);
  return tree;
}
afterEach(() => {
  act(() => trees.splice(0).forEach(t => t.unmount()));
  pending.finishContacts = null;
  updateCompany.mockClear();
});
const enLong = (tree) => tree.root.find(n => n.props?.["data-testid"] === "desc-en").findAllByType("textarea")[1];
const plLong = (tree) => tree.root.findAllByType("textarea").find(ta => ta.props.value === "Polski opis." || ta.props.value.startsWith("Polski opis"));
const saveBtn = (tree) => tree.root.findAllByType("button").find(b => b.children.includes("supplier.company.actions.save_btn") || b.children.includes("supplier.company.actions.saving"));

describe("zapis profilu a edycja w trakcie zapisu", () => {
  it("tekst A → zapis w toku → dopisanie B → odpowiedź serwera → B zostaje niezapisanym szkicem", async () => {
    const setCo = vi.fn(); const fl = vi.fn();
    const tree = render(CO, setCo, fl);
    await act(async () => { saveBtn(tree).props.onClick(); });
    expect(pending.finishContacts).toBeTypeOf("function");
    // formularz nie jest zablokowany w trakcie zapisu
    expect(enLong(tree).props.disabled).not.toBe(true);
    act(() => enLong(tree).props.onChange({ target: { value: "English version B, typed during save." } }));
    expect(enLong(tree).props.value).toBe("English version B, typed during save.");
    await act(async () => { pending.finishContacts([]); });
    // stan aplikacji dostał to, co faktycznie zapisano (A) …
    expect(setCo).toHaveBeenCalledTimes(1);
    expect(setCo.mock.calls[0][0].description_en).toBe("English version A.");
    // … a formularz zachował B
    expect(enLong(tree).props.value).toBe("English version B, typed during save.");
    expect(fl).toHaveBeenCalledWith("supplier.company.toasts.saved_newer_draft", "warning");
    expect(fl).not.toHaveBeenCalledWith("supplier.company.toasts.saved");
    // B nie jest oznaczony jako zapisany: kolejny zapis wysyła B
    await act(async () => { saveBtn(tree).props.onClick(); });
    expect(updateCompany).toHaveBeenCalledTimes(2);
    expect(updateCompany.mock.calls[1][1].description_en).toBe("English version B, typed during save.");
  });

  it("dopisanie w polu polskim w trakcie zapisu też zostaje (dotyczy PL i EN)", async () => {
    const tree = render(CO);
    await act(async () => { saveBtn(tree).props.onClick(); });
    act(() => plLong(tree).props.onChange({ target: { value: "Polski opis. Dopisek w trakcie zapisu." } }));
    await act(async () => { pending.finishContacts([]); });
    expect(tree.root.findAllByType("textarea").some(ta => ta.props.value === "Polski opis. Dopisek w trakcie zapisu.")).toBe(true);
  });

  it("bez edycji w trakcie zapisu: formularz dostaje znormalizowane wartości i zwykły toast", async () => {
    const fl = vi.fn();
    const tree = render({ ...CO, description_en: "  English version A.  ", logo: "https://x/logo.png", nip: "PL1234567890" }, vi.fn(), fl);
    await act(async () => { saveBtn(tree).props.onClick(); });
    await act(async () => { pending.finishContacts([]); });
    expect(enLong(tree).props.value).toBe("English version A.");
    expect(fl).toHaveBeenCalledWith("supplier.company.toasts.saved");
    expect(fl).not.toHaveBeenCalledWith("supplier.company.toasts.saved_newer_draft", "warning");
  });
});
