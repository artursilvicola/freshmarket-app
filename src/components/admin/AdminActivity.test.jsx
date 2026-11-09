// [feat/admin-activity] Zakładka „Aktywność”: ostrożne słownictwo, zastrzeżenia pomiaru, data
// rozpoczęcia zbierania, konta testowe ukryte domyślnie, oś czasu, eksport CSV bez IP.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

const calls = vi.hoisted(() => ({ load: [], setTest: [] }));
const REPORT = {
  meta: { from: "2026-10-10T00:00:00Z", to: "2026-11-09T00:00:00Z", collecting_since: "2026-11-09T08:00:00Z", retention_months: 12, dedupe_minutes: 30, events_total: 4, events_truncated: false },
  accounts: [
    { profile_id: "p-anna", role: "buyer", name: "Anna Kupiec", email: "anna@siec.test", active: true, retailer_name: "Sieć Testowa", company_name: null, is_test: false,
      visits: 2, last_visit_at: "2026-11-08T10:00:00Z", emails_sent: 1, emails_delivered: 1, emails_opened: 0, last_opened_at: null, proposals_viewed: 3,
      legacy_last_active_at: "2026-06-07T09:42:20Z", legacy_last_active_kind: "bulk_set" },
    { profile_id: "p-jan", role: "supplier", name: "Jan Dostawca", email: "=jan@sad.test", active: true, retailer_name: null, company_name: "Sad; \"Złoty\"", is_test: false,
      visits: 0, last_visit_at: null, emails_sent: 0, emails_delivered: 0, emails_opened: 0, last_opened_at: null, proposals_viewed: 0,
      legacy_last_active_at: null, legacy_last_active_kind: null },
    { profile_id: "p-test", role: "buyer", name: "Test Kupiec", email: "artur+kupiec@test", active: true, retailer_name: "ZZZ TEST", company_name: null, is_test: true,
      visits: 5, last_visit_at: "2026-11-08T12:00:00Z", emails_sent: 0, emails_delivered: 0, emails_opened: 0, last_opened_at: null, proposals_viewed: 0,
      legacy_last_active_at: "2026-11-02T13:26:00Z", legacy_last_active_kind: "app" },
  ],
  events: [
    { profile_id: "p-anna", kind: "visit", source: null, at: "2026-11-08T09:40:00Z", detail: { hit_count: 3 } },
    { profile_id: "p-anna", kind: "email_sent", source: "preconnect", at: "2026-11-03T09:20:00Z", detail: { proposals: 2 } },
    { profile_id: "p-anna", kind: "email_delivered", source: "preconnect", at: "2026-11-03T09:20:05Z", detail: {} },
    { profile_id: "p-test", kind: "visit", source: null, at: "2026-11-08T12:00:00Z", detail: { hit_count: 1 } },
  ],
};
vi.mock("../../lib/db.js", () => ({
  loadAdminActivityReport: vi.fn(async (range) => { calls.load.push(range); return REPORT; }),
  setActivityTestAccount: vi.fn(async (id, isTest) => { calls.setTest.push([id, isTest]); return { profile_id: id, is_test: isTest }; }),
}));
import AdminActivity, { buildSummaryCsv, buildEventsCsv, csvCell, filterAccounts, eventLabel } from "./AdminActivity.jsx";

let tree;
const text = (n) => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : (n?.children || []).map(text).join("");
const out = () => text(tree.toJSON());
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const byId = (id) => tree.root.findAllByProps({ "data-testid": id })[0];
const t = i18n.getFixedT("pl", "legacy");

describe("AdminActivity", () => {
  beforeEach(async () => { calls.load = []; calls.setTest = []; await i18n.changeLanguage("pl"); });
  afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

  it("ładuje ostatnie 30 dni, pokazuje datę rozpoczęcia zbierania i zastrzeżenia pomiaru", async () => {
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    expect(calls.load).toHaveLength(1);
    const span = new Date(calls.load[0].to) - new Date(calls.load[0].from);
    expect(Math.round(span / 864e5)).toBe(30);
    const s = out();
    expect(s).toContain("Historia wejść zbierana od 09.11.2026");
    expect(s).toContain("Brak zarejestrowanego wejścia lub otwarcia nie oznacza braku aktywności.");
    expect(s).toContain("Nie gwarantuje to trafienia do skrzynki głównej.");
    expect(s).toContain("Żadne z tych zdarzeń nie jest dowodem zainteresowania zakupem.");
    expect(s).toContain("Podgląd konta przez administratora nie jest zapisywany.");
    // ostrożne słownictwo w tabeli
    expect(s).toContain("brak zarejestrowanego wejścia");
    expect(s).toContain("brak zarejestrowanego otwarcia");
    expect(s).toContain("ustawione zbiorczo przy wdrożeniu, nie wejście");
    expect(s).not.toMatch(/nie wszedł|nie przeczytał|nie otworzył|zainteresowan[ya] zakupem\b(?! nie)/);
  });

  it("konta testowe ukryte domyślnie, widoczne po zaznaczeniu, z oznaczeniem TEST", async () => {
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    expect(out()).not.toContain("ZZZ TEST");
    expect(byId("activity-summary") && text(byId("activity-summary").children)).toContain("Konta: 2");
    await act(async () => { byId("activity-show-test").props.onChange({ target: { checked: true } }); });
    expect(out()).toContain("ZZZ TEST");
    expect(tree.root.findAllByProps({ "data-testid": "activity-test-badge" })).toHaveLength(1);
  });

  it("wiersz rozwija oś czasu; oznaczenie konta testowego woła RPC i odświeża raport", async () => {
    const fl = vi.fn();
    await act(async () => { tree = create(<AdminActivity fl={fl} />); });
    await flush();
    await act(async () => { byId("activity-row-p-anna").props.onClick(); });
    const tl = text(byId("activity-timeline-p-anna").children);
    expect(tl).toContain("Zarejestrowane wejście do aplikacji (wczytania w ciągu wizyty: 3)");
    expect(tl).toContain("Wysłano e-mail z propozycjami PreConnect (propozycje: 2)");
    expect(tl).toContain("Doręczono e-mail (przyjęty przez serwer odbiorcy)");
    await act(async () => { await byId("activity-toggle-test").props.onClick({ stopPropagation() {} }); });
    await flush();
    expect(calls.setTest).toEqual([["p-anna", true]]);
    expect(calls.load).toHaveLength(2);
    expect(fl).toHaveBeenCalledWith("Konto oznaczone jako testowe.", "success");
  });
});

describe("AdminActivity — logika i CSV", () => {
  it("filtry: rola, wyszukiwanie, konta testowe, tylko ze zdarzeniem", () => {
    const acc = REPORT.accounts;
    expect(filterAccounts(acc).map((a) => a.profile_id)).toEqual(["p-anna", "p-jan"]);
    expect(filterAccounts(acc, { showTest: true, role: "buyer" }).map((a) => a.profile_id)).toEqual(["p-anna", "p-test"]);
    expect(filterAccounts(acc, { query: "złoty" }).map((a) => a.profile_id)).toEqual(["p-jan"]);
    expect(filterAccounts(acc, { onlyWithEvents: true }).map((a) => a.profile_id)).toEqual(["p-anna"]);
  });

  it("CSV: średnik, BOM, cudzysłowy, ochrona przed formułami, bez IP i tokenów", () => {
    expect(csvCell('Sad; "Złoty"')).toBe('"Sad; ""Złoty"""');
    expect(csvCell("=jan@sad.test")).toBe("'=jan@sad.test");
    const csv = buildSummaryCsv(filterAccounts(REPORT.accounts), t, "pl");
    expect(csv.startsWith("﻿Rola;Firma / sieć;Osoba;E-mail;Konto testowe;Wejścia w okresie;Ostatnie zarejestrowane wejście")).toBe(true);
    expect(csv).toContain("Dostawca;\"Sad; \"\"Złoty\"\"\";Jan Dostawca;'=jan@sad.test;;0;brak zarejestrowanego wejścia;0;0;0");
    expect(csv).toContain("ustawione zbiorczo przy wdrożeniu, nie wejście");
    expect(csv).not.toMatch(/\bIP\b|token/i);
    const ev = buildEventsCsv(REPORT.events, new Map(REPORT.accounts.map((a) => [a.profile_id, a])), t, "pl");
    expect(ev.split("\r\n")[0]).toBe("﻿Data;Rola;Firma / sieć;Osoba;E-mail;Zdarzenie;Źródło");
    expect(ev).toContain("Sieć handlowa;Sieć Testowa;Anna Kupiec;anna@siec.test;Wysłano e-mail z propozycjami PreConnect (propozycje: 2);PreConnect");
  });

  it("etykiety zdarzeń rozróżniają wysłano / doręczono / otwarcie / wyświetlenie w aplikacji", () => {
    const l = (kind, extra = {}) => eventLabel({ kind, source: "preconnect", detail: {}, ...extra }, t);
    expect(l("email_opened")).toBe("Zarejestrowane otwarcie e-maila");
    expect(l("email_delivered")).toBe("Doręczono e-mail (przyjęty przez serwer odbiorcy)");
    expect(l("app_view", { detail: { channel: "app_detail", read_count: 2 } })).toBe("Wyświetlono szczegóły propozycji w aplikacji (razy: 2)");
    expect(l("email_sent", { source: "marketing", detail: { campaign: "Aktywacja" } })).toBe("Wysłano e-mail marketingowy: Aktywacja");
  });

  it("EN ma komplet tych samych kluczy co PL", async () => {
    const fs = await import("node:fs");
    const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" ? keys(v, p + k + ".") : [p + k]);
    const load = (l) => JSON.parse(fs.readFileSync(new URL(`../../i18n/${l}/legacy.json`, import.meta.url), "utf8"));
    expect(keys(load("en").admin.activity).sort()).toEqual(keys(load("pl").admin.activity).sort());
    expect(load("en").shell.sidebar.admin_activity).toBe("Activity");
  });
});
