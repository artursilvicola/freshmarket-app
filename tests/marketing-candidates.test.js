// [feat/marketing-activation] Kandydaci: segmenty, saldo jak w panelu, rezerwacje,
// terminy ważności, wykluczenia z powodami, dopasowanie do potrzeb kupców.
import { describe, it, expect } from "vitest";
import { buildCandidates, summarizePools, matchNeeds, SEGMENTS } from "../netlify/functions/_shared/marketing-candidates.js";
import { summarizeCreditPools } from "../src/lib/db.js";
import { describeCreditUsage } from "../src/lib/preconnect-credit-usage.js";

const TODAY = "2026-11-04";
const co = (over = {}) => ({ id: "c1", name: "Sad Kowalski", country: "PL", categories: ["owoce"], products: "jabłka Gala, gruszki", account_status: "active", preconnect_enabled: true, legacy_supplier_id: "sup-1", ...over });
const op = (over = {}) => ({ id: "p1", email: "op@kowalski.test", role: "supplier", company_id: "c1", locale: "pl", active: true, name: "Jan", ...over });
const pkg = (over = {}) => ({ company_id: "c1", source: "grant", qty_total: 5, qty_used: 0, expires_at: "2026-12-27", ...over });
const run = (over = {}) => buildCandidates({ companies: [co()], profiles: [op()], packages: [pkg()], sends: [], offers: [], suppressions: [], recentMessages: [], campaign: null, todayISO: TODAY, ...over });

describe("saldo i rezerwacje = te same reguły co panel", () => {
  it("pule liczone jak summarizeCreditPools (tylko niewygasłe, grant/purchase/legacy)", () => {
    const packages = [pkg(), pkg({ source: "purchase", qty_total: 10, qty_used: 4, expires_at: "2027-03-01" }), pkg({ source: "legacy", qty_total: 3, qty_used: 3, expires_at: null }), pkg({ qty_total: 5, expires_at: "2026-10-01" })];
    const mine = summarizePools(packages, TODAY);
    const panel = summarizeCreditPools(packages, TODAY);
    expect(mine.free).toBe(panel.free.remaining);
    expect(mine.paid).toBe(panel.paid.remaining);
    expect(mine.legacy).toBe(panel.legacy.remaining);
    expect(mine.remaining).toBe(11);
    expect(mine.nearest_expiry).toBe("2026-12-27");
  });
  it("rezerwacje liczone jak describeCreditUsage", () => {
    const sends = [
      { supplier_legacy_id: "sup-1", status: "sent", data: {}, created_at: "2026-10-07T10:00:00Z" },
      { supplier_legacy_id: "sup-1", status: "pending_moderation", data: {}, created_at: "2026-11-01T10:00:00Z" },
      { supplier_legacy_id: "sup-1", status: "read", data: { billingStatus: "charged" }, created_at: "2026-09-01T10:00:00Z" },
      { supplier_legacy_id: "sup-1", status: "unread_expired", data: {}, created_at: "2026-08-01T10:00:00Z" },
      { supplier_legacy_id: "sup-9", status: "sent", data: {}, created_at: "2026-10-07T10:00:00Z" },
    ];
    const r = run({ sends }).rows[0];
    const panel = describeCreditUsage(sends.filter((s) => s.supplier_legacy_id === "sup-1").map((s) => ({ ...s, supplierId: "sup-1" })), "sup-1", 1);
    expect(r.snapshot.reserved).toBe(panel.reserved);
    expect(r.snapshot.reserved).toBe(2);
    expect(r.snapshot.sends_total).toBe(4);
    expect(r.snapshot.reads_total).toBe(1);
    expect(r.snapshot.last_send_at).toBe("2026-11-01T10:00:00Z");
  });
});

describe("segmenty", () => {
  it("kredyty są, nic nie wysłał → start_with_credits, kwalifikuje się", () => {
    const r = run().rows[0];
    expect(r.segment).toBe(SEGMENTS.START_WITH_CREDITS);
    expect(r.template_key).toBe("start_with_credits");
    expect(r.eligible).toBe(true);
    expect(r.exclusions).toEqual([]);
    expect(r.email).toBe("op@kowalski.test");
    expect(r.warnings).not.toContain("credits_expire_soon"); // 27.12 to 53 dni
    expect(run({ packages: [pkg({ expires_at: "2026-11-20" })] }).rows[0].warnings).toContain("credits_expire_soon");
  });
  it("kredyty są, wysyłał → return_active; bez odczytów = ostrzeżenie sent_no_reads", () => {
    const r = run({ sends: [{ supplier_legacy_id: "sup-1", status: "unread_expired", data: {}, created_at: "2026-10-07T10:00:00Z" }] }).rows[0];
    expect(r.segment).toBe(SEGMENTS.RETURN_ACTIVE);
    expect(r.warnings).toContain("sent_no_reads");
    expect(r.eligible).toBe(true);
  });
  it("wszystko zarezerwowane (tylko czekać) → in_process_only, wykluczony", () => {
    const sends = [1, 2, 3, 4, 5].map((i) => ({ supplier_legacy_id: "sup-1", status: "sent", data: {}, created_at: `2026-11-0${i}T10:00:00Z` }));
    const r = run({ sends }).rows[0];
    expect(r.segment).toBe(SEGMENTS.IN_PROCESS_ONLY);
    expect(r.exclusions).toContain("in_process_only");
    expect(r.eligible).toBe(false);
  });
  it("rezerwacje, ale zostają wolne kredyty → kwalifikuje się z ostrzeżeniem has_reservations", () => {
    const r = run({ sends: [{ supplier_legacy_id: "sup-1", status: "approved", data: {}, created_at: "2026-11-01T10:00:00Z" }] }).rows[0];
    expect(r.eligible).toBe(true);
    expect(r.warnings).toContain("has_reservations");
  });
  it("wygasły prezent bez użycia → no_credits (poza fazą 1), nie „kup pakiet”", () => {
    const r = run({ packages: [pkg({ expires_at: "2026-10-01" })] }).rows[0];
    expect(r.segment).toBe(SEGMENTS.NO_CREDITS);
    expect(r.template_key).toBeNull();
    expect(r.exclusions).toContain("no_credits");
  });
});

describe("wykluczenia z powodami", () => {
  it("konto nieaktywne / PreConnect wyłączony / testowe", () => {
    expect(run({ companies: [co({ account_status: "pending_review" })] }).rows[0].exclusions).toContain("account_not_active");
    expect(run({ companies: [co({ preconnect_enabled: false })] }).rows[0].exclusions).toContain("preconnect_disabled");
    expect(run({ companies: [co({ name: "ZZZ TEST Dostawca" })] }).rows[0].exclusions).toContain("test_account");
  });
  it("brak operatora, dwóch operatorów, zły adres, adres w dwóch firmach, suppresja, niedawna kampania", () => {
    expect(run({ profiles: [] }).rows[0].exclusions).toContain("no_operator");
    expect(run({ profiles: [op(), op({ id: "p2", email: "drugi@kowalski.test" })] }).rows[0].exclusions).toContain("multiple_operators");
    expect(run({ profiles: [op({ email: "bez-malpy" })] }).rows[0].exclusions).toContain("email_invalid");
    const shared = run({ companies: [co(), co({ id: "c2", name: "Inna", legacy_supplier_id: "sup-2" })], profiles: [op(), op({ id: "p2", company_id: "c2", email: "OP@kowalski.test" })], packages: [pkg(), pkg({ company_id: "c2" })] });
    expect(shared.rows.every((r) => r.exclusions.includes("email_shared"))).toBe(true);
    expect(run({ suppressions: [{ email: "op@kowalski.test" }] }).rows[0].exclusions).toContain("suppressed");
    expect(run({ recentMessages: [{ company_id: "c1", profile_id: "p1", sent_at: "2026-10-20T00:00:00Z", state: "accepted" }] }).rows[0].exclusions).toContain("recent_campaign");
  });
  it("nieaktywny profil nie liczy się jako operator", () => {
    expect(run({ profiles: [op({ active: false })] }).rows[0].exclusions).toContain("no_operator");
  });
  it("liczniki wykluczeń nakładają się i są tak oznaczone", () => {
    const r = run({ companies: [co({ account_status: "suspended", preconnect_enabled: false })] });
    expect(r.summary.by_exclusion.account_not_active).toBe(1);
    expect(r.summary.by_exclusion.preconnect_disabled).toBe(1);
    expect(r.summary.counts_overlap).toBe(true);
    expect(r.summary.eligible).toBe(0);
  });
});

describe("dopasowanie do potrzeb kupców (Oksana)", () => {
  it("kategorie dokładnie, słowa kluczowe w asortymencie; brak kryteriów = n/a", () => {
    expect(matchNeeds(co(), { target_categories: ["Owoce"], target_keywords: ["gruszki", "pomidor"] })).toMatchObject({ status: "yes", score: 2, categories: ["owoce"], keywords: ["gruszki"] });
    expect(matchNeeds(co(), { target_categories: ["warzywa"], target_keywords: ["pomidor"] }).status).toBe("no");
    expect(matchNeeds(co(), { target_categories: [], target_keywords: [] }).status).toBe("n/a");
  });
  it("dopasowani kwalifikujący się są pierwsi na liście, summary.matched liczy ich", () => {
    const r = run({ companies: [co({ id: "c2", name: "Warzywa Nowak", categories: ["warzywa"], legacy_supplier_id: "sup-2" }), co()], profiles: [op(), op({ id: "p2", company_id: "c2", email: "nowak@test.pl" })], packages: [pkg(), pkg({ company_id: "c2" })], campaign: { target_categories: ["owoce"], target_keywords: [] } });
    expect(r.rows[0].company_id).toBe("c1");
    expect(r.summary.matched).toBe(1);
  });
});

describe("język i ostrzeżenia danych", () => {
  it("język z profilu operatora, nie z kraju; zagraniczna firma z locale pl = ostrzeżenie", () => {
    const r = run({ companies: [co({ country: "ES" })], profiles: [op({ locale: "pl" })] }).rows[0];
    expect(r.locale).toBe("pl");
    expect(r.warnings).toContain("locale_pl_foreign_country");
    expect(run({ profiles: [op({ locale: "en-GB" })] }).rows[0].locale).toBe("en");
  });
  it("odrzucenie w ostatnich 30 dniach = ostrzeżenie recent_rejection", () => {
    const r = run({ sends: [{ supplier_legacy_id: "sup-1", status: "rejected", data: {}, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-21T10:00:00Z" }] }).rows[0];
    expect(r.warnings).toContain("recent_rejection");
  });
});
