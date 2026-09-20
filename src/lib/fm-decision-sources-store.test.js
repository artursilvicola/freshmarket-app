// [feat/fm-decision-source] Magazyn źródeł: unieważnienie odrzuca odczyty w toku, para w edycji nie
// wraca ze spóźnionego/wcześniejszego odczytu, odrzucony zapis przywraca oznaczenie lokalnie,
// starsza edycja nie nadpisuje nowszej, błąd odczytu = jedno ponowienie.
import { describe, it, expect, vi } from "vitest";
import { createDecisionSourceStore } from "./fm-decision-sources-store.js";
import { respSource, targetSource } from "./fm-decision-sources.js";

const ADMIN_RESP = { entity: "resp", company_id: "co", retailer_id: 100, decision: "remove", source: "admin" };
const ADMIN_TARGET = { entity: "target", company_id: "co", retailer_id: 100, decision: "star", source: "admin" };
const PAIR_RESP = { entity: "resp", companyId: "co", retailerId: 100 };
const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; };
const flush = () => new Promise(r => setTimeout(r, 0));

function make(fetchImpl, extra = {}) {
  const changes = [];
  const timers = [];
  const store = createDecisionSourceStore({ fetchRows: fetchImpl, onChange: (s) => changes.push(s), retryMs: 3000, setTimer: (fn, ms) => timers.push({ fn, ms }), ...extra });
  return { store, changes, timers };
}

describe("createDecisionSourceStore", () => {
  it("odczyt zapisuje stan; invalidate zdejmuje oznaczenie pary i zwraca token", async () => {
    const { store } = make(async () => [ADMIN_RESP, ADMIN_TARGET]);
    await store.refetch();
    expect(respSource(store.getState(), 100, "co")?.source).toBe("admin");
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });
    expect(token).toMatchObject({ key: "resp|co|100", rev: 1 });
    expect(respSource(store.getState(), 100, "co")).toBeNull();
    expect(targetSource(store.getState(), "co", 100)?.source).toBe("admin");   // druga encja nietknięta
    expect(store.pendingCount()).toBe(1);
  });

  it("[review 7f3343e/2] spóźniony odczyt sprzed edycji nie przywraca oznaczenia; po udanym zapisie nieudany odczyt i ponowienie zostawiają stan bez oznaczenia", async () => {
    const first = deferred();
    let calls = 0;
    const { store, timers } = make(() => { calls += 1; return calls === 1 ? first.p : Promise.reject(new Error("network")); });
    const early = store.refetch();                       // 1. odczyt sprzed edycji rusza
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });   // 2. użytkownik zmienia decyzję
    first.resolve([ADMIN_RESP]);                         // 3. stary odczyt wraca z opóźnieniem
    expect(await early).toBe(false);
    expect(respSource(store.getState(), 100, "co")).toBeNull();   // NIE przywrócił admina
    store.handle({ settle: token });                     // 4. zapis przyjęty → odczyt (błąd) …
    await flush();
    expect(timers).toHaveLength(1);
    timers[0].fn();                                      // … i ponowienie (błąd)
    await flush();
    expect(respSource(store.getState(), 100, "co")).toBeNull();   // 5. nadal bez oznaczenia — zgodnie ze stanem po zmianie użytkownika
    expect(store.pendingCount()).toBe(0);
  });

  it("odczyt rozpoczęty PO unieważnieniu, ale przed rozliczeniem zapisu, pomija parę w edycji; po settle pełny odczyt jest miarodajny", async () => {
    const { store } = make(async () => [ADMIN_RESP]);
    await store.refetch();
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });
    expect(await store.refetch()).toBe(true);           // np. odświeżenie admina / powrót do karty — zapis jeszcze nie dotarł
    expect(respSource(store.getState(), 100, "co")).toBeNull();
    store.handle({ settle: token, refetch: false });
    expect(await store.refetch()).toBe(true);           // po zapisie: baza mówi ostatnie słowo (tu: nadal admin — np. zapis nie zmienił źródła)
    expect(respSource(store.getState(), 100, "co")?.source).toBe("admin");
  });

  it("[review 7f3343e/1] odrzucony zapis: restore przywraca zdjęte oznaczenie lokalnie, nawet gdy odczyt zawodzi", async () => {
    let ok = true;
    const { store, timers } = make(() => ok ? Promise.resolve([ADMIN_RESP]) : Promise.reject(new Error("locked")));
    await store.refetch();
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });
    expect(respSource(store.getState(), 100, "co")).toBeNull();
    ok = false;                                          // baza odrzuca zapis; odczyt też pada
    store.handle({ restore: token });
    expect(respSource(store.getState(), 100, "co")?.source).toBe("admin");   // przywrócone od razu, bez sieci
    await flush(); timers.forEach(t => t.fn()); await flush();
    expect(respSource(store.getState(), 100, "co")?.source).toBe("admin");
    expect(store.pendingCount()).toBe(0);
  });

  it("starsza edycja nie nadpisuje nowszej: restore ze starym tokenem jest ignorowane, settle/restore nowego działa", async () => {
    const { store } = make(async () => [ADMIN_RESP]);
    await store.refetch();
    const t1 = store.handle({ invalidate: PAIR_RESP, refetch: false });
    const t2 = store.handle({ invalidate: PAIR_RESP, refetch: false });   // drugie kliknięcie tej samej pary
    expect(store.restore(t1)).toBe(false);               // zapis 1 odrzucony po zapisie 2 — nic nie zmienia
    expect(respSource(store.getState(), 100, "co")).toBeNull();
    expect(store.restore(t2)).toBe(true);                // zapis 2 odrzucony → wraca pierwotny wiersz admina
    expect(respSource(store.getState(), 100, "co")?.source).toBe("admin");
    expect(store.settle(t2)).toBeUndefined();
  });

  it("odczyt: starsza odpowiedź nie nadpisuje nowszej; błąd = jedno ponowienie po retryMs", async () => {
    const a = deferred(), b = deferred();
    let n = 0;
    const { store, timers } = make(() => { n += 1; return n === 1 ? a.p : n === 2 ? b.p : Promise.reject(new Error("x")); });
    const pa = store.refetch(); const pb = store.refetch();
    b.resolve([ADMIN_TARGET]); expect(await pb).toBe(true);
    a.resolve([ADMIN_RESP]); expect(await pa).toBe(false);
    expect(targetSource(store.getState(), "co", 100)?.source).toBe("admin");
    expect(respSource(store.getState(), 100, "co")).toBeNull();
    expect(await store.refetch()).toBe(false);
    expect(timers).toHaveLength(1); expect(timers[0].ms).toBe(3000);
    timers[0].fn(); await flush();
    expect(timers).toHaveLength(1);                      // tylko jedno ponowienie
  });

  it("handle bez opcji = odczyt; invalidate bez refetch nie czyta; niepełna para = brak tokenu", async () => {
    const fetchRows = vi.fn(async () => []);
    const { store } = make(fetchRows);
    store.handle(); await flush();
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(store.handle({ invalidate: PAIR_RESP, refetch: false })).toBeTruthy(); await flush();
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(store.handle({ invalidate: { entity: "resp", companyId: null, retailerId: 1 }, refetch: false })).toBeNull();
  });
});
