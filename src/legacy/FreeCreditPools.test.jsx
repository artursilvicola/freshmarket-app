// [feat/free-credit-grants] Strona Finanse dostawcy: dwie pule (bezpłatne od organizatora / kupione)
// z rozbiciem po terminach, osobno "dostępne do nowych wysyłek" i "oczekuje na odczyt" (review Codexa p. 3, 6).
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
import { PageFinanse, PageWysylki } from "./PreconnectFM.jsx";
import { summarizeCreditPools } from "../lib/db.js";
const i18n = createInstance();
await i18n.init({ lng: "pl", fallbackLng: false, defaultNS: "legacy", resources: { pl: { legacy: pl }, en: { legacy: en } } });
function render(component, lng = "pl") { lang.t = i18n.getFixedT(lng, "legacy"); let tree; act(() => { tree = create(component); }); return tree; }
const text = (tree) => JSON.stringify(tree.toJSON());
const base = { wallet: { balance: 0, transactions: [] }, sends: [], offers: [], co: { id: "co1", pkg: "std_5" }, setCo: () => {}, fl: () => {}, nav: () => {}, buyPackage: () => {}, orders: [], pkgMax: 7, pkgUsed: 2, pkgPlan: "std_5", retailers: [], accountId: "s1" };
const pools = summarizeCreditPools([
  { id: "g1", source: "grant", qty_total: 3, qty_used: 1, expires_at: "2026-12-27" },
  { id: "p1", source: "purchase", qty_total: 5, qty_used: 0, expires_at: "2027-09-27" },
], "2026-09-27");

describe("PageFinanse — pule kredytów", () => {
  it("pokazuje osobno bezpłatne i kupione z terminami, dostępne i oczekujące, regułę kolejności (PL)", () => {
    const tree = render(<PageFinanse {...base} creditPools={pools} />);
    const out = text(tree);
    expect(out).toContain("Twoje kredyty PreConnect");
    expect(out).toContain("Bezpłatne od organizatora");
    expect(out).toContain("2 z 3");
    expect(out).toContain("2 kredyty wygasają 27.12.2026");
    expect(out).toContain("5 z 5");
    expect(out).toContain("5 kredytów wygasa 27.09.2027");
    expect(out).toContain("Dostępne do nowych wysyłek: 5");
    expect(out).toContain("oczekuje na odczyt sieci: 0");
    expect(out).toContain("rezerwuje kredyt");
    expect(out).not.toContain("Aktywny pakiet");
    act(() => tree.unmount());
  });
  it("3 bezpłatne + 3 wysłane nieodczytane: 0 dostępnych, 3 oczekują, pula nadal 3 z 3 — bez sprzeczności", () => {
    const sends = [1, 2, 3].map((i) => ({ id: "s" + i, supplierId: "s1", status: "sent", offerId: "o", retailerId: 1 }));
    const p = summarizeCreditPools([{ id: "g1", source: "grant", qty_total: 3, qty_used: 0, expires_at: "2026-12-27" }], "2026-09-27");
    const tree = render(<PageFinanse {...base} sends={sends} pkgMax={3} pkgUsed={3} creditPools={p} />);
    const out = text(tree);
    expect(out).toContain("Dostępne do nowych wysyłek: 0");
    expect(out).toContain("oczekuje na odczyt sieci: 3");
    expect(out).toContain("3 z 3");
    expect(out).toContain("3 kredyty wygasają 27.12.2026");
    expect(out).not.toContain("w tym 3 bezpłatnych");
    act(() => tree.unmount());
  });
  it("1 kredyt do października i 9 do grudnia: dwa terminy, nie „10 wygasa w październiku”", () => {
    const p = summarizeCreditPools([
      { id: "g1", source: "grant", qty_total: 1, qty_used: 0, expires_at: "2026-10-15" },
      { id: "g2", source: "grant", qty_total: 9, qty_used: 0, expires_at: "2026-12-27" },
    ], "2026-09-27");
    const tree = render(<PageFinanse {...base} creditPools={p} />);
    const out = text(tree);
    expect(out).toContain("1 kredyt wygasa 15.10.2026");
    expect(out).toContain("9 kredytów wygasa 27.12.2026");
    expect(out).not.toContain("10 kredytów wygasa 15.10.2026");
    act(() => tree.unmount());
  });
  it("EN: etykiety angielskie, bez polskich", () => {
    const tree = render(<PageFinanse {...base} creditPools={pools} />, "en");
    const out = text(tree);
    expect(out).toContain("Free from the organiser");
    expect(out).toContain("Purchased");
    expect(out).toContain("Available for new submissions: 5");
    expect(out).toContain("free credits first");
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

describe("PageWysylki — pasek kredytów", () => {
  it("dostępne osobno od pul i oczekujących: 0 dostępnych nie stoi obok „w tym 3 bezpłatnych”", () => {
    const sends = [1, 2, 3].map((i) => ({ id: "s" + i, supplierId: "s1", status: "sent", offerId: "o", retailerId: 1 }));
    const p = summarizeCreditPools([{ id: "g1", source: "grant", qty_total: 3, qty_used: 0, expires_at: "2026-12-27" }], "2026-09-27");
    const tree = render(<PageWysylki sends={sends} offers={[]} pkgUsed={3} pkgMax={3} pkgPlan="std_5" rem={0} wallet={{ balance: 0, transactions: [] }} sendToChain={() => {}} nav={() => {}} sid={null} accountId="s1" co={{ id: "co1" }} retailers={[]} companies={[]} creditPools={p} />);
    const out = text(tree);
    expect(out).toContain("Kredyty PreConnect: 0 z 3");
    expect(out).toContain("nierozliczone w pulach: bezpłatne 3, kupione 0 · oczekuje na odczyt: 3");
    expect(out).not.toContain("w tym 3 bezpłatnych");
    act(() => tree.unmount());
  });
});
