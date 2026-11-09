// [feat/admin-activity] Zakładka „Aktywność”: ostrożne słownictwo, zastrzeżenia pomiaru, wyłącznik
// w bazie, konta testowe ukryte domyślnie, oś czasu ładowana per konto, spóźnione odpowiedzi
// ignorowane, eksport zablokowany przy ładowaniu/błędzie i pełny (stronami), CSV bez IP.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

const calls = vi.hoisted(() => ({ load: [], events: [], setTest: [], reportImpl: null, eventsImpl: null }));
const META = { from: "2026-10-10T00:00:00Z", to: "2026-11-09T00:00:00Z", enabled: true, collecting_since: "2026-11-09T08:00:00Z", retention_months: 12, dedupe_minutes: 30 };
const ACCOUNTS = [
  { profile_id: "p-anna", role: "buyer", name: "Anna Kupiec", email: "anna@siec.test", active: true, retailer_name: "Sieć Testowa", company_name: null, is_test: false,
    visits: 2, last_visit_at: "2026-11-08T10:00:00Z", emails_sent: 1, emails_delivered: 1, emails_opened: 0, last_opened_at: null, proposals_viewed: 3, events: 5,
    legacy_last_active_at: "2026-06-07T09:42:20Z", legacy_last_active_shared: 87 },
  { profile_id: "p-jan", role: "supplier", name: "Jan Dostawca", email: "=jan@sad.test", active: true, retailer_name: null, company_name: "Sad; \"Złoty\"", is_test: false,
    visits: 0, last_visit_at: null, emails_sent: 0, emails_delivered: 0, emails_opened: 0, last_opened_at: null, proposals_viewed: 0, events: 0,
    legacy_last_active_at: null, legacy_last_active_shared: null },
  { profile_id: "p-test", role: "buyer", name: "Test Kupiec", email: "artur+kupiec@test", active: true, retailer_name: "ZZZ TEST", company_name: null, is_test: true,
    visits: 5, last_visit_at: "2026-11-08T12:00:00Z", emails_sent: 0, emails_delivered: 0, emails_opened: 0, last_opened_at: null, proposals_viewed: 0, events: 5,
    legacy_last_active_at: "2026-11-02T13:26:00Z", legacy_last_active_shared: 1 },
];
const REPORT = { meta: META, accounts: ACCOUNTS };
const EVENTS = [
  { profile_id: "p-anna", kind: "visit", source: null, at: "2026-11-08T09:40:00Z", detail: { hit_count: 3 } },
  { profile_id: "p-anna", kind: "email_sent", source: "preconnect", at: "2026-11-03T09:20:00Z", detail: { proposals: 2 } },
  { profile_id: "p-anna", kind: "email_delivered", source: "preconnect", at: "2026-11-03T09:20:05Z", detail: {} },
];
vi.mock("../../lib/db.js", () => ({
  loadAdminActivityReport: vi.fn(async (range) => { calls.load.push(range); return calls.reportImpl ? calls.reportImpl(range) : REPORT; }),
  loadAdminActivityEvents: vi.fn(async (args) => { calls.events.push(args); return calls.eventsImpl ? calls.eventsImpl(args) : { total: EVENTS.length, events: EVENTS }; }),
  setActivityTestAccount: vi.fn(async (id, isTest) => { calls.setTest.push([id, isTest]); return { profile_id: id, is_test: isTest }; }),
}));
import AdminActivity, { buildSummaryCsv, buildEventsCsv, csvCell, filterAccounts, eventLabel, loadAllEvents, TIMELINE_LIMIT, EXPORT_MAX, rangeFor, zonedMidnightISO } from "./AdminActivity.jsx";

let tree;
const text = (n) => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : (n?.children || []).map(text).join("");
const out = () => text(tree.toJSON());
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const byId = (id) => tree.root.findAllByProps({ "data-testid": id })[0];
const t = i18n.getFixedT("pl", "legacy");
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

describe("AdminActivity", () => {
  beforeEach(async () => { calls.load = []; calls.events = []; calls.setTest = []; calls.reportImpl = null; calls.eventsImpl = null; await i18n.changeLanguage("pl"); });
  afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

  it("ładuje ostatnie 30 dni; pokazuje okres, początek zbierania i zastrzeżenia pomiaru", async () => {
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    expect(calls.load).toHaveLength(1);
    expect(Math.round((new Date(calls.load[0].to) - new Date(calls.load[0].from)) / 864e5)).toBe(30);
    await act(async () => { byId("activity-limits-toggle").props.onClick(); });   // rozwinięcie „Ograniczenia pomiaru”
    const s = out();
    expect(s).toContain("Okres: 10.10.2026");
    expect(s).toContain("Historia wejść zbierana od 09.11.2026");
    expect(s).toContain("Brak zarejestrowanego wejścia lub otwarcia nie oznacza braku aktywności.");
    expect(s).toContain("Nie gwarantuje to trafienia do skrzynki głównej.");
    expect(s).toContain("Żadne z tych zdarzeń nie jest dowodem zainteresowania zakupem.");
    expect(s).toContain("Podgląd konta przez administratora nie jest zapisywany.");
    expect(s).toContain("Każde zdarzenie jest liczone według własnej daty");
    // ograniczona historia wyświetleń propozycji opisana wprost, bez liczby wyświetleń
    expect(s).toContain("tylko datę pierwszego i ostatniego wyświetlenia. Nie ma w nim pełnej historii ani dokładnej liczby wyświetleń.");
    expect(s).toContain("Propozycje z zapisanym wyświetleniem");
    expect(s).not.toMatch(/wyświetleń łącznie|razy:/);
    expect(s).toContain("brak zarejestrowanego wejścia");
    expect(s).toContain("brak zarejestrowanego otwarcia");
    expect(s).toContain("ta sama data u 87 kont");
    expect(s).not.toMatch(/nie wszedł|nie przeczytał|nie otworzył|ustawione zbiorczo/);
    expect(byId("activity-disabled")).toBeUndefined();
  });

  it("„Ograniczenia pomiaru”: domyślnie zwinięte (krótkie ostrzeżenie), rozwijane i zwijane, komplet wyjaśnień w środku", async () => {
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    const toggle = () => byId("activity-limits-toggle");
    expect(text(byId("activity-disclaimer-short").children)).toContain("Pomiar jest niepełny: brak zarejestrowanego zdarzenia nie oznacza braku aktywności.");
    expect(text(toggle().children)).toContain("Ograniczenia pomiaru");
    expect(toggle().props["aria-expanded"]).toBe(false);
    expect(byId("activity-limits")).toBeUndefined();
    expect(out()).not.toContain("Nie gwarantuje to trafienia do skrzynki głównej.");
    await act(async () => { toggle().props.onClick(); });
    expect(toggle().props["aria-expanded"]).toBe(true);
    const items = byId("activity-limits").findAllByType("li").map((li) => text(li.children));
    expect(items).toHaveLength(8);
    for (const k of ["incomplete", "visit", "opened", "delivered", "app_view", "dates", "no_intent", "mail_scope"]) {
      expect(items).toContain(t("admin.activity.disclaimer." + k));
    }
    await act(async () => { toggle().props.onClick(); });
    expect(toggle().props["aria-expanded"]).toBe(false);
    expect(byId("activity-limits")).toBeUndefined();
    // tabela firm stoi zaraz pod filtrami — nie zasłania jej rozwinięty blok
    expect(byId("activity-summary")).toBeDefined();
  });

  it("wyłączony zapis w bazie jest widoczny w zakładce", async () => {
    calls.reportImpl = () => ({ ...REPORT, meta: { ...META, enabled: false, collecting_since: null } });
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    expect(text(byId("activity-disabled").children)).toContain("Zapis wejść jest wyłączony w bazie");
    expect(out()).toContain("Dziennik wejść nie zarejestrował jeszcze żadnego wejścia.");
  });

  it("konta testowe ukryte domyślnie, widoczne po zaznaczeniu, z oznaczeniem TEST", async () => {
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    expect(out()).not.toContain("ZZZ TEST");
    expect(text(byId("activity-summary").children)).toContain("Konta: 2");
    await act(async () => { byId("activity-show-test").props.onChange({ target: { checked: true } }); });
    expect(out()).toContain("ZZZ TEST");
    expect(tree.root.findAllByProps({ "data-testid": "activity-test-badge" })).toHaveLength(1);
  });

  it("oś czasu: jedno wywołanie dla tego konta i okresu raportu; niepełna lista jest jawnie opisana", async () => {
    calls.eventsImpl = () => ({ total: 1500, events: EVENTS });
    const fl = vi.fn();
    await act(async () => { tree = create(<AdminActivity fl={fl} />); });
    await flush();
    await act(async () => { byId("activity-row-p-anna").props.onClick(); });
    await flush();
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]).toMatchObject({ profileIds: ["p-anna"], limit: TIMELINE_LIMIT, offset: 0, from: META.from, to: META.to });
    const tl = text(byId("activity-timeline-p-anna").children);
    expect(tl).toContain("Zarejestrowane wejście do aplikacji (wczytania w ciągu wizyty: 3)");
    expect(tl).toContain("Wysłano e-mail z propozycjami PreConnect (propozycje: 2)");
    expect(tl).toContain("Doręczono e-mail (przyjęty przez serwer odbiorcy)");
    expect(text(byId("activity-timeline-partial").children)).toContain("Pokazano najnowsze 3 z 1500 zdarzeń. Zawęź okres");
  });

  it("oznaczenie konta testowego woła RPC i odświeża raport", async () => {
    const fl = vi.fn();
    await act(async () => { tree = create(<AdminActivity fl={fl} />); });
    await flush();
    await act(async () => { byId("activity-row-p-anna").props.onClick(); });
    await flush();
    await act(async () => { await byId("activity-toggle-test").props.onClick({ stopPropagation() {} }); });
    await flush();
    expect(calls.setTest).toEqual([["p-anna", true]]);
    expect(calls.load).toHaveLength(2);
    expect(fl).toHaveBeenCalledWith("Konto oznaczone jako testowe.", "success");
  });

  it("spóźniona odpowiedź dla poprzedniego okresu nie nadpisuje aktualnej; eksport zablokowany w trakcie", async () => {
    const first = deferred(), second = deferred();
    calls.reportImpl = () => (calls.load.length === 1 ? first.p : second.p);
    await act(async () => { tree = create(<AdminActivity />); });
    expect(byId("activity-export-summary").props.disabled).toBe(true);
    expect(byId("activity-export-events").props.disabled).toBe(true);
    await act(async () => { byId("activity-period-7").props.onClick(); });
    expect(calls.load).toHaveLength(2);
    const seven = { ...REPORT, meta: { ...META, from: "2026-11-02T00:00:00Z" }, accounts: [ACCOUNTS[1]] };
    await act(async () => { second.resolve(seven); });
    await flush();
    await act(async () => { first.resolve(REPORT); });          // stara (30 dni) przychodzi później
    await flush();
    expect(text(byId("activity-summary").children)).toContain("Okres: 02.11.2026");
    expect(out()).not.toContain("Anna Kupiec");
    expect(byId("activity-export-summary").props.disabled).toBe(false);
  });

  it("niepełny własny okres unieważnia poprzedni raport i oczekujące żądanie; eksport zablokowany", async () => {
    const pending = deferred();
    calls.reportImpl = () => (calls.load.length === 1 ? REPORT : pending.p);
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    expect(byId("activity-export-summary").props.disabled).toBe(false);
    await act(async () => { byId("activity-period-7").props.onClick(); });     // żądanie w toku
    expect(calls.load).toHaveLength(2);
    const custom = tree.root.findAll((n) => n.type === "button" && text(n.children) === "Własny okres")[0];
    await act(async () => { custom.props.onClick(); });                         // brak dat
    expect(text(byId("activity-need-dates").children)).toContain("Uzupełnij obie daty");
    expect(byId("activity-summary")).toBeUndefined();
    expect(byId("activity-export-summary").props.disabled).toBe(true);
    expect(byId("activity-export-events").props.disabled).toBe(true);
    await act(async () => { pending.resolve({ ...REPORT, meta: { ...META, from: "2026-11-02T00:00:00Z" } }); });   // spóźnione 7 dni
    await flush();
    expect(byId("activity-summary")).toBeUndefined();
    expect(byId("activity-export-summary").props.disabled).toBe(true);
    expect(calls.load).toHaveLength(2);
  });

  it("oznaczenie konta testowego w trakcie zmiany okresu odświeża AKTUALNY okres, nie poprzedni", async () => {
    const pendingMark = deferred();
    const { setActivityTestAccount } = await import("../../lib/db.js");
    setActivityTestAccount.mockImplementationOnce(async (id, isTest) => { calls.setTest.push([id, isTest]); return pendingMark.p; });
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    await act(async () => { byId("activity-row-p-anna").props.onClick(); });
    await flush();
    let marking;
    await act(async () => { marking = byId("activity-toggle-test").props.onClick({ stopPropagation() {} }); });
    await act(async () => { byId("activity-period-7").props.onClick(); });          // zmiana okresu w trakcie RPC
    await flush();
    const before = calls.load.length;
    await act(async () => { pendingMark.resolve({ profile_id: "p-anna", is_test: true }); await marking; });
    await flush();
    expect(calls.load.length).toBe(before + 1);
    const last = calls.load[calls.load.length - 1];
    expect(Math.round((new Date(last.to) - new Date(last.from)) / 864e5)).toBe(7);    // nie 30 dni
  });

  it("błąd wczytania: eksport zablokowany, brak starych danych", async () => {
    calls.reportImpl = () => { throw new Error("awaria"); };
    await act(async () => { tree = create(<AdminActivity />); });
    await flush();
    expect(out()).toContain("Nie udało się wczytać danych: awaria");
    expect(byId("activity-export-summary").props.disabled).toBe(true);
    expect(byId("activity-export-events").props.disabled).toBe(true);
    expect(byId("activity-summary")).toBeUndefined();
  });
});

describe("AdminActivity — logika i CSV", () => {
  it("własny okres: północ czasu polskiego, poprawnie w dni zmiany czasu, niezależnie od strefy przeglądarki", () => {
    // 25.10.2026: zmiana CEST→CET (doba 25 h); 29.03.2026: CET→CEST (doba 23 h)
    expect(rangeFor("custom", "2026-10-25", "2026-10-25")).toEqual({ from: "2026-10-24T22:00:00.000Z", to: "2026-10-25T23:00:00.000Z" });
    expect(rangeFor("custom", "2026-03-29", "2026-03-29")).toEqual({ from: "2026-03-28T23:00:00.000Z", to: "2026-03-29T22:00:00.000Z" });
    expect(rangeFor("custom", "2026-11-01", "2026-11-30")).toEqual({ from: "2026-10-31T23:00:00.000Z", to: "2026-11-30T23:00:00.000Z" });
    expect(rangeFor("custom", "2026-12-31", "2026-12-31").to).toBe("2026-12-31T23:00:00.000Z");     // przejście roku
    expect(zonedMidnightISO("2026-07-01", "America/New_York")).toBe("2026-07-01T04:00:00.000Z");   // ta sama funkcja w innej strefie
    expect(rangeFor("custom", "2026-11-05", "2026-11-04")).toBeNull();
    expect(rangeFor("custom", "2026-11-05", "")).toBeNull();
    expect(zonedMidnightISO("05.11.2026")).toBeNull();
  });

  it("filtry: rola, wyszukiwanie, konta testowe, tylko ze zdarzeniem w okresie", () => {
    expect(filterAccounts(ACCOUNTS).map((a) => a.profile_id)).toEqual(["p-anna", "p-jan"]);
    expect(filterAccounts(ACCOUNTS, { showTest: true, role: "buyer" }).map((a) => a.profile_id)).toEqual(["p-anna", "p-test"]);
    expect(filterAccounts(ACCOUNTS, { query: "złoty" }).map((a) => a.profile_id)).toEqual(["p-jan"]);
    expect(filterAccounts(ACCOUNTS, { onlyWithEvents: true }).map((a) => a.profile_id)).toEqual(["p-anna"]);
  });

  it("eksport zdarzeń: jedno wywołanie (jedna migawka); niepełny lub zbyt duży zbiór to błąd, nie obcięty plik", async () => {
    const all = Array.from({ length: 12 }, (_, i) => ({ profile_id: "p-anna", kind: "visit", at: `2026-11-0${1 + (i % 9)}T10:00:00Z`, detail: { hit_count: 1 } }));
    const seen = [];
    const load = async (args) => { seen.push(args); return { total: all.length, events: all }; };
    expect(await loadAllEvents({ from: "a", to: "b", profileIds: ["p-anna"], load })).toHaveLength(12);
    expect(seen).toEqual([{ from: "a", to: "b", profileIds: ["p-anna"], limit: EXPORT_MAX, offset: 0 }]);
    const short = async () => ({ total: 12, events: all.slice(0, 5) });
    await expect(loadAllEvents({ from: "a", to: "b", profileIds: [], load: short })).rejects.toThrow("incomplete_events");
    const huge = async () => ({ total: EXPORT_MAX + 1, events: all });
    await expect(loadAllEvents({ from: "a", to: "b", profileIds: [], load: huge })).rejects.toThrow("too_many_events");
  });

  it("CSV: okres i zastrzeżenie w nagłówku, średnik, BOM, cudzysłowy, ochrona przed formułami, bez IP", () => {
    expect(csvCell('Sad; "Złoty"')).toBe('"Sad; ""Złoty"""');
    expect(csvCell("=jan@sad.test")).toBe("'=jan@sad.test");
    const csv = buildSummaryCsv(filterAccounts(ACCOUNTS), META, t, "pl");
    const lines = csv.split("\r\n");
    expect(lines[0]).toMatch(/^﻿Okres: 10\.10\.2026/);
    expect(lines[1]).toContain("brak zarejestrowanego zdarzenia nie oznacza braku aktywności");
    expect(lines[2]).toMatch(/^Rola;Firma \/ sieć;Osoba;E-mail;Konto testowe;Wejścia w okresie;Ostatnie zarejestrowane wejście/);
    expect(csv).toContain("Dostawca;\"Sad; \"\"Złoty\"\"\";Jan Dostawca;'=jan@sad.test;;0;brak zarejestrowanego wejścia;0;0;0");
    expect(csv).toContain(";87\r\n");
    expect(csv).not.toMatch(/\bIP\b|token/i);
    const ev = buildEventsCsv(EVENTS, new Map(ACCOUNTS.map((a) => [a.profile_id, a])), META, t, "pl");
    expect(ev.split("\r\n")[2]).toBe("Data;Rola;Firma / sieć;Osoba;E-mail;Zdarzenie;Źródło");
    expect(ev).toContain("Sieć handlowa;Sieć Testowa;Anna Kupiec;anna@siec.test;Wysłano e-mail z propozycjami PreConnect (propozycje: 2);PreConnect");
  });

  it("etykiety zdarzeń rozróżniają wysłano / doręczono / otwarcie / wyświetlenie w aplikacji", () => {
    const l = (kind, extra = {}) => eventLabel({ kind, source: "preconnect", detail: {}, ...extra }, t);
    expect(l("email_opened")).toBe("Zarejestrowane otwarcie e-maila");
    expect(l("email_delivered")).toBe("Doręczono e-mail (przyjęty przez serwer odbiorcy)");
    expect(l("app_view_first", { detail: { read_count_total: 7 } })).toBe("Pierwsze zapisane wyświetlenie propozycji w aplikacji");
    expect(l("app_view_last", { detail: { read_count_total: 7 } })).toBe("Ostatnie zapisane wyświetlenie propozycji w aplikacji");
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
