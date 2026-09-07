#!/usr/bin/env node
// [feat/fm-queue] Testy wspolbieznosci i sesji na TESTOWYM projekcie Supabase (nie prod!).
// Wymaga PostgREST + GoTrue + Realtime, wiec nie da sie ich uruchomic na golym Postgresie.
//
//   (1) dwa rownoczesne zadania z TYM SAMYM kluczem idempotencji = jedna operacja, jeden wpis logu
//   (2) dwa stanowiska rownolegle wywoluja rozne numery
//   (3) zalew 20 rownoczesnych call_next na jednym stanowisku = dokladnie 1 sukces
//   (4) rownoczesne PIERWSZE logowanie z dwoch urzadzen (login_result) = tylko jedno przypiete;
//       opcjonalnie to samo przez endpoint staff-login (STAFF_LOGIN_URL + STAFF_PIN_PEPPER)
//   (5) rownolegly brute force blednego PIN-u: 40 x login_gate naraz = max 4 przepuszczone, reszta FM_LOCKED
//   (6) reset PIN-u: stary access token odrzucany przez RPC, stary refresh token nie odswieza sesji
//   (7) Realtime: dwa klienty (tablety) dostaja zmiane fm_stations po call_next
//
// Uruchomienie (PowerShell):
//   $env:TEST_SUPABASE_URL="https://xxxx.supabase.co"; $env:TEST_SERVICE_ROLE_KEY="..."; $env:TEST_ANON_KEY="..."
//   node scripts/fm-queue-concurrency-test.mjs
// Skrypt tworzy fixtures z prefiksem CONC-TEST i sprzata po sobie.
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const url = process.env.TEST_SUPABASE_URL, key = process.env.TEST_SERVICE_ROLE_KEY, anonKey = process.env.TEST_ANON_KEY || key;
if (!url || !key) { console.error("Ustaw TEST_SUPABASE_URL, TEST_SERVICE_ROLE_KEY (i TEST_ANON_KEY) — baza TESTOWA."); process.exit(2); }
if (/sklyfuvzjikkqerxtulo/.test(url)) { console.error("ODMOWA: to wyglada na projekt produkcyjny."); process.exit(2); }
const svc = createClient(url, key, { auth: { persistSession: false } });
const idem = () => `conc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let fails = 0;
const fail = (m) => { console.error("FAIL", m); fails++; };
const ok = (c, m) => (c ? console.log("ok  ", m) : fail(m));
const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Warsaw" })).toISOString().slice(0, 10);
const RPC = "/rest/v1/rpc/";

async function makeStaff(code, password) {
  const email = `${code.toLowerCase()}@conc-test.local`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "staff", staff_code: code } });
  if (error) throw error;
  await svc.from("profiles").upsert({ id: u.user.id, email, role: "staff" });
  const { error: sErr } = await svc.from("fm_staff").insert({ id: u.user.id, code, event_date: today, pin_rotated_at: new Date(Date.now() - 60_000).toISOString() });
  if (sErr) throw sErr;
  return { id: u.user.id, email, password, code };
}
async function loginAs(email, password) {
  const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const asUser = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } });
  return { session: data.session, client: asUser };
}
const rpcAs = (client) => (name, params) => client.rpc(name, params).then(r => (r.error ? { error: r.error } : { data: r.data }));

const created = { users: [], retailer: null, channels: [] };
try {
  const pw = `Pw-${Math.random().toString(36).slice(2)}!x9`;
  const op = await makeStaff("CONC-TEST-OP", pw);
  created.users.push(op.id);
  const { data: ret, error: rErr } = await svc.from("retailers").insert({ id: 990009, name: "CONC-TEST Siec", fm26_active: true, fm26_chain_id: "conc-test" }).select().single();
  if (rErr) throw rErr;
  created.retailer = ret.id;
  const { data: g } = await svc.from("fm_queue_groups").insert({ event_date: today, retailer_id: ret.id }).select().single();
  const { data: st } = await svc.from("fm_stations").insert([{ queue_group_id: g.id, idx: 1 }, { queue_group_id: g.id, idx: 2 }]).select();
  const [s1, s2] = st.sort((a, b) => a.idx - b.idx);
  const { data: cos } = await svc.from("companies").insert(Array.from({ length: 6 }, (_, i) => ({ name: `CONC-TEST Firma ${i + 1}` }))).select();
  await svc.from("fm_queue_meetings").insert(cos.map((c, i) => ({ queue_group_id: g.id, company_id: c.id, nr: i + 1 })));
  await svc.from("fm_queue_assignments").insert({ operator_id: op.id, queue_group_id: g.id });
  const me = await loginAs(op.email, op.password);
  const rpc = rpcAs(me.client);

  // (7) Realtime — dwa tablety subskrybuja fm_stations przed operacjami
  const rtHits = [0, 0];
  const rtClients = [0, 1].map(i => createClient(url, anonKey, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 10 } } }));
  for (const [i, c] of rtClients.entries()) {
    await c.realtime.setAuth(me.session.access_token);
    const ch = c.channel(`conc-rt-${i}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "fm_stations" }, () => { rtHits[i]++; });
    await new Promise((res) => ch.subscribe((status) => { if (status === "SUBSCRIBED") res(); }));
    created.channels.push([c, ch]);
  }

  // (1) ten sam klucz idempotencji rownoczesnie
  const r0 = await rpc("fm_queue_open_station", { p_station_id: s1.id, p_expected_version: 0, p_idem: idem() });
  if (r0.error) throw new Error("open_station: " + r0.error.message);
  const k = idem();
  const both = await Promise.all([rpc("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: r0.data.version, p_idem: k }), rpc("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: r0.data.version, p_idem: k })]);
  ok(both.every(r => !r.error && r.data?.current?.nr === 1), "(1) oba zadania z tym samym kluczem zwrocily stan z nr 1 (bez bledu)");
  const { count: logCount } = await svc.from("fm_queue_log").select("*", { count: "exact", head: true }).eq("idempotency_key", k);
  ok(logCount === 1, `(1) jeden wpis logu dla klucza (jest ${logCount})`);

  // (2) dwa stanowiska rownolegle
  const r2 = await rpc("fm_queue_open_station", { p_station_id: s2.id, p_expected_version: 0, p_idem: idem() });
  const [a, b] = await Promise.all([
    rpc("fm_queue_finish_and_call_next", { p_station_id: s1.id, p_expected_version: both[0].data.version, p_idem: idem(), p_call_next: true }),
    rpc("fm_queue_call_next", { p_station_id: s2.id, p_expected_version: r2.data.version, p_idem: idem() }),
  ]);
  const nrs = [a.data?.current?.nr, b.data?.current?.nr].sort();
  ok(!a.error && !b.error && nrs.join(",") === "2,3", `(2) rownolegle stanowiska dostaly rozne numery: ${nrs.join(",")}`);

  // (3) zalew 20 rownoczesnych call_next
  const fin = await rpc("fm_queue_finish_and_call_next", { p_station_id: s1.id, p_expected_version: a.data.version, p_idem: idem(), p_call_next: false });
  const flood = await Promise.all(Array.from({ length: 20 }, () => rpc("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: fin.data.version, p_idem: idem() })));
  const successes = flood.filter(r => !r.error).length;
  const conflicts = flood.filter(r => r.error && /FM_CONFLICT|FM_STATION_BUSY/.test(r.error.message)).length;
  ok(successes === 1 && conflicts === 19, `(3) zalew: 1 sukces, 19 konfliktow (jest ${successes}/${conflicts})`);
  const { data: g2 } = await svc.from("fm_queue_groups").select("last_called_nr").eq("id", g.id).single();
  ok(g2.last_called_nr === 4, `(3) last_called_nr = 4 (jest ${g2.last_called_nr})`);

  // (7) Realtime: oba tablety dostaly aktualizacje
  await new Promise(r => setTimeout(r, 3000));
  ok(rtHits[0] > 0 && rtHits[1] > 0, `(7) Realtime: tablet A ${rtHits[0]} zdarzen, tablet B ${rtHits[1]} zdarzen (oba > 0)`);

  // (4) dwa urzadzenia — pierwsze logowanie rownoczesnie (poziom bazy: login_result)
  const dev = await makeStaff("CONC-TEST-DEV", pw); created.users.push(dev.id);
  const [dA, dB] = await Promise.all([
    svc.rpc("fm_staff_login_result", { p_code: dev.code, p_ip: "10.9.9.1", p_success: true, p_device: "dev-tablet-AAAA0001" }),
    svc.rpc("fm_staff_login_result", { p_code: dev.code, p_ip: "10.9.9.1", p_success: true, p_device: "dev-tablet-BBBB0002" }),
  ]);
  const oks = [dA.data?.ok, dB.data?.ok].filter(Boolean).length;
  ok(oks === 1 && [dA.data, dB.data].some(d => d?.reason === "FM_DEVICE_MISMATCH"), `(4) rownoczesne pierwsze logowanie z 2 urzadzen: 1 przypiete, 1 FM_DEVICE_MISMATCH (ok=${oks})`);
  if (process.env.STAFF_LOGIN_URL && process.env.STAFF_PIN_PEPPER) {
    // pelna sciezka przez funkcje Netlify: konto z haslem HMAC(pepper, KOD:PIN), dwa POST-y naraz
    const pin = "480117", code = "CONC-TEST-HTTP";
    const password = createHmac("sha256", process.env.STAFF_PIN_PEPPER).update(`${code}:${pin}`).digest("base64url");
    const http = await makeStaff(code, password); created.users.push(http.id);
    // e-mail musi byc taki, jakiego uzywa funkcja (<kod>@obsluga.freshmarket.eu)
    await svc.auth.admin.updateUserById(http.id, { email: `${code.toLowerCase()}@obsluga.freshmarket.eu`, email_confirm: true });
    const post = (device) => fetch(process.env.STAFF_LOGIN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, pin, device_id: device }) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const [hA, hB] = await Promise.all([post("http-tablet-AAAA0001"), post("http-tablet-BBBB0002")]);
    const got = [hA, hB].filter(r => r.status === 200 && r.body.access_token).length;
    ok(got === 1, `(4b) staff-login: dokladnie jeden tablet dostal tokeny (${hA.status}/${hB.status}, ${hA.body.code || "ok"}/${hB.body.code || "ok"})`);
  } else {
    console.log("skip (4b) staff-login przez HTTP — ustaw STAFF_LOGIN_URL i STAFF_PIN_PEPPER (deploy preview / netlify dev)");
  }

  // (5) rownolegly brute force: 40 x gate naraz dla jednego kodu
  const bf = await makeStaff("CONC-TEST-BF", pw); created.users.push(bf.id);
  const gates = await Promise.all(Array.from({ length: 40 }, (_, i) => svc.rpc("fm_staff_login_gate", { p_code: bf.code, p_ip: "10.9.9.2", p_device: `bf-tablet-${String(i).padStart(4, "0")}` })));
  const allowed = gates.filter(r => r.data?.allowed).length;
  const locked = gates.filter(r => r.data?.reason === "FM_LOCKED").length;
  ok(allowed <= 4 && allowed + locked === 40, `(5) brute force 40 naraz: przepuszczone ${allowed} (max 4), FM_LOCKED ${locked}`);

  // (6) reset PIN-u: stary access token i refresh token przestaja dzialac
  const before = await rpc("fm_queue_my_stations", { p_event_date: today });
  ok(!before.error, "(6) przed rotacja: my_stations OK");
  const { error: revErr } = await svc.rpc("fm_staff_revoke_sessions", { p_user: op.id, p_rotate_pin: true });
  if (revErr) throw revErr;
  const after = await rpc("fm_queue_my_stations", { p_event_date: today });
  ok(after.error && /FM_FORBIDDEN/.test(after.error.message), `(6) po rotacji: stary access token -> FM_FORBIDDEN (${after.error?.message?.slice(0, 40) || "brak bledu"})`);
  const refreshC = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: refErr } = await refreshC.auth.refreshSession({ refresh_token: me.session.refresh_token });
  ok(Boolean(refErr), `(6) stary refresh token odrzucony (${refErr?.message || "ODSWIEZYL SESJE!"})`);
} catch (e) {
  fail(e.message || String(e));
} finally {
  for (const [c, ch] of created.channels) { try { await c.removeChannel(ch); } catch { /* noop */ } }
  if (created.retailer) await svc.from("retailers").delete().eq("id", created.retailer);
  await svc.from("companies").delete().like("name", "CONC-TEST%");
  for (const id of created.users) await svc.auth.admin.deleteUser(id).catch(() => {});
  await svc.from("fm_queue_log").delete().like("idempotency_key", "conc-%");
  await svc.from("fm_login_attempts").delete().like("code", "CONC-TEST%");
  console.log(fails ? `❌ testy wspolbieznosci: ${fails} FAIL` : "✅ testy wspolbieznosci: OK");
  process.exit(fails ? 1 : 0);
}
