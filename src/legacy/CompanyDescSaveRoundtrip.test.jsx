// Scenariusze z review Codexa 17.09 (ReviewCompanyDescSave.test.jsx): zapis przez UPDATE,
// potem realny bulk mapper (setCo → bulkUpsertCompanies), remount i podgląd w obu językach.
import React from "react";
import { create, act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ row: null, updates: [], upserts: [], language: "pl" }));
vi.mock("../i18n", () => ({ default: { get language() { return state.language; }, t: k => k } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: k => k, i18n: { get language() { return state.language; } } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
vi.mock("../lib/supabase", () => ({ supabase: {
  from: (name) => {
    if (name !== "companies") throw new Error(`Unexpected table: ${name}`);
    return { upsert: rows => {
      state.upserts.push(structuredClone(rows));
      state.row = { ...state.row, ...rows[0] };
      return { select: async () => ({ data: rows, error: null }) };
    } };
  },
} }));
vi.mock("../lib/db", async (importOriginal) => ({
  ...(await importOriginal()),
  updateCompany: async (id, patch) => {
    state.updates.push(structuredClone(patch));
    state.row = { ...state.row, ...patch, id };
    return structuredClone(state.row);
  },
  saveCompanyContacts: vi.fn(async () => []),
  saveCompanyCerts: vi.fn(async () => []),
}));
import { PageCompany, pickDescriptionSet } from "./PreconnectFM.jsx";
import { bulkUpsertCompanies } from "../lib/db";

const trees = [];
const CO = {
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "Review fixture", country: "PL",
  contacts: [], certs: [], profile_data: {}, types: [], categories: [],
  description: "Polski pelny opis.", description_short: "Polski skrot.",
  description_en: "English full description.", description_short_en: "English short description.",
};
function render(co) {
  state.row = structuredClone(co);
  let tree;
  act(() => { tree = create(<PageCompany
    co={co} companyId={co.id} setCo={saved => { void bulkUpsertCompanies([saved]); }}
    fl={vi.fn()} aiModal={null} setAiModal={vi.fn()} aiLoad={false} runAI={vi.fn()}
    offers={[]} retailers={[]} hiddenRetailers={[]} setHiddenRetailers={vi.fn()}
  />); });
  trees.push(tree);
  return tree;
}
const button = (tree, key) => tree.root.findAllByType("button").find(b => b.children.includes(key));
function preview(tree) {
  act(() => button(tree, "supplier.company.actions.preview_buyer").props.onClick());
  return tree.root.findAllByType("p").map(p => p.children.filter(c => typeof c === "string").join(" "));
}
afterEach(() => {
  act(() => trees.splice(0).forEach(t => t.unmount()));
  state.row = null; state.updates = []; state.upserts = []; state.language = "pl";
});

describe("opisy PL/EN — zapis, bulk mapper, remount, podgląd", () => {
  it("oba języki przechodzą przez UPDATE, realny bulk mapper i remount", async () => {
    const tree = render(CO);
    await act(async () => button(tree, "supplier.company.actions.save_btn").props.onClick());
    expect(state.updates).toHaveLength(1);
    expect(state.upserts).toHaveLength(1);
    const saved = structuredClone(state.row);
    expect(saved.description).toBe(CO.description);
    expect(saved.description_en).toBe(CO.description_en);
    expect(saved.description_short_en).toBe(CO.description_short_en);
    const reloaded = render(saved);
    state.language = "en";
    expect(preview(reloaded)).toContain(CO.description_short_en);
  });

  it("EN z samych spacji: null po UPDATE i po drugim zapisie (bulk), podgląd EN wraca do PL", async () => {
    const tree = render({ ...CO, description_en: "   ", description_short_en: "   " });
    await act(async () => button(tree, "supplier.company.actions.save_btn").props.onClick());
    expect(state.updates[0].description_en).toBeNull();
    expect(state.updates[0].description_short_en).toBeNull();
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0][0].description_en).toBeNull();
    expect(state.upserts[0][0].description_short_en).toBeNull();
    expect(state.row.description_en).toBeNull();
    expect(state.row.description_short_en).toBeNull();
    // pole formularza też jest już znormalizowane (nie zostają spacje do kolejnego zapisu)
    const enBox = tree.root.find(n => n.props && n.props["data-testid"] === "desc-en");
    expect(enBox.findAllByType("textarea").map(ta => ta.props.value)).toEqual(["", ""]);
    const reloaded = render(structuredClone(state.row));
    state.language = "en";
    expect(preview(reloaded)).toContain(CO.description_short);
  });

  it("polski podgląd z pełnym PL i pustym skrótem PL nie dokleja skrótu EN (plan naprawy 12 firm)", () => {
    const tree = render({ ...CO, description_short: null });
    const paragraphs = preview(tree);
    expect(paragraphs).toContain(CO.description);
    expect(paragraphs).not.toContain(CO.description_short_en);
  });

  it("angielski podgląd z pełnym EN i pustym skrótem EN nie dokleja skrótu PL", () => {
    const tree = render({ ...CO, description_short_en: "" });
    state.language = "en";
    const paragraphs = preview(tree);
    expect(paragraphs).toContain(CO.description_en);
    expect(paragraphs).not.toContain(CO.description_short);
  });
});

describe("pickDescriptionSet — jeden język na cały opis", () => {
  it("wybiera komplet języka UI, a drugi język tylko gdy pierwszy jest pusty (także same spacje)", () => {
    expect(pickDescriptionSet(CO, false)).toEqual({ short: "Polski skrot.", long: "Polski pelny opis.", lang: "pl" });
    expect(pickDescriptionSet(CO, true)).toEqual({ short: "English short description.", long: "English full description.", lang: "en" });
    expect(pickDescriptionSet({ ...CO, description_short: "" }, false)).toEqual({ short: "", long: "Polski pelny opis.", lang: "pl" });
    expect(pickDescriptionSet({ ...CO, description_en: "  ", description_short_en: null }, true)).toEqual({ short: "Polski skrot.", long: "Polski pelny opis.", lang: "pl" });
    expect(pickDescriptionSet({}, true)).toEqual({ short: "", long: "", lang: "pl" });
  });
});
