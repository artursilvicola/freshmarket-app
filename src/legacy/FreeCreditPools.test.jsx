// [feat/free-credit-grants] Strona Finanse dostawcy: zamiast jednego "Aktywnego pakietu"
// dwie pule — bezpłatne od organizatora i kupione — z datą ważności i regułą kolejności.
import React from "react";
import { act, create } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { createInstance } from "i18next";
import en from "../i18n/en/legacy.json";
import pl from "../i18n/pl/legacy.json";
const lang = vi.hoisted(() => ({ t: null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: lang.t, i18n: { language: "pl" } }), Trans: () => null }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: (k) => k } }));
vi.mock("../lib/supabase", () => ({ supabase: {}, isSupabaseConfigured: true }));
import { PageFinanse } from "./PreconnectFM.jsx";
const i18n = createInstance();
await i18n.init({ lng: "pl", fallbackLng: false, defaultNS: "legacy", resources: { pl: { legacy: pl }, en: { legacy: en } } });
function render(component, lng = "pl") { lang.t = i18n.getFixedT(lng, "legacy"); let tree; act(() => { tree = create(component); }); return tree; }
const text = (tree) => JSON.stringify(tree.toJSON());
const base = { wallet: { balance: 0, transactions: [] }, sends: [], offers: [], co: { id: "co1", pkg: "std_5" }, setCo: () => {}, fl: () => {}, nav: () => {}, buyPackage: () => {}, orders: [], pkgMax: 7, pkgUsed: 2, pkgPlan: "std_5", retailers: [], accountId: "s1" };
const pools = { free: { total: 3, used: 1, remaining: 2, expiry: "2026-12-27", rows: [] }, paid: { total: 5, used: 0, remaining: 5, expiry: "2027-09-27", rows: [] } };

describe("PageFinanse — pule kredytów", () => {
  it("pokazuje osobno bezpłatne i kupione z datami ważności i regułą kolejności (PL)", () => {
    const tree = render(<PageFinanse {...base} creditPools={pools} />);
    const out = text(tree);
    expect(out).toContain("Twoje kredyty PreConnect");
    expect(out).toContain("Bezpłatne od organizatora");
    expect(out).toContain("2 z 3");
    expect(out).toContain("ważne do 27.12.2026");
    expect(out).toContain("5 z 5");
    expect(out).toContain("ważne do 27.09.2027");
    expect(out).toContain("Najpierw wykorzystujemy kredyty bezpłatne");
    expect(out).not.toContain("Aktywny pakiet");
    act(() => tree.unmount());
  });
  it("EN: etykiety angielskie, bez polskich", () => {
    const tree = render(<PageFinanse {...base} creditPools={pools} />, "en");
    const out = text(tree);
    expect(out).toContain("Free from the organiser");
    expect(out).toContain("Purchased");
    expect(out).toContain("Free credits are used first");
    expect(out).not.toContain("Bezpłatne");
    act(() => tree.unmount());
  });
  it("bez pul (jeszcze nie wczytane) renderuje zera zamiast błędu", () => {
    const tree = render(<PageFinanse {...base} creditPools={undefined} />);
    const out = text(tree);
    expect(out).toContain("Twoje kredyty PreConnect");
    expect(out).toContain("brak");
    act(() => tree.unmount());
  });
});
