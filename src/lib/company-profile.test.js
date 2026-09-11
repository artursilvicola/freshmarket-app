import { describe, it, expect } from "vitest";
import { companySaveBlockers } from "./company-profile.js";

describe("wymagania przed zapisem profilu firmy", () => {
  it("brak logo blokuje zapis (przypadek wierniccy.co: NIP jest, logo nie)", () => {
    expect(companySaveBlockers({ nip: "PL5223215504", logo: null })).toEqual(["logo"]);
    expect(companySaveBlockers({ nip: "PL5223215504", logo: "" })).toEqual(["logo"]);
  });

  it("brak NIP blokuje tylko przy włączonej fladze", () => {
    expect(companySaveBlockers({ logo: "https://x/logo.png", nip: "" }, { nipRequired: true })).toEqual(["nip"]);
    expect(companySaveBlockers({ logo: "https://x/logo.png", nip: "   " }, { nipRequired: true })).toEqual(["nip"]);
    expect(companySaveBlockers({ logo: "https://x/logo.png", nip: "" }, { nipRequired: false })).toEqual([]);
  });

  it("komplet danych = brak blokad; pusty rekord = obie", () => {
    expect(companySaveBlockers({ logo: "https://x/logo.png", nip: "968-09-02-691" }, { nipRequired: true })).toEqual([]);
    expect(companySaveBlockers(null, { nipRequired: true })).toEqual(["logo", "nip"]);
    expect(companySaveBlockers({}, { nipRequired: true })).toEqual(["logo", "nip"]);
  });
});
