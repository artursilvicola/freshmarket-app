import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { canRegisterBuyerSeen, pendingBuyerSeenSends, createSeenSubmissionTracker, isBuyerSeenPending, isManualAwaitingBuyerRead, isNewForBuyer } from "./buyer-seen.js";
import { buyerReadScope } from "../../netlify/functions/_shared/buyer-read-scope.js";

const buyerUser = { id: "u-buyer", role: "buyer", retailer_id: 100 };
const buyerAccount = { id: "u-buyer", role: "buyer", retailerId: 100 };

describe("canRegisterBuyerSeen — kto rejestruje odczyt propozycji", () => {
  it("zalogowany kupiec na własnym koncie: tak", () => {
    expect(canRegisterBuyerSeen({ sessionRole: "buyer", account: buyerAccount, currentUser: buyerUser })).toBe(true);
  });

  it("administrator w podglądzie konta kupca: nie", () => {
    const admin = { id: "u-admin", role: "admin" };
    expect(canRegisterBuyerSeen({ sessionRole: "admin", account: buyerAccount, currentUser: admin })).toBe(false);
  });

  it("administrator z historycznym retailer_id nadal nie jest kupcem", () => {
    const admin = { id: "u-buyer", role: "admin", retailer_id: 100 };
    expect(canRegisterBuyerSeen({ sessionRole: "admin", account: buyerAccount, currentUser: admin })).toBe(false);
  });

  it("konto innego kupca tej samej sieci: nie", () => {
    const other = { id: "u-other", role: "buyer", retailerId: 100 };
    expect(canRegisterBuyerSeen({ sessionRole: "buyer", account: other, currentUser: buyerUser })).toBe(false);
  });

  it("brak danych sesji albo konto dostawcy: nie", () => {
    expect(canRegisterBuyerSeen({ sessionRole: "buyer", account: buyerAccount, currentUser: null })).toBe(false);
    expect(canRegisterBuyerSeen({ sessionRole: "supplier", account: { id: "c1", role: "supplier" }, currentUser: { id: "u1" } })).toBe(false);
  });
});

describe("pendingBuyerSeenSends — co rozlicza wejście kupca na platformę", () => {
  const sends = [
    { id: 1, retailerId: 100, status: "sent" },
    { id: 2, retailerId: 100, status: "opened" },
    { id: 3, retailerId: 100, status: "read" },
    { id: 4, retailerId: 100, status: "unread_expired" },
    { id: 5, retailerId: 100, status: "queued" },
    { id: 6, retailerId: 200, status: "sent" },
  ];

  it("tylko wysłane i jeszcze nierozliczone propozycje własnej sieci", () => {
    const out = pendingBuyerSeenSends({ sends, buyerRetailerId: 100, retailers: [{ id: 100, active: true }], buyer: { active: true } });
    expect(out.map((s) => s.id)).toEqual([1, 2]);
  });

  it("bez sieci, przy nieaktywnej sieci albo nieaktywnym kupcu: nic", () => {
    expect(pendingBuyerSeenSends({ sends, buyerRetailerId: null, retailers: [], buyer: {} })).toEqual([]);
    expect(pendingBuyerSeenSends({ sends, buyerRetailerId: 100, retailers: [{ id: 100, active: false }], buyer: {} })).toEqual([]);
    expect(pendingBuyerSeenSends({ sends, buyerRetailerId: 100, retailers: [{ id: 100 }], buyer: { active: false } })).toEqual([]);
  });

  it("znosi brak danych", () => {
    expect(pendingBuyerSeenSends({ sends: null, buyerRetailerId: 100 })).toEqual([]);
  });
});

describe("buyerReadScope — zabezpieczenie po stronie funkcji", () => {
  it("kupiec z siecią: odczyt liczony, ograniczony do własnej sieci", () => {
    expect(buyerReadScope({ role: "buyer", retailer_id: 100 })).toEqual({ counts: true, allowedRetailerId: 100 });
  });

  it("administrator: nic nie jest rozliczane", () => {
    expect(buyerReadScope({ role: "admin", retailer_id: null })).toEqual({ counts: false, reason: "admin_preview" });
    expect(buyerReadScope({ role: "admin", retailer_id: 100 }).counts).toBe(false);
  });

  it("kupiec bez sieci nie dostaje dostępu do cudzych wysyłek", () => {
    expect(buyerReadScope({ role: "buyer", retailer_id: null })).toEqual({ counts: false, reason: "buyer_without_retailer" });
  });

  it("inne role i brak profilu: nie", () => {
    expect(buyerReadScope({ role: "supplier" }).counts).toBe(false);
    expect(buyerReadScope(null).counts).toBe(false);
  });
});

describe("spięcie w kodzie (strażnik regresji)", () => {
  const app = readFileSync(new URL("../legacy/PreconnectFM.jsx", import.meta.url), "utf8");
  const fnBody = (name) => {
    const start = app.indexOf(`async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return app.slice(start, start + 600);
  };

  it("oba wywołania odczytu zaczynają od blokady podglądu", () => {
    expect(fnBody("markBuyerPreconnectSeen")).toMatch(/if \(!buyerSeenAllowed\) return;/);
    expect(fnBody("markSendOpened")).toMatch(/if \(!buyerSeenAllowed\) return;/);
  });

  it("wejście kupca na platformę zgłasza oczekujące propozycje", () => {
    expect(app).toMatch(/markBuyerPreconnectSeen\(buyerEntryPending, "app_list"\)/);
  });

  it("funkcje serwera nie przepuszczają już roli admin bez ograniczenia sieci", () => {
    for (const f of ["mark-buyer-preconnect-seen.js", "notify-supplier-read.js"]) {
      const src = readFileSync(new URL(`../../netlify/functions/${f}`, import.meta.url), "utf8");
      expect(src).toMatch(/buyerReadScope\(profile\)/);
      expect(src).not.toMatch(/profile\.role === "buyer" \? profile\.retailer_id : null/);
    }
  });
});

// ── review Codexa 13.11, P2: błąd pojedynczej pozycji przy HTTP 200 nie może blokować ponowienia ──
const sent = (...ids) => ids.map((id) => ({ id, status: "sent" }));

describe("createSeenSubmissionTracker — rozstrzyganie zgłoszeń per pozycja", () => {
  it("mieszany wynik: ponawiana jest tylko pozycja nieudana, udane nie idą drugi raz", () => {
    const t = createSeenSubmissionTracker();
    const first = t.take(sent(1, 2, 3));
    expect(first.map((x) => x.id)).toEqual([1, 2, 3]);
    const { failed } = t.settle(first, [{ legacy_id: 1, ok: true, status: "read" }, { legacy_id: 2, ok: false, status: "error" }, { legacy_id: 3, ok: true, status: "skipped" }]);
    expect(failed).toEqual([2]);
    expect(t.take(sent(1, 2, 3)).map((x) => x.id)).toEqual([2]);
    expect(t.isDone(1)).toBe(true); expect(t.isDone(2)).toBe(false);
  });

  it("pozycja pominięta w odpowiedzi albo odpowiedź bez listy: wraca do puli", () => {
    const t = createSeenSubmissionTracker();
    let taken = t.take(sent(1, 2));
    expect(t.settle(taken, [{ legacy_id: 1, ok: true }]).failed).toEqual([2]);
    for (const malformed of [undefined, null, {}, "ok", [null, 7, { ok: true }, { legacy_id: 2 }]]) {
      const tr = createSeenSubmissionTracker();
      taken = tr.take(sent(5, 6));
      expect(tr.settle(taken, malformed).failed).toEqual([5, 6]);
      expect(tr.take(sent(5, 6)).map((x) => x.id)).toEqual([5, 6]);
    }
  });

  it("identyfikator z odpowiedzi może być tekstem albo liczbą", () => {
    const t = createSeenSubmissionTracker();
    const taken = t.take(sent(77));
    expect(t.settle(taken, [{ legacy_id: "77", ok: true }]).failed).toEqual([]);
    expect(t.take(sent(77))).toEqual([]);
  });

  it("ponowienia są ograniczone (domyślnie 3 próby na pozycję)", () => {
    const t = createSeenSubmissionTracker();
    for (let i = 0; i < 3; i++) {
      const taken = t.take(sent(9));
      expect(taken.length).toBe(1);
      t.settle(taken, [{ legacy_id: 9, ok: false, status: "error" }]);
    }
    expect(t.take(sent(9))).toEqual([]);
    expect(t.attemptsOf(9)).toBe(3);
  });

  it("pozycja w trakcie wysyłki nie idzie równolegle drugi raz; nieudane żądanie zwalnia wszystko", () => {
    const t = createSeenSubmissionTracker();
    const taken = t.take(sent(1, 2));
    expect(t.take(sent(1, 2))).toEqual([]);
    t.release(taken);
    expect(t.take(sent(1, 2)).map((x) => x.id)).toEqual([1, 2]);
  });

  it("pomija pozycje już przeczytane i śmieci", () => {
    const t = createSeenSubmissionTracker();
    expect(t.take([{ id: 1, status: "read" }, null, { id: 2, status: "opened" }]).map((x) => x.id)).toEqual([2]);
    expect(t.take(null)).toEqual([]);
  });
});

describe("markBuyerPreconnectSeen — prawdziwa funkcja z panelu, serwer na atrapie", () => {
  // Treść funkcji jest wycinana z PreconnectFM.jsx i wykonywana z podstawionymi zależnościami,
  // tak jak w reprodukcji recenzenta: liczy się faktyczny kod, nie jego opis.
  const src = readFileSync(new URL("../legacy/PreconnectFM.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("  async function markBuyerPreconnectSeen(");
  const body = src.slice(start, src.indexOf("\n  }\n", start) + 5);
  function harness({ allowed = true, responses }) {
    const calls = [];
    const applied = [];
    let n = 0;
    const fetchStub = async (url, init) => {
      const ids = JSON.parse(init.body).legacy_ids;
      calls.push(ids);
      const r = responses[Math.min(n++, responses.length - 1)];
      if (r === "network") throw new Error("sieć");
      return { ok: r.http ? r.http < 400 : true, status: r.http || 200, json: async () => (typeof r.body === "function" ? r.body(ids) : r.body) };
    };
    const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } };
    const tracker = { current: createSeenSubmissionTracker() };
    const quiet = { warn: vi.fn(), log: vi.fn() };
    // eslint-disable-next-line no-new-func
    const fn = new Function("buyerSeenAllowed", "buyerSeenTrackerRef", "supabase", "fetch", "applySeenResultsToState", "console", `${body}\n return markBuyerPreconnectSeen;`)(
      allowed, tracker, supabase, fetchStub, (rows) => applied.push(rows), quiet);
    return { fn, calls, applied, tracker: tracker.current, warn: quiet.warn };
  }

  it("funkcja jest samodzielnym kodem JS (bez JSX) i korzysta ze śledzenia per pozycja", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/tracker\.settle\(candidates, body\?\.results\)/);
    expect(body).not.toMatch(/buyerSeenSubmittedRef/);
  });

  it("reprodukcja recenzenta: HTTP 200 z błędem pozycji 77 → druga próba jest wykonywana", async () => {
    const h = harness({ responses: [{ body: { results: [{ legacy_id: 77, ok: false, status: "error" }] } }] });
    await h.fn(sent(77)); await h.fn(sent(77));
    expect(h.calls).toEqual([[77], [77]]);
    expect(h.tracker.isDone(77)).toBe(false);
  });

  it("mieszany wynik: ponawiana tylko nieudana pozycja; po sukcesie nic już nie idzie", async () => {
    const h = harness({ responses: [
      { body: { results: [{ legacy_id: 1, ok: true, status: "read", data: {} }, { legacy_id: 2, ok: false, status: "error" }, { legacy_id: 3, ok: true, status: "read", data: {} }] } },
      { body: { results: [{ legacy_id: 2, ok: true, status: "read", data: {} }] } },
    ] });
    await h.fn(sent(1, 2, 3)); await h.fn(sent(1, 2, 3)); await h.fn(sent(1, 2, 3));
    expect(h.calls).toEqual([[1, 2, 3], [2]]);
    expect(h.applied.length).toBe(2);
  });

  it("odpowiedź bez listy wyników albo z listą niepełną: brakujące pozycje są ponawiane", async () => {
    const h = harness({ responses: [{ body: {} }, { body: { results: [{ legacy_id: 5, ok: true, data: {} }] } }, { body: { results: [{ legacy_id: 6, ok: true, data: {} }] } }] });
    await h.fn(sent(5, 6)); await h.fn(sent(5, 6)); await h.fn(sent(5, 6)); await h.fn(sent(5, 6));
    expect(h.calls).toEqual([[5, 6], [5, 6], [6]]);
    expect(h.applied[0]).toEqual([]);
  });

  it("stały błąd pozycji: najwyżej 3 żądania w sesji", async () => {
    const h = harness({ responses: [{ body: { results: [{ legacy_id: 9, ok: false, status: "error" }] } }] });
    for (let i = 0; i < 6; i++) await h.fn(sent(9));
    expect(h.calls.length).toBe(3);
  });

  it("błąd HTTP i błąd sieci zwalniają blokadę; udane rozliczenie nie jest powtarzane", async () => {
    const h = harness({ responses: [{ http: 500, body: { error: "x" } }, "network", { body: { results: [{ legacy_id: 4, ok: true, status: "read", data: {} }] } }] });
    await h.fn(sent(4)); await h.fn(sent(4)); await h.fn(sent(4)); await h.fn(sent(4));
    expect(h.calls).toEqual([[4], [4], [4]]);
    expect(h.tracker.isDone(4)).toBe(true);
  });

  it("podgląd cudzego konta: żadnego żądania", async () => {
    const h = harness({ allowed: false, responses: [{ body: { results: [] } }] });
    await h.fn(sent(1));
    expect(h.calls).toEqual([]);
  });
});

// ── review Codexa 13.11, 2. runda — P1: panel kupca musi zgłaszać odczyt propozycji potwierdzonych ręcznie ──
// (wejście, lista i szczegół), bo od tego odczytu zależy, czy cofnięcie potwierdzenia zwróci kredyt.
const manualCharged = (id, extra = {}) => ({ id, retailerId: 100, status: "read_manual", readType: "manual_phone", billingStatus: "charged", chargeAt: "2026-11-13T10:00:00.000Z", chargeChannel: "manual", ...extra });

describe("które propozycje potwierdzone ręcznie panel zgłasza jako odczyt kupca", () => {
  it("rozliczona ręcznym potwierdzeniem, bez odczytu w aplikacji: TAK", () => {
    expect(isManualAwaitingBuyerRead(manualCharged(1))).toBe(true);
    expect(isBuyerSeenPending(manualCharged(1))).toBe(true);
  });

  it("po samym otwarciu maila nadal TAK (odczytu w aplikacji jeszcze nie było)", () => {
    expect(isManualAwaitingBuyerRead(manualCharged(1, { buyerSeenAt: "x", buyerSeenChannel: "email", emailOpenedAt: "x" }))).toBe(true);
  });

  it("odczyt w aplikacji już zapisany: NIE (jedno zgłoszenie wystarczy)", () => {
    expect(isManualAwaitingBuyerRead(manualCharged(1, { buyerAppSeenAt: "2026-11-13T11:00:00.000Z" }))).toBe(false);
  });

  it("nierozliczone read_manual (stare albo bez wolnego kredytu): NIE — zapis odczytu nie może rozszerzyć rozliczeń", () => {
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", readType: "manual_phone" })).toBe(false); // historyczne, bez kredytu
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", billingStatus: "no_package_available" })).toBe(false); // potwierdzone bez wolnego kredytu
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", chargeChannel: "manual" })).toBe(false); // znacznik bez rozliczenia
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", chargeChannel: "email", emailOpenedAt: "x" })).toBe(false); // mail otwarty, ale bez rozliczenia
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", data: { billingStatus: "refunded" } })).toBe(false);
    expect(isBuyerSeenPending({ id: 1, status: "read_manual" })).toBe(false);
  });

  it("[P2, 3. runda] rozliczone wcześniejszym otwarciem maila, potem potwierdzone ręcznie: TAK", () => {
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", billingStatus: "charged", chargeAt: "x" })).toBe(true); // bez znacznika kanału
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", billingStatus: "charged", chargeAt: "x", chargeChannel: "email" })).toBe(true);
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", data: { chargeTxId: "tx", chargeChannel: "email", buyerSeenChannel: "email" } })).toBe(true);
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", billingStatus: "charged", chargeAt: "x", chargeChannel: "email", buyerAppSeenAt: "y" })).toBe(false); // odczyt w aplikacji już zapisany
  });

  it("inne statusy bez zmian: wysłane i otwarte zgłaszane, przeczytane i wygasłe nie", () => {
    expect(isBuyerSeenPending({ id: 1, status: "sent" })).toBe(true);
    expect(isBuyerSeenPending({ id: 1, status: "opened" })).toBe(true);
    for (const st of ["read", "unread_expired", "refunded", "queued"]) expect(isBuyerSeenPending({ id: 1, status: st, chargeChannel: "manual", chargeAt: "x" })).toBe(false);
    expect(isBuyerSeenPending(null)).toBe(false);
  });

  it("pola w `data` (wiersz z bazy) działają tak samo jak na wierzchu", () => {
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", data: { chargeChannel: "manual", billingStatus: "charged" } })).toBe(true);
    expect(isManualAwaitingBuyerRead({ id: 1, status: "read_manual", data: { chargeChannel: "manual", billingStatus: "charged", buyerAppSeenAt: "x" } })).toBe(false);
  });

  it("licznik „nowych” na pulpicie kupca nie obejmuje potwierdzonych ręcznie", () => {
    expect(isNewForBuyer({ status: "sent" })).toBe(true);
    expect(isNewForBuyer(manualCharged(1))).toBe(false);
  });

  it("wejście kupca: oczekujące obejmują potwierdzoną ręcznie i rozliczoną, pomijają historyczną", () => {
    const sends = [{ id: 1, retailerId: 100, status: "sent" }, manualCharged(2), { id: 3, retailerId: 100, status: "read_manual" }, manualCharged(4, { retailerId: 200 }), { id: 5, retailerId: 100, status: "read" }];
    const out = pendingBuyerSeenSends({ sends, buyerRetailerId: 100, retailers: [{ id: 100, active: true }], buyer: { active: true } });
    expect(out.map((x) => x.id)).toEqual([1, 2]);
    expect(out.filter(isNewForBuyer).length).toBe(1);
  });

  it("śledzenie zgłoszeń przyjmuje potwierdzoną ręcznie, a historycznej nie", () => {
    const t = createSeenSubmissionTracker();
    expect(t.take([manualCharged(7), { id: 8, status: "read_manual" }]).map((x) => x.id)).toEqual([7]);
  });
});

describe("panel kupca — prawdziwe funkcje: wejście, lista i szczegół zgłaszają odczyt propozycji potwierdzonej ręcznie", () => {
  const src = readFileSync(new URL("../legacy/PreconnectFM.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const cut = (name) => { const a = src.indexOf(`  async function ${name}(`); return src.slice(a, src.indexOf("\n  }\n", a) + 5); };
  const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } };
  const quiet = { warn() {}, log() {} };
  // serwer na atrapie: zapisuje odczyt (buyerAppSeenAt), nie zmienia statusu read_manual, nie pobiera drugi raz
  function server() {
    const calls = [];
    const fetchStub = async (url, init) => {
      const b = JSON.parse(init.body);
      const ids = b.legacy_ids || [b.legacy_id];
      calls.push({ fn: url.split("/").pop(), ids });
      return { ok: true, status: 200, json: async () => ({ ok: true, results: ids.map((id) => ({ legacy_id: id, ok: true, status: "read_manual", data: { buyerAppSeenAt: "2026-11-13T11:00:00.000Z", buyerAppSeenChannel: "app_list" }, billing: { charged: false, alreadyCharged: true, billingStatus: "charged" } })) }) };
    };
    return { calls, fetchStub };
  }

  it("wejście i lista (markBuyerPreconnectSeen): jedno żądanie z propozycją potwierdzoną ręcznie, bez powtórki", async () => {
    const { calls, fetchStub } = server();
    const applied = [];
    const tracker = { current: createSeenSubmissionTracker() };
    // eslint-disable-next-line no-new-func
    const fn = new Function("buyerSeenAllowed", "buyerSeenTrackerRef", "supabase", "fetch", "applySeenResultsToState", "console", `${cut("markBuyerPreconnectSeen")}\n return markBuyerPreconnectSeen;`)(true, tracker, supabase, fetchStub, (r) => applied.push(r), quiet);
    const entry = pendingBuyerSeenSends({ sends: [manualCharged(77), { id: 78, retailerId: 100, status: "read_manual" }], buyerRetailerId: 100, retailers: [], buyer: {} });
    await fn(entry, "app_list");                       // wejście kupca
    await fn([manualCharged(77)].filter(isBuyerSeenPending), "app_list"); // lista: ten sam filtr co w PageBuyerOffers
    expect(calls).toEqual([{ fn: "mark-buyer-preconnect-seen", ids: [77] }]);
    expect(applied[0][0].billing.charged).toBe(false);
    expect(tracker.current.isDone(77)).toBe(true);
  });

  it("lista w kodzie panelu używa wspólnego filtra w obu miejscach", () => {
    const a = src.indexOf("function PageBuyerOffers(");
    const block = src.slice(a, src.indexOf("const getDisplayCo", a));
    expect(block).toMatch(/\.filter\(isBuyerSeenPending\)/);
    expect(block).toMatch(/mySends\.filter\(s => isBuyerSeenPending\(s\) && !seenListRef\.current\.has\(s\.id\)\)/);
    expect(block).not.toMatch(/\["sent","opened"\]\.includes\(s\.status\)/);
  });

  function detailHarness({ allowed = true } = {}) {
    const { calls, fetchStub } = server();
    const state = { dbRead: [], setSends: 0, applied: [] };
    const tracker = { current: createSeenSubmissionTracker() };
    // eslint-disable-next-line no-new-func
    const fn = new Function("buyerSeenAllowed", "buyerSeenTrackerRef", "isManualAwaitingBuyerRead", "supabase", "fetch", "applySeenResultsToState", "dbMarkLegacySendRead", "nowStr", "_setSendsRaw", "console", `${cut("markSendOpened")}\n return markSendOpened;`)(
      allowed, tracker, isManualAwaitingBuyerRead, supabase, fetchStub, (r) => state.applied.push(r), async (id) => { state.dbRead.push(id); }, () => "teraz", () => { state.setSends += 1; }, quiet);
    return { fn, calls, state, tracker: tracker.current };
  }

  it("szczegół (markSendOpened): odczyt zapisany jednym żądaniem, status lokalnie NIE zmienia się na „read”", async () => {
    const h = detailHarness();
    await h.fn(manualCharged(77)); await h.fn(manualCharged(77)); await h.fn(manualCharged(77));
    expect(h.calls).toEqual([{ fn: "notify-supplier-read", ids: [77] }]);
    expect(h.state.dbRead).toEqual([]);      // RPC „sent → read” nie dotyczy potwierdzonych ręcznie
    expect(h.state.setSends).toBe(0);        // bez ręcznego nadpisania statusu w stanie panelu
    expect(h.state.applied.length).toBe(1);  // stan z odpowiedzi serwera (buyerAppSeenAt)
  });

  it("szczegół: historyczna nierozliczona read_manual nie jest zgłaszana; podgląd admina też nie", async () => {
    const h = detailHarness();
    await h.fn({ id: 5, status: "read_manual", readType: "manual_phone" });
    await h.fn({ id: 6, status: "read_manual", billingStatus: "no_package_available" });
    expect(h.calls).toEqual([]);
    const preview = detailHarness({ allowed: false });
    await preview.fn(manualCharged(77));
    expect(preview.calls).toEqual([]);
  });

  it("szczegół: zwykła wysłana propozycja działa jak dotąd", async () => {
    const h = detailHarness();
    await h.fn({ id: 9, status: "sent" });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.state.dbRead).toEqual([9]);
    expect(h.state.setSends).toBe(1);
    expect(h.calls).toEqual([{ fn: "notify-supplier-read", ids: [9] }]);
  });

  it("efekt szczegółu w PageBuyerDetail reaguje na propozycję potwierdzoną ręcznie", () => {
    const a = src.indexOf("export function PageBuyerDetail(");
    const block = src.slice(a, a + 2200);
    expect(block).toMatch(/const manualAwaitingRead = isManualAwaitingBuyerRead\(send\);/);
    expect(block).toMatch(/if \(send\.status !== "sent" && !manualAwaitingRead\) return;/);
    expect(block).toMatch(/\[sendId, sendStatus, manualAwaitingRead, onOpened\]/);
  });

  it("pulpit: licznik nowych liczy tylko nieprzeczytane", () => {
    expect(src).toMatch(/setBuyerNewAtEntry\(n => Math\.max\(n, buyerEntryPending\.filter\(isNewForBuyer\)\.length\)\)/);
  });
});

// ── review Codexa 13.11, 3. runda — P2: mail → potwierdzenie ręczne → aplikacja ──
// Kredyt pobrało OTWARCIE MAILA, więc potwierdzenie ręczne nie ustawia chargeChannel = manual.
// Odczyt w aplikacji (wejście, lista, szczegół) i tak musi zostać zgłoszony — dokładnie raz.
describe("[P2, 3. runda] mail → potwierdzenie ręczne → aplikacja: prawdziwe funkcje panelu zgłaszają odczyt", () => {
  const src = readFileSync(new URL("../legacy/PreconnectFM.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const cut = (name) => { const a = src.indexOf(`  async function ${name}(`); return src.slice(a, src.indexOf("\n  }\n", a) + 5); };
  const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } };
  const quiet = { warn() {}, log() {} };
  // tak wygląda wiersz po sekwencji: sent → mark_legacy_send_seen(email) → confirm_legacy_send_manual
  const emailThenManual = (id, extra = {}) => ({ id, retailerId: 100, status: "read_manual", readType: "manual_phone", billingStatus: "charged", chargeAt: "2026-11-13T09:00:00.000Z", chargeChannel: "email", emailOpenedAt: "2026-11-13T09:00:00.000Z", buyerSeenAt: "2026-11-13T09:00:00.000Z", buyerSeenChannel: "email", seenChannel: "email", ...extra });
  const variants = [["chargeChannel = email", emailThenManual(41)], ["bez znacznika kanału", emailThenManual(42, { chargeChannel: undefined })], ["pola w data (wiersz z bazy)", { id: 43, retailerId: 100, status: "read_manual", data: { billingStatus: "charged", chargeAt: "x", chargeChannel: "email", buyerSeenChannel: "email" } }]];

  function server() {
    const calls = [];
    const fetchStub = async (url, init) => {
      const b = JSON.parse(init.body);
      const ids = b.legacy_ids || [b.legacy_id];
      calls.push({ fn: url.split("/").pop(), ids });
      return { ok: true, status: 200, json: async () => ({ ok: true, results: ids.map((id) => ({ legacy_id: id, ok: true, status: "read_manual", data: { buyerAppSeenAt: "2026-11-13T11:00:00.000Z", buyerAppSeenChannel: "app_list" }, billing: { charged: false, alreadyCharged: true, billingStatus: "charged" } })) }) };
    };
    return { calls, fetchStub };
  }
  const entryFn = (fetchStub, applied, tracker) =>
    // eslint-disable-next-line no-new-func
    new Function("buyerSeenAllowed", "buyerSeenTrackerRef", "supabase", "fetch", "applySeenResultsToState", "console", `${cut("markBuyerPreconnectSeen")}\n return markBuyerPreconnectSeen;`)(true, tracker, supabase, fetchStub, (r) => applied.push(r), quiet);
  const detailFn = (fetchStub, state, tracker, allowed = true) =>
    // eslint-disable-next-line no-new-func
    new Function("buyerSeenAllowed", "buyerSeenTrackerRef", "isManualAwaitingBuyerRead", "supabase", "fetch", "applySeenResultsToState", "dbMarkLegacySendRead", "nowStr", "_setSendsRaw", "console", `${cut("markSendOpened")}\n return markSendOpened;`)(
      allowed, tracker, isManualAwaitingBuyerRead, supabase, fetchStub, (r) => state.applied.push(r), async (id) => { state.dbRead.push(id); }, () => "teraz", () => { state.setSends += 1; }, quiet);

  for (const [label, send] of variants) {
    it(`wejście kupca (${label}): dokładnie jedno zgłoszenie, bez drugiego pobrania`, async () => {
      const { calls, fetchStub } = server();
      const applied = []; const tracker = { current: createSeenSubmissionTracker() };
      const fn = entryFn(fetchStub, applied, tracker);
      const pending = pendingBuyerSeenSends({ sends: [send], buyerRetailerId: 100, retailers: [{ id: 100, active: true }], buyer: { active: true } });
      expect(pending.map((x) => x.id)).toEqual([send.id]);
      expect(pending.filter(isNewForBuyer)).toHaveLength(0);   // nie liczy się jako „nowa” na pulpicie
      await fn(pending, "app_list"); await fn(pending, "app_list");
      expect(calls).toEqual([{ fn: "mark-buyer-preconnect-seen", ids: [send.id] }]);
      expect(applied[0][0].billing.charged).toBe(false);
    });

    it(`lista (${label}): ten sam filtr co w PageBuyerOffers, dokładnie jedno zgłoszenie`, async () => {
      const { calls, fetchStub } = server();
      const applied = []; const tracker = { current: createSeenSubmissionTracker() };
      const fn = entryFn(fetchStub, applied, tracker);
      const seen = new Set();
      const candidates = () => [send].filter((s) => isBuyerSeenPending(s) && !seen.has(s.id));
      expect(candidates().map((x) => x.id)).toEqual([send.id]);
      await fn(candidates(), "app_list"); await fn(candidates(), "app_list");
      expect(calls).toEqual([{ fn: "mark-buyer-preconnect-seen", ids: [send.id] }]);
    });

    it(`szczegół (${label}): dokładnie jedno zgłoszenie, status lokalnie bez zmian, bez ścieżki „sent → read”`, async () => {
      const { calls, fetchStub } = server();
      const state = { dbRead: [], setSends: 0, applied: [] };
      const fn = detailFn(fetchStub, state, { current: createSeenSubmissionTracker() });
      await fn(send); await fn(send);
      expect(calls).toEqual([{ fn: "notify-supplier-read", ids: [send.id] }]);
      expect(state.dbRead).toEqual([]); expect(state.setSends).toBe(0); expect(state.applied).toHaveLength(1);
    });
  }

  it("po zapisaniu odczytu w aplikacji żadna ścieżka nie zgłasza ponownie", async () => {
    const done = emailThenManual(44, { buyerAppSeenAt: "2026-11-13T11:00:00.000Z" });
    const { calls, fetchStub } = server();
    expect(pendingBuyerSeenSends({ sends: [done], buyerRetailerId: 100, retailers: [], buyer: {} })).toEqual([]);
    expect(isBuyerSeenPending(done)).toBe(false);
    const state = { dbRead: [], setSends: 0, applied: [] };
    await detailFn(fetchStub, state, { current: createSeenSubmissionTracker() })(done);
    expect(calls).toEqual([]);
  });

  it("nierozliczona read_manual po otwarciu maila bez kredytu: żadna ścieżka jej nie zgłasza; podgląd admina też nie", async () => {
    const unpaid = { id: 45, retailerId: 100, status: "read_manual", billingStatus: "no_package_available", emailOpenedAt: "x", buyerSeenChannel: "email" };
    const { calls, fetchStub } = server();
    expect(pendingBuyerSeenSends({ sends: [unpaid], buyerRetailerId: 100, retailers: [], buyer: {} })).toEqual([]);
    const state = { dbRead: [], setSends: 0, applied: [] };
    await detailFn(fetchStub, state, { current: createSeenSubmissionTracker() })(unpaid);
    await detailFn(fetchStub, state, { current: createSeenSubmissionTracker() }, false)(emailThenManual(46));
    expect(calls).toEqual([]);
  });
});
