// [feat/marketing-activation] Ekran Marketing → Aktywacja PreConnect (Artur 5.11): grupa odbiorców zamiast
// „potrzeb kupców”, kandydaci z powodem kwalifikacji, edytor treści PL/EN bez HTML (zapis/reset/podgląd
// z niezapisaną treścią), zatwierdzenie bez źródła zgody zatrzymane w UI, zamknięcie z potwierdzeniem.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

const calls = vi.hoisted(() => ({ list: [] }));
const DEF = { pl: { subject: "Domyślny PL {{credits}}", body: "Treść PL", cta: "Przygotuj propozycję" }, en: { subject: "Default EN", body: "Body EN", cta: "Prepare a proposal" } };
vi.mock("../../lib/db.js", () => ({
  marketingCall: vi.fn(async (fn, body) => {
    calls.list.push([fn, body]);
    if (fn === "marketing-campaign" && body.action === "list") return { campaigns: [{ id: "camp-1", name: "Aktywacja listopad", status: "draft", template_key: "credits_no_proposal", content: {}, counts: { total: 0 } }] };
    if (fn === "marketing-campaign" && body.action === "get") return { campaign: { id: "camp-1", name: "Aktywacja listopad", status: "draft", template_key: "credits_no_proposal", content: {}, content_version: 1 }, default_content: DEF, messages: [] };
    if (fn === "marketing-campaign" && body.action === "update_content") return { campaign: { id: "camp-1", name: "Aktywacja listopad", status: "draft", template_key: "credits_no_proposal", content: body.content, content_version: 2 }, reset: Object.keys(body.content).length === 0 };
    if (fn === "marketing-campaign" && body.action === "approve") return { approved: 1, skipped: [], content_version: body.content_version };
    if (fn === "marketing-preview") return { subject: "Podgląd", html: "<p>x</p>", text: "x", row: { company_name: "Sad Kowalski" }, meta: { customContent: !!body.content } };
    if (fn === "marketing-candidates") return {
      snapshot_at: "2026-11-04T10:00:00Z", summary: { companies: 3, base_ok: 2, eligible: 1, audience: "credits_no_proposal", by_audience: { credits_no_proposal: 1, credits_proposal_ready: 0, used_before_free_credits: 1, credits_expiring: 0, no_valid_credits: 0 }, by_exclusion: { suppressed: 1 }, counts_overlap: true },
      rows: [
        { company_id: "c1", company_name: "Sad Kowalski", country: "PL", categories: ["owoce"], profile_id: "p1", operator_name: "Jan", email: "op@kowalski.test", locale: "pl", segment: "start_with_credits", template_key: "credits_no_proposal", audiences: ["credits_no_proposal"], audience_reasons: {}, in_audience: true, audience_reason: "q_credits_available_no_history", base_ok: true, eligible: true, exclusions: [], warnings: ["credits_expire_soon"], snapshot: { credits_free: 5, credits_paid: 0, credits_legacy: 0, credits_remaining: 5, credits_available: 5, expiring_credits: 5, nearest_expiry: "2026-11-20", reserved: 0, sends_total: 0, reads_total: 0, offers_total: 0, last_send_at: null } },
        { company_id: "c2", company_name: "Warzywa Nowak", country: "PL", categories: ["warzywa"], profile_id: "p2", operator_name: "Anna", email: "nowak@test.pl", locale: "pl", segment: "return_active", template_key: "credits_no_proposal", audiences: ["used_before_free_credits"], audience_reasons: {}, in_audience: false, audience_reason: "b_has_sends", base_ok: true, eligible: false, exclusions: [], warnings: [], snapshot: { credits_free: 3, credits_paid: 10, credits_legacy: 0, credits_remaining: 13, credits_available: 12, expiring_credits: 3, nearest_expiry: "2027-01-03", reserved: 1, sends_total: 3, reads_total: 1, offers_total: 2, last_send_at: "2026-10-30T10:00:00Z" } },
        { company_id: "c3", company_name: "Wypisana", country: "PL", categories: [], profile_id: "p3", operator_name: "Zofia", email: "w@test.pl", locale: "en", segment: "start_with_credits", template_key: "credits_no_proposal", audiences: ["credits_no_proposal"], audience_reasons: {}, in_audience: true, audience_reason: "q_credits_available_no_history", base_ok: false, eligible: false, exclusions: ["suppressed"], warnings: [], snapshot: { credits_free: 5, credits_paid: 0, credits_legacy: 0, credits_remaining: 5, credits_available: 5, expiring_credits: 5, nearest_expiry: "2026-12-19", reserved: 0, sends_total: 0, reads_total: 0, offers_total: 0, last_send_at: null } },
      ],
    };
    return {};
  }),
}));
import MarketingActivation, { AUDIENCES } from "./MarketingActivation.jsx";

let tree;
const text = (n) => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : (n?.children || []).map(text).join("");
const out = () => text(tree.toJSON());
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const byId = (id) => tree.root.findAllByProps({ "data-testid": id })[0];
const openFirst = async (fl = vi.fn()) => {
  await act(async () => { tree = create(<MarketingActivation fl={fl} />); });
  await flush();
  await act(async () => { byId("mk-campaign").props.onClick(); });
  await flush();
  return fl;
};
let hadWindow, prevConfirm;
beforeEach(async () => {
  await i18n.changeLanguage("pl"); calls.list.length = 0;
  hadWindow = "window" in globalThis; if (!hadWindow) globalThis.window = {}; prevConfirm = globalThis.window.confirm;
});
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; globalThis.window.confirm = prevConfirm; if (!hadWindow) delete globalThis.window; });

describe("Marketing → Aktywacja PreConnect", () => {
  it("formularz: grupa odbiorców z opisem, bez pól „potrzeb kupców”; lista kampanii pokazuje grupę", async () => {
    await openFirst();
    const o = out();
    expect(byId("mk-audience").props.value).toBe("credits_no_proposal");
    expect(AUDIENCES).toHaveLength(5);
    expect(o).toContain("Mają kredyty, brak propozycji");
    expect(o).toContain("Zachęta do pierwszej prezentacji firmy");
    expect(o).not.toContain("Potrzeby kupców");
    expect(o).not.toContain("Dopasowanie");
    expect(calls.list[0]).toEqual(["marketing-campaign", { action: "list" }]);
  });

  it("kandydaci: domyślnie tylko kwalifikujący się do grupy z powodem; „pokaż pozostałe” dodaje innych z powodem niekwalifikacji / wykluczeniem; saldo wolne/ważne i propozycje", async () => {
    await openFirst();
    let o = out();
    expect(o).toContain("Sad Kowalski");
    expect(o).toContain("wolne kredyty, brak propozycji i wysyłek");
    expect(o).toContain("kredyty wygasają <30 dni");
    expect(o).not.toContain("Warzywa Nowak");
    expect(o).toContain("Mają kredyty, brak propozycji 1");
    expect(o).toContain("Korzystali wcześniej, mają wolne kredyty 1");
    expect(o).toContain("Wykluczenia bazowe (nakładają się)");
    const toggle = tree.root.findAllByType("input").find((i) => i.props.type === "checkbox"); // pierwszy checkbox = „pokaż pozostałe” (nad tabelą)
    await act(async () => { toggle.props.onChange({ target: { checked: true } }); });
    o = out();
    expect(o).toContain("Warzywa Nowak");
    expect(o).toContain("wysyłał już propozycje");
    expect(o).toContain("12 / 13"); // wolne / ważne
    expect(o).toContain("propozycje: 2");
    expect(o).toContain("Wypisana");
    expect(o).toContain("wypis/blokada");
  });

  it("edytor treści: domyślna treść grupy w polach PL/EN, zmiana = „niezapisane”, zapis woła update_content z 3 polami per język, reset woła {} ; podgląd PL z niezapisaną treścią", async () => {
    const fl = await openFirst();
    expect(byId("mk-subject-pl").props.value).toBe("Domyślny PL {{credits}}");
    expect(byId("mk-cta-en").props.value).toBe("Prepare a proposal");
    expect(out()).toContain("treść domyślna");
    expect(byId("mk-save-content").props.disabled).toBe(true);
    await act(async () => { byId("mk-subject-pl").props.onChange({ target: { value: "Nowy temat {{company}}" } }); });
    expect(out()).toContain("niezapisane zmiany");
    expect(byId("mk-save-content").props.disabled).toBe(false);
    await act(async () => { await byId("mk-preview-pl").props.onClick(); });
    const prev = calls.list.find(([fn]) => fn === "marketing-preview");
    expect(prev[1]).toMatchObject({ campaign_id: "camp-1", company_id: "c1", locale: "pl" });
    expect(prev[1].content.pl.subject).toBe("Nowy temat {{company}}");
    await act(async () => { await byId("mk-save-content").props.onClick(); });
    await flush();
    const upd = calls.list.find(([fn, b]) => fn === "marketing-campaign" && b.action === "update_content");
    expect(upd[1].content).toEqual({ pl: { subject: "Nowy temat {{company}}", body: "Treść PL", cta: "Przygotuj propozycję" }, en: DEF.en });
    expect(fl).toHaveBeenCalledWith("Treść zapisana.", undefined);
    expect(out()).toContain("treść własna");
    await act(async () => { await byId("mk-reset-content").props.onClick(); });
    await flush();
    const resets = calls.list.filter(([fn, b]) => fn === "marketing-campaign" && b.action === "update_content");
    expect(resets.at(-1)[1].content).toEqual({});
    expect(byId("mk-subject-pl").props.value).toBe("Domyślny PL {{credits}}");
  });

  it("zatwierdzenie: zaznacz widoczne → podsumowanie liczy język i grupę; bez źródła zgody zatrzymane w UI; z confirm=false serwer nie wołany", async () => {
    const fl = await openFirst();
    await act(async () => { byId("mk-select-visible").props.onClick(); });
    expect(out()).toContain("Do zatwierdzenia: 1 firm · PL 1 · EN 0 · grupa: Mają kredyty, brak propozycji");
    const approve = byId("mk-approve");
    expect(approve.props.disabled).toBe(false);
    await act(async () => { await approve.props.onClick(); });
    expect(fl).toHaveBeenCalledWith(expect.stringMatching(/źródło zgody/), "error");
    expect(calls.list.some(([fn, b]) => fn === "marketing-campaign" && b.action === "approve")).toBe(false);
    const confirmSpy = vi.fn().mockReturnValue(false); globalThis.window.confirm = confirmSpy;
    const consentInput = tree.root.findAllByType("input").find((i) => i.props.placeholder === "źródło zgody");
    await act(async () => { consentInput.props.onChange({ target: { value: "regulamin 1.0 §9" } }); });
    await act(async () => { await byId("mk-approve").props.onClick(); });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Mają kredyty, brak propozycji"));
    expect(calls.list.some(([fn, b]) => fn === "marketing-campaign" && b.action === "approve")).toBe(false);
  });

  it("[P1] edycja → podgląd → zatwierdzenie BEZ zapisu = blokada „Najpierw zapisz treść”, serwer nie wołany; po zapisie approve niesie content_version z bazy", async () => {
    const fl = await openFirst();
    await act(async () => { byId("mk-subject-pl").props.onChange({ target: { value: "Inny temat" } }); });
    await act(async () => { await byId("mk-preview-pl").props.onClick(); });
    await act(async () => { byId("mk-select-visible").props.onClick(); });
    const consentInput = tree.root.findAllByType("input").find((i) => i.props.placeholder === "źródło zgody");
    await act(async () => { consentInput.props.onChange({ target: { value: "regulamin 1.0 §9" } }); });
    expect(out()).toContain("Najpierw zapisz treść");
    const confirmSpy = vi.fn().mockReturnValue(true); globalThis.window.confirm = confirmSpy;
    await act(async () => { await byId("mk-approve").props.onClick(); });
    expect(fl).toHaveBeenCalledWith(expect.stringMatching(/Najpierw zapisz treść/), "error");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(calls.list.some(([fn, b]) => fn === "marketing-campaign" && b.action === "approve")).toBe(false);
    await act(async () => { await byId("mk-save-content").props.onClick(); });
    await flush();
    await act(async () => { byId("mk-select-visible").props.onClick(); });
    const consent2 = tree.root.findAllByType("input").find((i) => i.props.placeholder === "źródło zgody");
    await act(async () => { consent2.props.onChange({ target: { value: "regulamin 1.0 §9" } }); });
    await act(async () => { await byId("mk-approve").props.onClick(); });
    await flush();
    const approve = calls.list.find(([fn, b]) => fn === "marketing-campaign" && b.action === "approve");
    expect(approve[1].content_version).toBe(2); // wersja po zapisie, ta sama którą pokazał podgląd
    const upd = calls.list.find(([fn, b]) => fn === "marketing-campaign" && b.action === "update_content");
    expect(upd[1].expected_version).toBe(1);
  });

  it("„Zamknij kampanię”: anulowane potwierdzenie nie woła serwera; potwierdzone woła action=close", async () => {
    const fl = await openFirst();
    const close = byId("mk-close");
    const confirmSpy = vi.fn().mockReturnValueOnce(false); globalThis.window.confirm = confirmSpy;
    await act(async () => { await close.props.onClick(); });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Aktywacja listopad"));
    expect(calls.list.some(([fn, b]) => fn === "marketing-campaign" && b.action === "close")).toBe(false);
    confirmSpy.mockReturnValueOnce(true);
    await act(async () => { await close.props.onClick(); });
    await flush();
    expect(calls.list.some(([fn, b]) => fn === "marketing-campaign" && b.action === "close" && b.campaign_id === "camp-1")).toBe(true);
    expect(fl).toHaveBeenCalledWith(expect.stringMatching(/zamknięta/i), undefined);
  });
});
