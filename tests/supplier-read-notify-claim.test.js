// [fix/supplier-read-notify-once v3] Powiadomienie dostawcy o odczycie.
//
// Cztery znaleziska z dwóch tur review Codexa (13.10), każde odtworzone osobno:
//
//  1. Powiadomienie przepadało: znacznik „powiadomiono" szedł PRZED mailem, więc
//     odmowa poczty blokowała wysyłkę na zawsze.
//  2. Mail mógł zawierać cudze propozycje: RPC zwracał samą LICZBĘ zajętych wierszy,
//     a mail opisywał całą grupę. Odczyt A równolegle z paczką A+B dawał dwa maile,
//     oba z A.
//  3. Rezerwacja tylko ODSUWAŁA dubla: gdy poczta przyjęła wiadomość, a aplikacja
//     nie zapisała potwierdzenia, po wygaśnięciu dzierżawy szedł drugi mail.
//  4. Niekompletne potwierdzenie uchodziło za sukces: sprawdzany był brak błędu,
//     nie liczba zapisanych wierszy.
//
// Atrapa bazy odwzorowuje warunki RPC z migracji 20261013090000 (rezerwacja
// z dzierżawą, stałe messageId, okno idempotencji, potwierdzenie i zwolnienie
// tylko po własnym tokenie). Atrapa poczty odwzorowuje Idempotency-Key Resend.
// Zero ruchu sieciowego.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notifySupplierOffersRead } from "../netlify/functions/_shared/supplier-read-notify.js";

const LEASE_MS = 900 * 1000;
const WINDOW_MS = 86400 * 1000;

function fakeDb(sendDefs) {
  // sendDefs: [{ legacy_id, offer_legacy_id, title }] — jeden dostawca, jedna sieć,
  // czyli wszystkie wiersze trafiają do tej samej grupy.
  const rows = sendDefs.map((d) => ({
    legacy_id: d.legacy_id,
    supplier_legacy_id: "supplier-1",
    retailer_id: 1,
    offer_legacy_id: d.offer_legacy_id,
    status: "read",
    data: {},
  }));
  const messages = new Map();   // message_id -> niezmienna tresc
  const state = { rows, claims: 0, confirms: 0, releases: 0, uncertains: 0, now: () => Date.now() };
  const byId = (id) => rows.find((r) => Number(r.legacy_id) === Number(id));
  const mine = (row, token) => row && row.data.supplierNotifyClaimToken === token && !row.data.supplierNotifiedAt;
  const strip = (data, ...keys) => {
    const out = { ...data };
    for (const k of keys) delete out[k];
    return out;
  };
  const WORK = [
    "supplierNotifyClaimToken", "supplierNotifyClaimedAt", "supplierNotifyMessageId",
    "supplierNotifyFirstClaimAt", "supplierNotifyAttempts",
    "supplierNotifyUncertainAt", "supplierNotifyUncertainReason",
  ];

  const supa = {
    from(table) {
      return {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        in(_col, ids) {
          if (table === "legacy_sends") return Promise.resolve({ data: ids.map((id) => structuredClone(byId(id))).filter(Boolean), error: null });
          if (table === "retailers") return Promise.resolve({ data: [{ id: 1, name: "Test retailer" }], error: null });
          if (table === "legacy_offers") return Promise.resolve({ data: sendDefs.map((d) => ({ legacy_id: d.offer_legacy_id, data: { title: d.title } })), error: null });
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          return Promise.resolve({
            data: table === "profiles"
              ? { name: "Test", email: "nobody@example.invalid", active: true, locale: "pl" }
              : { id: "company-1", name: "Test company", legacy_supplier_id: "supplier-1" },
            error: null,
          });
        },
      };
    },
    async rpc(name, args) {
      const now = state.now();
      if (name === "ensure_legacy_send_notify_message") {
        // zapisz albo oddaj juz zapisana — przy wyscigu wygrywa pierwszy
        if (!messages.has(args.p_message_id)) {
          messages.set(args.p_message_id, {
            message_id: args.p_message_id, to_email: args.p_to_email, subject: args.p_subject,
            html: args.p_html, legacy_ids: [...args.p_legacy_ids], created_at: new Date(now).toISOString(),
          });
        }
        return { data: [messages.get(args.p_message_id)], error: null };
      }
      if (name === "claim_legacy_sends_supplier_notify") {
        state.claims += 1;
        const out = [];
        for (const id of args.p_legacy_ids) {
          const row = byId(id);
          if (!row) continue;
          const d = row.data;
          const first = d.supplierNotifyFirstClaimAt ? Date.parse(d.supplierNotifyFirstClaimAt) : now;
          // blokada NIE zalezy od znacznika niepewnosci — sam brak potwierdzenia wystarczy
          const pozaOknem = first < now - WINDOW_MS;
          if (d.supplierNotifiedAt) { out.push({ legacy_id: Number(id), state: "notified", message_id: d.supplierNotifyMessageId || null, attempt: Number(d.supplierNotifyAttempts || 0) }); continue; }
          if (pozaOknem) { out.push({ legacy_id: Number(id), state: "needs_review", message_id: d.supplierNotifyMessageId || null, attempt: Number(d.supplierNotifyAttempts || 0) }); continue; }
          const token = d.supplierNotifyClaimToken;
          const at = d.supplierNotifyClaimedAt ? Date.parse(d.supplierNotifyClaimedAt) : null;
          const wolny = !token || at === null || token === args.p_claim_token || at < now - LEASE_MS;
          if (!wolny) { out.push({ legacy_id: Number(id), state: "busy", message_id: d.supplierNotifyMessageId || null, attempt: Number(d.supplierNotifyAttempts || 0) }); continue; }
          row.data = {
            ...d,
            supplierNotifyClaimToken: args.p_claim_token,
            supplierNotifyClaimedAt: new Date(now).toISOString(),
            supplierNotifyMessageId: d.supplierNotifyMessageId || args.p_new_message_id,
            supplierNotifyFirstClaimAt: d.supplierNotifyFirstClaimAt || new Date(now).toISOString(),
            supplierNotifyAttempts: Number(d.supplierNotifyAttempts || 0) + 1,
          };
          out.push({ legacy_id: Number(id), state: "claimed", message_id: row.data.supplierNotifyMessageId, attempt: row.data.supplierNotifyAttempts });
        }
        return { data: out, error: null };
      }
      if (name === "confirm_legacy_sends_supplier_notified") {
        state.confirms += 1;
        let n = 0;
        for (const id of args.p_legacy_ids) {
          const row = byId(id);
          if (!mine(row, args.p_claim_token)) continue;
          row.data = {
            ...strip(row.data, ...WORK.filter((k) => k !== "supplierNotifyMessageId")),
            supplierNotifiedAt: args.p_notified_at,
            supplierNotifiedVia: args.p_via,
            supplierNotifiedBatchSize: args.p_batch_size,
          };
          n += 1;
        }
        return { data: n, error: null };
      }
      if (name === "release_legacy_sends_supplier_notify_claim") {
        state.releases += 1;
        let n = 0;
        for (const id of args.p_legacy_ids) {
          const row = byId(id);
          if (!mine(row, args.p_claim_token)) continue;
          row.data = strip(row.data, ...WORK);
          n += 1;
        }
        return { data: n, error: null };
      }
      if (name === "mark_legacy_sends_supplier_notify_uncertain") {
        state.uncertains += 1;
        let n = 0;
        for (const id of args.p_legacy_ids) {
          const row = byId(id);
          if (!mine(row, args.p_claim_token)) continue;
          row.data = { ...row.data, supplierNotifyUncertainAt: new Date(now).toISOString(), supplierNotifyUncertainReason: args.p_reason ?? null };
          n += 1;
        }
        return { data: n, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "not found" } };
    },
  };
  return { supa, state };
}

// Atrapa Resend wierna regulom Idempotency-Key:
//  - ten sam klucz + TEN SAM ladunek  → deduplikacja, oddajemy pierwotna odpowiedz
//  - ten sam klucz + INNY ladunek     → 409 (tak odpowiada Resend)
//  - klucz starszy niz 24 h           → wygasl, kolejne zadanie tworzy NOWA wiadomosc
// Bez tych dwoch regul atrapa przepuszczala dublowanie, czego nie wylapywalismy.
const RESEND_KEY_TTL_MS = 24 * 60 * 60 * 1000;
function fakeResend({ now = () => Date.now() } = {}) {
  const wyslane = [];               // wiadomosci faktycznie utworzone u dostawcy
  const poKluczu = new Map();       // key -> { id, odcisk, at }
  const odcisk = (b) => JSON.stringify([b.to, b.subject, b.html]);
  const fn = vi.fn(async (_url, init) => {
    const key = init.headers["Idempotency-Key"];
    const body = JSON.parse(init.body);
    const zapamietany = key ? poKluczu.get(key) : null;
    const wazny = zapamietany && now() - zapamietany.at < RESEND_KEY_TTL_MS;
    if (wazny) {
      if (zapamietany.odcisk !== odcisk(body)) {
        return { ok: false, status: 409, text: async () => "idempotency key reused with different payload" };
      }
      return { ok: true, json: async () => ({ id: zapamietany.id }) };
    }
    const id = `mail-${wyslane.length + 1}`;
    wyslane.push({ key, html: body.html, subject: body.subject, to: body.to });
    if (key) poKluczu.set(key, { id, odcisk: odcisk(body), at: now() });
    return { ok: true, json: async () => ({ id }) };
  });
  return { fn, wyslane, poKluczu };
}

const env = { resendApiKey: "fake-not-a-key", b2bAppUrl: "https://example.invalid" };
const notify = (supa, legacyIds, openedVia = "app_list") =>
  notifySupplierOffersRead({ supaSvc: supa, env, legacyIds, openedVia });

describe("powiadomienie dostawcy o odczycie — rezerwacja i tożsamość wiadomości", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  // ── znalezisko 2 ──────────────────────────────────────────────────────────
  it("odczyt A równolegle z paczką A+B: DWA maile, ale A tylko w jednym z nich", async () => {
    const { supa, state } = fakeDb([
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ]);
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    await Promise.all([notify(supa, [1], "resend_webhook"), notify(supa, [1, 2], "app_list")]);

    expect(poczta.wyslane).toHaveLength(2);
    expect(poczta.wyslane.filter((m) => m.html.includes("Awokado"))).toHaveLength(1);
    expect(poczta.wyslane.filter((m) => m.html.includes("Banany"))).toHaveLength(1);
    expect(state.rows.every((r) => r.data.supplierNotifiedAt)).toBe(true);
    expect(state.releases).toBe(0);
  });

  it("obie ścieżki o tej samej pojedynczej propozycji → dokładnie jeden mail", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const [a, b] = await Promise.all([notify(supa, [1], "resend_webhook"), notify(supa, [1], "app_list")]);

    expect(poczta.wyslane).toHaveLength(1);
    const statusy = [a, b].map((r) => r.notifications[0]?.status ?? r.reason);
    expect(statusy.filter((s) => s === "sent")).toHaveLength(1);
    expect([a, b].every((r) => r.notifications.every((n) => n.ok !== false))).toBe(true);
    expect(state.rows[0].data.supplierNotifiedVia).toBeTruthy();
  });

  it("mail opisuje tylko propozycje z WŁASNEJ rezerwacji, gdy część zajęła inna ścieżka", async () => {
    const { supa, state } = fakeDb([
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ]);
    state.rows[0].data = { supplierNotifyClaimToken: "cudzy", supplierNotifyClaimedAt: new Date().toISOString() };
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1, 2]);
    expect(poczta.wyslane).toHaveLength(1);
    expect(poczta.wyslane[0].html).toContain("Banany");
    expect(poczta.wyslane[0].html).not.toContain("Awokado");
    expect(r.notifications[0]).toMatchObject({ status: "sent", legacy_ids: [2], offer_count: 1 });
  });

  // ── znalezisko 1 ──────────────────────────────────────────────────────────
  it("jednoznaczna odmowa poczty zwalnia rezerwację i KOLEJNA próba wysyła", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, text: async () => "odmowa" }));

    const pierwsza = await notify(supa, [1]);
    expect(pierwsza.notifications[0]).toMatchObject({ ok: false, status: "error", delivery: "no", claim_released: true });
    expect(state.releases).toBe(1);
    // pełny reset: ani znacznika wysłania, ani rezerwacji, ani tożsamości wiadomości
    expect(state.rows[0].data).toEqual({});

    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;
    const druga = await notify(supa, [1]);
    expect(druga.notifications[0]).toMatchObject({ status: "sent", confirm_ok: true, confirm_rows: 1, confirm_expected: 1 });
    expect(poczta.wyslane).toHaveLength(1);
    expect(poczta.wyslane[0].html).toContain("Awokado");
  });

  // ── znalezisko 3: sama rezerwacja tylko odsuwała dubla ────────────────────
  it("brak odpowiedzi poczty + wygasła dzierżawa: ponowienie idzie TYM SAMYM kluczem, mail jeden", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const poczta = fakeResend();
    // pierwsza próba: poczta PRZYJMUJE wiadomość, ale odpowiedź do nas nie wraca
    globalThis.fetch = vi.fn(async (url, init) => {
      await poczta.fn(url, init);
      throw new Error("ECONNRESET");
    });

    const pierwsza = await notify(supa, [1]);
    expect(pierwsza.notifications[0]).toMatchObject({ delivery: "unknown", claim_released: false });
    expect(poczta.wyslane).toHaveLength(1);
    const klucz = poczta.wyslane[0].key;
    expect(state.rows[0].data.supplierNotifyUncertainAt).toBeTruthy();
    expect(state.rows[0].data.supplierNotifyMessageId).toBe(klucz);

    // 16 minut później — dzierżawa wygasła, okno idempotencji poczty jeszcze trwa
    state.now = () => Date.now() + 16 * 60 * 1000;
    globalThis.fetch = poczta.fn;
    const druga = await notify(supa, [1]);

    expect(poczta.fn).toHaveBeenCalledTimes(2);          // żądanie poszło drugi raz…
    expect(poczta.wyslane).toHaveLength(1);              // …ale wiadomość powstała JEDNA
    expect(poczta.wyslane[0].key).toBe(klucz);
    expect(druga.notifications[0]).toMatchObject({ status: "sent", message_id: klucz, confirm_ok: true });
    expect(state.rows[0].data.supplierNotifiedAt).toBeTruthy();
  });

  it("poza oknem idempotencji niepewny wynik NIE jest ponawiany — wraca jako needs_review", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const dawno = new Date(Date.now() - WINDOW_MS - 60_000).toISOString();
    state.rows[0].data = {
      supplierNotifyClaimToken: "stary",
      supplierNotifyClaimedAt: dawno,
      supplierNotifyMessageId: "fmr-stary",
      supplierNotifyFirstClaimAt: dawno,
      supplierNotifyAttempts: 1,
      supplierNotifyUncertainAt: dawno,
    };
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1]);
    expect(poczta.fn).not.toHaveBeenCalled();
    expect(r.notifications[0]).toMatchObject({
      ok: false, status: "needs_review",
      reason: "uncertain_outside_idempotency_window",
      legacy_ids: [1], message_ids: ["fmr-stary"],
    });
  });

  it("porzucona rezerwacja BEZ niepewnego wyniku wraca do obiegu po dzierżawie", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const dawno = new Date(Date.now() - LEASE_MS - 60_000).toISOString();
    state.rows[0].data = { supplierNotifyClaimToken: "porzucony", supplierNotifyClaimedAt: dawno, supplierNotifyMessageId: "fmr-porzucony", supplierNotifyFirstClaimAt: dawno };
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1]);
    expect(poczta.wyslane).toHaveLength(1);
    // ponowienie TEJ SAMEJ wiadomości, nie nowej
    expect(poczta.wyslane[0].key).toBe("fmr-porzucony");
    expect(r.notifications[0]).toMatchObject({ status: "sent", message_id: "fmr-porzucony", confirm_ok: true });
  });

  // ── znalezisko 4: niekompletne potwierdzenie ──────────────────────────────
  it("potwierdzenie 1 z 2 wierszy NIE jest sukcesem i zostaje odnotowane jako niepewne", async () => {
    const { supa, state } = fakeDb([
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ]);
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "confirm_legacy_sends_supplier_notified"
        ? origRpc(name, { ...args, p_legacy_ids: args.p_legacy_ids.slice(0, 1) })   // baza zapisała tylko jeden
        : origRpc(name, args));
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1, 2]);
    expect(poczta.wyslane).toHaveLength(1);
    expect(r.notifications[0]).toMatchObject({ status: "sent", ok: false, confirm_ok: false, confirm_rows: 1, confirm_expected: 2 });
    expect(r.ok).toBe(false);
    // niepotwierdzony wiersz ma ślad niepewności, więc ponowienie pójdzie tym samym kluczem
    expect(state.rows[1].data.supplierNotifyUncertainAt).toBeTruthy();
    expect(state.rows[1].data.supplierNotifyUncertainReason).toContain("confirm_partial: 1/2");
  });

  it("potwierdzenie 0 wierszy też nie jest sukcesem", async () => {
    const { supa } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "confirm_legacy_sends_supplier_notified" ? { data: 0, error: null } : origRpc(name, args));
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1]);
    expect(r.notifications[0]).toMatchObject({ status: "sent", ok: false, confirm_ok: false, confirm_rows: 0, confirm_expected: 1 });
  });

  it("błąd RPC potwierdzenia: mail poszedł, ale raport tego nie zamiata", async () => {
    const { supa } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "confirm_legacy_sends_supplier_notified" ? { data: null, error: { message: "boom" } } : origRpc(name, args));
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1]);
    expect(r.notifications[0]).toMatchObject({ status: "sent", ok: false, confirm_ok: false, confirm_error: "boom" });
  });

  it("błąd RPC rezerwacji: maila NIE wysyłamy", async () => {
    const { supa } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "claim_legacy_sends_supplier_notify" ? { data: null, error: { message: "boom" } } : origRpc(name, args));
    const poczta = fakeResend();
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1]);
    expect(r.notifications[0]).toMatchObject({ ok: false, status: "error", reason: "claim_failed", claim_error: "boom" });
    expect(poczta.fn).not.toHaveBeenCalled();
  });

  // ── znalezisko 5: ten sam klucz, ale zmieniona treść ─────────────────────
  // Resend wiąże klucz z KONKRETNYM ładunkiem. Składanie maila od nowa przy każdej
  // próbie dawało inną treść pod tym samym kluczem → 409 → kod kasował tożsamość
  // i wysyłał nową wiadomość. Zapisana, niezmienna treść to zamyka.
  it("ponowienie po częściowym potwierdzeniu wysyła ZAPISANĄ treść, nie złożoną od nowa", async () => {
    const defs = [
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ];
    const { supa, state } = fakeDb(defs);
    const poczta = fakeResend({ now: () => state.now() });
    globalThis.fetch = poczta.fn;

    // pierwsza próba: mail idzie, ale baza potwierdza tylko wiersz 1
    const origRpc = supa.rpc.bind(supa);
    let obcinaj = true;
    supa.rpc = async (name, args) =>
      (name === "confirm_legacy_sends_supplier_notified" && obcinaj
        ? origRpc(name, { ...args, p_legacy_ids: args.p_legacy_ids.slice(0, 1) })
        : origRpc(name, args));

    const pierwsza = await notify(supa, [1, 2]);
    expect(pierwsza.notifications[0]).toMatchObject({ status: "sent", confirm_ok: false, confirm_rows: 1, confirm_expected: 2 });
    expect(poczta.wyslane).toHaveLength(1);
    const trescPierwsza = poczta.wyslane[0].html;
    expect(trescPierwsza).toContain("Awokado");
    expect(trescPierwsza).toContain("Banany");

    // 16 minut później dzierżawa wygasła. Gdyby mail składał się od nowa, zostałoby
    // samo „Banany" (wiersz 1 jest już potwierdzony) i doszłaby nowa godzina odczytu.
    obcinaj = false;
    defs[1].title = "Banany ZMIENIONE";          // dowód, że treść NIE jest składana ponownie
    state.now = () => Date.now() + 16 * 60 * 1000;
    const druga = await notify(supa, [1, 2]);

    expect(poczta.fn).toHaveBeenCalledTimes(2);  // żądanie poszło drugi raz…
    expect(poczta.wyslane).toHaveLength(1);      // …a wiadomość u dostawcy nadal JEDNA
    // ładunek drugiego żądania był identyczny, więc nie było 409
    const drugieZadanie = JSON.parse(poczta.fn.mock.calls[1][1].body);
    expect(drugieZadanie.html).toBe(trescPierwsza);
    expect(druga.notifications[0]).toMatchObject({ status: "sent", confirm_ok: true, confirm_rows: 1, confirm_expected: 1 });
    expect(state.rows.every((r) => r.data.supplierNotifiedAt)).toBe(true);
  });

  // [review Codexa, tura 4] 409 ma DWA znaczenia i żadne nie znaczy „dostawca dostał mail".
  it("409 typu ‚inna treść pod tym kluczem’: do wyjaśnienia, bez zapisu powiadomienia, bez resetu", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const poczta = fakeResend({ now: () => state.now() });
    // klucz zajęty u poczty przez wiadomość o INNEJ treści
    globalThis.fetch = vi.fn(async (url, init) => {
      const key = init.headers["Idempotency-Key"];
      poczta.poKluczu.set(key, { id: "mail-wczesniejszy", odcisk: "INNY", at: state.now() });
      return poczta.fn(url, init);
    });

    const r = await notify(supa, [1]);
    expect(poczta.wyslane).toHaveLength(0);                       // nic nowego nie powstało
    expect(r.notifications[0]).toMatchObject({
      ok: false, status: "needs_review", reason: "idempotency_payload_conflict", delivery: "conflict",
    });
    expect(state.releases).toBe(0);                                // tożsamość NIEtknięta
    expect(state.rows[0].data.supplierNotifiedAt).toBeUndefined(); // NIE zapisujemy „powiadomiono"
    expect(state.rows[0].data.supplierNotifyMessageId).toBeTruthy();
  });

  it("409 typu ‚żądanie w toku’: ponawialne, też bez zapisu powiadomienia", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 409,
      text: async () => JSON.stringify({ name: "concurrent_idempotent_requests", message: "request in progress" }),
    }));

    const r = await notify(supa, [1]);
    expect(r.notifications[0]).toMatchObject({ ok: false, delivery: "in_flight", retryable: true });
    expect(r.notifications[0].status).not.toBe("sent");
    expect(state.releases).toBe(0);
    expect(state.rows[0].data.supplierNotifiedAt).toBeUndefined();
    expect(state.rows[0].data.supplierNotifyMessageId).toBeTruthy();
  });

  it("odrzucony ładunek (422) kasuje tożsamość, 500 jej nie rusza", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => "serwer poczty" }));
    const po500 = await notify(supa, [1]);
    expect(po500.notifications[0]).toMatchObject({ delivery: "unknown", claim_released: false });
    expect(state.rows[0].data.supplierNotifyMessageId).toBeTruthy();

    state.rows[0].data = {};                                 // czysty start dla drugiej części
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, text: async () => "zly ladunek" }));
    const po422 = await notify(supa, [1]);
    expect(po422.notifications[0]).toMatchObject({ delivery: "no", claim_released: true });
    expect(state.rows[0].data).toEqual({});
  });

  // ── znalezisko 6: okno 24 h nie może zależeć od znacznika niepewności ────
  it("niepotwierdzony po 25 h NIE jest ponawiany, nawet gdy znacznik niepewności się nie zapisał", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const dawno = new Date(Date.now() - WINDOW_MS - 60 * 60 * 1000).toISOString();
    // poczta przyjęła mail, ale zapis znacznika niepewności padł — tego pola NIE MA
    state.rows[0].data = {
      supplierNotifyClaimToken: "stary",
      supplierNotifyClaimedAt: dawno,
      supplierNotifyMessageId: "fmr-stary",
      supplierNotifyFirstClaimAt: dawno,
      supplierNotifyAttempts: 1,
    };
    const poczta = fakeResend({ now: () => state.now() });
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1]);
    expect(poczta.fn).not.toHaveBeenCalled();
    expect(r.notifications[0]).toMatchObject({
      ok: false, status: "needs_review",
      reason: "uncertain_outside_idempotency_window",
      legacy_ids: [1], message_ids: ["fmr-stary"],
    });
  });

  it("nieudany zapis treści wiadomości wstrzymuje wysyłkę i zwalnia rezerwację", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "ensure_legacy_send_notify_message" ? { data: null, error: { message: "boom" } } : origRpc(name, args));
    const poczta = fakeResend({ now: () => state.now() });
    globalThis.fetch = poczta.fn;

    const r = await notify(supa, [1]);
    expect(poczta.fn).not.toHaveBeenCalled();
    expect(r.notifications[0]).toMatchObject({ ok: false, status: "error", reason: "message_store_failed", claim_released: true });
    expect(state.rows[0].data).toEqual({});
  });

  it("wyścig dwóch ścieżek o tę samą wiadomość: obie wysyłają TEN SAM zapisany ładunek", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const poczta = fakeResend({ now: () => state.now() });
    globalThis.fetch = poczta.fn;
    await Promise.all([notify(supa, [1], "resend_webhook"), notify(supa, [1], "app_list")]);
    expect(poczta.wyslane).toHaveLength(1);
    expect(state.rows[0].data.supplierNotifiedAt).toBeTruthy();
  });

  // ── znalezisko 7: niepowodzenie KOLEJNEJ próby nie dowodzi, że poprzedni mail nie poszedł
  it("401 przy ponowieniu NIE kasuje tożsamości — poprzedni mail mógł pójść", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const poczta = fakeResend({ now: () => state.now() });
    // próba 1: poczta przyjmuje mail, odpowiedź do nas ginie
    globalThis.fetch = vi.fn(async (url, init) => { await poczta.fn(url, init); throw new Error("ECONNRESET"); });
    await notify(supa, [1]);
    expect(poczta.wyslane).toHaveLength(1);
    const klucz = state.rows[0].data.supplierNotifyMessageId;
    expect(klucz).toBeTruthy();

    // próba 2 po wygaśnięciu dzierżawy: poczta odrzuca (401). To dotyczy TEJ próby,
    // nie tamtego maila — kasowanie tożsamości otwierałoby drogę do dubla.
    state.now = () => Date.now() + 16 * 60 * 1000;
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, text: async () => "zly klucz api" }));
    const druga = await notify(supa, [1]);
    expect(druga.notifications[0]).toMatchObject({ delivery: "no", claim_released: false, attempt: 2 });
    expect(state.rows[0].data.supplierNotifyMessageId).toBe(klucz);
    expect(state.rows[0].data.supplierNotifyFirstClaimAt).toBeTruthy();

    // próba 3: poczta znowu działa → ten sam klucz i ładunek, więc mail nadal JEDEN
    state.now = () => Date.now() + 32 * 60 * 1000;
    globalThis.fetch = poczta.fn;
    const trzecia = await notify(supa, [1]);
    expect(poczta.wyslane).toHaveLength(1);
    expect(trzecia.notifications[0]).toMatchObject({ status: "sent", message_id: klucz, confirm_ok: true });
  });

  it("nieudany odczyt treści przy ponowieniu też nie kasuje historii", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    const poczta = fakeResend({ now: () => state.now() });
    globalThis.fetch = vi.fn(async (url, init) => { await poczta.fn(url, init); throw new Error("ECONNRESET"); });
    await notify(supa, [1]);
    const klucz = state.rows[0].data.supplierNotifyMessageId;

    state.now = () => Date.now() + 16 * 60 * 1000;
    const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) =>
      (name === "ensure_legacy_send_notify_message" ? { data: null, error: { message: "boom" } } : origRpc(name, args));
    const druga = await notify(supa, [1]);
    expect(druga.notifications[0]).toMatchObject({ reason: "message_store_failed", claim_released: false, attempt: 2 });
    expect(state.rows[0].data.supplierNotifyMessageId).toBe(klucz);
  });

  it("przy PIERWSZEJ próbie odrzucony ładunek nadal czyści wszystko", async () => {
    const { supa, state } = fakeDb([{ legacy_id: 1, offer_legacy_id: 77, title: "Awokado" }]);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, text: async () => "zly ladunek" }));
    const r = await notify(supa, [1]);
    expect(r.notifications[0]).toMatchObject({ delivery: "no", claim_released: true, attempt: 1 });
    expect(state.rows[0].data).toEqual({});
  });

  // ── znalezisko 8: przerwanie procesu gubiło część paczki ──────────────────
  it("wiadomość zapisana bez części paczki: brakującej propozycji NIE potwierdzamy", async () => {
    const { supa, state } = fakeDb([
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ]);
    const poczta = fakeResend({ now: () => state.now() });
    globalThis.fetch = poczta.fn;

    // Proces zarezerwował A+B i padł przed zapisem treści: oba wiersze mają wspólną
    // tożsamość, ale wiadomości jeszcze nie ma.
    const wspolny = "fmr-przerwany";
    const dawno = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    for (const row of state.rows) {
      row.data = { supplierNotifyClaimToken: "padl", supplierNotifyClaimedAt: dawno, supplierNotifyMessageId: wspolny, supplierNotifyFirstClaimAt: dawno, supplierNotifyAttempts: 1 };
    }

    // Następne zdarzenie dotyczy samego A → wiadomość zapisuje się TYLKO o A.
    const pierwsza = await notify(supa, [1]);
    expect(pierwsza.notifications[0]).toMatchObject({ status: "sent", legacy_ids: [1] });
    expect(poczta.wyslane[0].html).toContain("Awokado");
    expect(poczta.wyslane[0].html).not.toContain("Banany");

    // Dopiero teraz wraca B. Zapisana wiadomość go NIE zawiera, więc nie wolno
    // oznaczyć go jako powiadomionego — ma dostać własną wiadomość.
    const druga = await notify(supa, [2]);
    expect(state.rows[1].data.supplierNotifiedAt).toBeUndefined();
    expect(druga.notifications[0]).toMatchObject({ ok: false, reason: "message_missing_offers", legacy_ids: [2] });
    expect(state.rows[1].data.supplierNotifyMessageId).toBeUndefined();   // tożsamość zwolniona

    // kolejne zdarzenie buduje B własną wiadomość
    const trzecia = await notify(supa, [2]);
    expect(trzecia.notifications[0]).toMatchObject({ status: "sent", legacy_ids: [2], confirm_ok: true });
    expect(poczta.wyslane).toHaveLength(2);
    expect(poczta.wyslane[1].html).toContain("Banany");
    expect(poczta.wyslane[1].key).not.toBe(wspolny);
  });

  it("paczka częściowo objęta wiadomością: potwierdzamy tylko obecnych, resztę zwalniamy", async () => {
    const { supa, state } = fakeDb([
      { legacy_id: 1, offer_legacy_id: 77, title: "Awokado" },
      { legacy_id: 2, offer_legacy_id: 78, title: "Banany" },
    ]);
    const poczta = fakeResend({ now: () => state.now() });
    globalThis.fetch = poczta.fn;
    const wspolny = "fmr-czesciowy";
    const dawno = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    for (const row of state.rows) {
      row.data = { supplierNotifyClaimToken: "padl", supplierNotifyClaimedAt: dawno, supplierNotifyMessageId: wspolny, supplierNotifyFirstClaimAt: dawno, supplierNotifyAttempts: 1 };
    }
    // treść zapisana wcześniej obejmuje tylko A
    await supa.rpc("ensure_legacy_send_notify_message", {
      p_message_id: wspolny, p_to_email: "nobody@example.invalid", p_subject: "T", p_html: "<p>Awokado</p>", p_legacy_ids: [1],
    });

    const r = await notify(supa, [1, 2]);
    expect(r.notifications[0]).toMatchObject({
      status: "sent", legacy_ids: [1], confirm_expected: 1, released_not_in_message: [2],
    });
    expect(state.rows[0].data.supplierNotifiedAt).toBeTruthy();
    expect(state.rows[1].data.supplierNotifiedAt).toBeUndefined();
    expect(r.ok).toBe(false);   // paczka nie została obsłużona w całości
  });
});
