#!/usr/bin/env node
// [fix/security-hotfix] Sondy uprawnień PRAWDZIWYCH kont przez PostgREST po migracjach 054 + 055.
//
// Tryby:
//   node scripts/fm-permission-probe.mjs            # TYLKO odczyty (anon / dostawca / kupiec / admin) — zero zapytań zmieniających
//   node scripts/fm-permission-probe.mjs --writes   # + próby zapisu, WYŁĄCZNIE na jawnie wskazanych rekordach testowych
//
// Zmienne: FM_PROBE_URL, FM_PROBE_ANON_KEY, FM_PROBE_SUPPLIER_EMAIL/PASSWORD, FM_PROBE_BUYER_EMAIL/PASSWORD,
//          (opcjonalnie FM_PROBE_ADMIN_EMAIL/PASSWORD); dla --writes dodatkowo:
//   FM_PROBE_FIXTURE_COMPANY_ID          firma testowa dostawcy (account_status=suspended, fm_b2b_enabled=false, nazwa z „TEST")
//   FM_PROBE_FIXTURE_FOREIGN_COMPANY_ID  DRUGA firma testowa (też zawieszona) — cel prób „cudzej firmy"; nigdy firma uczestnika
//   FM_PROBE_FIXTURE_RETAILER_ID         sieć testowa kupca (active=false, fm26_active=false, nazwa z „TEST")
//
// Zasady --writes (review Codexa c3c1e66 P1/P2):
//   * każdy cel zapisu to jawnie wskazany rekord testowy; preflight sprawdza tożsamość i flagi udziału
//     KAŻDEGO rekordu i przerywa PRZED pierwszym zapisem, gdy coś się nie zgadza;
//   * żadnego neq(...).limit(1), „pierwszej sieci z listy" ani zasobów uczestników;
//   * oczekiwany wynik każdej próby = konkretny błąd uprawnień (42501 fm_inputs_forbidden / brak uprawnień /
//     row-level security) — błąd transportu, brak RPC albo „nie ma firmy" NIE liczą się jako sukces ochrony;
//   * stan rekordów testowych porównywany PRZED i PO (dokładne wiersze, nie liczby);
//   * pierwszy nieoczekiwany sukces zapisu = STOP dalszych zapisów i głośny komunikat.
// Nic tu nie dotyka wyborów sieci, odpowiedzi kupców, planu ani maili. Nie wypisuje kluczy, tokenów, e-maili ani kontaktów.
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const WRITES = args.includes("--writes");
const env = (k) => (process.env[k] || "").trim();
const URL = env("FM_PROBE_URL"), ANON = env("FM_PROBE_ANON_KEY");
if (!URL || !ANON) { console.error("Ustaw FM_PROBE_URL i FM_PROBE_ANON_KEY."); process.exit(2); }
const FX = { company: env("FM_PROBE_FIXTURE_COMPANY_ID"), foreign: env("FM_PROBE_FIXTURE_FOREIGN_COMPANY_ID"), retailer: env("FM_PROBE_FIXTURE_RETAILER_ID") };
if (WRITES && (!FX.company || !FX.foreign || !FX.retailer)) { console.error("--writes wymaga FM_PROBE_FIXTURE_COMPANY_ID, FM_PROBE_FIXTURE_FOREIGN_COMPANY_ID i FM_PROBE_FIXTURE_RETAILER_ID."); process.exit(2); }
if (WRITES && FX.company === FX.foreign) { console.error("Firma testowa i „cudza" firma testowa muszą być różne."); process.exit(2); }

const results = [];
let writesAborted = false;
function rec(role, name, pass, info = "") {
  results.push({ role, name, pass: !!pass, info: String(info).slice(0, 160) });
  console.log(`${pass ? "PASS" : "FAIL"}  [${role}] ${name}${info ? " — " + info : ""}`);
}
// klasyfikacja błędów: tylko KONKRETNA odmowa liczy się jako sukces ochrony
const isForbidden = (e, reason) => !!e && e.code === "42501" && /fm_inputs_forbidden/.test(e.message || "") && (!reason || (e.hint || "").includes(reason));
const isOwnership = (e) => !!e && e.code === "42501" && /brak uprawnie/.test(e.message || "");
const isRls = (e) => !!e && (e.code === "42501" || /row-level security|permission denied/i.test(e.message || ""));
const isDenied = (e) => isRls(e) && !/could not find|does not exist|nie ma firmy|failed to fetch/i.test(e.message || "");
const errInfo = (e) => (e ? `${e.code || "-"} ${e.message || ""} ${e.hint ? "(" + e.hint + ")" : ""}` : "brak błędu!");
const ZERO = "00000000-0000-0000-0000-000000000000";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function client() { return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function login(role) {
  const email = env(`FM_PROBE_${role.toUpperCase()}_EMAIL`), pwd = env(`FM_PROBE_${role.toUpperCase()}_PASSWORD`);
  if (!email || !pwd) return null;
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password: pwd });
  if (error || !data?.user) { console.error(`[${role}] logowanie nieudane: ${error?.message || "brak użytkownika"}`); return null; }
  const { data: me, error: meErr } = await c.from("profiles").select("id, role, company_id, retailer_id, active, fm26_active").eq("id", data.user.id).maybeSingle();
  if (meErr || !me) { console.error(`[${role}] brak profilu`); return null; }
  if (me.role !== role) { console.error(`[${role}] konto ma rolę ${me.role}, oczekiwano ${role} — sondy pominięte`); return null; }
  return { c, me };
}
async function count(c, table, mod = (q) => q) {
  const r = await mod(c.from(table).select("*", { count: "exact", head: true }));
  return { error: r.error, n: r.count ?? 0 };
}
async function probeAdminViews(role, c, uid) {
  for (const v of ["v_admin_registrations", "v_admin_stats", "consent_audit"]) {
    const r = await c.from(v).select("*");
    const rows = r.data || [];
    const onlySelf = v === "consent_audit" && rows.every(x => x.id === uid);
    rec(role, `${v}: odmowa albo 0 wierszy${v === "consent_audit" ? " (lub tylko własny)" : ""}`, isDenied(r.error) || (!r.error && (rows.length === 0 || onlySelf)), r.error?.message || `rows=${rows.length}`);
  }
}

// ── preflight rekordów testowych (przed jakimkolwiek zapisem) ─────────────────
const isTestName = (n) => /\bTEST\b/i.test(String(n || ""));
async function preflightSupplierFixtures(c, me) {
  const problems = [];
  if (me.company_id !== FX.company) problems.push(`konto dostawcy testowego nie należy do FM_PROBE_FIXTURE_COMPANY_ID`);
  const own = await c.from("companies").select("id, name, account_status, fm_b2b_enabled").eq("id", FX.company).maybeSingle();
  if (!own.data) problems.push("firma testowa niewidoczna / nie istnieje");
  else {
    if (!isTestName(own.data.name)) problems.push("firma testowa bez „TEST" w nazwie");
    if (own.data.account_status !== "suspended") problems.push(`firma testowa account_status=${own.data.account_status} (oczekiwane suspended)`);
    if (own.data.fm_b2b_enabled) problems.push("firma testowa ma fm_b2b_enabled=true");
  }
  const foreign = await c.from("companies").select("id, name, account_status, fm_b2b_enabled").eq("id", FX.foreign).maybeSingle();
  if (!foreign.data) problems.push("„cudza" firma testowa niewidoczna dla dostawcy — musi istnieć i być widoczna (katalog), inaczej próba nie sprawdza reguły właściciela");
  else {
    if (!isTestName(foreign.data.name)) problems.push("„cudza" firma testowa bez „TEST" w nazwie");
    if (foreign.data.account_status !== "suspended" || foreign.data.fm_b2b_enabled) problems.push("„cudza" firma testowa musi być zawieszona i poza FM");
  }
  const ret = await c.from("retailers").select("id, name, active, fm26_active").eq("id", Number(FX.retailer)).maybeSingle();
  if (!ret.data) problems.push("sieć testowa niewidoczna / nie istnieje");
  else {
    if (!isTestName(ret.data.name)) problems.push("sieć testowa bez „TEST" w nazwie");
    if (ret.data.active !== false || ret.data.fm26_active) problems.push("sieć testowa musi mieć active=false i fm26_active=false");
  }
  return problems;
}
async function preflightBuyerFixtures(c, me) {
  const problems = [];
  if (Number(me.retailer_id) !== Number(FX.retailer)) problems.push("konto kupca testowego nie należy do FM_PROBE_FIXTURE_RETAILER_ID");
  const ret = await c.from("retailers").select("id, name, active, fm26_active").eq("id", Number(FX.retailer)).maybeSingle();
  if (!ret.data) problems.push("sieć testowa niewidoczna / nie istnieje");
  else if (!isTestName(ret.data.name) || ret.data.active !== false || ret.data.fm26_active) problems.push("sieć testowa musi mieć „TEST" w nazwie, active=false, fm26_active=false");
  return problems;
}
const snapshotTargets = async (c, companyId) => (await c.from("company_target_retailers").select("company_id, retailer_id, priority, note").eq("company_id", companyId).order("retailer_id")).data || [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function guardUnexpectedSuccess(role, name, error) {
  if (!error) { writesAborted = true; rec(role, name, false, "ZAPIS PRZESZEDŁ — zabezpieczenie nie działa; dalsze próby zapisu przerwane, sprawdź rekord testowy ręcznie"); return true; }
  return false;
}

// ── anon ─────────────────────────────────────────────────────────────────────
async function probeAnon() {
  const c = client();
  let r = await count(c, "consent_audit");
  rec("anon", "consent_audit: odczyt zabroniony", isDenied(r.error), r.error?.message || `count=${r.n}`);
  r = await count(c, "v_admin_registrations");
  rec("anon", "v_admin_registrations: odczyt zabroniony", isDenied(r.error), r.error?.message || `count=${r.n}`);
  let s = await c.from("v_admin_stats").select("*");
  rec("anon", "v_admin_stats: odczyt zabroniony", isDenied(s.error), s.error?.message || `rows=${s.data?.length}`);
  r = await count(c, "company_capacity");
  rec("anon", "company_capacity: 0 wierszy (security_invoker)", !r.error && r.n === 0, r.error?.message || `count=${r.n}`);
  s = await c.from("fm_settings").select("schedule, brand_logo_url");
  rec("anon", "fm_settings: schedule = null, logo czytelne", !s.error && (s.data || []).every(x => x.schedule == null), s.error?.message || `rows=${s.data?.length}`);
  r = await count(c, "retailers");
  rec("anon", "retailers: 0 wierszy", !r.error && r.n === 0, r.error?.message || `count=${r.n}`);
  r = await count(c, "retailer_contacts");
  rec("anon", "retailer_contacts: zabronione", isDenied(r.error), r.error?.message || `count=${r.n}`);
  r = await count(c, "fm_plan_private");
  rec("anon", "fm_plan_private: zabronione", isDenied(r.error), r.error?.message || `count=${r.n}`);
  s = await c.rpc("fm_my_schedule");
  rec("anon", "fm_my_schedule: null/zabronione", (!s.error && s.data == null) || isDenied(s.error), s.error?.message || JSON.stringify(s.data));
  if (!WRITES) return;
  // jedyny zapis anon: DELETE przez widok z nieistniejącym id — oczekiwana odmowa uprawnień (nie „0 wierszy")
  s = await c.from("consent_audit").delete().eq("id", ZERO);
  rec("anon", "write: delete przez widok consent_audit zabroniony", isDenied(s.error), errInfo(s.error));
}

// ── dostawca (konto testowe: firma zawieszona, poza FM) ──────────────────────
async function probeSupplier() {
  const s = await login("supplier");
  if (!s) { rec("supplier", "logowanie", false, "brak danych konta (FM_PROBE_SUPPLIER_*)"); return; }
  const { c, me } = s;
  let r = await c.from("retailers").select("id, name, buyer_name, buyer_email, buyer_phone, contacts:retailer_contacts(buyer_email)");
  const rows = r.data || [];
  rec("supplier", "retailers: lista sieci widoczna", !r.error && rows.length > 0, r.error?.message || `rows=${rows.length}`);
  rec("supplier", "retailers: zero kontaktów kupców (buyer_* puste, retailer_contacts null)", rows.every(x => !x.buyer_name && !x.buyer_email && !x.buyer_phone && !x.contacts), `z kontaktem: ${rows.filter(x => x.buyer_email || x.buyer_name || x.buyer_phone || x.contacts).length}`);
  let n = await count(c, "retailer_contacts");
  rec("supplier", "retailer_contacts: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "profiles", q => q.eq("role", "buyer"));
  rec("supplier", "profiles kupców: 0", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "fm_prefs");
  rec("supplier", "fm_prefs: 0 (polityka 002 usunięta)", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "fm_plan_private");
  rec("supplier", "fm_plan_private: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "fm_inputs_snapshots");
  rec("supplier", "fm_inputs_snapshots: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "audit_log");
  rec("supplier", "audit_log: 0 wierszy (tylko admin)", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  r = await c.rpc("fm_my_schedule");
  rec("supplier", "fm_my_schedule: null (konto testowe zawieszone / poza FM nie ma prawa do planu)", !r.error && r.data == null, r.error?.message || JSON.stringify(r.data).slice(0, 80));
  r = await c.from("fm_resps").select("supplier_company_id");
  rec("supplier", "fm_resps: tylko o sobie", !r.error && (r.data || []).every(x => x.supplier_company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_target_retailers").select("company_id");
  rec("supplier", "company_target_retailers: tylko własne", !r.error && (r.data || []).every(x => x.company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("legacy_sends").select("data");
  rec("supplier", "legacy_sends.data bez adresów kupców", !r.error && (r.data || []).every(x => !(x.data && x.data.resendBuyerEmails)), r.error?.message || `rows=${r.data?.length}`);
  await probeAdminViews("supplier", c, me.id);
  if (!WRITES) return;

  const problems = await preflightSupplierFixtures(c, me);
  if (problems.length) { rec("supplier", "preflight rekordów testowych", false, problems.join("; ") + " — ZAPISY POMINIĘTE"); return; }
  const before = { own: await snapshotTargets(c, FX.company), foreign: await snapshotTargets(c, FX.foreign) };
  const company = await c.from("companies").select("fm_b2b_tier, fm_b2b_packages, account_status, fm_b2b_enabled").eq("id", FX.company).maybeSingle();

  // 1) własna (zawieszona) firma testowa: RPC odrzucony z powodu udziału — pełny zestaw, nie pusta lista
  let w = await c.rpc("fm_set_company_targets", { p_company_id: FX.company, p_items: [{ retailer_id: Number(FX.retailer), priority: 1000, note: "probe" }] });
  if (!guardUnexpectedSuccess("supplier", "write: RPC dla własnej zawieszonej firmy testowej", w.error))
    rec("supplier", "write: RPC dla własnej zawieszonej firmy testowej → fm_inputs_forbidden (company_*)", isForbidden(w.error, "company_"), errInfo(w.error));
  // 2) „cudza" firma testowa (istnieje, widoczna): RPC odrzucony regułą właściciela — bez pustej listy
  if (!writesAborted) {
    w = await c.rpc("fm_set_company_targets", { p_company_id: FX.foreign, p_items: [{ retailer_id: Number(FX.retailer), priority: 1000, note: "probe" }] });
    if (!guardUnexpectedSuccess("supplier", "write: RPC dla cudzej firmy testowej", w.error))
      rec("supplier", "write: RPC dla cudzej firmy testowej → brak uprawnień (42501)", isOwnership(w.error), errInfo(w.error));
  }
  // 3) bezpośredni INSERT / DELETE (stary bundle) na własnej firmie testowej i sieci testowej
  if (!writesAborted) {
    const ins = await c.from("company_target_retailers").insert({ company_id: FX.company, retailer_id: Number(FX.retailer), priority: 1 });
    if (!guardUnexpectedSuccess("supplier", "write: bezpośredni INSERT wyborów", ins.error))
      rec("supplier", "write: bezpośredni INSERT wyborów → RLS / forbidden", isDenied(ins.error), errInfo(ins.error));
    const del = await c.from("company_target_retailers").delete().eq("company_id", FX.company).eq("retailer_id", Number(FX.retailer)).select("retailer_id");
    rec("supplier", "write: bezpośredni DELETE wyborów → 0 wierszy, bez błędu albo odmowa", (!del.error && (del.data || []).length === 0) || isDenied(del.error), del.error?.message || `usunięte=${(del.data || []).length}`);
  }
  // 4) kolumny administracyjne własnej firmy i profilu: trigger przywraca (dokładne porównanie pól)
  if (!writesAborted && company.data) {
    const other = company.data.fm_b2b_tier === "premium" ? "business" : "premium";
    const u = await c.from("companies").update({ fm_b2b_tier: other, fm_b2b_packages: 9, account_status: "active", fm_b2b_enabled: true }).eq("id", FX.company).select("fm_b2b_tier, fm_b2b_packages, account_status, fm_b2b_enabled").maybeSingle();
    rec("supplier", "write: pakiet/status/udział własnej firmy testowej nie do zmiany (trigger przywraca)", !u.error && same(u.data, company.data), u.error?.message || JSON.stringify(u.data));
    const p = await c.from("profiles").update({ company_id: null, active: false, fm26_active: !me.fm26_active }).eq("id", me.id).select("company_id, active, fm26_active").maybeSingle();
    rec("supplier", "write: własne przypisanie firmy/aktywność nie do zmiany", !p.error && p.data?.company_id === me.company_id && p.data?.active === me.active && p.data?.fm26_active === me.fm26_active, p.error?.message || JSON.stringify(p.data));
  }
  // 5) storage: cudzy folder = folder DRUGIEJ firmy testowej; własny folder = upload + usunięcie
  if (!writesAborted) {
    const foreignPath = `${FX.foreign}/probe-${Date.now()}.png`;
    const up = await c.storage.from("company-logos").upload(foreignPath, PNG, { contentType: "image/png" });
    const listed = await c.storage.from("company-logos").list(FX.foreign, { search: "probe-" });
    const exists = (listed.data || []).some(f => foreignPath.endsWith(f.name));
    if (!up.error || exists) { writesAborted = true; rec("supplier", "write: upload do folderu cudzej firmy testowej", false, "UPLOAD PRZESZEDŁ — usuń plik: " + foreignPath); }
    else rec("supplier", "write: upload do folderu cudzej firmy testowej odrzucony (RLS)", /row-level security|policy|403|401|not allowed|unauthorized/i.test(up.error.message || ""), up.error.message);
  }
  if (!writesAborted) {
    const ownPath = `${FX.company}/probe-${Date.now()}.png`;
    const own = await c.storage.from("company-logos").upload(ownPath, PNG, { contentType: "image/png" });
    rec("supplier", "write: upload do własnego folderu działa", !own.error, own.error?.message || "ok");
    if (!own.error) {
      const del = await c.storage.from("company-logos").remove([ownPath]);
      const after = await c.storage.from("company-logos").list(FX.company, { search: "probe-" });
      rec("supplier", "write: usunięcie własnego pliku działa", !del.error && !(after.data || []).some(f => ownPath.endsWith(f.name)), del.error?.message || "usunięto");
    }
  }
  // 6) stan rekordów testowych po próbach = jak przed (dokładne wiersze)
  const after = { own: await snapshotTargets(c, FX.company), foreign: await snapshotTargets(c, FX.foreign) };
  rec("supplier", "po próbach: wybory firm testowych dokładnie jak przed", same(before, after), same(before, after) ? `own=${after.own.length} foreign=${after.foreign.length}` : "RÓŻNICA — sprawdź rekordy testowe");
}

// ── kupiec (konto testowe: sieć nieaktywna, poza FM) ─────────────────────────
async function probeBuyer() {
  const s = await login("buyer");
  if (!s) { rec("buyer", "logowanie", false, "brak danych konta (FM_PROBE_BUYER_*)"); return; }
  const { c, me } = s;
  let n = await count(c, "retailer_contacts");
  rec("buyer", "retailer_contacts: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  let r = await c.from("profiles").select("id");
  rec("buyer", "profiles: tylko własny", !r.error && (r.data || []).every(x => x.id === me.id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_prefs").select("retailer_id");
  rec("buyer", "fm_prefs: tylko własna sieć", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_target_retailers").select("retailer_id");
  rec("buyer", "company_target_retailers: tylko własna sieć", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_resps").select("retailer_id");
  rec("buyer", "fm_resps: tylko własna sieć", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  n = await count(c, "fm_plan_private");
  rec("buyer", "fm_plan_private: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  r = await c.rpc("fm_my_schedule");
  rec("buyer", "fm_my_schedule: null (konto testowe poza FM nie ma prawa do planu)", !r.error && r.data == null, r.error?.message || JSON.stringify(r.data).slice(0, 80));
  r = await c.from("retailers").select("id, buyer_email, contacts:retailer_contacts(buyer_email)");
  rec("buyer", "retailers: bez kontaktów innych sieci", !r.error && (r.data || []).every(x => !x.buyer_email && !x.contacts), r.error?.message || `rows=${r.data?.length}`);
  await probeAdminViews("buyer", c, me.id);
  if (!WRITES) return;

  const problems = await preflightBuyerFixtures(c, me);
  if (problems.length) { rec("buyer", "preflight rekordów testowych", false, problems.join("; ") + " — ZAPISY POMINIĘTE"); return; }
  const respBefore = (await c.from("fm_resps").select("retailer_id, supplier_company_id, zone, status").eq("retailer_id", Number(FX.retailer)).eq("supplier_company_id", FX.company)).data || [];
  // 1) odpowiedź kupca testowego (sieć testowa → firma testowa): odrzucona regułą udziału
  const ins = await c.from("fm_resps").insert({ retailer_id: Number(FX.retailer), supplier_company_id: FX.company, zone: "green", status: "green", meta: { probe: true } });
  if (!guardUnexpectedSuccess("buyer", "write: odpowiedź kupca testowego", ins.error))
    rec("buyer", "write: odpowiedź kupca testowego → fm_inputs_forbidden (buyer_/retailer_)", isForbidden(ins.error) && /buyer_|retailer_/.test(ins.error.hint || ""), errInfo(ins.error));
  // 2) RPC dostawcy wywołany przez kupca dla firmy testowej: brak uprawnień (istniejąca firma → reguła właściciela, nie „nie ma firmy")
  if (!writesAborted) {
    const t = await c.rpc("fm_set_company_targets", { p_company_id: FX.company, p_items: [{ retailer_id: Number(FX.retailer), priority: 1000 }] });
    if (!guardUnexpectedSuccess("buyer", "write: fm_set_company_targets przez kupca", t.error))
      rec("buyer", "write: fm_set_company_targets przez kupca → brak uprawnień (42501)", isOwnership(t.error), errInfo(t.error));
  }
  // 3) własne przypisanie sieci / aktywność
  if (!writesAborted) {
    const p = await c.from("profiles").update({ retailer_id: 1, active: false, fm26_active: !me.fm26_active }).eq("id", me.id).select("retailer_id, active, fm26_active").maybeSingle();
    rec("buyer", "write: własne przypisanie sieci/aktywność nie do zmiany", !p.error && Number(p.data?.retailer_id) === Number(me.retailer_id) && p.data?.active === me.active && p.data?.fm26_active === me.fm26_active, p.error?.message || JSON.stringify(p.data));
  }
  const respAfter = (await c.from("fm_resps").select("retailer_id, supplier_company_id, zone, status").eq("retailer_id", Number(FX.retailer)).eq("supplier_company_id", FX.company)).data || [];
  rec("buyer", "po próbach: odpowiedzi pary testowej dokładnie jak przed", same(respBefore, respAfter), `rows=${respAfter.length}`);
}

// ── admin (opcjonalnie, tylko odczyt) ────────────────────────────────────────
async function probeAdmin() {
  const s = await login("admin");
  if (!s) { console.log("(admin: brak FM_PROBE_ADMIN_* — pominięte)"); return; }
  const { c } = s;
  let n = await count(c, "retailer_contacts");
  rec("admin", "retailer_contacts: widoczne", !n.error && n.n > 0, n.error?.message || `count=${n.n}`);
  let r = await c.from("retailers").select("id, contacts:retailer_contacts(buyer_email)");
  rec("admin", "retailers z osadzonym kontaktem", !r.error && (r.data || []).some(x => x.contacts), r.error?.message || `z kontaktem=${(r.data || []).filter(x => x.contacts).length}`);
  r = await c.rpc("fm_my_schedule");
  rec("admin", "fm_my_schedule: całość lub null (brak planu)", !r.error, r.error?.message || (r.data ? `keys=${Object.keys(r.data).join(",")}` : "null"));
  r = await c.from("fm_plan_private").select("id, updated_at");
  rec("admin", "fm_plan_private: odczyt", !r.error, r.error?.message || `rows=${r.data?.length}`);
  n = await count(c, "consent_audit");
  rec("admin", "consent_audit: legalny odczyt admina działa", !n.error, n.error?.message || `count=${n.n}`);
  n = await count(c, "company_capacity");
  rec("admin", "company_capacity: legalny odczyt admina działa", !n.error && n.n > 0, n.error?.message || `count=${n.n}`);
  r = await c.from("audit_log").select("action, entity_id, created_at").eq("action", "fm_targets_saved").order("created_at", { ascending: false }).limit(3);
  rec("admin", "audit_log: ślady zapisów wyborów (fm_targets_saved) czytelne", !r.error, r.error?.message || `ostatnie=${(r.data || []).length}`);
}

await probeAnon();
await probeSupplier();
await probeBuyer();
await probeAdmin();
const failed = results.filter(x => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS${WRITES ? " (z próbami zapisu na rekordach testowych)" : " (tylko odczyty)"}${writesAborted ? " — UWAGA: zapisy przerwane po nieoczekiwanym sukcesie" : ""}`);
if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
