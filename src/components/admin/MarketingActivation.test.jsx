// [feat/marketing-activation] Ekran Marketing → Aktywacja PreConnect: renderuje kampanie,
// kandydatów (saldo, rezerwacje, ważność, powody, dopasowanie), rejestr wiadomości;
// zatwierdzenie bez źródła zgody jest zatrzymane po stronie UI (serwer i tak blokuje).
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

const calls = vi.hoisted(() => ({ list: [] }));
vi.mock("../../lib/db.js", () => ({
  marketingCall: vi.fn(async (fn, body) => {
    calls.list.push([fn, body]);
    if (fn === "marketing-campaign" && body.action === "list") return { campaigns: [{ id: "camp-1", name: "Aktywacja listopad", status: "draft", template_key: "start_with_credits", target_categories: ["owoce"], target_keywords: [], reply_to: "preconnect@test.pl", counts: { total: 0, test: 0 } }] };
    if (fn === "marketing-campaign" && body.action === "get") return { campaign: { id: "camp-1", name: "Aktywacja listopad", status: "draft", template_key: "start_with_credits", target_categories: ["owoce"], target_keywords: [], reply_to: "preconnect@test.pl" }, messages: [] };
    if (fn === "marketing-candidates") return {
      snapshot_at: "2026-11-04T10:00:00Z", summary: { companies: 2, eligible: 1, matched: 1, by_segment: { start_with_credits: 1, no_credits: 1 }, by_exclusion: { no_credits: 1 }, counts_overlap: true },
      rows: [
        { company_id: "c1", company_name: "Sad Kowalski", country: "PL", categories: ["owoce"], profile_id: "p1", operator_name: "Jan", email: "op@kowalski.test", locale: "pl", segment: "start_with_credits", template_key: "start_with_credits", eligible: true, exclusions: [], warnings: ["credits_expire_soon"], match: { status: "yes", score: 1, categories: ["owoce"], keywords: [] }, snapshot: { credits_free: 5, credits_paid: 0, credits_legacy: 0, credits_remaining: 5, nearest_expiry: "2026-11-20", reserved: 0, sends_total: 0, reads_total: 0, last_send_at: null } },
        { company_id: "c2", company_name: "Bez Kredytów", country: "PL", categories: [], profile_id: "p2", operator_name: null, email: "x@y.test", locale: "en", segment: "no_credits", template_key: null, eligible: false, exclusions: ["no_credits"], warnings: [], match: { status: "no", score: 0, categories: [], keywords: [] }, snapshot: { credits_free: 0, credits_paid: 0, credits_legacy: 0, credits_remaining: 0, nearest_expiry: null, reserved: 0, sends_total: 2, reads_total: 0, last_send_at: "2026-10-07T10:00:00Z" } },
      ],
    };
    return {};
  }),
}));
import MarketingActivation from "./MarketingActivation.jsx";

let tree;
const text = (n) => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : (n?.children || []).map(text).join("");
const out = () => text(tree.toJSON());
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(async () => { await i18n.changeLanguage("pl"); calls.list.length = 0; });
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

describe("Marketing → Aktywacja PreConnect", () => {
  it("ładuje kampanie; po wyborze pokazuje kandydatów z saldem, rezerwacjami, ważnością, segmentem i dopasowaniem", async () => {
    const fl = vi.fn();
    await act(async () => { tree = create(<MarketingActivation fl={fl} />); });
    await flush();
    expect(out()).toContain("Aktywacja listopad");
    expect(calls.list[0]).toEqual(["marketing-campaign", { action: "list" }]);
    const row = tree.root.findAllByProps({ "data-testid": "mk-campaign" })[0];
    await act(async () => { row.props.onClick(); });
    await flush();
    const o = out();
    expect(o).toContain("Sad Kowalski");
    expect(o).toContain("op@kowalski.test");
    expect(o).toContain("2026-11-20");
    expect(o).toContain("start z kredytami");
    expect(o).toContain("kredyty wygasają <30 dni");
    expect(o).toContain("owoce");
    expect(o).not.toContain("Bez Kredytów"); // wykluczone ukryte domyślnie
    expect(o).toContain("Wykluczenia (nakładają się)");
    expect(o).toContain("Brak wiadomości");
  });

  it("zatwierdzenie bez zaznaczenia i bez źródła zgody jest zatrzymane w UI (serwer nie jest wołany)", async () => {
    const fl = vi.fn();
    await act(async () => { tree = create(<MarketingActivation fl={fl} />); });
    await flush();
    const row = tree.root.findAllByProps({ "data-testid": "mk-campaign" })[0];
    await act(async () => { row.props.onClick(); });
    await flush();
    const selectVisible = tree.root.findAllByProps({ "data-testid": "mk-select-visible" })[0];
    await act(async () => { selectVisible.props.onClick(); });
    const approve = tree.root.findAllByProps({ "data-testid": "mk-approve" })[0];
    expect(approve.props.disabled).toBe(false);
    await act(async () => { await approve.props.onClick(); });
    expect(fl).toHaveBeenCalledWith(expect.stringMatching(/źródło zgody/), "error");
    expect(calls.list.some(([fn, b]) => fn === "marketing-campaign" && b.action === "approve")).toBe(false);
  });
});
