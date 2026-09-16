import { describe, it, expect } from "vitest";
import { isOwnAccount, isOwnProfileTarget } from "./profile-guard.js";

const ADMIN = { id: "admin-uid", role: "admin", company_id: "co-admin", retailer_id: null };
const SUPPLIER_USER = { id: "sup-uid", role: "supplier", company_id: "co-1", retailer_id: null };
const BUYER_USER = { id: "buyer-uid", role: "buyer", company_id: null, retailer_id: 100 };

describe("rozpoznanie podglądu cudzego konta", () => {
  it("admin na swoim koncie = własne; po przełączeniu na dostawcę lub innego admina = podgląd", () => {
    expect(isOwnAccount({ role: "admin", id: "admin-uid" }, ADMIN)).toBe(true);
    expect(isOwnAccount({ role: "admin", id: "inny-admin" }, ADMIN)).toBe(false);
    // przypadek z 16.09: admin przełączony na konto dostawcy (account.id = companies.id)
    expect(isOwnAccount({ role: "supplier", id: "co-fresh-roots" }, ADMIN)).toBe(false);
    // historyczne company_id administratora nie może otworzyć furtki
    expect(isOwnAccount({ role: "supplier", id: "co-admin" }, ADMIN)).toBe(false);
    expect(isOwnAccount({ role: "buyer", retailerId: 100 }, ADMIN)).toBe(false);
  });

  it("dostawca i kupiec na własnym koncie", () => {
    expect(isOwnAccount({ role: "supplier", id: "co-1" }, SUPPLIER_USER)).toBe(true);
    expect(isOwnAccount({ role: "supplier", id: "co-2" }, SUPPLIER_USER)).toBe(false);
    expect(isOwnAccount({ role: "buyer", id: "buyer-uid", retailerId: 100 }, BUYER_USER)).toBe(true);
    expect(isOwnAccount({ role: "buyer", id: "other-buyer", retailerId: 100 }, BUYER_USER)).toBe(false);
    expect(isOwnAccount({ role: "buyer", id: "buyer-uid", retailerId: 143 }, BUYER_USER)).toBe(true);
  });

  it("brak danych sesji nie blokuje (demo/testy); brak konta = nie własne", () => {
    expect(isOwnAccount({ role: "supplier", id: "co-1" }, null)).toBe(true);
    expect(isOwnAccount(null, SUPPLIER_USER)).toBe(false);
    // puste identyfikatory nie mogą „pasować" do siebie
    expect(isOwnAccount({ role: "supplier", id: "" }, { id: "x", company_id: "" })).toBe(false);
  });
});

describe("zabezpieczenie zapisu profilu w db", () => {
  it("przepuszcza zapis na własny profil (po id profilu albo po company_id)", () => {
    expect(isOwnProfileTarget({ argId: "uid-1", uid: "uid-1", companyId: "co-1" })).toBe(true);
    expect(isOwnProfileTarget({ argId: "co-1", uid: "uid-1", companyId: "co-1" })).toBe(true);
    expect(isOwnProfileTarget({ argId: null, uid: "uid-1", companyId: "co-1" })).toBe(true);
  });

  it("odrzuca zapis, gdy panel wskazuje cudze konto", () => {
    expect(isOwnProfileTarget({ argId: "co-fresh-roots", uid: "admin-uid", companyId: "co-admin" })).toBe(false);
    expect(isOwnProfileTarget({ argId: "inny-uid", uid: "uid-1", companyId: null })).toBe(false);
  });
});
