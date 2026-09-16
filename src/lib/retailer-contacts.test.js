import { describe, it, expect } from "vitest";
import { retailerContact, hasRetailerContact } from "./retailer-contacts.js";

describe("kontakt awaryjny sieci (retailer_contacts)", () => {
  it("admin: kontakt z osadzonej tabeli retailer_contacts (obiekt lub tablica)", () => {
    const obj = { id: 142, buyer_email: null, contacts: { buyer_name: "Anna", buyer_email: "a@frac.test", buyer_phone: "600" } };
    expect(retailerContact(obj)).toEqual({ name: "Anna", email: "a@frac.test", phone: "600" });
    const arr = { id: 142, contacts: [{ buyer_name: "Anna", buyer_email: "a@frac.test", buyer_phone: null }] };
    expect(retailerContact(arr)).toEqual({ name: "Anna", email: "a@frac.test", phone: "" });
    expect(hasRetailerContact(obj)).toBe(true);
  });

  it("dostawca/kupiec: brak osadzenia (RLS) i puste kolumny → pusty kontakt", () => {
    const r = { id: 142, buyer_name: null, buyer_email: null, buyer_phone: null, contacts: null };
    expect(retailerContact(r)).toEqual({ name: "", email: "", phone: "" });
    expect(hasRetailerContact(r)).toBe(false);
    expect(retailerContact(undefined)).toEqual({ name: "", email: "", phone: "" });
  });

  it("stary wiersz sprzed migracji: fallback do kolumn buyer_*", () => {
    const r = { id: 1, buyer_name: "Jan", buyer_email: "j@x.test", buyer_phone: "1" };
    expect(retailerContact(r)).toEqual({ name: "Jan", email: "j@x.test", phone: "1" });
  });
});
