import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { canRegisterBuyerSeen, pendingBuyerSeenSends, createSeenSubmissionTracker } from "./buyer-seen.js";
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
