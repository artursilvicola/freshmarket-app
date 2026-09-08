#!/usr/bin/env node
// Narrow integration test for the staff list: real Netlify login, RLS and two Realtime sessions.
// NEVER targets production. Only the existing Queue Tests project is allowed, no migrations/deploys.
// Credentials: TEST_SUPABASE_URL, TEST_SERVICE_ROLE_KEY, TEST_ANON_KEY, STAFF_LOGIN_URL.
// Alternatively --stdin reads one JSON line with those keys (no credentials in argv/files/output).
// Temporary records are removed by their recorded IDs; append-only audit/login logs are retained.
import { createClient } from "@supabase/supabase-js";
import { randomInt, randomUUID, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";

const TEST_REF = "uowpixwtewrmmvkyooec";
let cfg = process.env;
if (process.argv.includes("--stdin")) {
  // PTY execution must not echo the incoming secret configuration.
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  console.log("READY_FOR_TEST_CONFIG (stdin; values are never logged)");
  const rl = createInterface({ input: process.stdin, terminal: false });
  cfg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { rl.close(); reject(new Error("CONFIG_TIMEOUT")); }, 60_000);
    rl.once("line", line => {
      clearTimeout(timer); rl.close();
      try { resolve(JSON.parse(line)); } catch { reject(new Error("CONFIG_INVALID_JSON")); }
    });
  });
}
const { TEST_SUPABASE_URL: url, TEST_SERVICE_ROLE_KEY: serviceKey, TEST_ANON_KEY: anonKey, STAFF_LOGIN_URL: loginUrl } = cfg;
if (!serviceKey || !anonKey || serviceKey === anonKey || url !== `https://${TEST_REF}.supabase.co`) throw new Error("REFUSE: missing keys or wrong test project");
const endpoint = new URL(loginUrl);
if (endpoint.protocol !== "https:" || !/^(?:[a-f0-9]{24}|deploy-preview-\d+)--freshmarketb2b\.netlify\.app$/.test(endpoint.hostname) || endpoint.pathname !== "/.netlify/functions/staff-login" || endpoint.search || endpoint.username || endpoint.password) {
  throw new Error("REFUSE: only the test deploy-preview staff-login endpoint is allowed");
}
for (const [key, role] of [[serviceKey, "service_role"], [anonKey, "anon"]]) {
  // A masked Netlify secret is not a usable key. Stop before any remote write.
  if (key.split(".").length !== 3 || !/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error("REFUSE: unmasked legacy test JWT keys are required; never export production secrets");
  let claims;
  try { claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()); }
  catch { throw new Error("REFUSE: invalid test JWT key format"); }
  if (claims.ref !== TEST_REF || claims.role !== role) throw new Error("REFUSE: key project/role mismatch");
}
const adminUrl = new URL("admin-staff", endpoint).href;
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(20_000) }) } };
const svc = createClient(url, serviceKey, options);
const anon = createClient(url, anonKey, options);
const run = `LIST-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const evidence = { run, started_at: new Date().toISOString(), project_ref: TEST_REF, preview_origin: endpoint.origin, event_date: today, checks: [], cleanup: [] };
const created = { users: [], staff: [], groups: [], companies: [], retailer: null, settings: false, realtime: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checked = async (query, label) => {
  const r = await query;
  if (r.error) throw new Error(`${label}: ${r.error.code || "API_ERROR"} ${r.error.message || ""}`);
  return r.data;
};
const check = (condition, label) => {
  evidence.checks.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) throw new Error(label);
};
const post = async (address, body, token) => {
  const response = await fetch(address, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const asToken = token => createClient(url, anonKey, { ...options, global: { ...options.global, headers: { Authorization: `Bearer ${token}` } } });
const list = (client, groupId) => checked(client.from("fm_queue_meetings").select("*, companies(name)").eq("queue_group_id", groupId).order("nr"), "listMeetings");
const rpc = (client, name, params) => checked(client.rpc(name, params), name);
let failure = null;
try {
  // Verify read access and date BEFORE creating anything. Never overwrite a pre-existing setting.
  await checked(svc.from("fm_staff").select("id").limit(1), "test project access");
  const setting = await checked(svc.from("fm_queue_settings").select("event_date,test_mode,closed_all_at").eq("event_date", today).maybeSingle(), "test date");
  if (setting && (!setting.test_mode || setting.closed_all_at)) throw new Error("REFUSE: existing date is not an open test day");
  if (!setting) {
    await checked(svc.from("fm_queue_settings").insert({ event_date: today, test_mode: true }), "create test date");
    created.settings = true;
  }
  const password = `A-${randomBytes(24).toString("base64url")}!9`;
  const admin = await checked(svc.auth.admin.createUser({ email: `${run.toLowerCase()}@staff-list-test.invalid`, password, email_confirm: true, app_metadata: { role: "admin" } }), "create temporary admin");
  created.users.push(admin.user.id);
  await checked(svc.from("profiles").upsert({ id: admin.user.id, email: admin.user.email, role: "admin", admin_level: "super" }), "temporary admin profile");
  const session = await checked(anon.auth.signInWithPassword({ email: admin.user.email, password }), "admin login");
  // Separate anon client below: never accidentally test public access using the admin session.
  const publicClient = createClient(url, anonKey, options);
  const staff = [];
  for (let i = 1; i <= 2; i++) {
    const result = await post(adminUrl, { action: "create", code: `${run}-${i}`, display_name: `${run} Operator ${i}`, event_date: today }, session.session.access_token);
    if (result.status === 200 && result.body.id) { created.users.push(result.body.id); created.staff.push(result.body.id); }
    check(result.status === 200 && !!result.body.id && /^\d{6}$/.test(result.body.pin || ""), `real admin-staff creates operator ${i}`);
    staff.push(result.body);
  }
  const retailerId = randomInt(991000, 999999);
  await checked(svc.from("retailers").insert({ id: retailerId, name: `${run} Test Chain`, fm26_active: true }), "test retailer");
  created.retailer = retailerId;
  const groups = await checked(svc.from("fm_queue_groups").insert(["Assigned", "Unassigned"].map(label => ({ event_date: today, retailer_id: retailerId, label: `${run} ${label}` }))).select("id,label"), "test groups");
  created.groups.push(...groups.map(g => g.id));
  const assigned = groups.find(g => g.label.endsWith(" Assigned")), hidden = groups.find(g => g.label.endsWith(" Unassigned"));
  const stations = await checked(svc.from("fm_stations").insert([{ queue_group_id: assigned.id, idx: 1 }, { queue_group_id: assigned.id, idx: 2 }, { queue_group_id: hidden.id, idx: 1 }]).select("id,idx,queue_group_id"), "test stations");
  const station = stations.find(s => s.queue_group_id === assigned.id && s.idx === 1), hiddenStation = stations.find(s => s.queue_group_id === hidden.id);
  const companies = await checked(svc.from("companies").insert([1, 2, 3].map(i => ({ name: `${run} Supplier ${i}` }))).select("id,name"), "test suppliers");
  created.companies.push(...companies.map(c => c.id));
  companies.sort((a, b) => a.name.localeCompare(b.name));
  await checked(svc.from("fm_queue_meetings").insert(companies.map((c, i) => ({ queue_group_id: i === 2 ? hidden.id : assigned.id, company_id: c.id, nr: i === 2 ? 1 : i + 1 }))), "test meetings");
  await checked(svc.from("fm_queue_assignments").insert(staff.map(s => ({ operator_id: s.id, queue_group_id: assigned.id }))), "test assignments");
  await sleep(1200); // Auth iat must be later than the PIN creation second, without bypassing the rule.
  const clients = [];
  const tokens = [];
  for (const [i, account] of staff.entries()) {
    const result = await post(loginUrl, { code: account.code, pin: account.pin, device_id: `${run}-TABLET-${i + 1}` });
    check(result.status === 200 && !!result.body.access_token && result.body.staff?.id === account.id, `real staff-login operator ${i + 1}`);
    const token = result.body.access_token;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    check(claims.iss === `${url}/auth/v1` && claims.sub === account.id, `operator ${i + 1} session belongs to test project`);
    tokens.push(token); clients.push(asToken(token));
  }
  for (const [i, client] of clients.entries()) {
    const rows = await list(client, assigned.id);
    check(rows.length === 2 && rows.every((r, n) => r.companies?.name === companies[n].name && r.status === "planned"), `operator ${i + 1}: exact supplier names and planned list`);
    check((await list(client, hidden.id)).length === 0, `operator ${i + 1}: unassigned meeting list blocked by RLS`);
    const allRows = await checked(client.from("fm_queue_meetings").select("id,queue_group_id"), "unfiltered meeting read");
    check(allRows.length === 2 && allRows.every(r => r.queue_group_id === assigned.id), `operator ${i + 1}: unfiltered request does not bypass assignment`);
    const state = await client.rpc("fm_queue_station_state", { p_station_id: hiddenStation.id });
    check(!!state.error && /FM_FORBIDDEN/.test(state.error.message), `operator ${i + 1}: private unassigned station RPC forbidden`);
    const mine = await rpc(client, "fm_queue_my_stations", { p_event_date: today });
    check(mine.length === 2 && mine.every(s => s.group_id === assigned.id), `operator ${i + 1}: chooser contains only assigned group`);
  }
  const publicRows = await publicClient.from("fm_queue_meetings").select("id").in("queue_group_id", created.groups);
  check(!!publicRows.error || publicRows.data?.length === 0, "anonymous user cannot read meeting lists");
  const board = await rpc(publicClient, "fm_queue_public_snapshot", { p_event_date: today });
  check(board.stations.some(s => s.station_id === station.id) && companies.every(c => !JSON.stringify(board).includes(c.name)), "public board contains test station but no supplier names");

  const hits = [[], []];
  for (const [i, token] of tokens.entries()) {
    const c = createClient(url, anonKey, options);
    await c.realtime.setAuth(token);
    const channel = c.channel(`${run}-${i}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "fm_stations", filter: `id=eq.${station.id}` }, payload => hits[i].push(payload.new));
    created.realtime.push([c, channel]);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Realtime ${i + 1}: timeout`)), 15_000);
      channel.subscribe(status => {
        if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error(`Realtime ${i + 1}: ${status}`)); }
      });
    });
    check(true, `Realtime session ${i + 1} subscribed with real staff token`);
  }
  let state = await rpc(clients[0], "fm_queue_open_station", { p_station_id: station.id, p_expected_version: 0, p_idem: `${run}-open` });
  state = await rpc(clients[0], "fm_queue_call_next", { p_station_id: station.id, p_expected_version: state.version, p_idem: `${run}-call` });
  check(state.current?.nr === 1, "operator 1 calls first supplier through RPC");
  state = await rpc(clients[0], "fm_queue_start", { p_station_id: station.id, p_expected_version: state.version, p_idem: `${run}-start` });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && hits.some(events => !events.some(row => row.version === state.version))) await sleep(100);
  check(hits.every(events => events.some(row => row.version === state.version)), "both independent Realtime sessions received the started meeting version");
  evidence.realtime_event_counts = hits.map(events => events.length);
  for (const [i, client] of clients.entries()) {
    const rows = await list(client, assigned.id);
    check(rows[0]?.status === "in_progress" && rows[0].companies?.name === companies[0].name && rows[0].station_id === station.id && !!rows[0].called_at && !!rows[0].started_at && rows[1]?.status === "planned", `operator ${i + 1}: refreshed list shows correct company, desk, status and times`);
  }
} catch (error) {
  failure = String(error.message || error);
  console.error("FAIL", failure);
} finally {
  const cleanup = async (label, action) => {
    try { await action(); evidence.cleanup.push({ label, pass: true }); }
    catch (error) { evidence.cleanup.push({ label, pass: false, error: String(error.message || error) }); failure ||= "cleanup failed"; }
  };
  for (const [client, channel] of created.realtime) await cleanup("close test Realtime channel", () => client.removeChannel(channel));
  for (const id of created.staff) await cleanup("revoke temporary staff session", () => rpc(svc, "fm_staff_revoke_sessions", { p_user: id, p_rotate_pin: false }));
  if (created.groups.length) await cleanup("delete only created queue groups (cascades test meetings/stations/assignments)", () => checked(svc.from("fm_queue_groups").delete().in("id", created.groups), "cleanup groups"));
  if (created.companies.length) await cleanup("delete only created suppliers", () => checked(svc.from("companies").delete().in("id", created.companies), "cleanup companies"));
  if (created.retailer !== null) await cleanup("delete only created retailer", () => checked(svc.from("retailers").delete().eq("id", created.retailer).eq("name", `${run} Test Chain`), "cleanup retailer"));
  for (const id of created.users.reverse()) await cleanup("delete temporary Auth user/profile", () => checked(svc.auth.admin.deleteUser(id), "cleanup auth"));
  if (created.settings) await cleanup("remove only newly created test-day setting", () => checked(svc.from("fm_queue_settings").delete().eq("event_date", today).eq("test_mode", true), "cleanup setting"));
  if (created.users.length) {
    const leftovers = await checked(svc.from("profiles").select("id").in("id", created.users), "verify user cleanup").catch(() => ["unknown"]);
    evidence.cleanup.push({ label: "no created profiles remain", pass: leftovers.length === 0 });
    if (leftovers.length) failure ||= "profile cleanup verification failed";
  }
  evidence.finished_at = new Date().toISOString(); evidence.pass = !failure; evidence.failure = failure;
  evidence.audit_policy = "Append-only queue and login audit records retained; no PIN/password/key/token written to report.";
  await mkdir("out", { recursive: true });
  await writeFile("out/staff-list-hosted-result.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
process.exit(failure ? 1 : 0);
