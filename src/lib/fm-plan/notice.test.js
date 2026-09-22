import { describe, expect, it } from "vitest";
import content from "./notice-content.js";
import { meetingNotice, noticeRuns } from "./notice.js";
import { buildPlanModel } from "./model.js";

describe("shared meeting notice", () => {
  it("has complete PL/EN content and identical section structure", () => {
    expect(Object.keys(content.pl).sort()).toEqual(Object.keys(content.en).sort());
    for (const audience of ["supplier", "buyer"]) expect(meetingNotice("pl", audience).sections.map(s => s.id)).toEqual(meetingNotice("en", audience).sections.map(s => s.id));
  });
  it.each(["pl", "en"])("limits supplier-only information and verifies contacts (%s)", lang => {
    const supplier = meetingNotice(lang), buyer = meetingNotice(lang, "buyer");
    const buyerCopy = JSON.stringify(buyer.sections);
    expect(supplier.sections.find(s => s.id === "cancellations").paragraphs[1]).toContain("Mega Image");
    expect(supplier.sections.find(s => s.id === "cancellations").paragraphs[2]).not.toContain("Mega Image");
    expect(buyerCopy).not.toMatch(/PreConnect|Biedron|Mega Image|płatności|payment|Premium/);
    expect(supplier.contacts.map(c => [c.name, c.phone])).toEqual([["Oksana Kozłowska", "+48 509 086 949"], ["Jagoda Knadel", "+48 603 811 818"]]);
    expect(noticeRuns(supplier.credits).map(r => r.text).join("")).not.toContain("<b>");
  });
  it("keeps approved priority copy without changing algorithm inputs", () => {
    expect(content.pl.priorities.map(p => p[0])).toEqual(["Wzajemny wybór", "Pakiety Premium i sponsorskie", "Kolejność rejestracji i płatności"]);
  });
  it("continues to choose card language by recipient country", () => {
    const model = buildPlanModel({ companies: [{ id: "pl", name: "PL", country: "PL" }, { id: "en", name: "EN", country: "NL" }], retailers: [{ id: 1, fm26_chain_id: "pl", name: "PL", country: "PL" }, { id: 2, fm26_chain_id: "en", name: "EN", country: "DE" }] });
    expect(model.suppliers.find(c => c.id === "pl").lang).toBe("pl");
    expect(model.suppliers.find(c => c.id === "en").lang).toBe("en");
    expect(model.chains.find(c => c.id === 2).lang).toBe("en");
  });
});
