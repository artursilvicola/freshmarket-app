#!/usr/bin/env node
// [fix/security-hotfix] Sondy uprawnień PRAWDZIWYCH kont przez PostgREST po migracjach 054 + 055.
// TYLKO ODCZYT. Skrypt nie wykonuje żadnego INSERT/UPDATE/DELETE, uploadu ani RPC zapisującego
// (review Codexa f504f09: produkcyjne próby zapisu usunięte; ścieżki zapisu i odmowy są dowiedzione
// w izolacji — testy SQL 055, test równoległości, testy jednostkowe).
//
//   node scripts/fm-permission-probe.mjs [--json]
//
// Zmienne: FM_PROBE_URL, FM_PROBE_ANON_KEY (klucz publiczny anon),
//          FM_PROBE_SUPPLIER_EMAIL/PASSWORD — konto dostawcy TESTOWEGO (firma zawieszona, poza FM),
//          FM_PROBE_BUYER_EMAIL/PASSWORD    — konto kupca TESTOWEGO (sieć nieaktywna, poza FM),
//          FM_PROBE_ADMIN_EMAIL/PASSWORD    — opcjonalnie.
// Konta testowe nie wchodzą do wyborów ani planu (nie spełniają warunków udziału); nie używać kont uczestników.
// Nie wypisuje kluczy, tokenów, e-maili ani kontaktów — tylko liczby i statusy.
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
if (args.includes("--writes")) { console.error("Tryb --writes został usunięty: na produkcji tylko odczyty. Próby zapisu wykonuj w izolacji (scripts/fm-queue-sql-test.mjs --test 055, scripts/fm-targets-concurrency-test.mjs)."); process.exit(2); }
const env = (k) => (process.env[k] || "").trim();
const URL = env("FM_PROBE_URL"), ANON = env("FM_PROBE_ANON_KEY");
if (!URL || !ANON) { console.error("Ustaw FM_PROBE_URL i FM_PROBE_ANON_KEY."); process.exit(2); }

const results = [];
function rec(role, name, pass, info = "") {
  results.push({ role, name, pass: !!pass, info: String(info).slice(0, 160) });
  console.log(`${pass ? "PASS" : "FAIL"}  [${role}] ${name}${info ? " - " + info : ""}`);
}
// tylko KONKRETNA odmowa liczy sie jako ochrona; transport / brak obiektu = FAIL
const isDenied = (e) => !!e && (e.code === "42501" || /permission denied|row-level security|not allowed|401|403/i.test(e.message || "")) && !/could not find|does not exist|failed to fetch/i.test(e.message || "");

function client() { return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function login(role) {
  const email = env(`FM_PROBE_${role.toUpperCase()}_EMAIL`), pwd = env(`FM_PROBE_${role.toUpperCase()}_PASSWORD`);
  if (!email || !pwd) return null;
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password: pwd });
  if (error || !data?.user) { console.error(`[${role}] logowanie nieudane: ${error?.message || "brak uzytkownika"}`); return null; }
  const { data: me, error: meErr } = await c.from("profiles").select("id, role, company_id, retailer_id, active, fm26_active").eq("id", data.user.id).maybeSingle();
  if (meErr || !me) { console.error(`[${role}] brak profilu`); return null; }
  if (me.role !== role) { console.error(`[${role}] konto ma role ${me.role}, oczekiwano ${role} - sondy pominiete`); return null; }
  return { c, me };
}
// GET z limit 1 zamiast HEAD: przy HEAD supabase-js nie oddaje bledu 401/42501 (count=0 wygladalo jak sukces)
async function count(c, table, mod = (q) => q) {
  const r = await mod(c.from(table).select("*", { count: "exact" }).limit(1));
  return { error: r.error, n: r.count ?? (r.data ? r.data.length : 0) };
}
async function probeAdminViews(role, c, uid) {
  for (const v of ["v_admin_registrations", "v_admin_stats", "consent_audit"]) {
    const r = await c.from(v).select("*");
    const rows = r.data || [];
    const onlySelf = v === "consent_audit" && rows.every(x => x.id === uid);
    // v_admin_stats to widok agregujacy: dla nie-admina (RLS event_registrations) zwraca 1 wiersz samych zer — brak danych
    const allZero = v === "v_admin_stats" && rows.length === 1 && Object.values(rows[0]).every(x => x === 0 || x === "0" || x == null);
    rec(role, `${v}: odmowa albo 0 wierszy${v === "consent_audit" ? " (lub tylko wlasny)" : v === "v_admin_stats" ? " (lub same zera)" : ""}`, isDenied(r.error) || (!r.error && (rows.length === 0 || onlySelf || allZero)), r.error?.message || `rows=${rows.length}`);
  }
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
  r = await count(c, "audit_log");
  rec("anon", "audit_log: zabronione", isDenied(r.error) || (!r.error && r.n === 0), r.error?.message || `count=${r.n}`);
  s = await c.rpc("fm_my_schedule");
  rec("anon", "fm_my_schedule: null/zabronione", (!s.error && s.data == null) || isDenied(s.error), s.error?.message || JSON.stringify(s.data));
}

// ── dostawca (konto testowe: firma zawieszona, poza FM) ──────────────────────
async function probeSupplier() {
  const s = await login("supplier");
  if (!s) { rec("supplier", "logowanie", false, "brak danych konta (FM_PROBE_SUPPLIER_*)"); return; }
  const { c, me } = s;
  const own = await c.from("companies").select("account_status, fm_b2b_enabled").eq("id", me.company_id).maybeSingle();
  rec("supplier", "konto testowe: firma zawieszona i poza FM (nie wchodzi do wyborow ani planu)", own.data?.account_status === "suspended" && own.data?.fm_b2b_enabled === false, own.error?.message || `status=${own.data?.account_status} fm=${own.data?.fm_b2b_enabled}`);
  let r = await c.from("retailers").select("id, name, buyer_name, buyer_email, buyer_phone, contacts:retailer_contacts(buyer_email)");
  const rows = r.data || [];
  rec("supplier", "retailers: lista sieci widoczna", !r.error && rows.length > 0, r.error?.message || `rows=${rows.length}`);
  rec("supplier", "retailers: zero kontaktow kupcow (buyer_* puste, retailer_contacts null)", rows.every(x => !x.buyer_name && !x.buyer_email && !x.buyer_phone && !x.contacts), `z kontaktem: ${rows.filter(x => x.buyer_email || x.buyer_name || x.buyer_phone || x.contacts).length}`);
  let n = await count(c, "retailer_contacts");
  rec("supplier", "retailer_contacts: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "profiles", q => q.eq("role", "buyer"));
  rec("supplier", "profiles kupcow: 0", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "fm_prefs");
  rec("supplier", "fm_prefs: 0 (polityka 002 usunieta)", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "fm_plan_private");
  rec("supplier", "fm_plan_private: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "fm_inputs_snapshots");
  rec("supplier", "fm_inputs_snapshots: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "audit_log");
  rec("supplier", "audit_log: 0 wierszy (odczyt tylko admin)", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  r = await c.rpc("fm_my_schedule");
  rec("supplier", "fm_my_schedule: null (konto zawieszone / poza FM; przed publikacja takze null)", !r.error && r.data == null, r.error?.message || JSON.stringify(r.data).slice(0, 80));
  r = await c.from("fm_resps").select("supplier_company_id");
  rec("supplier", "fm_resps: tylko o sobie (konto testowe: 0)", !r.error && (r.data || []).every(x => x.supplier_company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_target_retailers").select("company_id");
  rec("supplier", "company_target_retailers: tylko wlasne (konto testowe: 0)", !r.error && (r.data || []).every(x => x.company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("legacy_sends").select("data");
  rec("supplier", "legacy_sends.data bez adresow kupcow", !r.error && (r.data || []).every(x => !(x.data && x.data.resendBuyerEmails)), r.error?.message || `rows=${r.data?.length}`);
  await probeAdminViews("supplier", c, me.id);
}

// ── kupiec (konto testowe: siec nieaktywna, poza FM) ─────────────────────────
async function probeBuyer() {
  const s = await login("buyer");
  if (!s) { rec("buyer", "logowanie", false, "brak danych konta (FM_PROBE_BUYER_*)"); return; }
  const { c, me } = s;
  const own = await c.from("retailers").select("active, fm26_active").eq("id", me.retailer_id).maybeSingle();
  rec("buyer", "konto testowe: siec nieaktywna i poza FM (nie wchodzi do planu)", own.data?.active === false && own.data?.fm26_active === false, own.error?.message || `active=${own.data?.active} fm=${own.data?.fm26_active}`);
  let n = await count(c, "retailer_contacts");
  rec("buyer", "retailer_contacts: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  let r = await c.from("profiles").select("id");
  rec("buyer", "profiles: tylko wlasny", !r.error && (r.data || []).every(x => x.id === me.id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_prefs").select("retailer_id");
  rec("buyer", "fm_prefs: tylko wlasna siec", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_target_retailers").select("retailer_id");
  rec("buyer", "company_target_retailers: tylko wlasna siec (konto testowe: 0)", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_resps").select("retailer_id");
  rec("buyer", "fm_resps: tylko wlasna siec (konto testowe: 0)", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  n = await count(c, "fm_plan_private");
  rec("buyer", "fm_plan_private: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  n = await count(c, "audit_log");
  rec("buyer", "audit_log: 0 wierszy", !n.error && n.n === 0, n.error?.message || `count=${n.n}`);
  r = await c.rpc("fm_my_schedule");
  rec("buyer", "fm_my_schedule: null (konto poza FM)", !r.error && r.data == null, r.error?.message || JSON.stringify(r.data).slice(0, 80));
  r = await c.from("retailers").select("id, buyer_email, contacts:retailer_contacts(buyer_email)");
  rec("buyer", "retailers: bez kontaktow innych sieci", !r.error && (r.data || []).every(x => !x.buyer_email && !x.contacts), r.error?.message || `rows=${r.data?.length}`);
  await probeAdminViews("buyer", c, me.id);
}

// ── admin (opcjonalnie, tylko odczyt) ────────────────────────────────────────
async function probeAdmin() {
  const s = await login("admin");
  if (!s) { console.log("(admin: brak FM_PROBE_ADMIN_* - pominiete)"); return; }
  const { c } = s;
  let n = await count(c, "retailer_contacts");
  rec("admin", "retailer_contacts: widoczne", !n.error && n.n > 0, n.error?.message || `count=${n.n}`);
  let r = await c.from("retailers").select("id, contacts:retailer_contacts(buyer_email)");
  rec("admin", "retailers z osadzonym kontaktem", !r.error && (r.data || []).some(x => x.contacts), r.error?.message || `z kontaktem=${(r.data || []).filter(x => x.contacts).length}`);
  r = await c.rpc("fm_my_schedule");
  rec("admin", "fm_my_schedule: calosc lub null (brak planu)", !r.error, r.error?.message || (r.data ? `keys=${Object.keys(r.data).join(",")}` : "null"));
  r = await c.from("fm_plan_private").select("id, updated_at");
  rec("admin", "fm_plan_private: odczyt", !r.error, r.error?.message || `rows=${r.data?.length}`);
  n = await count(c, "consent_audit");
  rec("admin", "consent_audit: legalny odczyt admina dziala", !n.error, n.error?.message || `count=${n.n}`);
  n = await count(c, "company_capacity");
  rec("admin", "company_capacity: legalny odczyt admina dziala", !n.error && n.n > 0, n.error?.message || `count=${n.n}`);
  r = await c.from("audit_log").select("action, entity_id, created_at").in("action", ["fm_targets_saved", "fm_resp_insert", "fm_resp_update"]).order("created_at", { ascending: false }).limit(5);
  rec("admin", "audit_log: zdarzenia serwerowe (fm_targets_saved / fm_resp_*) czytelne", !r.error, r.error?.message || `ostatnie=${(r.data || []).length}`);
}

await probeAnon();
await probeSupplier();
await probeBuyer();
await probeAdmin();
const failed = results.filter(x => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS (tylko odczyty)`);
if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
