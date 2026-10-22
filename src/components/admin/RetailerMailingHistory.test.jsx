import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import RetailerMailingHistory from "./RetailerMailingHistory.jsx";

const props = {
  retailerId: 1, retailerName: "TEST SIECI",
  sends: [
    { id: 1, retailerId: 1, supplierId: "sup-a", offerId: 11, emailSentAt: "2026-10-06T12:14:00Z", resendMessageIds: ["one", "two"] },
    { id: 2, retailerId: 1, supplierId: "sup-a", offerId: 12, emailSentAt: "2026-10-06T12:14:00Z", resendMessageIds: ["one", "two"] },
    { id: 3, retailerId: 2, offerId: 13, emailSentAt: "2026-10-13T12:14:00Z", resendMessageIds: ["other"] },
  ],
  offers: [{ id: 11, title: "Jabłka" }, { id: 12, title: "Gruszki" }, { id: 13, title: "Nie dla tej sieci" }],
  companies: [{ id: "company-a", legacy_supplier_id: "sup-a", name: "TEST DOSTAWCA" }],
};
let tree;
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const output = () => text(tree.toJSON());
const mount = (overrides = {}) => act(() => { tree = create(<RetailerMailingHistory {...props} {...overrides}/>); });
const toggle = () => act(() => { tree.root.findByType("button").props.onClick(); });

beforeEach(async () => { await i18n.changeLanguage("pl"); });
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

describe("admin mailing history", () => {
  it("shows latest date and time then expands a read-only history for just this retailer", () => {
    mount();
    expect(output()).toContain("Ostatni mailing: 06.10.2026, 14:14");
    expect(output()).not.toContain("Jabłka");
    toggle();
    expect(tree.root.findByType("button").props["aria-expanded"]).toBe(true);
    expect(output()).toContain("Propozycje: 2");
    expect(output()).toContain("Wysłane e-maile do kupców: 2");
    expect(output()).toContain("Jabłka");
    expect(output()).toContain("Gruszki");
    expect(output()).toContain("TEST DOSTAWCA");
    expect(output()).not.toContain("Nie dla tej sieci");
    expect(tree.root.findAllByType("button")).toHaveLength(1);
    expect(tree.root.findAllByType("a")).toHaveLength(0);
    toggle();
    expect(output()).not.toContain("Jabłka");
  });

  it("shows no mailing rather than mistaking a panel/read date for sending", () => {
    mount({ sends: [{ id: 1, retailerId: 1, status: "read", sentAt: "2026-10-13", readAt: "2026-10-13" }] });
    expect(output()).toContain("brak zapisanej wysyłki");
    toggle();
    expect(output()).toContain("Nie ma zapisanych wysyłek e-mail do tej sieci.");
  });

  it("discloses unknown hours, missing IDs and unavailable proposal details", () => {
    mount({ sends: [{ id: 9, retailerId: 1, offerId: 99, mailingSentAt: "2026-10-06" }] });
    expect(output()).toContain("06.10.2026 (godzina nie została zapisana)");
    expect(output()).not.toContain("00:00");
    toggle();
    expect(output()).toContain("Starszy zapis bez identyfikatora mailingu");
    expect(output()).toContain("Propozycja #99");
    expect(output()).toContain("Brak danych dostawcy");
  });

  it("does not claim the dated record is the latest when another mailing has no date", () => {
    mount({ sends: [...props.sends, { id: 9, retailerId: 1, resendMessageId: "undated" }] });
    expect(output()).toContain("Ostatni mailing z zapisaną datą");
    toggle();
    expect(output()).toContain("data nie została zapisana");
    expect(output()).toContain("Nie można ustalić ich kolejności");
  });

  it("refreshes history from new sends without mutating them", () => {
    mount();
    toggle();
    const sends = [...props.sends, { ...props.sends[0], id: 4, emailSentAt: "2026-10-13T13:14:00Z", resendMessageIds: ["new"] }];
    const before = JSON.stringify(sends);
    act(() => tree.update(<RetailerMailingHistory {...props} sends={sends}/>));
    expect(output()).toContain("Ostatni mailing: 13.10.2026, 15:14");
    expect(JSON.stringify(sends)).toBe(before);
  });

  it("has English translations and still uses Polish time", async () => {
    await i18n.changeLanguage("en");
    mount();
    toggle();
    expect(output()).toContain("Last mailing: 06/10/2026, 14:14");
    expect(output()).toContain("Mailing history");
    expect(output()).toContain("Polish time (Europe/Warsaw)");
    expect(output()).not.toContain("admin.mailing_history");
  });

  it("does not claim an exact buyer count when only the first successful message ID survived", async () => {
    mount({ sends: [{ id: 1, retailerId: 1, resend_message_id: "first-only" }] });
    toggle();
    expect(output()).toContain("Wysłane e-maile do kupców: co najmniej 1");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(output()).toContain("Emails sent to buyers: at least 1");
  });
});

// [feat/email-open-history] odbiorcy per kupiec i wejścia do aplikacji — osobno, nazwane jak trzeba
describe("admin mailing history — recipients", () => {
  const history = {
    messages: [
      { resend_message_id: "one", retailer_id: 1, buyer_profile_id: "b-anna", to_email: "anna@siec.test", legacy_ids: [1, 2],
        sent_at: "2026-10-06T12:14:00Z", buyer_name: "Anna Kupiec", buyer_email_now: "anna@siec.test",
        delivered_at: "2026-10-06T12:14:30Z", first_opened_at: "2026-10-06T13:00:00Z", last_opened_at: "2026-10-07T08:00:00Z", open_count: 3,
        bounced_at: null, complained_at: null, delayed_at: null, last_event_error: null, event_count: 4 },
      { resend_message_id: "two", retailer_id: 1, buyer_profile_id: "b-bartek", to_email: "bartek@siec.test", legacy_ids: [1, 2],
        sent_at: "2026-10-06T12:14:00Z", buyer_name: "Bartek Kupiec", buyer_email_now: "bartek@siec.test",
        delivered_at: "2026-10-06T12:14:31Z", first_opened_at: null, last_opened_at: null, open_count: 0,
        bounced_at: null, complained_at: null, delayed_at: null, last_event_error: null, event_count: 1 },
    ],
    app_reads: [
      { legacy_id: 1, buyer_profile_id: "b-bartek", reader_role: "buyer", channel: "app_detail",
        first_read_at: "2026-10-08T09:00:00Z", last_read_at: "2026-10-08T09:05:00Z", read_count: 2, buyer_name: "Bartek Kupiec", buyer_email_now: "bartek@siec.test" },
    ],
  };
  // efekt → Promise.resolve(loadHistory) → then → setState: potrzebna pełna makrotura
  const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

  it("po rozwinięciu doczytuje odbiorców i pokazuje otwarcia e-maila osobno od wejść do aplikacji", async () => {
    const calls = [];
    mount({ loadHistory: async (id) => { calls.push(id); return history; } });
    expect(calls).toHaveLength(0);                      // nic nie ładuje, póki panel zwinięty
    toggle(); await flush();
    expect(calls).toEqual([1]);
    const out = output();
    expect(out).toContain("Anna Kupiec");
    expect(out).toContain("anna@siec.test");
    expect(out).toContain("06.10.2026, 15:00");         // pierwsze otwarcie, czas polski
    expect(out).toContain("otwarć: 3");
    // Bartek: brak otwarcia maila to NIE „nie przeczytał"
    expect(out).toContain("Brak zarejestrowanego otwarcia");
    expect(out).not.toContain("Nie przeczytał");
    // wejście do aplikacji — osobna sekcja, przypisana do kupca, z rodzajem
    expect(out).toContain("Wejścia do aplikacji");
    expect(out).toContain("otwarcie propozycji");
    expect(out).toContain("Jabłka");
    expect(out).toContain("bez błędów");
  });

  it("błąd wczytania nie chowa historii wysyłek i jest nazwany", async () => {
    mount({ loadHistory: async () => null });
    toggle(); await flush();
    expect(output()).toContain("Nie udało się wczytać historii odbiorców.");
    expect(output()).toContain("Jabłka");
  });

  it("stare mailingi bez powiązań per kupiec: jasny komunikat zamiast pustej tabeli", async () => {
    mount({ loadHistory: async () => ({ messages: [], app_reads: [] }) });
    toggle(); await flush();
    expect(output()).toContain("Brak zapisanych odbiorców dla tego mailingu");
  });
});
