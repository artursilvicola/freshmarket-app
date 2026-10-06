import { describe, expect, it } from "vitest";
import { commercialContacts, commercialEmail } from "./commercial-contacts.js";

describe("commercial contacts", () => {
  it.each([null, undefined, "", "   ", "no-address", "a@", "a b@example.com", "a@example.com?bcc=x@y.com", "a@example.com,b@example.com"])("rejects unusable email %s", value => {
    expect(commercialEmail(value)).toBe("");
  });
  it("trims valid addresses including plus aliases", () => {
    expect(commercialEmail(" sales+fruit@example.com ")).toBe("sales+fruit@example.com");
  });
  it("keeps phone-only contacts and skips empty records without changing the source", () => {
    const company = { contacts: [null, {}, { name: " A ", phone: " +48 123456789 ", email: " " }, { email: " sales@example.com " }] };
    const original = structuredClone(company);
    expect(commercialContacts(company)).toEqual([
      { name: "A", position: "", phone: "+48 123456789", email: "" },
      { name: "", position: "", phone: "", email: "sales@example.com" },
    ]);
    expect(company).toEqual(original);
  });
  it("never substitutes an operator email or phone", () => {
    expect(commercialContacts({ email: "private@example.com", phone: "123", contacts: null })).toEqual([]);
  });
});
