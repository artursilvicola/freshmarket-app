// [feat/email-open-history] Webhook Resend: zapisz → przetwórz → potwierdź.
//
// Atrapa bazy odwzorowuje kontrakt RPC z migracji 20261022120000 (ingest z deduplikacją
// po svix-id, orphan bez powiązania, finish) oraz mark_legacy_send_seen (rozliczenie
// idempotentne po znaczniku). Podpis Svix liczony naprawdę — HMAC jak w produkcji.
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const state = vi.hoisted(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.supa }));
vi.mock("../netlify/functions/_shared/function-env.js", () => ({
  resolveEnvConfig: () => ({ supabaseUrl: "https://fake.test", supabaseServiceRoleKey: "svc", resendWebhookSecret: "whsec_" + Buffer.from("tajne").toString("base64"), resendApiKey: "fake", b2bAppUrl: "https://fake.test" }),
  missingEnvNames: () => [], envErrorPayload: () => ({}),
}));
vi.mock("../netlify/functions/_shared/supplier-read-notify.js", () => ({
  notifySupplierOffersRead: vi.fn(async ({ legacyIds }) => ({ ok: true, status: "sent", notifications: legacyIds.map((id) => ({ status: "sent", legacy_ids: [id] })) })),
}));
import { handler } from "../netlify/functions/resend-webhook.js";

function fakeDb({ messages = {}, sends = [], profiles = [] } = {}) {
  const db = {
    messages,                       // resend_message_id -> { retailer_id, buyer_profile_id, legacy_ids }
    profiles,                       // [{ id, email }]
    recorded: [],                   // wywołania record_legacy_send_message
    events: new Map(),              // event_id -> row
    sends: new Map(sends.map((s) => [s.legacy_id, { id: "uuid-" + s.legacy_id, supplier_legacy_id: "sup-1", retailer_id: 1, status: "sent", data: {}, ...s }])),
    charges: 0, failSeen: 0, failIngest: false, failFinish: false,
  };
  const supa = {
    from(table) {
      const q = {
        _table: table, _filters: [],
        select() { return q; }, eq(col, val) { q._filters.push([col, val]); return q; },
        in(col, vals) { q._filters.push([col, vals]); return q; },
        contains(col, val) { q._filters.push(["contains:" + col, val]); return q; },
        limit() { return q; },
        async maybeSingle() {
          if (table === "legacy_send_messages") {
            const id = q._filters.find(([c]) => c === "resend_message_id")?.[1];
            const m = db.messages[id];
            return { data: m ? { legacy_ids: m.legacy_ids } : null, error: null };
          }
          if (table === "companies") return { data: { id: "company-1" }, error: null };
          if (table === "profiles") {
            const email = q._filters.find(([c]) => c === "email")?.[1];
            const p = db.profiles.find((x) => x.email === email);
            return { data: p ? { id: p.id } : null, error: null };
          }
          return { data: null, error: null };
        },
        then(res, rej) {
          if (table === "legacy_sends") {
            if (db.failLegacyLookup) return Promise.resolve({ data: null, error: { message: "lookup down" } }).then(res, rej);
            const all = [...db.sends.values()];
            const byCol = q._filters.find(([c]) => c === "resend_message_id")?.[1];
            if (byCol !== undefined) return Promise.resolve({ data: all.filter((s) => s.resend_message_id === byCol).map((s) => structuredClone(s)), error: null }).then(res, rej);
            const byJson = q._filters.find(([c]) => c === "contains:data")?.[1];
            if (byJson) return Promise.resolve({ data: all.filter((s) => (s.data?.resendMessageIds || []).includes(byJson.resendMessageIds[0])).map((s) => structuredClone(s)), error: null }).then(res, rej);
            const ids = q._filters.find(([c]) => c === "legacy_id")?.[1] || [];
            return Promise.resolve({ data: ids.map((id) => structuredClone(db.sends.get(Number(id)))).filter(Boolean), error: null }).then(res, rej);
          }
          return Promise.resolve({ data: [], error: null }).then(res, rej);
        },
      };
      return q;
    },
    async rpc(name, args) {
      if (name === "ingest_legacy_send_email_event") {
        if (db.failIngest) return { data: null, error: { message: "db down" } };
        const ex = db.events.get(args.p_event_id);
        if (ex) return { data: { duplicate: true, status: ex.status, event_type: ex.event_type, resend_message_id: ex.resend_message_id }, error: null };
        const m = db.messages[args.p_resend_message_id];
        const known = ["email.sent", "email.delivered", "email.opened", "email.clicked", "email.bounced", "email.complained", "email.delivery_delayed"].includes(args.p_event_type);
        const status = !known ? "ignored" : m ? "pending" : "orphan";
        db.events.set(args.p_event_id, { event_id: args.p_event_id, event_type: args.p_event_type, resend_message_id: args.p_resend_message_id, status, attempts: 0 });
        return { data: { duplicate: false, status, event_type: args.p_event_type, resend_message_id: args.p_resend_message_id, message_known: !!m, legacy_ids: m ? m.legacy_ids : [], retailer_id: m?.retailer_id ?? null, buyer_profile_id: m?.buyer_profile_id ?? null }, error: null };
      }
      if (name === "finish_legacy_send_email_event") {
        if (db.failFinish) return { data: null, error: { message: "finish down" } };
        const ev = db.events.get(args.p_event_id);
        if (!ev) return { data: 0, error: null };
        ev.status = args.p_status; ev.attempts += 1; ev.last_error = args.p_error ?? null; ev.result = args.p_result ?? ev.result;
        return { data: 1, error: null };
      }
      if (name === "mark_legacy_send_seen") {
        if (db.failSeen > 0) { db.failSeen -= 1; return { data: null, error: { message: "40001 serialization" } }; }
        const row = [...db.sends.values()].find((s) => s.id === args.p_send_id);
        if (!row) return { data: null, error: { message: "not found" } };
        if (!["sent", "opened", "read", "read_manual"].includes(row.status)) return { data: { skipped: true, reason: "status_" + row.status, status: row.status, data: row.data }, error: null };
        const prev = row.status;
        const next = args.p_channel === "email" ? (prev === "sent" ? "opened" : prev) : (["sent", "opened"].includes(prev) ? "read" : prev);
        row.status = next;
        row.data = { ...row.data, status: next, seenAt: row.data.seenAt || args.p_now, emailOpenedAt: args.p_channel === "email" ? (row.data.emailOpenedAt || args.p_now) : row.data.emailOpenedAt };
        let billing;
        if (row.data.billingStatus === "charged") billing = { charged: false, already_charged: true, billing_status: "charged" };
        else { db.charges += 1; row.data.billingStatus = "charged"; row.data.chargeTxId = "tx-" + db.charges; billing = { charged: true, already_charged: false, billing_status: "charged", charge_tx_id: row.data.chargeTxId }; }
        return { data: { skipped: false, previous_status: prev, status: next, data: structuredClone(row.data), billing, supplier_notified_before: !!row.data.supplierNotifiedAt }, error: null };
      }
      if (name === "record_legacy_send_app_read") return { data: { first: true }, error: null };
      if (name === "record_legacy_send_message") {
        db.recorded.push(args);
        if (!db.messages[args.p_resend_message_id]) {
          db.messages[args.p_resend_message_id] = { retailer_id: args.p_retailer_id, buyer_profile_id: args.p_buyer_profile_id, legacy_ids: args.p_legacy_ids, to_email: args.p_to_email, send_key: args.p_send_key };
        }
        const pending = [];
        for (const ev of db.events.values()) {
          if (ev.resend_message_id === args.p_resend_message_id && ev.status === "orphan") ev.status = "pending";
          if (ev.resend_message_id === args.p_resend_message_id && ev.status === "pending") pending.push({ event_id: ev.event_id, event_type: ev.event_type });
        }
        return { data: { recorded: true, pending_events: pending }, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "not found: " + name } };
    },
  };
  return { supa, db };
}

const SECRET = Buffer.from("tajne");
function signed(body, { id = "msg_" + Math.random().toString(36).slice(2), ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", SECRET).update(`${id}.${ts}.${raw}`).digest("base64");
  return { httpMethod: "POST", headers: { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": "v1," + sig }, body: raw };
}
const opened = (emailId, extra = {}) => ({ type: "email.opened", created_at: "2026-10-22T10:00:00.000Z", data: { email_id: emailId, to: ["x@example.invalid"] }, ...extra });
const call = async (ev) => { const r = await handler(ev); return { status: r.statusCode, body: JSON.parse(r.body) }; };

describe("resend-webhook — zapisz, przetwórz, potwierdź", () => {
  beforeEach(() => { state.supa = null; });

  it("zła sygnatura / brak nagłówków / stary timestamp → 200 ignored, bez dotykania bazy", async () => {
    const { supa, db } = fakeDb(); state.supa = supa;
    const ev = signed(opened("m1")); ev.headers["svix-signature"] = "v1,AAAA";
    expect((await call(ev)).body.ignored).toBe("bad_signature");
    expect((await call({ httpMethod: "POST", headers: {}, body: "{}" })).body.ignored).toBe("missing_svix_headers");
    expect((await call(signed(opened("m1"), { ts: Math.floor(Date.now() / 1000) - 3600 }))).body.ignored).toBe("stale_timestamp");
    expect(db.events.size).toBe(0);
  });

  it("otwarcie znanej wiadomości rozlicza TYLKO jej propozycje i oznacza zdarzenie processed", async () => {
    const { supa, db } = fakeDb({
      messages: { "m-anna": { retailer_id: 1, buyer_profile_id: "anna", legacy_ids: [101, 102] } },
      sends: [{ legacy_id: 101 }, { legacy_id: 102 }, { legacy_id: 103 }],   // 103 do tej sieci, ale NIE w tym mailu
    });
    state.supa = supa;
    const r = await call(signed(opened("m-anna"), { id: "svix-1" }));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("processed");
    expect(db.charges).toBe(2);
    expect(db.sends.get(103).status).toBe("sent");          // nietknięta
    expect(db.sends.get(101).data.emailOpenedAt).toBeTruthy();
    expect(db.events.get("svix-1").status).toBe("processed");
  });

  it("dwóch kupców jednej sieci, ten sam zestaw: drugi mail NIE pobiera kredytu drugi raz", async () => {
    const { supa, db } = fakeDb({
      messages: { "m-anna": { retailer_id: 1, buyer_profile_id: "anna", legacy_ids: [101] }, "m-bartek": { retailer_id: 1, buyer_profile_id: "bartek", legacy_ids: [101] } },
      sends: [{ legacy_id: 101 }],
    });
    state.supa = supa;
    await call(signed(opened("m-anna"), { id: "svix-a" }));
    const r = await call(signed(opened("m-bartek"), { id: "svix-b" }));
    expect(db.charges).toBe(1);
    expect(r.body.results[0].billing.alreadyCharged).toBe(true);
    expect(db.events.get("svix-b").status).toBe("processed");  // historia zapisana mimo braku pobrania
  });

  it("powtórzenie tego samego webhooka (ten sam svix-id) nie dubluje ani historii, ani rozliczenia", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101] } }, sends: [{ legacy_id: 101 }] });
    state.supa = supa;
    const ev = signed(opened("m1"), { id: "svix-dup" });
    await call(ev);
    const r = await call(ev);
    expect(r.body.duplicate).toBe(true);
    expect(db.charges).toBe(1);
    expect(db.events.size).toBe(1);
  });

  it("równoczesne otwarcia tej samej wiadomości: jedno rozliczenie", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101] } }, sends: [{ legacy_id: 101 }] });
    state.supa = supa;
    await Promise.all([call(signed(opened("m1"), { id: "svix-x" })), call(signed(opened("m1"), { id: "svix-y" }))]);
    expect(db.charges).toBe(1);
    expect([...db.events.values()].every((e) => e.status === "processed")).toBe(true);
  });

  it("zdarzenie PRZED powiązaniem → 200 orphan, nic nie rozliczone, zdarzenie zachowane", async () => {
    const { supa, db } = fakeDb({ sends: [{ legacy_id: 101 }] });
    state.supa = supa;
    const r = await call(signed(opened("m-nieznana"), { id: "svix-o" }));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("orphan");
    expect(db.charges).toBe(0);
    expect(db.events.get("svix-o").status).toBe("orphan");
  });

  it("mail niezwiązany z propozycjami (logowanie) → orphan, nigdy nie rozlicza", async () => {
    const { supa, db } = fakeDb({ sends: [{ legacy_id: 101 }] });
    state.supa = supa;
    const r = await call(signed({ type: "email.opened", created_at: "2026-10-22T10:00:00Z", data: { email_id: "m-login", subject: "Link logowania" } }, { id: "svix-l" }));
    expect(r.body.status).toBe("orphan");
    expect(db.charges).toBe(0);
  });

  it("wygasła propozycja: zdarzenie zapisane, status skipped, bez obciążenia", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101] } }, sends: [{ legacy_id: 101, status: "unread_expired" }] });
    state.supa = supa;
    const r = await call(signed(opened("m1"), { id: "svix-e" }));
    expect(r.status).toBe(200);
    expect(r.body.results[0].status).toBe("skipped");
    expect(db.charges).toBe(0);
    expect(db.sends.get(101).status).toBe("unread_expired");
    expect(db.events.get("svix-e").status).toBe("processed");
  });

  it("awaria bazy przy zapisie zdarzenia → 500 (Svix ponawia), nic nie przetworzone", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101] } }, sends: [{ legacy_id: 101 }] });
    db.failIngest = true; state.supa = supa;
    const r = await call(signed(opened("m1"), { id: "svix-f" }));
    expect(r.status).toBe(500);
    expect(r.body.retry).toBe(true);
    expect(db.charges).toBe(0);
  });

  it("przejściowy błąd rozliczenia → zdarzenie w error, 500; ponowienie Svixa kończy bez dubla", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101] } }, sends: [{ legacy_id: 101 }] });
    db.failSeen = 1; state.supa = supa;
    const ev = signed(opened("m1"), { id: "svix-r" });
    const r1 = await call(ev);
    expect(r1.status).toBe(500);
    expect(db.events.get("svix-r").status).toBe("error");
    expect(db.charges).toBe(0);
    const r2 = await call(ev);                     // ta sama dostawa, ponowiona przez Svix
    expect(r2.status).toBe(200);
    expect(db.events.get("svix-r").status).toBe("processed");
    expect(db.charges).toBe(1);
  });

  it("delivered / bounced → tylko historia, bez rozliczenia", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101] } }, sends: [{ legacy_id: 101 }] });
    state.supa = supa;
    const r = await call(signed({ type: "email.delivered", created_at: "2026-10-22T09:00:00Z", data: { email_id: "m1" } }, { id: "svix-d" }));
    expect(r.body.history_only).toBe(true);
    expect(db.charges).toBe(0);
    expect(db.events.get("svix-d").status).toBe("processed");
  });
});

// [review 22.10] fallback po legacy_sends (maile sprzed historii per kupiec), otwarcie przed `sent`, scrub click
describe("resend-webhook — poprawki po review 22.10", () => {
  beforeEach(() => { state.supa = null; });

  it("mail sprzed wdrożenia (brak powiązania, ale legacy_sends.resend_message_id) → rozliczony jak w starym webhooku, powiązanie dopisane", async () => {
    const { supa, db } = fakeDb({
      sends: [{ legacy_id: 101, resend_message_id: "m-old" }, { legacy_id: 102, resend_message_id: "m-old" }, { legacy_id: 103, resend_message_id: "m-inny" }],
      profiles: [{ id: "prof-anna", email: "anna@siec.test" }],
    });
    state.supa = supa;
    const r = await call(signed(opened("m-old", { data: { email_id: "m-old", to: ["Anna@siec.test"] } }), { id: "svix-old" }));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("processed");
    expect(r.body.linked_from_legacy_sends).toBe(true);
    expect(db.charges).toBe(2);                                   // 101 i 102, NIE 103
    expect(db.sends.get(103).status).toBe("sent");
    expect(db.recorded).toHaveLength(1);
    expect(db.recorded[0]).toMatchObject({ p_resend_message_id: "m-old", p_retailer_id: 1, p_buyer_profile_id: "prof-anna", p_to_email: "anna@siec.test", p_legacy_ids: [101, 102], p_send_key: "fallback:m-old" });
    expect(db.events.get("svix-old").status).toBe("processed");
    // powtórka tego samego webhooka: nic więcej
    const r2 = await call(signed(opened("m-old", { data: { email_id: "m-old", to: ["Anna@siec.test"] } }), { id: "svix-old" }));
    expect(r2.body.duplicate).toBe(true);
    expect(db.charges).toBe(2);
  });

  it("mail sprzed wdrożenia z id tylko w data.resendMessageIds → też rozliczony", async () => {
    const { supa, db } = fakeDb({ sends: [{ legacy_id: 101, data: { resendMessageIds: ["m-json", "m-json-2"] } }] });
    state.supa = supa;
    const r = await call(signed(opened("m-json"), { id: "svix-json" }));
    expect(r.body.status).toBe("processed");
    expect(db.charges).toBe(1);
    expect(db.recorded[0].p_buyer_profile_id).toBeNull();          // adres bez profilu — powiązanie i tak jest
  });

  it("awaria bazy w fallbacku → 500 (Svix ponowi), zdarzenie zachowane, nic nie rozliczone", async () => {
    const { supa, db } = fakeDb({ sends: [{ legacy_id: 101, resend_message_id: "m-old" }] });
    db.failLegacyLookup = true; state.supa = supa;
    const r = await call(signed(opened("m-old"), { id: "svix-fb" }));
    expect(r.status).toBe(500);
    expect(db.charges).toBe(0);
    expect(db.events.get("svix-fb").status).toBe("orphan");
    db.failLegacyLookup = false;
    const r2 = await call(signed(opened("m-old"), { id: "svix-fb" }));   // ponowienie Svixa
    expect(r2.status).toBe(200);
    expect(db.charges).toBe(1);
  });

  it("otwarcie w trakcie batcha (wiersz jeszcze `approved`) → 500 i ponowienie po oznaczeniu `sent` rozlicza raz", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101, 102] } }, sends: [{ legacy_id: 101, status: "approved" }, { legacy_id: 102, status: "sent" }] });
    state.supa = supa;
    const ev = signed(opened("m1"), { id: "svix-early" });
    const r1 = await call(ev);
    expect(r1.status).toBe(500);
    expect(r1.body.error).toBe("not_yet_marked_sent");
    expect(db.events.get("svix-early").status).toBe("error");
    expect(db.charges).toBe(1);                                   // 102 było `sent` — rozliczone od razu
    db.sends.get(101).status = "sent";                            // batch skończył oznaczanie
    const r2 = await call(ev);
    expect(r2.status).toBe(200);
    expect(db.events.get("svix-early").status).toBe("processed");
    expect(db.charges).toBe(2);                                   // 101 dorozliczone, 102 bez dubla
  });

  it("z kliknięcia do rejestru trafia tylko czas — bez linku z tokenem, IP i user-agenta", async () => {
    const { supa, db } = fakeDb({ messages: { "m1": { retailer_id: 1, legacy_ids: [101] } }, sends: [{ legacy_id: 101 }] });
    const ingestArgs = []; const origRpc = supa.rpc.bind(supa);
    supa.rpc = async (name, args) => { if (name === "ingest_legacy_send_email_event") ingestArgs.push(args); return origRpc(name, args); };
    state.supa = supa;
    await call(signed({ type: "email.clicked", created_at: "2026-10-22T10:00:00Z", data: { email_id: "m1", click: { link: "https://x/auth?token=SEKRET", ipAddress: "1.2.3.4", userAgent: "UA", timestamp: "2026-10-22T10:00:01Z" } } }, { id: "svix-c" }));
    expect(ingestArgs[0].p_payload.data.click).toEqual({ timestamp: "2026-10-22T10:00:01Z" });
    expect(JSON.stringify(ingestArgs[0].p_payload)).not.toContain("SEKRET");
    expect(db.charges).toBe(0);
  });
});
