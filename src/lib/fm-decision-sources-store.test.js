// [feat/fm-decision-source] Magazyn źródeł: unieważnienie odrzuca odczyty w toku, para w edycji nie
// wraca ze spóźnionego/wcześniejszego odczytu, odrzucony zapis przywraca oznaczenie lokalnie,
// KAŻDY zapis rozliczany z osobna (nakładające się edycje z mieszanym wynikiem), jedno ponowienie.
import { describe, it, expect, vi } from "vitest";
import { createDecisionSourceStore } from "./fm-decision-sources-store.js";
import { respSource, targetSource } from "./fm-decision-sources.js";

const ADMIN_RESP = { entity: "resp", company_id: "co", retailer_id: 100, decision: "remove", source: "admin" };
const ADMIN_TARGET = { entity: "target", company_id: "co", retailer_id: 100, decision: "star", source: "admin" };
const ADMIN_TARGET_B = { entity: "target", company_id: "co", retailer_id: 101, decision: "star", source: "admin" };
const PAIR_RESP = { entity: "resp", companyId: "co", retailerId: 100 };
const PAIR_A = { entity: "target", companyId: "co", retailerId: 100 };
const PAIR_B = { entity: "target", companyId: "co", retailerId: 101 };
const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; };
const flush = () => new Promise(r => setTimeout(r, 0));

function make(fetchImpl, extra = {}) {
  const changes = [];
  const timers = [];
  const store = createDecisionSourceStore({ fetchRows: fetchImpl, onChange: (s) => changes.push(s), retryMs: 3000, setTimer: (fn, ms) => timers.push({ fn, ms }), ...extra });
  return { store, changes, timers };
}
const marker = (store) => respSource(store.getState(), 100, "co")?.source === "admin";

describe("createDecisionSourceStore", () => {
  it("odczyt zapisuje stan; invalidate zdejmuje oznaczenie pary i zwraca token", async () => {
    const { store } = make(async () => [ADMIN_RESP, ADMIN_TARGET]);
    await store.refetch();
    expect(marker(store)).toBe(true);
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });
    expect(token).toMatchObject({ key: "resp|co|100", rev: 1 });
    expect(marker(store)).toBe(false);
    expect(targetSource(store.getState(), "co", 100)?.source).toBe("admin");   // druga encja nietknięta
    expect(store.pendingCount()).toBe(1);
  });

  it("[review 7f3343e/2] spóźniony odczyt sprzed edycji nie przywraca oznaczenia; po udanym zapisie nieudany odczyt i ponowienie zostawiają stan bez oznaczenia", async () => {
    const first = deferred();
    let calls = 0;
    const { store, timers } = make(() => { calls += 1; return calls === 1 ? first.p : Promise.reject(new Error("network")); });
    const early = store.refetch();
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });
    first.resolve([ADMIN_RESP]);
    expect(await early).toBe(false);
    expect(marker(store)).toBe(false);
    store.handle({ settle: token });
    await flush();
    expect(timers).toHaveLength(1);
    timers[0].fn(); await flush();
    expect(marker(store)).toBe(false);
    expect(store.pendingCount()).toBe(0);
  });

  it("odczyt rozpoczęty PO unieważnieniu, ale przed rozliczeniem, pomija parę w edycji; odczyt rozpoczęty przed settle, a zakończony po nim, jest odrzucany", async () => {
    const slow = deferred();
    let calls = 0;
    const { store } = make(() => { calls += 1; return calls === 1 ? Promise.resolve([ADMIN_RESP]) : calls === 2 ? Promise.resolve([ADMIN_RESP]) : slow.p; });
    await store.refetch();
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });
    expect(await store.refetch()).toBe(true);           // odświeżenie admina zanim zapis dotarł — para nadal bez oznaczenia
    expect(marker(store)).toBe(false);
    const stale = store.refetch();                      // trzeci odczyt rusza PRZED rozliczeniem …
    store.handle({ settle: token, refetch: false });    // … zapis przyjęty
    slow.resolve([ADMIN_RESP]);                         // … i wraca ze starym stanem bazy
    expect(await stale).toBe(false);
    expect(marker(store)).toBe(false);                  // potwierdzony stan (użytkownik) nie został nadpisany
  });

  it("[review 7f3343e/1] odrzucony zapis: restore przywraca zdjęte oznaczenie lokalnie, nawet gdy odczyt zawodzi", async () => {
    let ok = true;
    const { store, timers } = make(() => ok ? Promise.resolve([ADMIN_RESP]) : Promise.reject(new Error("locked")));
    await store.refetch();
    const token = store.handle({ invalidate: PAIR_RESP, refetch: false });
    expect(marker(store)).toBe(false);
    ok = false;
    store.handle({ restore: token });
    expect(marker(store)).toBe(true);
    await flush(); timers.forEach(t => t.fn()); await flush();
    expect(marker(store)).toBe(true);
    expect(store.pendingCount()).toBe(0);
  });

  it("[review a75ca3f/2] ta sama para, dwie edycje: 1. przyjęta, 2. odrzucona → bez oznaczenia (podstawa = przyjęty zapis użytkownika)", async () => {
    const { store } = make(() => Promise.reject(new Error("network")));   // odczyty niedostępne — liczy się rozliczenie lokalne
    store.restore; // (no-op) — stan początkowy z „odczytu”:
    const s2 = make(async () => [ADMIN_RESP]); const st = s2.store; await st.refetch();
    const t1 = st.handle({ invalidate: PAIR_RESP, refetch: false });   // „Chcę”
    const t2 = st.handle({ invalidate: PAIR_RESP, refetch: false });   // „Daj szansę” zanim zapis 1 wrócił
    expect(st.settle(t1)).toBe(true);                     // zapis 1 przyjęty (starszy nie nadpisuje nowszej edycji: para nadal w edycji)
    expect(marker(st)).toBe(false); expect(st.pendingCount()).toBe(1);
    expect(st.restore(t2)).toBe(true);                    // zapis 2 odrzucony → wracamy do stanu potwierdzonego = „Chcę” kupca
    expect(marker(st)).toBe(false);                       // ŻADNEGO „wybrane przez administratora”
    expect(st.pendingCount()).toBe(0);
    void store;
  });

  it("[review a75ca3f/2] ta sama para: 1. odrzucona, 2. przyjęta → bez oznaczenia; obie odrzucone → oznaczenie wraca; stary token po rozliczeniu ignorowany", async () => {
    const { store } = make(async () => [ADMIN_RESP]); await store.refetch();
    let t1 = store.handle({ invalidate: PAIR_RESP, refetch: false }), t2 = store.handle({ invalidate: PAIR_RESP, refetch: false });
    expect(store.restore(t1)).toBe(true); expect(marker(store)).toBe(false);   // 2. edycja nadal w toku
    expect(store.settle(t2)).toBe(true); expect(marker(store)).toBe(false); expect(store.pendingCount()).toBe(0);
    expect(store.restore(t1)).toBe(false); expect(store.settle(t2)).toBe(false);   // rozliczone tokeny nic nie zmieniają
    // obie odrzucone
    const s2 = make(async () => [ADMIN_RESP]); const st = s2.store; await st.refetch();
    t1 = st.handle({ invalidate: PAIR_RESP, refetch: false }); t2 = st.handle({ invalidate: PAIR_RESP, refetch: false });
    st.restore(t1); expect(marker(st)).toBe(false);
    st.restore(t2); expect(marker(st)).toBe(true);
  });

  it("[review a75ca3f/1] dwie pary (dostawca), zapisy szeregowe z mieszanym wynikiem: rozliczenie per zapis", async () => {
    const run = async (first, second) => {
      const { store } = make(async () => [ADMIN_TARGET, ADMIN_TARGET_B]); await store.refetch();
      const tA = store.invalidate(PAIR_A);                 // zapis 1 niesie A
      const tB = store.invalidate(PAIR_B);                 // zapis 2 niesie A i B (cała lista)
      // zapis 1: przy błędzie, gdy czeka nowszy zapis, nic nie rozliczamy; przy sukcesie settle A
      if (first === "ok") store.settle(tA);
      // zapis 2: sukces → settle A (jeśli jeszcze nierozliczone) i B; błąd → restore wszystkich nierozliczonych ≤ rev2
      if (second === "ok") { store.settle(tA); store.settle(tB); } else { store.restore(tA); store.restore(tB); }
      return [targetSource(store.getState(), "co", 100)?.source === "admin", targetSource(store.getState(), "co", 101)?.source === "admin", store.pendingCount()];
    };
    expect(await run("ok", "ok")).toEqual([false, false, 0]);
    expect(await run("fail", "fail")).toEqual([true, true, 0]);
    expect(await run("fail", "ok")).toEqual([false, false, 0]);
    expect(await run("ok", "fail")).toEqual([false, true, 0]);   // tylko druga sieć wraca do admina
  });

  it("odczyt: starsza odpowiedź nie nadpisuje nowszej; błąd = jedno ponowienie po retryMs", async () => {
    const a = deferred(), b = deferred();
    let n = 0;
    const { store, timers } = make(() => { n += 1; return n === 1 ? a.p : n === 2 ? b.p : Promise.reject(new Error("x")); });
    const pa = store.refetch(); const pb = store.refetch();
    b.resolve([ADMIN_TARGET]); expect(await pb).toBe(true);
    a.resolve([ADMIN_RESP]); expect(await pa).toBe(false);
    expect(targetSource(store.getState(), "co", 100)?.source).toBe("admin");
    expect(marker(store)).toBe(false);
    expect(await store.refetch()).toBe(false);
    expect(timers).toHaveLength(1); expect(timers[0].ms).toBe(3000);
    timers[0].fn(); await flush();
    expect(timers).toHaveLength(1);
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
