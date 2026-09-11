import { describe, it, expect } from "vitest";
import { companyProfileGaps } from "./company-profile.js";

describe("braki w profilu firmy (ostrzeżenie, nie blokada)", () => {
  it("brak logo (przypadek wierniccy.co: NIP jest, logo nie)", () => {
    expect(companyProfileGaps({ nip: "PL5223215504", logo: null })).toEqual(["logo"]);
    expect(companyProfileGaps({ nip: "PL5223215504", logo: "" })).toEqual(["logo"]);
  });

  it("brak NIP liczy się tylko przy włączonej fladze", () => {
    expect(companyProfileGaps({ logo: "https://x/logo.png", nip: "" }, { nipRequired: true })).toEqual(["nip"]);
    expect(companyProfileGaps({ logo: "https://x/logo.png", nip: "   " }, { nipRequired: true })).toEqual(["nip"]);
    expect(companyProfileGaps({ logo: "https://x/logo.png", nip: "" }, { nipRequired: false })).toEqual([]);
  });

  it("komplet danych = brak braków; pusty rekord = oba", () => {
    expect(companyProfileGaps({ logo: "https://x/logo.png", nip: "968-09-02-691" }, { nipRequired: true })).toEqual([]);
    expect(companyProfileGaps(null, { nipRequired: true })).toEqual(["logo", "nip"]);
    expect(companyProfileGaps({}, { nipRequired: true })).toEqual(["logo", "nip"]);
  });
});
