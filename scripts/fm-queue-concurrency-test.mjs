#!/usr/bin/env node
// [feat/fm-queue] Test wspolbieznosci RPC kolejek na BAZIE TESTOWEJ (nie prod!).
// Sprawdza: (1) dwa rownoczesne zadania z TYM SAMYM kluczem idempotencji = jedna
// operacja i jeden wpis logu; (2) dwa stanowiska rownolegle wywoluja rozne numery;
// (3) zalew 20 rownoczesnych call_next na jednym stanowisku daje dokladnie 1 sukces.
//
// Uruchomienie (PowerShell):
//   $env:TEST_SUPABASE_URL="https://xxxx.supabase.co"; $env:TEST_SERVICE_ROLE_KEY="..."; node scripts/fm-queue-concurrency-test.mjs
// Skrypt tworzy wlasne fixtures z prefiksem CONC-TEST i sprzata po sobie.
import { createClient } from "@supabase/supabase-js";

const url = process.env.TEST_SUPABASE_URL, key = process.env.TEST_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Ustaw TEST_SUPABASE_URL i TEST_SERVICE_ROLE_KEY (baza TESTOWA)."); process.exit(2); }
if (/sklyfuvzjikkqerxtulo/.test(url)) { console.error("ODMOWA: to wyglada na projekt produkcyjny."); process.exit(2); }
const svc = createClient(url, key, { auth: { persistSession: false } });
const idem = () => `conc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (c, m) => (c ? console.log("ok  ", m) : fail(m));

// operator = uzytkownik staff z tokenem: tworzymy przez admin API i logujemy haslem
async function makeOperator(code) {
  const email = `${code.toLowerCase()}@conc-test.local`, password = `Pw-${Math.random().toString(36).slice(2)}!x9`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "staff", staff_code: code } });
  if (error) throw error;
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Warsaw" })).toISOString().slice(0, 10);
  await svc.from("profiles").upsert({ id: u.user.id, email, role: "staff" });
  const { error: sErr } = await svc.from("fm_staff").insert({ id: u.user.id, code, event_date: today });
  if (sErr) throw sErr;
  const anon = createClient(url, process.env.TEST_ANON_KEY || key, { auth: { persistSession: false } });
  const { data: s, error: lErr } = await anon.auth.signInWithPassword({ email, password });
  if (lErr) throw lErr;
  const asUser = createClient(url, process.env.TEST_ANON_KEY || key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
  return { id: u.user.id, client: asUser, today };
}

const created = { users: [], retailer: null };
try {
  const op = await makeOperator("CONC-TEST-OP");
  created.users.push(op.id);
  const { data: ret, error: rErr } = await svc.from("retailers").insert({ id: 990009, name: "CONC-TEST Siec", fm26_active: true, fm26_chain_id: "conc-test" }).select().single();
  if (rErr) throw rErr;
  created.retailer = ret.id;
  const { data: g } = await svc.from("fm_queue_groups").insert({ event_date: op.today, retailer_id: ret.id }).select().single();
  const { data: st } = await svc.from("fm_stations").insert([{ queue_group_id: g.id, idx: 1 }, { queue_group_id: g.id, idx: 2 }]).select();
  const [s1, s2] = st.sort((a, b) => a.idx - b.idx);
  const { data: cos } = await svc.from("companies").insert(Array.from({ length: 6 }, (_, i) => ({ name: `CONC-TEST Firma ${i + 1}` }))).select();
  await svc.from("fm_queue_meetings").insert(cos.map((c, i) => ({ queue_group_id: g.id, company_id: c.id, nr: i + 1 })));
  await svc.from("fm_queue_assignments").insert({ operator_id: op.id, queue_group_id: g.id });
  const rpc = (name, params) => op.client.rpc(name, params).then(r => (r.error ? { error: r.error } : { data: r.data }));

  // (1) ten sam klucz idempotencji rownoczesnie
  const r0 = await rpc("fm_queue_open_station", { p_station_id: s1.id, p_expected_version: 0, p_idem: idem() });
  const v1 = r0.data.version;
  const k = idem();
  const both = await Promise.all([rpc("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: v1, p_idem: k }), rpc("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: v1, p_idem: k })]);
  ok(both.every(r => !r.error && r.data?.current?.nr === 1), "(1) oba zadania z tym samym kluczem zwrocily stan z nr 1 (bez bledu)");
  const { count: logCount } = await svc.from("fm_queue_log").select("*", { count: "exact", head: true }).eq("idempotency_key", k);
  ok(logCount === 1, `(1) jeden wpis logu dla klucza (jest ${logCount})`);
  const { data: g1 } = await svc.from("fm_queue_groups").select("last_called_nr").eq("id", g.id).single();
  ok(g1.last_called_nr === 1, "(1) last_called_nr = 1 (nie 2)");

  // (2) dwa stanowiska rownolegle
  const r2 = await rpc("fm_queue_open_station", { p_station_id: s2.id, p_expected_version: 0, p_idem: idem() });
  const [a, b] = await Promise.all([
    rpc("fm_queue_finish_and_call_next", { p_station_id: s1.id, p_expected_version: both[0].data.version, p_idem: idem(), p_call_next: true }),
    rpc("fm_queue_call_next", { p_station_id: s2.id, p_expected_version: r2.data.version, p_idem: idem() }),
  ]);
  const nrs = [a.data?.current?.nr, b.data?.current?.nr].sort();
  ok(!a.error && !b.error && nrs.join(",") === "2,3", `(2) rownolegle stanowiska dostaly rozne numery: ${nrs.join(",")}`);

  // (3) zalew 20 rownoczesnych call_next na wolnym stanowisku (rozne klucze, ta sama wersja)
  const fin = await rpc("fm_queue_finish_and_call_next", { p_station_id: s1.id, p_expected_version: a.data.version, p_idem: idem(), p_call_next: false });
  const v = fin.data.version;
  const flood = await Promise.all(Array.from({ length: 20 }, () => rpc("fm_queue_call_next", { p_station_id: s1.id, p_expected_version: v, p_idem: idem() })));
  const successes = flood.filter(r => !r.error).length;
  const conflicts = flood.filter(r => r.error && /FM_CONFLICT|FM_STATION_BUSY/.test(r.error.message)).length;
  ok(successes === 1 && conflicts === 19, `(3) zalew: 1 sukces, 19 konfliktow (jest ${successes}/${conflicts})`);
  const { data: g2 } = await svc.from("fm_queue_groups").select("last_called_nr").eq("id", g.id).single();
  ok(g2.last_called_nr === 4, `(3) last_called_nr = 4 (jest ${g2.last_called_nr})`);
} catch (e) {
  fail(e.message || String(e));
} finally {
  // sprzatanie (kaskady: retailer -> grupy -> stanowiska/spotkania/przypisania)
  if (created.retailer) await svc.from("retailers").delete().eq("id", created.retailer);
  await svc.from("companies").delete().like("name", "CONC-TEST%");
  for (const id of created.users) await svc.auth.admin.deleteUser(id).catch(() => {});
  await svc.from("fm_queue_log").delete().like("idempotency_key", "conc-%");
  console.log(process.exitCode ? "❌ testy wspolbieznosci: FAIL" : "✅ testy wspolbieznosci: OK");
}
