import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ language: "pl", changeLanguage: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: app }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: key => `${app.language}:${key}`, i18n: app }),
  Trans: ({ i18nKey }) => i18nKey,
}));
import { CompanyPreviewModal, pickDescriptionSet } from "./PreconnectFM.jsx";

const COMPANY = {
  id: "company-a", name: "Test company", country: "PL",
  description_short: "PL summary", description: "PL full",
  description_short_en: "EN summary", description_en: "EN full",
  products: "PRODUCTS", certs: ["CERTIFICATE"], categories: ["warzywa"],
  contacts: [{ name: "PUBLIC SALES CONTACT" }],
  profile_data: {
    offer: { products_year_round: "YEAR ROUND", products_seasonal: "SEASONAL" },
    operations: { capabilities: ["sorting"] },
    trade: { main_markets: "MARKETS", typical_volumes: "VOLUMES" },
    materials: ["https://example.com/company.pdf"],
  },
};
const trees = [];
function render(co = COMPANY) {
  let tree;
  act(() => { tree = create(<CompanyPreviewModal co={co} role="buyer"/>); });
  trees.push(tree);
  return tree;
}
function update(tree, co) {
  act(() => tree.update(<CompanyPreviewModal co={co} role="buyer"/>));
}
function languageButton(tree, lang) {
  return tree.root.findAllByType("button").find(b => b.children.includes(lang.toUpperCase()));
}
function choose(tree, lang) { act(() => languageButton(tree, lang).props.onClick()); }
function text(tree) { return JSON.stringify(tree.toJSON()); }
function descriptions(tree) { return tree.root.findAllByType("p").map(p => p.children.join(" ")); }
beforeEach(() => { app.language = "pl"; vi.clearAllMocks(); });
afterEach(() => { act(() => trees.splice(0).forEach(tree => tree.unmount())); });

describe("description completeness, not text length", () => {
  it.each([
    [false, { description_short: "PL summary", description_en: "EN full" }, "en"],
    [true, { description: "PL full", description_short_en: "EN summary" }, "pl"],
    [false, COMPANY, "pl"],
    [true, COMPANY, "en"],
    [false, { description: "PL full", description_short_en: "EN summary", description_en: "EN full" }, "pl"],
    [true, { description_short: "PL summary", description_short_en: "EN summary" }, "en"],
    [false, { description_short: "long summary ".repeat(200), description_en: "Full." }, "en"],
    [false, { description: " \n ", description_short: " ", description_en: " EN full " }, "en"],
    [true, { description: "PL full" }, "pl"],
  ])("UI EN=%s chooses structurally more complete version", (preferEn, co, expected) => {
    expect(pickDescriptionSet(co, preferEn).lang).toBe(expected);
  });

  it("honors an explicit shorter version without mixing the two languages", () => {
    expect(pickDescriptionSet({ description_short: "PL summary", description_en: "EN full" }, false, "pl"))
      .toEqual({ short: "PL summary", long: "", lang: "pl" });
  });
});

describe("local preview language switch", () => {
  it("defaults to full EN over short PL, then lets the buyer choose PL", () => {
    const co = { ...COMPANY, description: "", description_short_en: "" };
    const before = JSON.stringify(co);
    const tree = render(co);
    expect(descriptions(tree)).toEqual(["EN full"]);
    expect(languageButton(tree, "en").props["aria-pressed"]).toBe(true);
    choose(tree, "pl");
    expect(descriptions(tree)).toEqual(["PL summary"]);
    expect(languageButton(tree, "pl").props["aria-pressed"]).toBe(true);
    expect(app.language).toBe("pl");
    expect(app.changeLanguage).not.toHaveBeenCalled();
    expect(JSON.stringify(co)).toBe(before);
  });

  it.each(["pl", "en"])("keeps all shared data and section labels in app language %s", lang => {
    app.language = lang;
    const tree = render();
    for (const selected of ["pl", "en", "pl"]) {
      choose(tree, selected);
      expect(descriptions(tree)).toEqual([`${selected.toUpperCase()} summary`, `${selected.toUpperCase()} full`]);
      for (const value of ["PRODUCTS", "CERTIFICATE", "YEAR ROUND", "SEASONAL", "MARKETS", "VOLUMES", "PUBLIC SALES CONTACT", "https://example.com/company.pdf"])
        expect(text(tree)).toContain(value);
      for (const section of ["offer", "markets", "ops", "certs", "materials", "long_desc"])
        expect(text(tree)).toContain(`${lang}:common.company_preview.section_${section}`);
      expect(text(tree)).not.toContain("account_operator_title");
      expect(app.language).toBe(lang);
      expect(app.changeLanguage).not.toHaveBeenCalled();
    }
  });

  it.each(["pl", "en"])("disables missing %s and shows the supplied version immediately", missing => {
    const co = { ...COMPANY };
    const suffix = missing === "pl" ? "" : "_en";
    co[`description${suffix}`] = " \n ";
    co[`description_short${suffix}`] = null;
    const tree = render(co);
    const other = missing === "pl" ? "en" : "pl";
    expect(languageButton(tree, missing).props.disabled).toBe(true);
    expect(languageButton(tree, missing).props["aria-pressed"]).toBe(false);
    expect(languageButton(tree, other).props["aria-pressed"]).toBe(true);
    expect(text(tree)).toContain(`description_unavailable_${missing}`);
    expect(descriptions(tree)).toEqual([`${other.toUpperCase()} summary`, `${other.toUpperCase()} full`]);
  });

  it("does not hide shared profile data when neither description exists", () => {
    const tree = render({ ...COMPANY, description: null, description_short: " ", description_en: "", description_short_en: null });
    expect(languageButton(tree, "pl")).toBeUndefined();
    expect(text(tree)).toContain("no_description");
    expect(text(tree)).toContain("PRODUCTS");
    expect(text(tree)).toContain("CERTIFICATE");
    expect(text(tree)).toContain("https://example.com/company.pdf");
  });

  it("retains manual choice for the same company, resets for another company and on reopen", () => {
    const tree = render();
    choose(tree, "en");
    update(tree, { ...COMPANY, products: "UPDATED PRODUCTS" });
    expect(languageButton(tree, "en").props["aria-pressed"]).toBe(true);
    update(tree, { ...COMPANY, id: "company-b" });
    expect(languageButton(tree, "pl").props["aria-pressed"]).toBe(true);
    choose(tree, "en");
    update(tree, COMPANY);
    expect(languageButton(tree, "pl").props["aria-pressed"]).toBe(true);
    choose(tree, "en");
    act(() => tree.update(null));
    update(tree, COMPANY);
    expect(languageButton(tree, "pl").props["aria-pressed"]).toBe(true);
  });

  it("recomputes automatic choice when descriptions finish loading", () => {
    const tree = render({ ...COMPANY, description_en: "", description_short_en: "", description: "" });
    expect(languageButton(tree, "pl").props["aria-pressed"]).toBe(true);
    update(tree, { ...COMPANY, description: "" });
    expect(languageButton(tree, "en").props["aria-pressed"]).toBe(true);
  });

  it("falls back safely when the manually selected version becomes empty", () => {
    const tree = render();
    choose(tree, "en");
    update(tree, { ...COMPANY, description_en: "", description_short_en: "" });
    expect(descriptions(tree)).toEqual(["PL summary", "PL full"]);
    expect(languageButton(tree, "en").props.disabled).toBe(true);
  });
});
