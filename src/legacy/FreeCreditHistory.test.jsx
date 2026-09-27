// [feat/free-credit-grants v5] Historia pakietów dostawcy: historyczne przyznania („przyznano wcześniej”),
// pakiet o nieustalonym źródle (opis neutralny, nie „Kupione”), zwykłe przyznanie i zakup.
import React from "react";
import { act, create } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { createInstance } from "i18next";
import en from "../i18n/en/legacy.json";
import pl from "../i18n/pl/legacy.json";
const lang = vi.hoisted(() => ({ t: null }));
const rows = vi.hoisted(() => ([
  { id: "h1", source: "grant", grant_historical: true, grant_reason: "registration", grant_seen_at: "2026-09-27T10:00:00Z", plan: "std_5", qty_total: 5, qty_used: 3, purchased_at: "2026-07-02T07:18:42Z", expires_at: "2026-12-31" },
  { id: "h2", source: "grant", grant_historical: true, grant_reason: "compensation", grant_seen_at: "2026-09-27T10:00:00Z", plan: "std_1", qty_total: 1, qty_used: 0, purchased_at: "2026-09-23T09:52:54Z", expires_at: "2026-12-31" },
  { id: "l1", source: "legacy", plan: "std_1", qty_total: 1, qty_used: 0, purchased_at: "2026-07-09T10:00:00Z", expires_at: "2026-12-31" },
  { id: "g1", source: "grant", grant_reason: "gift", grant_message: "Miłego testu", plan: "grant", qty_total: 2, qty_used: 0, purchased_at: "2026-09-27T12:00:00Z", expires_at: "2026-12-27" },
  { id: "p1", source: "purchase", plan: "std_5", qty_total: 5, qty_used: 1, purchased_at: "2026-08-22T10:00:00Z", expires_at: "2027-08-22", payment_ref: "PBZVJMLQ25260822GU" },
]));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: lang.t, i18n: { language: "pl" } }), Trans: () => null }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: (k) => k } }));
vi.mock("../lib/supabase", () => ({ supabase: {}, isSupabaseConfigured: true }));
vi.mock("../lib/db.js", async (importOriginal) => ({ ...(await importOriginal()), getPackages: async () => rows, getMyProformas: async () => [] }));
import { PageFinansePakiety } from "./PreconnectFM.jsx";
const i18n = createInstance();
await i18n.init({ lng: "pl", fallbackLng: false, defaultNS: "legacy", resources: { pl: { legacy: pl }, en: { legacy: en } } });
async function render(lng) {
  lang.t = i18n.getFixedT(lng, "legacy"); let tree;
  await act(async () => { tree = create(<PageFinansePakiety co={{ id: "co1", pkg: "std_5" }} setCo={() => {}} fl={() => {}} buyPackage={() => {}} orders={[]} wallet={{ balance: 0, transactions: [] }} pkgMax={9} pkgUsed={4} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return tree;
}
const text = (tree) => JSON.stringify(tree.toJSON());

describe("historia pakietów — historyczne przyznania", () => {
  it("PL: rejestracja = „przyznano wcześniej 5 kredytów”, rekompensata historyczna, nieustalone = opis neutralny, nowe przyznanie z wiadomością, zakup jak dotąd", async () => {
    const tree = await render("pl");
    const out = text(tree);
    expect(out).toContain("Prezent za rejestrację na Fresh Market — przyznano wcześniej 5 kredytów");
    expect(out).toContain("2/5 kredytów");                                   // pozostało 2 z 5 (zużycie zachowane)
    expect(out).toContain("Bezpłatne kredyty od organizatora (rekompensata) — przyznano wcześniej 1 kredyt");
    expect(out).toContain("Pakiet historyczny — źródło nieustalone");
    expect(out).toContain("Bezpłatne kredyty od organizatora · prezent");
    expect(out).toContain("Miłego testu");
    expect(out).not.toContain("Kupione · ");                                 // legacy nie jest opisany jako zakup
    act(() => tree.unmount());
  });
  it("EN: te same wiersze po angielsku", async () => {
    const tree = await render("en");
    const out = text(tree);
    expect(out).toContain("Fresh Market registration gift — 5 credits granted previously");
    expect(out).toContain("Free credits from the organiser (compensation) — 1 credit granted previously");
    expect(out).toContain("Historical package — source not determined");
    expect(out).not.toContain("przyznano");
    act(() => tree.unmount());
  });
});
