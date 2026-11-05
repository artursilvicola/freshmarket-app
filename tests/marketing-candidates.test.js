// [feat/marketing-activation] Kandydaci: GRUPY ODBIORCÓW (Artur 5.11) z powodem kwalifikacji/niekwalifikacji,
// saldo jak w panelu, rezerwacje, terminy ważności, wykluczenia bazowe z powodami. Bez „potrzeb kupców”.
import { describe, it, expect } from "vitest";
import { buildCandidates, summarizePools, qualifyAudience, AUDIENCES, AUDIENCE_KEYS, SEGMENTS, EXCLUSION_REASONS } from "../netlify/functions/_shared/marketing-candidates.js";
import { summarizeCreditPools } from "../src/lib/db.js";
import { describeCreditUsage } from "../src/lib/preconnect-credit-usage.js";

const TODAY = "2026-11-04";
const co = (over = {}) => ({ id: "c1", name: "Sad Kowalski", country: "PL", categories: ["owoce"], products: "jabłka Gala, gruszki", account_status: "active", preconnect_enabled: true, legacy_supplier_id: "sup-1", ...over });
const op = (over = {}) => ({ id: "p1", email: "op@kowalski.test", role: "supplier", company_id: "c1", locale: "pl", active: true, name: "Jan", ...over });
const pkg = (over = {}) => ({ company_id: "c1", source: "grant", qty_total: 5, qty_used: 0, expires_at: "2026-12-27", ...over });
const send = (over = {}) => ({ supplier_legacy_id: "sup-1", status: "sent", data: {}, created_at: "2026-10-07T10:00:00Z", ...over });
const offer = (over = {}) => ({ supplier_legacy_id: "sup-1", status: "active", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-02T10:00:00Z", ...over });
const run = (over = {}) => buildCandidates({ companies: [co()], profiles: [op()], packages: [pkg()], sends: [], offers: [], suppressions: [], recentMessages: [], campaign: null, todayISO: TODAY, ...over });
const forAud = (key, over = {}) => run({ campaign: { template_key: key }, ...over }).rows[0];

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
  it("rezerwacje liczone jak describeCreditUsage; wolne = ważne − rezerwacje; propozycje liczone po kluczach firmy", () => {
    const sends = [
      send({ status: "sent" }), send({ status: "pending_moderation", created_at: "2026-11-01T10:00:00Z" }),
      send({ status: "read", data: { billingStatus: "charged" }, created_at: "2026-09-01T10:00:00Z" }), send({ status: "unread_expired", created_at: "2026-08-01T10:00:00Z" }),
      send({ supplier_legacy_id: "sup-9" }),
    ];
    const r = run({ sends, offers: [offer(), offer({ supplier_legacy_id: "sup-9" })] }).rows[0];
    const panel = describeCreditUsage(sends.filter((s) => s.supplier_legacy_id === "sup-1").map((s) => ({ ...s, supplierId: "sup-1" })), "sup-1", 1);
    expect(r.snapshot.reserved).toBe(panel.reserved);
    expect(r.snapshot.reserved).toBe(2);
    expect(r.snapshot.credits_available).toBe(3);
    expect(r.snapshot.sends_total).toBe(4);
    expect(r.snapshot.reads_total).toBe(1);
    expect(r.snapshot.offers_total).toBe(1);
    expect(r.snapshot.last_send_at).toBe("2026-11-01T10:00:00Z");
  });
  it("kredyty z najbliższym terminem liczone osobno (expiring_credits)", () => {
    const r = run({ packages: [pkg({ qty_total: 2, expires_at: "2026-11-20" }), pkg({ source: "purchase", qty_total: 10, expires_at: "2027-06-01" })] }).rows[0];
    expect(r.snapshot.credits_remaining).toBe(12);
    expect(r.snapshot.nearest_expiry).toBe("2026-11-20");
    expect(r.snapshot.expiring_credits).toBe(2);
  });
});

describe("grupy odbiorców — dokładna kwalifikacja z powodem", () => {
  it("qualifyAudience: pięć grup, powody q_/b_", () => {
    const f = (o) => ({ remaining: 5, reserved: 0, available: 5, sends_total: 0, offers_total: 0, nearest_expiry: "2026-12-27", expiring_soon: false, ...o });
    expect(qualifyAudience(AUDIENCES.CREDITS_NO_PROPOSAL, f())).toEqual({ ok: true, reason: "q_credits_available_no_history" });
    expect(qualifyAudience(AUDIENCES.CREDITS_NO_PROPOSAL, f({ offers_total: 1 }))).toEqual({ ok: false, reason: "b_has_offers" });
    expect(qualifyAudience(AUDIENCES.CREDITS_NO_PROPOSAL, f({ sends_total: 1 }))).toEqual({ ok: false, reason: "b_has_sends" });
    expect(qualifyAudience(AUDIENCES.CREDITS_PROPOSAL_READY, f({ offers_total: 1 }))).toEqual({ ok: true, reason: "q_credits_available_offer_not_sent" });
    expect(qualifyAudience(AUDIENCES.CREDITS_PROPOSAL_READY, f())).toEqual({ ok: false, reason: "b_no_offers" });
    expect(qualifyAudience(AUDIENCES.USED_BEFORE_FREE_CREDITS, f({ sends_total: 2 }))).toEqual({ ok: true, reason: "q_used_before_credits_available" });
    expect(qualifyAudience(AUDIENCES.USED_BEFORE_FREE_CREDITS, f())).toEqual({ ok: false, reason: "b_no_sends" });
    expect(qualifyAudience(AUDIENCES.CREDITS_EXPIRING, f({ expiring_soon: true }))).toEqual({ ok: true, reason: "q_credits_expiring" });
    expect(qualifyAudience(AUDIENCES.CREDITS_EXPIRING, f())).toEqual({ ok: false, reason: "b_expiry_far" });
    expect(qualifyAudience(AUDIENCES.CREDITS_EXPIRING, f({ nearest_expiry: null }))).toEqual({ ok: false, reason: "b_no_expiry" });
    expect(qualifyAudience(AUDIENCES.NO_VALID_CREDITS, f({ remaining: 0, available: 0 }))).toEqual({ ok: true, reason: "q_no_valid_credits" });
    expect(qualifyAudience(AUDIENCES.NO_VALID_CREDITS, f())).toEqual({ ok: false, reason: "b_has_valid_credits" });
    // brak wolnych kredytów: rozróżnienie „brak ważnych” vs „wszystko zarezerwowane”
    expect(qualifyAudience(AUDIENCES.CREDITS_NO_PROPOSAL, f({ remaining: 0, available: 0 }))).toEqual({ ok: false, reason: "b_no_valid_credits" });
    expect(qualifyAudience(AUDIENCES.CREDITS_NO_PROPOSAL, f({ remaining: 2, reserved: 2, available: 0 }))).toEqual({ ok: false, reason: "b_all_reserved" });
    expect(qualifyAudience("sprzedaz", f()).ok).toBe(false);
    expect(AUDIENCE_KEYS).toHaveLength(5);
  });
  it("firma z kredytami zarezerwowanymi przy oczekujących propozycjach NIGDY nie trafia do „brak kredytów”", () => {
    // wygasły pakiet (remaining 0), ale wysyłka w toku → rezerwacja 1
    const r = forAud(AUDIENCES.NO_VALID_CREDITS, { packages: [pkg({ expires_at: "2026-10-01" })], sends: [send({ status: "sent", created_at: "2026-11-01T10:00:00Z" })] });
    expect(r.in_audience).toBe(false);
    expect(r.audience_reason).toBe("b_reserved_pending");
    expect(r.eligible).toBe(false);
    expect(r.audiences).toEqual([]);
    // wszystkie ważne kredyty zarezerwowane → też nie „kup pakiet” i nie „masz kredyty”
    const all = run({ campaign: { template_key: AUDIENCES.USED_BEFORE_FREE_CREDITS }, sends: [1, 2, 3, 4, 5].map((i) => send({ created_at: `2026-11-0${i}T10:00:00Z` })) }).rows[0];
    expect(all.audiences).toEqual([]);
    expect(all.audience_reason).toBe("b_all_reserved");
    expect(all.audience_reasons.no_valid_credits).toBe("b_has_valid_credits");
    expect(all.segment).toBe(SEGMENTS.IN_PROCESS_ONLY);
  });
  it("firma może kwalifikować się do kilku grup (np. brak propozycji + wygasające); kampania wybiera jedną", () => {
    const r = forAud(AUDIENCES.CREDITS_NO_PROPOSAL, { packages: [pkg({ expires_at: "2026-11-20" })] });
    expect(r.audiences).toEqual([AUDIENCES.CREDITS_NO_PROPOSAL, AUDIENCES.CREDITS_EXPIRING]);
    expect(r.eligible).toBe(true);
    expect(r.audience_reason).toBe("q_credits_available_no_history");
    expect(r.warnings).toContain("credits_expire_soon");
    const e = forAud(AUDIENCES.CREDITS_EXPIRING, { packages: [pkg({ expires_at: "2026-11-20" })] });
    expect(e.eligible).toBe(true);
    expect(e.warnings).not.toContain("credits_expire_soon"); // w tej grupie to nie ostrzeżenie, to powód
  });
  it("propozycja gotowa (legacy_offers bez wysyłek) → credits_proposal_ready, a nie credits_no_proposal", () => {
    const over = { offers: [offer()] };
    expect(forAud(AUDIENCES.CREDITS_PROPOSAL_READY, over).eligible).toBe(true);
    expect(forAud(AUDIENCES.CREDITS_NO_PROPOSAL, over)).toMatchObject({ eligible: false, audience_reason: "b_has_offers" });
    expect(forAud(AUDIENCES.USED_BEFORE_FREE_CREDITS, over)).toMatchObject({ eligible: false, audience_reason: "b_no_sends" });
  });
  it("wysyłał wcześniej i ma wolne kredyty → used_before_free_credits (z rezerwacją = ostrzeżenie)", () => {
    const r = forAud(AUDIENCES.USED_BEFORE_FREE_CREDITS, { sends: [send({ status: "approved", created_at: "2026-11-01T10:00:00Z" })] });
    expect(r.eligible).toBe(true);
    expect(r.snapshot.credits_available).toBe(4);
    expect(r.warnings).toContain("has_reservations");
    expect(r.warnings).toContain("sent_no_reads");
    expect(r.segment).toBe(SEGMENTS.RETURN_ACTIVE);
  });
  it("brak ważnych kredytów bez rezerwacji → no_valid_credits; podsumowanie per grupa liczy firmy bez wykluczeń bazowych", () => {
    const res = run({ campaign: { template_key: AUDIENCES.NO_VALID_CREDITS }, packages: [pkg({ expires_at: "2026-10-01" })] });
    expect(res.rows[0]).toMatchObject({ eligible: true, audience_reason: "q_no_valid_credits", segment: SEGMENTS.NO_CREDITS });
    expect(res.summary.by_audience.no_valid_credits).toBe(1);
    expect(res.summary.by_audience.credits_no_proposal).toBe(0);
    expect(res.summary.audience).toBe(AUDIENCES.NO_VALID_CREDITS);
    expect(res.summary.eligible).toBe(1);
  });
  it("bez kampanii / stary szablon: wolne kredyty wystarczają (zgodność ze starymi kampaniami testowymi)", () => {
    expect(run().rows[0]).toMatchObject({ in_audience: true, eligible: true, audience_reason: "q_credits_available", template_key: "start_with_credits" });
    expect(run({ campaign: { template_key: "return_active" } }).rows[0].eligible).toBe(true);
    expect(run({ packages: [pkg({ expires_at: "2026-10-01" })] }).rows[0]).toMatchObject({ eligible: false, audience_reason: "b_no_valid_credits" });
  });
});

describe("wykluczenia bazowe z powodami (niezależne od grupy)", () => {
  it("konto nieaktywne / PreConnect wyłączony / testowe → base_ok=false, eligible=false mimo kwalifikacji do grupy", () => {
    const r = forAud(AUDIENCES.CREDITS_NO_PROPOSAL, { companies: [co({ account_status: "pending_review" })] });
    expect(r.exclusions).toContain("account_not_active");
    expect(r.in_audience).toBe(true);
    expect(r.base_ok).toBe(false);
    expect(r.eligible).toBe(false);
    expect(run({ companies: [co({ preconnect_enabled: false })] }).rows[0].exclusions).toContain("preconnect_disabled");
    expect(run({ companies: [co({ name: "ZZZ TEST Dostawca" })] }).rows[0].exclusions).toContain("test_account");
    expect(EXCLUSION_REASONS).not.toContain("no_credits"); // brak kredytów to kwestia grupy, nie wykluczenie bazowe
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
  it("liczniki wykluczeń nakładają się i są tak oznaczone; kwalifikujący się są pierwsi na liście", () => {
    const r = run({ campaign: { template_key: AUDIENCES.CREDITS_NO_PROPOSAL }, companies: [co({ id: "c2", name: "Aaa zawieszona", account_status: "suspended", legacy_supplier_id: "sup-2" }), co()], profiles: [op(), op({ id: "p2", company_id: "c2", email: "aaa@test.pl" })], packages: [pkg(), pkg({ company_id: "c2" })] });
    expect(r.summary.by_exclusion.account_not_active).toBe(1);
    expect(r.summary.counts_overlap).toBe(true);
    expect(r.summary.eligible).toBe(1);
    expect(r.rows[0].company_id).toBe("c1");
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
    const r = run({ sends: [send({ status: "rejected", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-21T10:00:00Z" })] }).rows[0];
    expect(r.warnings).toContain("recent_rejection");
  });
});
