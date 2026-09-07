#!/usr/bin/env node
// [feat/fm-queue] Testy hostowane na TESTOWYM projekcie Supabase + deploy preview Netlify (nie prod!).
// Wszystkie czesci sa OBOWIAZKOWE — skrypt nie pomija zadnej (brak zmiennej = exit 2).
//
// Wymagane zmienne (PowerShell): $env:TEST_SUPABASE_URL, $env:TEST_SERVICE_ROLE_KEY, $env:TEST_ANON_KEY
//   (osobny klucz anon — bez fallbacku), $env:STAFF_LOGIN_URL (np. https://deploy-preview-123--freshmarketb2b.netlify.app/.netlify/functions/staff-login)
//   ADMIN_STAFF_URL wyprowadzany z STAFF_LOGIN_URL (ta sama baza + /admin-staff).
//
//   (1) dwa rownoczesne zadania z TYM SAMYM kluczem idempotencji = jedna operacja, jeden wpis logu
//   (2) dwa stanowiska rownolegle wywoluja rozne numery
//   (3) zalew 20 rownoczesnych call_next na jednym stanowisku = dokladnie 1 sukces
//   (4) pelna sciezka Netlify -> GoTrue -> RPC: rownoczesne pierwsze logowanie z 2 urzadzen = jeden dostaje tokeny
//   (5) brute force przez prawdziwy endpoint: 40 x zly PIN naraz -> max 5 sprawdzonych (FM_BAD_CREDENTIALS),
//       potem poprawny PIN -> FM_LOCKED; osobne konto: 4 zle + poprawny przy 5. probie = 200
//   (6) reset PIN-u przez admin-staff: stary access token -> FM_FORBIDDEN, stary refresh token odrzucony
//   (7) Realtime: dwa NIEZALEZNE konta operatorow (dwie sesje z endpointu) dostaja zmiane fm_stations
//   (8) blokada przez admin-staff: logowanie -> FM_BLOCKED, stary token -> FM_FORBIDDEN; odblokowanie dziala
// Skrypt tworzy fixtures z prefiksem CONC-TEST (siec 990009) i sprzata po sobie.
import { createClient } from "@supabase/supabase-js";

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Brak zmiennej ${k} (wymagana, bez fallbacku).`); process.exit(2); } return v; };
const url = need("TEST_SUPABASE_URL"), key = need("TEST_SERVICE_ROLE_KEY"), anonKey = need("TEST_ANON_KEY"), loginUrl = need("STAFF_LOGIN_URL");
if (anonKey === key) { console.error("TEST_ANON_KEY nie moze byc kluczem service role."); process.exit(2); }
if (/sklyfuvzjikkqerxtulo|b2b\.freshmarket\.eu/.test(url + loginUrl)) { console.error("ODMOWA: to wyglada na produkcje."); process.exit(2); }
const adminUrl = loginUrl.replace(/staff-login(\?.*)?$/, "admin-staff");

const svc = createClient(url, key, { auth: { persistSession: false } });
const idem = () => `conc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let fails = 0;
const fail = (m) => { console.error("FAIL", m); fails++; };
const ok = (c, m) => (c ? console.log("ok  ", m) : fail(m));
const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Warsaw" })).toISOString().slice(0, 10);
const post = (u, body, token) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = (code, pin, device) => post(loginUrl, { code, pin, device_id: device });
const asToken = (t) => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${t}` } } });
const rpcAs = (client) => (name, params) => client.rpc(name, params).then(r => (r.error ? { error: r.error } : { data: r.data }));
const wrongPin = (pin) => String((Number(pin) + 1) % 1_000_000).padStart(6, "0");

const created = { users: [], retailer: null, channels: [] };
try {
  // super admin do endpointu admin-staff (konto testowe, haslo losowe)
  const adminPw = `Adm-${Math.random().toString(36).slice(2)}!x9`;
  const { data: adm, error: aErr } = await svc.auth.admin.createUser({ email: `conc-test-admin-${Date.now()}@conc-test.local`, password: adminPw, email_confirm: true, app_metadata: { role: "admin" } });
  if (aErr) throw aErr;
  created.users.push(adm.user.id);
  await svc.from("profiles").upsert({ id: adm.user.id, email: adm.user.email, role: "admin", admin_level: "super" });
  const admC = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admS, error: alErr } = await admC.auth.signInWithPassword({ email: adm.user.email, password: adminPw });
  if (alErr) throw alErr;
  const adminToken = admS.session.access_token;
  const createStaff = async (code) => {
    const r = await post(adminUrl, { action: "create", code, event_date: today }, adminToken);
    if (r.status !== 200) throw new Error(`admin-staff create ${code}: ${r.status} ${r.body.error || ""}`);
    created.users.push(r.body.id);
    return { id: r.body.id, code: r.body.code, pin: r.body.pin };
  };

  // fixtures kolejki
  const { data: ret, error: rErr } = await svc.from("retailers").insert({ id: 990009, name: "CONC-TEST Siec", fm26_active: true, fm26_chain_id: "conc-test" }).select().single();
  if (rErr) throw rErr;
  created.retailer = ret.id;
  const { data: g } = await svc.from("fm_queue_groups").insert({ event_date: today, retailer_id: ret.id }).select().single();
  const { data: st } = await svc.from("fm_stations").insert([{ queue_group_id: g.id, idx: 1 }, { queue_group_id: g.id, idx: 2 }]).select();
  const [s1, s2] = st.sort((a, b) => a.idx - b.idx);
  const { data: cos } = await svc.from("companies").insert(Array.from({ length: 8 }, (_, i) => ({ name: `CONC-TEST Firma ${i + 1}` }))).select();
  await svc.from("fm_queue_meetings").insert(cos.map((c, i) => ({ queue_group_id: g.id, company_id: c.id, nr: i + 1 })));

  // dwa niezalezne konta operatorow, oba zalogowane PRZEZ ENDPOINT
  const op1 = await createStaff("CONC-TEST-OP1"), op2 = await createStaff("CONC-TEST-OP2");
  await svc.from("fm_queue_assignments").insert([{ operator_id: op1.id, queue_group_id: g.id }, { operator_id: op2.id, queue_group_id: g.id }]);
  const l1 = await login(op1.code, op1.pin, "conc-tablet-op1-0001"), l2 = await login(op2.code, op2.pin, "conc-tablet-op2-0002");
  ok(l1.status === 200 && l2.status === 200, `(0) logowanie 2 operatorow przez endpoint (${l1.status}/${l2.status} ${l1.body.code || ""} ${l2.body.code || ""})`);
  if (l1.status !== 200 || l2.status !== 200) throw new Error("bez sesji operatorow dalsze testy nie maja sensu");
  const rpc1 = rpcAs(asToken(l1.body.access_token)), rpc2 = rpcAs(asToken(l2.body.access_token));

  // (7) Realtime — dwie sesje subskrybuja fm_stations przed operacjami
  const rtHits = [0, 0];
  for (const [i, tok] of [l1.body.access_token, l2.body.access_token].entries()) {
    const c = createClient(url, anonKey, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 10 } } });
    await c.realtime.setAuth(tok);
    const ch = c.channel(`conc-rt-${i}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "fm_stations" }, () => { rtHits[i]++; });
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("realtime subscribe timeout")), 15000); ch.subscribe((s) => { if (s === "SUBSCRIBED") { clearTimeout(t); res(); } }); });
    created.channels.push([c, ch]);
  }

  // (1) ten sam klucz idempotencji rownoczesnie
  const r0 = await rpc1("fm_queue_open_station", { p_station_id: s1.id, p_expected_version: 0, p_idem: idem() });
  if (r0.error) throw new Error("open_station: " + r0.error.message);
  const k = idem();
  const both = await Promise.all([rpc1("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: r0.data.version, p_idem: k }), rpc1("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: r0.data.version, p_idem: k })]);
  ok(both.every(r => !r.error && r.data?.current?.nr === 1), "(1) oba zadania z tym samym kluczem zwrocily stan z nr 1 (bez bledu)");
  const { count: logCount } = await svc.from("fm_queue_log").select("*", { count: "exact", head: true }).eq("idempotency_key", k);
  ok(logCount === 1, `(1) jeden wpis logu dla klucza (jest ${logCount})`);

  // (2) dwa stanowiska rownolegle (dwaj operatorzy)
  const r2 = await rpc2("fm_queue_open_station", { p_station_id: s2.id, p_expected_version: 0, p_idem: idem() });
  const [a, b] = await Promise.all([
    rpc1("fm_queue_finish_and_call_next", { p_station_id: s1.id, p_expected_version: both[0].data.version, p_idem: idem(), p_call_next: true }),
    rpc2("fm_queue_call_next", { p_station_id: s2.id, p_expected_version: r2.data.version, p_idem: idem() }),
  ]);
  const nrs = [a.data?.current?.nr, b.data?.current?.nr].sort();
  ok(!a.error && !b.error && nrs.join(",") === "2,3", `(2) rownolegle stanowiska dostaly rozne numery: ${nrs.join(",")}`);

  // (3) zalew 20 rownoczesnych call_next
  const fin = await rpc1("fm_queue_finish_and_call_next", { p_station_id: s1.id, p_expected_version: a.data.version, p_idem: idem(), p_call_next: false });
  const flood = await Promise.all(Array.from({ length: 20 }, () => rpc1("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: fin.data.version, p_idem: idem() })));
  const successes = flood.filter(r => !r.error).length;
  const conflicts = flood.filter(r => r.error && /FM_CONFLICT|FM_STATION_BUSY/.test(r.error.message)).length;
  const busy = flood.filter(r => r.error && /FM_BUSY/.test(r.error.message)).length;
  const other = flood.filter(r => r.error && !/FM_CONFLICT|FM_STATION_BUSY|FM_BUSY/.test(r.error.message)).map(r => `${r.error.code || ""} ${r.error.message}`.trim().slice(0, 60));
  ok(successes === 1 && conflicts + busy === 19 && other.length === 0, `(3) zalew 20x: 1 sukces, ${conflicts} FM_CONFLICT (fail-fast), ${busy} FM_BUSY, inne: ${other.length ? other.join(" | ") : "0"}`);
  const { data: g2 } = await svc.from("fm_queue_groups").select("last_called_nr").eq("id", g.id).single();
  ok(g2.last_called_nr === 4, `(3) last_called_nr = 4 (jest ${g2.last_called_nr})`);

  // (7) Realtime: oba niezalezne konta dostaly aktualizacje
  await new Promise(r => setTimeout(r, 3000));
  ok(rtHits[0] > 0 && rtHits[1] > 0, `(7) Realtime: operator 1 ${rtHits[0]} zdarzen, operator 2 ${rtHits[1]} zdarzen (oba > 0)`);

  // (4) pelna sciezka: rownoczesne pierwsze logowanie z 2 urzadzen
  const dev = await createStaff("CONC-TEST-DEV");
  const [hA, hB] = await Promise.all([login(dev.code, dev.pin, "conc-tablet-AAAA0001"), login(dev.code, dev.pin, "conc-tablet-BBBB0002")]);
  const got = [hA, hB].filter(r => r.status === 200 && r.body.access_token).length;
  const loser = [hA, hB].find(r => r.status !== 200);
  ok(got === 1 && loser && /FM_DEVICE_MISMATCH|FM_BUSY/.test(loser.body.code || ""), `(4) 2 urzadzenia naraz: dokladnie jeden dostal tokeny (${hA.status}/${hB.status}, ${hA.body.code || "ok"}/${hB.body.code || "ok"})`);
  const { data: devRow } = await svc.from("fm_staff").select("device_id").eq("id", dev.id).single();
  ok(Boolean(devRow?.device_id) && /^conc-tablet-(AAAA0001|BBBB0002)$/.test(devRow.device_id), `(4) w bazie przypiety dokladnie jeden tablet (${devRow?.device_id})`);

  // (5) brute force przez prawdziwy endpoint
  const bf = await createStaff("CONC-TEST-BF");
  const wrong = wrongPin(bf.pin);
  const flood2 = await Promise.all(Array.from({ length: 40 }, () => login(bf.code, wrong, "conc-tablet-BF000001")));
  const checked = flood2.filter(r => r.body.code === "FM_BAD_CREDENTIALS").length;
  const waited = flood2.filter(r => /FM_BUSY|FM_LOCKED|FM_RATE_LIMIT/.test(r.body.code || "")).length;
  const sysErr = flood2.filter(r => r.body.code === "FM_SYSTEM_ERROR").length;
  ok(checked <= 5 && checked + waited + sysErr === 40 && flood2.every(r => r.status !== 200), `(5) brute force 40 naraz: sprawdzone ${checked} (max 5), odrzucone ${waited}, awarie ${sysErr}, zadnego 200`);
  const afterBf = await login(bf.code, bf.pin, "conc-tablet-BF000001");
  ok(afterBf.status === 423 && /FM_LOCKED|FM_RATE_LIMIT/.test(afterBf.body.code || ""), `(5) po brute force poprawny PIN -> ${afterBf.body.code} (lockout)`);
  const fifth = await createStaff("CONC-TEST-5TH");
  for (let i = 0; i < 4; i++) await login(fifth.code, wrongPin(fifth.pin), "conc-tablet-5TH00001");
  const fifthOk = await login(fifth.code, fifth.pin, "conc-tablet-5TH00001");
  ok(fifthOk.status === 200, `(5) 4 zle PIN-y + poprawny przy 5. probie = 200 (jest ${fifthOk.status} ${fifthOk.body.code || ""})`);

  // (6) reset PIN-u przez admin-staff: stary access i refresh token przestaja dzialac
  const before = await rpc1("fm_queue_my_stations", { p_event_date: today });
  ok(!before.error, "(6) przed rotacja: my_stations OK");
  const reset = await post(adminUrl, { action: "reset_pin", id: op1.id }, adminToken);
  ok(reset.status === 200 && /^\d{6}$/.test(reset.body.pin || ""), `(6) reset_pin przez endpoint (${reset.status})`);
  await new Promise(r => setTimeout(r, 1100)); // iat ma rozdzielczosc sekundowa
  const after = await rpc1("fm_queue_my_stations", { p_event_date: today });
  ok(after.error && /FM_FORBIDDEN/.test(after.error.message), `(6) po rotacji: stary access token -> FM_FORBIDDEN (${after.error?.message?.slice(0, 40) || "brak bledu"})`);
  const refreshC = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: refErr } = await refreshC.auth.refreshSession({ refresh_token: l1.body.refresh_token });
  ok(Boolean(refErr), `(6) stary refresh token odrzucony (${refErr?.message || "ODSWIEZYL SESJE!"})`);
  const relog = await login(op1.code, reset.body.pin, "conc-tablet-op1-0001");
  ok(relog.status === 200, `(6) nowy PIN loguje (${relog.status} ${relog.body.code || ""}); tablet odpiety wiec pierwsze logowanie przypina ponownie`);

  // (8) blokada fail-closed przez admin-staff
  const blk = await post(adminUrl, { action: "block", id: op2.id }, adminToken);
  ok(blk.status === 200 && blk.body.blocked === true, `(8) block przez endpoint (${blk.status})`);
  const blockedLogin = await login(op2.code, op2.pin, "conc-tablet-op2-0002");
  ok(blockedLogin.status === 403 && blockedLogin.body.code === "FM_BLOCKED", `(8) zablokowane konto: logowanie -> ${blockedLogin.body.code}`);
  const blockedRpc = await rpc2("fm_queue_my_stations", { p_event_date: today });
  ok(blockedRpc.error && /FM_FORBIDDEN/.test(blockedRpc.error.message), "(8) zablokowane konto: stary token -> FM_FORBIDDEN");
  const unb = await post(adminUrl, { action: "unblock", id: op2.id }, adminToken);
  await new Promise(r => setTimeout(r, 1100));
  const afterUnblock = await rpc2("fm_queue_my_stations", { p_event_date: today });
  ok(afterUnblock.error && /FM_FORBIDDEN/.test(afterUnblock.error.message), "(8) po odblokowaniu ten sam stary token NADAL odrzucony");
  const relog2 = await login(op2.code, op2.pin, "conc-tablet-op2-0002");
  ok(unb.status === 200 && relog2.status === 200, `(8) unblock + ponowne logowanie (${unb.status}/${relog2.status})`);
  if (relog2.status === 200) {
    const fresh = await rpcAs(asToken(relog2.body.access_token))("fm_queue_my_stations", { p_event_date: today });
    ok(!fresh.error, "(8) nowa sesja po odblokowaniu dziala");
  }
} catch (e) {
  fail(e.message || String(e));
} finally {
  for (const [c, ch] of created.channels) { try { await c.removeChannel(ch); } catch { /* noop */ } }
  if (created.retailer) await svc.from("retailers").delete().eq("id", created.retailer);
  await svc.from("companies").delete().like("name", "CONC-TEST%");
  for (const id of created.users) await svc.auth.admin.deleteUser(id).catch(() => {});
  await svc.from("fm_queue_log").delete().like("idempotency_key", "conc-%");
  await svc.from("fm_login_attempts").delete().like("code", "CONC-TEST%");
  console.log(fails ? `❌ testy hostowane: ${fails} FAIL` : "✅ testy hostowane: OK");
  process.exit(fails ? 1 : 0);
}
