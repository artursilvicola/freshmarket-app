import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canRegisterBuyerSeen, pendingBuyerSeenSends } from "./buyer-seen.js";
import { buyerReadScope } from "../../netlify/functions/_shared/buyer-read-scope.js";

const buyerUser = { id: "u-buyer", role: "buyer", retailer_id: 100 };
const buyerAccount = { id: "u-buyer", role: "buyer", retailerId: 100 };

describe("canRegisterBuyerSeen — kto rejestruje odczyt propozycji", () => {
  it("zalogowany kupiec na własnym koncie: tak", () => {
    expect(canRegisterBuyerSeen({ sessionRole: "buyer", account: buyerAccount, currentUser: buyerUser })).toBe(true);
  });

  it("administrator w podglądzie konta kupca: nie", () => {
    const admin = { id: "u-admin", role: "admin" };
    expect(canRegisterBuyerSeen({ sessionRole: "admin", account: buyerAccount, currentUser: admin })).toBe(false);
  });

  it("administrator z historycznym retailer_id nadal nie jest kupcem", () => {
    const admin = { id: "u-buyer", role: "admin", retailer_id: 100 };
    expect(canRegisterBuyerSeen({ sessionRole: "admin", account: buyerAccount, currentUser: admin })).toBe(false);
  });

  it("konto innego kupca tej samej sieci: nie", () => {
    const other = { id: "u-other", role: "buyer", retailerId: 100 };
    expect(canRegisterBuyerSeen({ sessionRole: "buyer", account: other, currentUser: buyerUser })).toBe(false);
  });

  it("brak danych sesji albo konto dostawcy: nie", () => {
    expect(canRegisterBuyerSeen({ sessionRole: "buyer", account: buyerAccount, currentUser: null })).toBe(false);
    expect(canRegisterBuyerSeen({ sessionRole: "supplier", account: { id: "c1", role: "supplier" }, currentUser: { id: "u1" } })).toBe(false);
  });
});

describe("pendingBuyerSeenSends — co rozlicza wejście kupca na platformę", () => {
  const sends = [
    { id: 1, retailerId: 100, status: "sent" },
    { id: 2, retailerId: 100, status: "opened" },
    { id: 3, retailerId: 100, status: "read" },
    { id: 4, retailerId: 100, status: "unread_expired" },
    { id: 5, retailerId: 100, status: "queued" },
    { id: 6, retailerId: 200, status: "sent" },
  ];

  it("tylko wysłane i jeszcze nierozliczone propozycje własnej sieci", () => {
    const out = pendingBuyerSeenSends({ sends, buyerRetailerId: 100, retailers: [{ id: 100, active: true }], buyer: { active: true } });
    expect(out.map((s) => s.id)).toEqual([1, 2]);
  });

  it("bez sieci, przy nieaktywnej sieci albo nieaktywnym kupcu: nic", () => {
    expect(pendingBuyerSeenSends({ sends, buyerRetailerId: null, retailers: [], buyer: {} })).toEqual([]);
    expect(pendingBuyerSeenSends({ sends, buyerRetailerId: 100, retailers: [{ id: 100, active: false }], buyer: {} })).toEqual([]);
    expect(pendingBuyerSeenSends({ sends, buyerRetailerId: 100, retailers: [{ id: 100 }], buyer: { active: false } })).toEqual([]);
  });

  it("znosi brak danych", () => {
    expect(pendingBuyerSeenSends({ sends: null, buyerRetailerId: 100 })).toEqual([]);
  });
});

describe("buyerReadScope — zabezpieczenie po stronie funkcji", () => {
  it("kupiec z siecią: odczyt liczony, ograniczony do własnej sieci", () => {
    expect(buyerReadScope({ role: "buyer", retailer_id: 100 })).toEqual({ counts: true, allowedRetailerId: 100 });
  });

  it("administrator: nic nie jest rozliczane", () => {
    expect(buyerReadScope({ role: "admin", retailer_id: null })).toEqual({ counts: false, reason: "admin_preview" });
    expect(buyerReadScope({ role: "admin", retailer_id: 100 }).counts).toBe(false);
  });

  it("kupiec bez sieci nie dostaje dostępu do cudzych wysyłek", () => {
    expect(buyerReadScope({ role: "buyer", retailer_id: null })).toEqual({ counts: false, reason: "buyer_without_retailer" });
  });

  it("inne role i brak profilu: nie", () => {
    expect(buyerReadScope({ role: "supplier" }).counts).toBe(false);
    expect(buyerReadScope(null).counts).toBe(false);
  });
});

describe("spięcie w kodzie (strażnik regresji)", () => {
  const app = readFileSync(new URL("../legacy/PreconnectFM.jsx", import.meta.url), "utf8");
  const fnBody = (name) => {
    const start = app.indexOf(`async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return app.slice(start, start + 600);
  };

  it("oba wywołania odczytu zaczynają od blokady podglądu", () => {
    expect(fnBody("markBuyerPreconnectSeen")).toMatch(/if \(!buyerSeenAllowed\) return;/);
    expect(fnBody("markSendOpened")).toMatch(/if \(!buyerSeenAllowed\) return;/);
  });

  it("wejście kupca na platformę zgłasza oczekujące propozycje", () => {
    expect(app).toMatch(/markBuyerPreconnectSeen\(buyerEntryPending, "app_list"\)/);
  });

  it("funkcje serwera nie przepuszczają już roli admin bez ograniczenia sieci", () => {
    for (const f of ["mark-buyer-preconnect-seen.js", "notify-supplier-read.js"]) {
      const src = readFileSync(new URL(`../../netlify/functions/${f}`, import.meta.url), "utf8");
      expect(src).toMatch(/buyerReadScope\(profile\)/);
      expect(src).not.toMatch(/profile\.role === "buyer" \? profile\.retailer_id : null/);
    }
  });
});
