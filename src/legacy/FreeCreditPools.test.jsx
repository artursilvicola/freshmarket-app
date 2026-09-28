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
// fragment JSON jednego kafla puli (od jego data-pool do następnego kafla)
const tileJson = (out, key) => { const i = out.indexOf('"data-pool":"' + key + '"'); if (i < 0) return ""; const j = out.indexOf('"data-pool":"', i + 10); return out.slice(i, j < 0 ? i + 4000 : j); };
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
    expect(out).toContain("kredyty zarezerwowane przez propozycje: 0");
    expect(out).toContain("rezerwują kredyty");
    expect(out).not.toContain("Aktywny pakiet");
    act(() => tree.unmount());
  });
  it("3 bezpłatne + 3 wysłane nieodczytane: 0 dostępnych, 3 oczekują, pula nadal 3 z 3 — bez sprzeczności", () => {
    const sends = [1, 2, 3].map((i) => ({ id: "s" + i, supplierId: "s1", status: "sent", offerId: "o", retailerId: 1 }));
    const p = summarizeCreditPools([{ id: "g1", source: "grant", qty_total: 3, qty_used: 0, expires_at: "2026-12-27" }], "2026-09-27");
    const tree = render(<PageFinanse {...base} sends={sends} pkgMax={3} pkgUsed={3} creditPools={p} />);
    const out = text(tree);
    expect(out).toContain("Dostępne do nowych wysyłek: 0");
    expect(out).toContain("kredyty zarezerwowane przez propozycje: 3");
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

describe("PageFinanse — pakiety o nieustalonym źródle", () => {
  it("sam pakiet nieustalony: Kupione 0, osobny kafel „Pakiety historyczne (źródło nieustalone)” z 1; mieszanka: te same liczby co w widoku SQL", () => {
    const only = summarizeCreditPools([{ id: "l1", source: "legacy", qty_total: 1, qty_used: 0, expires_at: "2026-12-31" }], "2026-09-27");
    let tree = render(<PageFinanse {...base} pkgMax={1} pkgUsed={0} creditPools={only} />);
    let out = text(tree);
    expect(out).toContain("Pakiety historyczne (źródło nieustalone)");
    expect(tileJson(out, "legacy")).toContain('"children":["1",');
    expect(tileJson(out, "paid")).toContain('"children":["0",');
    act(() => tree.unmount());
    const mix = summarizeCreditPools([
      { id: "g", source: "grant", grant_historical: true, qty_total: 5, qty_used: 3, expires_at: "2026-12-31" },
      { id: "l", source: "legacy", qty_total: 1, qty_used: 0, expires_at: "2026-12-31" },
      { id: "p", source: "purchase", qty_total: 5, qty_used: 1, expires_at: "2027-08-22" },
    ], "2026-09-27");
    expect([mix.free.remaining, mix.paid.remaining, mix.legacy.remaining]).toEqual([2, 4, 1]);   // = qty_remaining_free/paid/legacy
    tree = render(<PageFinanse {...base} pkgMax={11} pkgUsed={4} creditPools={mix} />, "en");
    out = text(tree);
    expect(out).toContain("Historical packages (source not determined)");
    expect(tileJson(out, "paid")).toContain('"children":["4",');
    expect(tileJson(out, "legacy")).toContain('"children":["1",');
    expect(tileJson(out, "free")).toContain('"children":["2",');
    act(() => tree.unmount());
  });
  it("bez pakietów nieustalonych kafel nie pojawia się", () => {
    const tree = render(<PageFinanse {...base} creditPools={pools} />);
    expect(text(tree)).not.toContain("nieustalone");
    act(() => tree.unmount());
  });
});

describe("PageWysylki — pasek kredytów", () => {
  it("PL i EN oddzielają pobrane od rezerwacji; Finanse nie oczekują zwrotu za nigdy niepobrany kredyt", () => {
    const sends = [{id:1,supplierId:'s1',status:'read',billingStatus:'charged'}, {id:2,supplierId:'s1',status:'pending_moderation'}, {id:3,supplierId:'s1',status:'sent'}, {id:4,supplierId:'s1',status:'unread_expired'}, {id:5,supplierId:'s1',status:'read',billingStatus:'no_package_available'}];
    for (const lng of ['pl','en']) {
      let tree=render(<PageWysylki {...base} sends={sends} pkgUsed={3} creditPools={pools} sendToChain={()=>{}} companies={[]} />,lng);
      expect(text(tree)).toContain(lng==='pl'?'Wykorzystane: 1 · Zarezerwowane: 2':'Used: 1 · Reserved: 2');
      act(()=>tree.unmount());
      tree=render(<PageFinanse {...base} sends={sends} pkgUsed={3} creditPools={pools} />,lng);
      expect(text(tree)).toContain(lng==='pl'?'Zwolnione rezerwacje':'Released reservations');
      expect(text(tree)).not.toContain(lng==='pl'?'Zwroty w toku':'Refunds in progress');
      const label=lng==='pl'?'Historia wysyłek':'Submission history';
      const history=tree.root.findAllByType('button').find(b=>b.children.includes(label));
      expect(history).toBeTruthy();act(()=>history.props.onClick());
      expect(text(tree)).toContain(lng==='pl'?'Rezerwacja zwolniona — bez pobrania kredytu':'Reservation released — no credit charged');
      expect(text(tree)).toContain(lng==='pl'?'Odczyt potwierdzony — pobranie kredytu niepotwierdzone':'Read confirmed — credit charge unconfirmed');
      act(()=>tree.unmount());
    }
  });
  it("dostępne osobno od pul i oczekujących: 0 dostępnych nie stoi obok „w tym 3 bezpłatnych”", () => {
    const sends = [1, 2, 3].map((i) => ({ id: "s" + i, supplierId: "s1", status: "sent", offerId: "o", retailerId: 1 }));
    const p = summarizeCreditPools([{ id: "g1", source: "grant", qty_total: 3, qty_used: 0, expires_at: "2026-12-27" }], "2026-09-27");
    const tree = render(<PageWysylki sends={sends} offers={[]} pkgUsed={3} pkgMax={3} pkgPlan="std_5" rem={0} wallet={{ balance: 0, transactions: [] }} sendToChain={() => {}} nav={() => {}} sid={null} accountId="s1" co={{ id: "co1" }} retailers={[]} companies={[]} creditPools={p} />);
    const out = text(tree);
    expect(out).toContain("Kredyty PreConnect: 0 z 3");
    expect(out).toContain("nierozliczone w pulach: bezpłatne 3, kupione 0 · zarezerwowane przez propozycje: 3");
    expect(out).not.toContain("w tym 3 bezpłatnych");
    expect(out).not.toContain("nieustalone");
    act(() => tree.unmount());
    const withLegacy = summarizeCreditPools([{ id: "g1", source: "grant", qty_total: 3, qty_used: 0, expires_at: "2026-12-27" }, { id: "l1", source: "legacy", qty_total: 2, qty_used: 0, expires_at: "2026-12-31" }], "2026-09-27");
    const tree2 = render(<PageWysylki sends={sends} offers={[]} pkgUsed={3} pkgMax={5} pkgPlan="std_5" rem={2} wallet={{ balance: 0, transactions: [] }} sendToChain={() => {}} nav={() => {}} sid={null} accountId="s1" co={{ id: "co1" }} retailers={[]} companies={[]} creditPools={withLegacy} />);
    const out2 = text(tree2);
    expect(out2).toContain("kupione 0");
    expect(out2).toContain("nieustalone 2");
    act(() => tree2.unmount());
    return;
    act(() => tree.unmount());
  });
});

import { countUsedCreditSlots } from "../lib/preconnect-credit-usage.js";
describe("live smoke regression: expired proposals", () => {
  it("11 total, one read, two in moderation, four expired = 8 available and 2 reserved", () => {
    const sends = ["read", "pending_moderation", "pending_moderation", ...Array(4).fill("unread_expired"), "rejected"].map((status,i)=>({id:i,supplierId:"s1",status}));
    const used = countUsedCreditSlots(sends,"s1");
    expect(used).toBe(3);
    const p = summarizeCreditPools([{source:"grant",qty_total:8,qty_used:1,expires_at:"2026-12-31"},{source:"purchase",qty_total:3,qty_used:0,expires_at:"2027-08-22"}],"2026-09-28");
    const tree = render(<PageFinanse {...base} sends={sends} pkgMax={11} pkgUsed={used} creditPools={p}/>);
    expect(text(tree)).toContain("Dostępne do nowych wysyłek: 8");
    expect(text(tree)).toContain("kredyty zarezerwowane przez propozycje: 2");
    expect(p.free.remaining + p.paid.remaining).toBe(10);
    act(()=>tree.unmount());
  });
});
