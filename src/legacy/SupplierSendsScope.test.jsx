// [28.09] Dwie poprawki z panelu dostawcy:
//  1) „Sieci handlowe”: liczniki wysłanych/przeczytanych liczone TYLKO z własnych wysyłek dostawcy
//     (wcześniej z całej listy `sends` — w podglądzie admina pokazywały wysyłki wszystkich firm);
//  2) Dashboard: podpis „czeka na otwarcie (max 14 dni)” → reguła: 14 dni od DATY MAILINGU
//     (pierwszy wtorek miesiąca), np. propozycja z 21.09 → mailing 06.10 → termin odczytu 20.10.
import React from "react";
import { act, create } from "react-test-renderer";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createInstance } from "i18next";
import en from "../i18n/en/legacy.json";
import pl from "../i18n/pl/legacy.json";
const lang = vi.hoisted(() => ({ t: null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: lang.t, i18n: { language: "pl" } }), Trans: () => null }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: (k) => k } }));
vi.mock("../lib/supabase", () => ({ supabase: {}, isSupabaseConfigured: true }));
import { PageWysylki, PageDashboard } from "./PreconnectFM.jsx";
const i18n = createInstance();
await i18n.init({ lng: "pl", fallbackLng: false, defaultNS: "legacy", resources: { pl: { legacy: pl }, en: { legacy: en } } });
function render(component, lng = "pl") { lang.t = i18n.getFixedT(lng, "legacy"); let tree; act(() => { tree = create(component); }); return tree; }
const text = (tree) => JSON.stringify(tree.toJSON());

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T10:00:00")); });
afterAll(() => vi.useRealTimers());

const retailers = [{ id: 1, name: "AIBĖ", country: "LT", active: true, nextSend: "2026-10-06" }];
const own = { id: "a1", supplierId: "s1", retailerId: 1, offerId: "o1", status: "sent", sendDate: "2026-09-21", createdAt: "2026-09-21T10:00:00" };
const others = [1, 2, 3].map((i) => ({ id: "b" + i, supplierId: "s2", retailerId: 1, offerId: "o9", status: "read", sendDate: "2026-09-01", createdAt: "2026-09-01T10:00:00" }));
const wysylkiProps = { offers: [], pkgUsed: 1, pkgMax: 5, pkgPlan: "std_5", rem: 4, wallet: { balance: 0, transactions: [] }, sendToChain: () => {}, nav: () => {}, sid: null, accountId: "s1", co: { id: "co1" }, companies: [], retailers };

describe("PageWysylki — Sieci handlowe: tylko własne wysyłki dostawcy", () => {
  it("licznik nagłówka, badge sieci i „x/y przeczytanych” pomijają wysyłki innych dostawców", () => {
    const tree = render(<PageWysylki {...wysylkiProps} sends={[own, ...others]} />);
    const out = text(tree);
    expect(out).toContain("1 wysłanych · 0 przeczytanych");
    expect(out).toContain("1 wysł.");
    expect(out).toContain("0/1 propozycji przeczytanych");
    expect(out).not.toContain("4 wysłanych");
    expect(out).not.toContain("3 przeczytanych");
    expect(out).not.toContain("3/4");
    act(() => tree.unmount());
  });
  it("[review Codexa] wiersz bez supplierId NIE jest własny; brak accountId = zero wysyłek", () => {
    const orphan = { ...own, id: "x1", supplierId: undefined };
    const tree = render(<PageWysylki {...wysylkiProps} sends={[own, orphan]} />);
    const out = text(tree);
    expect(out).toContain("1 wysłanych · 0 przeczytanych");
    expect(out).toContain("0/1 propozycji przeczytanych");
    expect(out).not.toContain("2 wysłanych");
    act(() => tree.unmount());
    const tree2 = render(<PageWysylki {...wysylkiProps} accountId={undefined} sends={[own, orphan]} />);
    expect(text(tree2)).toContain("0 wysłanych · 0 przeczytanych");
    expect(text(tree2)).not.toContain("wysł.");
    act(() => tree2.unmount());
  });
  it("bez własnych wysyłek do sieci: brak badge i brak licznika, mimo wysyłek innych firm", () => {
    const tree = render(<PageWysylki {...wysylkiProps} sends={others} />);
    const out = text(tree);
    expect(out).toContain("0 wysłanych · 0 przeczytanych");
    expect(out).not.toContain("wysł.");
    expect(out).not.toContain("propozycji przeczytanych");
    act(() => tree.unmount());
  });
});

const dashProps = { offers: [], nav: () => {}, rem: 4, wallet: { balance: 0, transactions: [] }, refundNotifs: [], dismissRefund: () => {}, fmSettings: null, accountId: "s1", co: { id: "co1" }, pkgMax: 5, pkgUsed: 1 };

describe("PageDashboard — reguła 14 dni od daty mailingu", () => {
  it("propozycja z 21.09 (mailing 06.10 jeszcze nie ruszył): e-mail 06.10.2026, termin odczytu 20.10.2026", () => {
    const tree = render(<PageDashboard {...dashProps} sends={[own]} />);
    const out = text(tree);
    expect(out).toContain("planowany e-mail do kupca 06.10.2026 (pierwszy wtorek miesiąca) · czeka na otwarcie do 20.10.2026 — 14 dni od wysyłki e-maila");
    expect(out).not.toContain("max 14 dni");
    act(() => tree.unmount());
  });
  it("po realnym mailingu (stempel 22.09): czeka na otwarcie do 06.10.2026 — 14 dni od e-maila 22.09.2026", () => {
    const sent = { ...own, id: "a2", sendDate: "2026-09-15", mailingSentAt: "2026-09-22T08:00:00Z" };
    const tree = render(<PageDashboard {...dashProps} sends={[sent]} />);
    expect(text(tree)).toContain("czeka na otwarcie do 06.10.2026 — 14 dni od wysyłki e-maila do kupca (22.09.2026)");
    act(() => tree.unmount());
  });
  it("EN: ta sama reguła", () => {
    const tree = render(<PageDashboard {...dashProps} sends={[own]} />, "en");
    expect(text(tree)).toContain("planned e-mail to the buyer on 06.10.2026 (first Tuesday of the month) · awaiting open until 20.10.2026 — 14 days from the e-mail");
    act(() => tree.unmount());
  });
  it("[review Codexa] po upływie planowanego wtorku BEZ znacznika: „czeka na potwierdzenie wysyłki”, nie „14 dni od wysyłki”", () => {
    vi.setSystemTime(new Date("2026-10-07T10:00:00"));
    try {
      const tree = render(<PageDashboard {...dashProps} sends={[own]} />);
      const out = text(tree);
      expect(out).toContain("mailing planowany na 06.10.2026 — czeka na potwierdzenie wysyłki e-maila · przewidywany termin odczytu 20.10.2026 (14 dni od mailingu)");
      expect(out).not.toContain("14 dni od wysyłki e-maila do kupca");
      act(() => tree.unmount());
    } finally { vi.setSystemTime(new Date("2026-09-28T10:00:00")); }
  });
  it("[review Codexa] znacznik YYYY-MM-DD nie cofa się o dzień w strefie na zachód od UTC", () => {
    const orig = process.env.TZ; process.env.TZ = "America/New_York";
    try {
      expect(new Date("2026-09-22").getDate()).toBe(21); // środowisko honoruje TZ: północ UTC = 21.09 w Nowym Jorku
      const sent = { ...own, id: "a3", sendDate: "2026-09-15", mailingSentAt: "2026-09-22" };
      const tree = render(<PageDashboard {...dashProps} sends={[sent]} />);
      expect(text(tree)).toContain("czeka na otwarcie do 06.10.2026 — 14 dni od wysyłki e-maila do kupca (22.09.2026)");
      act(() => tree.unmount());
    } finally { if (orig === undefined) delete process.env.TZ; else process.env.TZ = orig; }
  });
  it("[review Codexa] zmiana miesiąca i koniec czasu letniego: 24.10 + 14 dni = 07.11", () => {
    const sent = { ...own, id: "a4", sendDate: "2026-10-20", createdAt: "2026-10-20T10:00:00", mailingSentAt: "2026-10-24" };
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    try {
      const tree = render(<PageDashboard {...dashProps} sends={[sent]} />);
      expect(text(tree)).toContain("czeka na otwarcie do 07.11.2026 — 14 dni od wysyłki e-maila do kupca (24.10.2026)");
      act(() => tree.unmount());
    } finally { vi.setSystemTime(new Date("2026-09-28T10:00:00")); }
  });
  it("[review Codexa] brak sendDate: kotwica sentAt jak w RPC (nie „dziś”)", () => {
    const sent = { ...own, id: "a5", sendDate: undefined, sentAt: "2026-08-20T10:00:00Z", createdAt: "2026-09-20T10:00:00" };
    const tree = render(<PageDashboard {...dashProps} sends={[sent]} />);
    // 20.08 → pierwszy wtorek września = 01.09 (już minął, bez znacznika) → czeka na potwierdzenie, termin 15.09
    expect(text(tree)).toContain("mailing planowany na 01.09.2026 — czeka na potwierdzenie wysyłki e-maila · przewidywany termin odczytu 15.09.2026");
    act(() => tree.unmount());
  });
  it("aktywność dashboardu liczy tylko własne wysyłki (30 dni)", () => {
    const tree = render(<PageDashboard {...dashProps} sends={[own, ...others.map((o) => ({ ...o, createdAt: "2026-09-25T10:00:00" }))]} />);
    const out = text(tree);
    expect(out).toContain('"children":["1"');   // 1 czeka (własna)
    expect(out).not.toContain('"children":["3"'); // nie: 3 zobaczone innych firm
    act(() => tree.unmount());
  });
});
