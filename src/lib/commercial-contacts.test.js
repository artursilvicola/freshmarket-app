import { describe, expect, it } from "vitest";
import { commercialContacts, commercialEmail, commercialEmailHref, commercialPhoneHref } from "./commercial-contacts.js";

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
  it.each([
    ["sales+fruit@example.com", "mailto:sales+fruit@example.com"],
    ["sales%3Fbcc=team/example@example.com", "mailto:sales%253Fbcc%3Dteam%2Fexample@example.com"],
    ["", ""],
    ["sales@example.com?subject=injected", ""],
  ])("creates a safe, readable raw mail href for %s", (value, expected) => {
    expect(commercialEmailHref(value)).toBe(expected);
  });
  it.each([
    [" +48\u00a0603 424\t346 ", "tel:+48603424346"],
    ["+1 (201) 555-0123", "tel:+1(201)555-0123"],
    ["012 345 678", "tel:012345678"],
    ["", ""],
  ])("creates a raw phone href without inventing a country code for %s", (value, expected) => {
    expect(commercialPhoneHref(value)).toBe(expected);
  });
});
