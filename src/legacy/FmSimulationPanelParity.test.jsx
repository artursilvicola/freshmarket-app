// Kontrola złota symulacji: lokalnie uruchomiony KOD PANELU (App z PreconnectFM.jsx) zasilony tą samą
// kopią danych (bez bazy, wszystkie funkcje db zamockowane, zero zapisów) musi dać identyczne wejścia
// i identyczny wynik algorytmu jak scripts/fm-simulate-lib.mjs (wariant A).
// Uruchomienie: FM_SIM_INPUT=<ścieżka do symulacja-wejscie.json> npx vitest run src/legacy/FmSimulationPanelParity.test.jsx
// Bez FM_SIM_INPUT test jest pomijany (nie wymaga danych produkcyjnych w CI).
import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const H = vi.hoisted(() => {
  // Minimalny szkielet DOM (środowisko testów = node): App rejestruje visibilitychange / czyta localStorage.
  const noop = () => {};
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
  if (typeof globalThis.document === "undefined") globalThis.document = { visibilityState: "visible", hidden: false, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, querySelector: () => null, querySelectorAll: () => [], body: { style: {} }, documentElement: { lang: "pl", style: {} }, title: "" };
  if (typeof globalThis.window === "undefined") globalThis.window = { location: { pathname: "/", href: "http://localhost/", search: "", hash: "", reload: noop }, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, localStorage, sessionStorage: localStorage, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), scrollTo: noop, innerWidth: 1280, innerHeight: 900, confirm: () => false, alert: noop, open: noop, setTimeout, clearTimeout, setInterval, clearInterval };
  if (typeof globalThis.localStorage === "undefined") globalThis.localStorage = localStorage;
  if (typeof globalThis.navigator === "undefined") globalThis.navigator = { userAgent: "node", language: "pl" };
  const p = process.env.FM_SIM_INPUT;
  const snapshot = p ? JSON.parse(require("node:fs").readFileSync(p, "utf8")) : null;
  return { snapshot };
});

vi.mock("../lib/supabase", () => ({ supabase: {}, isSupabaseConfigured: true }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: k => k, changeLanguage: async () => {}, on: () => {}, off: () => {} } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: "pl", changeLanguage: async () => {} } }),
  Trans: ({ i18nKey }) => i18nKey,
}));
vi.mock("../lib/fm-queue.js", async (importOriginal) => {
  const orig = await importOriginal();
  const { queueCapacityByRetailer } = await import("../../scripts/fm-simulate-lib.mjs");
  const S = H.snapshot;
  return { ...orig, getFmQueueCapacityByRetailer: vi.fn(async () => S ? queueCapacityByRetailer(S.tables.fm_queue_groups || [], S.tables.fm_stations || []) : {}) };
});
vi.mock("../lib/db", async (importOriginal) => {
  const orig = await importOriginal();
  const S = H.snapshot;
  const mocked = {};
  for (const [k, v] of Object.entries(orig)) {
    mocked[k] = (typeof v === "function" && v.constructor && v.constructor.name === "AsyncFunction") ? vi.fn(async () => (/^(get|list|fetch|load|read)/.test(k) ? [] : null)) : v;
  }
  if (S) {
    mocked.getCompanies = vi.fn(async () => S.tables.companies.map(c => ({ ...c, contacts: [], certs: [] })));
    mocked.getRetailers = vi.fn(async () => S.tables.retailers.map(r => ({ ...r, contacts: [], buyers: [] })));
    mocked.getFmSettings = vi.fn(async () => (S.tables.fm_settings && S.tables.fm_settings[0]) || null);
    mocked.getAllCompanyTargetRetailers = vi.fn(async () => S.tables.company_target_retailers.map(r => ({ ...r, retailer: null })));
    mocked.getFmResps = vi.fn(async () => S.tables.fm_resps);
    mocked.getCompanyHiddenRetailers = vi.fn(async () => S.tables.company_hidden_retailers || []);
    mocked.getFmSchedule = vi.fn(async () => null);
  }
  return mocked;
});

import App from "./PreconnectFM.jsx";
import { buildFMData } from "../lib/fm-algo.js";
import { buildInputs } from "../../scripts/fm-simulate-lib.mjs";

const tick = async (ms = 40) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
const ADMIN = { id: "5b9f6f8a-0000-4000-8000-000000000001", email: "parity.admin@local.invalid", name: "Parity Admin", role: "admin" };

describe.skipIf(!H.snapshot)("parytet symulacji z kodem panelu (wariant A)", () => {
  it("wejścia i wynik buildFMData z App są identyczne jak w fm-simulate-lib", async () => {
    const errors = [];
    const origError = console.error; console.error = (...a) => errors.push(String(a[0]).slice(0, 120));
    let tree;
    try {
      act(() => { tree = create(<App initialRole="admin" currentUser={ADMIN} />); });
      for (let i = 0; i < 60; i++) { await tick(); }
      // nawigacja do „Spotkania FM 2026” jak w panelu
      const label = tree.root.findAll(n => n.type === "span" && n.children.length === 1 && n.children[0] === "shell.sidebar.admin_fm_meetings")[0];
      expect(label, "brak pozycji menu Spotkania FM 2026").toBeTruthy();
      let node = label.parent; while (node && !node.props.onClick) node = node.parent;
      act(() => node.props.onClick());
      let page = null;
      for (let i = 0; i < 40 && !page; i++) { await tick(); page = tree.root.findAll(n => n.props && n.props.fmAlgo && n.props.fmSuppliers && n.props.fmChains)[0] || null; }
      expect(page, "PageAdminFM nie otrzymał fmAlgo").toBeTruthy();
      expect(page.props.fmInputsReady, "panel nie uznał wejść za kompletne").toBe(true);
      const app = { suppliers: page.props.fmSuppliers, chains: page.props.fmChains, prefs: page.props.fmPrefs, resps: page.props.fmResps, algo: page.props.fmAlgo };
      const lib = buildInputs(H.snapshot);
      const libAlgo = buildFMData(lib.prefs, lib.resps, lib.chains, lib.suppliers);
      const pickS = s => ({ id: s.id, pkg: s.pkg, fmPackages: s.fmPackages, paymentDate: s.paymentDate, fmB2bEnabled: s.fmB2bEnabled, _sortIdx: s._sortIdx });
      const pickC = c => ({ id: c.id, stations: c.stations ?? null });
      expect(app.suppliers.map(pickS)).toEqual(lib.suppliers.map(pickS));
      expect(app.chains.map(pickC)).toEqual(lib.chains.map(pickC));
      expect(app.prefs).toEqual(lib.prefs);
      expect(app.resps).toEqual(lib.resps);
      expect(JSON.stringify(app.algo.res)).toBe(JSON.stringify(libAlgo.res));
      expect(JSON.stringify(app.algo.nums)).toBe(JSON.stringify(libAlgo.nums));
      expect(JSON.stringify(app.algo.cq)).toBe(JSON.stringify(libAlgo.cq));
      expect(JSON.stringify(app.algo.cs)).toBe(JSON.stringify(libAlgo.cs));
      expect(app.algo.warnings.map(w => w.type + ":" + (w.chainId || w.supplierId || ""))).toEqual(libAlgo.warnings.map(w => w.type + ":" + (w.chainId || w.supplierId || "")));
      const meetings = Object.values(app.algo.res).reduce((s, r) => s + r.m.length, 0);
      console.log(`PARYTET OK: firm=${app.suppliers.length} sieci=${app.chains.length} spotkań=${meetings} ostrzeżeń=${app.algo.warnings.length}`);
    } finally {
      console.error = origError;
      if (tree) act(() => tree.unmount());
    }
  }, 120000);
});
