#!/usr/bin/env node
// [fix/security-hotfix] Sondy uprawnień PRAWDZIWYCH kont (anon / dostawca / kupiec /
// opcjonalnie admin) przez PostgREST — po zastosowaniu migracji 054 + 055.
//
// Użycie (PowerShell):
//   $env:FM_PROBE_URL="https://<ref>.supabase.co"; $env:FM_PROBE_ANON_KEY="<anon key>"
//   $env:FM_PROBE_SUPPLIER_EMAIL="…"; $env:FM_PROBE_SUPPLIER_PASSWORD="…"
//   $env:FM_PROBE_BUYER_EMAIL="…";    $env:FM_PROBE_BUYER_PASSWORD="…"
//   ($env:FM_PROBE_ADMIN_EMAIL / FM_PROBE_ADMIN_PASSWORD — opcjonalnie)
//   node scripts/fm-permission-probe.mjs            # TYLKO odczyty (żadnego INSERT/UPDATE/DELETE)
//   node scripts/fm-permission-probe.mjs --writes   # + próby zapisu (patrz niżej)
//
// Tryb domyślny nie wykonuje żadnego zapytania zmieniającego dane. `--writes`
// wykonuje WYŁĄCZNIE na KONTACH TESTOWYCH (nie klientów!) próby, które po hotfixie
// mają zostać odrzucone lub przywrócone przez trigger — jeśli zabezpieczenie zawiedzie,
// dane tego konta testowego ZMIENIĄ SIĘ (dlatego nie używać kont uczestników) — oraz
// upload + usunięcie 1-pikselowego PNG we WŁASNYM folderze konta testowego.
// Nigdy nie dotyka wyborów sieci, odpowiedzi kupców, planu ani maili.
// Nie wypisuje kluczy, tokenów, e-maili ani kontaktów — tylko liczby i statusy.
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const WRITES = args.includes("--writes");
const env = (k) => (process.env[k] || "").trim();
const URL = env("FM_PROBE_URL"), ANON = env("FM_PROBE_ANON_KEY");
if (!URL || !ANON) { console.error("Ustaw FM_PROBE_URL i FM_PROBE_ANON_KEY."); process.exit(2); }

const results = [];
function rec(role, name, pass, info = "") {
  results.push({ role, name, pass: !!pass, info: String(info).slice(0, 160) });
  console.log(`${pass ? "PASS" : "FAIL"}  [${role}] ${name}${info ? " — " + info : ""}`);
}
const denied = (e) => !!e && (e.code === "42501" || /permission denied|row-level security|not allowed|401|403/i.test(e.message || ""));
const ZERO = "00000000-0000-0000-0000-000000000000";
// 1×1 przezroczysty PNG (68 B) — poprawny MIME dla bucketu logo
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function client() {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}
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
// widoki v_admin_* dla nie-admina: albo odmowa, albo 0 wierszy (security_invoker + RLS)
async function probeAdminViews(role, c) {
  for (const v of ["v_admin_registrations", "v_admin_stats", "consent_audit"]) {
    const r = await c.from(v).select("*");
    const rows = r.data || [];
    const onlySelf = v === "consent_audit" && rows.every(x => x.id === c.__uid);
    rec(role, `${v}: odmowa albo 0 wierszy${v === "consent_audit" ? " (lub tylko własny)" : ""}`, denied(r.error) || (!r.error && (rows.length === 0 || onlySelf)), r.error?.message || `rows=${rows.length}`);
  }
}

// ── anon ─────────────────────────────────────────────────────────────────────
async function probeAnon() {
  const c = client();
  let r = await count(c, "consent_audit");
  rec("anon", "consent_audit: odczyt zabroniony", denied(r.error), r.error?.message || `count=${r.n}`);
  r = await count(c, "v_admin_registrations");
  rec("anon", "v_admin_registrations: odczyt zabroniony", denied(r.error), r.error?.message || `count=${r.n}`);
  let s = await c.from("v_admin_stats").select("*");
  rec("anon", "v_admin_stats: odczyt zabroniony", denied(s.error), s.error?.message || `rows=${s.data?.length}`);
  r = await count(c, "company_capacity");
  rec("anon", "company_capacity: 0 wierszy (security_invoker)", !r.error && r.n === 0, r.error?.message || `count=${r.n}`);
  s = await c.from("fm_settings").select("schedule, brand_logo_url");
  rec("anon", "fm_settings: schedule = null, logo czytelne", !s.error && (s.data || []).every(x => x.schedule == null), s.error?.message || `rows=${s.data?.length}`);
  r = await count(c, "retailers");
  rec("anon", "retailers: 0 wierszy", !r.error && r.n === 0, r.error?.message || `count=${r.n}`);
  r = await count(c, "retailer_contacts");
  rec("anon", "retailer_contacts: zabronione", denied(r.error), r.error?.message || `count=${r.n}`);
  r = await count(c, "fm_plan_private");
  rec("anon", "fm_plan_private: zabronione", denied(r.error), r.error?.message || `count=${r.n}`);
  s = await c.rpc("fm_my_schedule");
  rec("anon", "fm_my_schedule: null/zabronione", (!s.error && s.data == null) || denied(s.error), s.error?.message || JSON.stringify(s.data));
  s = await c.rpc("fm_set_company_targets", { p_company_id: ZERO, p_items: [] });
  rec("anon", "fm_set_company_targets: zabronione", denied(s.error) || !!s.error, s.error?.message || "brak błędu!");
  if (!WRITES) return;
  s = await c.from("consent_audit").delete().eq("id", ZERO);
  rec("anon", "write: delete przez widok consent_audit zabroniony", denied(s.error), s.error?.message || "brak błędu!");
}

// ── dostawca ─────────────────────────────────────────────────────────────────
async function probeSupplier() {
  const s = await login("supplier");
  if (!s) { rec("supplier", "logowanie", false, "brak danych konta (FM_PROBE_SUPPLIER_*)"); return; }
  const { c, me } = s; c.__uid = me.id;
  let r = await c.from("retailers").select("id, name, buyer_name, buyer_email, buyer_phone, contacts:retailer_contacts(buyer_email)");
  const rows = r.data || [];
  rec("supplier", "retailers: lista sieci widoczna", !r.error && rows.length > 0, r.error?.message || `rows=${rows.length}`);
  rec("supplier", "retailers: zero kontaktów kupców", rows.every(x => !x.buyer_name && !x.buyer_email && !x.buyer_phone && !x.contacts), `z kontaktem: ${rows.filter(x => x.buyer_email || x.buyer_name || x.buyer_phone || x.contacts).length}`);
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
  const co = await c.from("companies").select("id, legacy_fm_id, legacy_supplier_id, fm_b2b_tier, fm_b2b_packages, account_status").eq("id", me.company_id).maybeSingle();
  const ownKeys = new Set([me.company_id, co.data?.legacy_fm_id, co.data?.legacy_supplier_id].filter(Boolean).map(String));
  r = await c.rpc("fm_my_schedule");
  const plan = r.data;
  const planOk = plan == null || (plan.scope === "supplier"
    && Object.keys(plan.res || {}).every(k => ownKeys.has(k))
    && Object.keys(plan.nums || {}).every(k => ownKeys.has(k))
    && !("cs" in plan) && !("warnings" in plan));
  rec("supplier", "fm_my_schedule: null przed publikacją / po niej wyłącznie własne klucze", !r.error && planOk, r.error?.message || (plan ? `scope=${plan.scope} res=${Object.keys(plan.res || {}).length} nums=${Object.keys(plan.nums || {}).length}` : "null"));
  r = await c.from("fm_resps").select("supplier_company_id");
  rec("supplier", "fm_resps: tylko o sobie", !r.error && (r.data || []).every(x => x.supplier_company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_target_retailers").select("company_id");
  rec("supplier", "company_target_retailers: tylko własne", !r.error && (r.data || []).every(x => x.company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("legacy_sends").select("data");
  rec("supplier", "legacy_sends.data bez adresów kupców", !r.error && (r.data || []).every(x => !(x.data && x.data.resendBuyerEmails)), r.error?.message || `rows=${r.data?.length}`);
  await probeAdminViews("supplier", c);

  if (!WRITES) return;
  if (co.data) {
    const other = co.data.fm_b2b_tier === "premium" ? "business" : "premium";
    const w = await c.from("companies").update({ fm_b2b_tier: other, fm_b2b_packages: 9, account_status: "active" }).eq("id", me.company_id).select("fm_b2b_tier, fm_b2b_packages, account_status").maybeSingle();
    rec("supplier", "write: własny pakiet/status nie do zmiany (trigger przywraca)", !w.error && w.data?.fm_b2b_tier === co.data.fm_b2b_tier && w.data?.fm_b2b_packages === co.data.fm_b2b_packages && w.data?.account_status === co.data.account_status, w.error?.message || `tier=${w.data?.fm_b2b_tier} packages=${w.data?.fm_b2b_packages}`);
  }
  const p = await c.from("profiles").update({ company_id: null, active: false, fm26_active: !me.fm26_active }).eq("id", me.id).select("company_id, active, fm26_active").maybeSingle();
  rec("supplier", "write: własne przypisanie firmy/aktywność nie do zmiany", !p.error && p.data?.company_id === me.company_id && p.data?.active === me.active && p.data?.fm26_active === me.fm26_active, p.error?.message || `company_id=${p.data?.company_id === me.company_id ? "bez zmian" : "ZMIENIONE"}`);
  const others = await c.from("companies").select("id").neq("id", me.company_id).limit(1);
  const otherId = others.data?.[0]?.id;
  if (otherId) {
    const path = `${otherId}/probe-${Date.now()}.png`;
    const up = await c.storage.from("company-logos").upload(path, PNG, { contentType: "image/png" });
    const listed = await c.storage.from("company-logos").list(otherId, { search: "probe-" });
    const exists = (listed.data || []).some(f => path.endsWith(f.name));
    rec("supplier", "write: upload do cudzego folderu odrzucony (RLS)", !!up.error && !exists, up.error?.message || "UPLOAD PRZESZEDŁ — usuń plik ręcznie: " + path);
  }
  const ownPath = `${me.company_id}/probe-${Date.now()}.png`;
  const own = await c.storage.from("company-logos").upload(ownPath, PNG, { contentType: "image/png" });
  rec("supplier", "write: upload do własnego folderu działa", !own.error, own.error?.message || "ok");
  if (!own.error) {
    const del = await c.storage.from("company-logos").remove([ownPath]);
    const after = await c.storage.from("company-logos").list(me.company_id, { search: "probe-" });
    rec("supplier", "write: usunięcie własnego pliku działa", !del.error && !(after.data || []).some(f => ownPath.endsWith(f.name)), del.error?.message || "usunięto");
  }
  const t = await c.rpc("fm_set_company_targets", { p_company_id: otherId || ZERO, p_items: [] });
  rec("supplier", "write: zapis wyborów CUDZEJ firmy odrzucony", !!t.error, t.error?.message || "brak błędu!");
  // stary bundle (DELETE + INSERT wprost): DELETE = 0 wierszy, INSERT odrzucony — własne wybory konta testowego nietknięte
  const beforeN = (await c.from("company_target_retailers").select("retailer_id")).data?.length ?? -1;
  const anyRetailer = rows[0]?.id;
  const d = await c.from("company_target_retailers").delete().eq("company_id", me.company_id).select("retailer_id");
  const ins = anyRetailer ? await c.from("company_target_retailers").insert({ company_id: me.company_id, retailer_id: anyRetailer, priority: 1 }) : { error: new Error("brak sieci") };
  const afterN = (await c.from("company_target_retailers").select("retailer_id")).data?.length ?? -2;
  rec("supplier", "write: bezpośredni DELETE/INSERT wyborów bez efektu (tylko RPC)", !d.error && (d.data || []).length === 0 && !!ins.error && beforeN === afterN, d.error?.message || ins.error?.message || `przed=${beforeN} po=${afterN} usunięte=${(d.data || []).length}`);
}

// ── kupiec ───────────────────────────────────────────────────────────────────
async function probeBuyer() {
  const s = await login("buyer");
  if (!s) { rec("buyer", "logowanie", false, "brak danych konta (FM_PROBE_BUYER_*)"); return; }
  const { c, me } = s; c.__uid = me.id;
  const own = await c.from("retailers").select("id, fm26_chain_id").eq("id", me.retailer_id).maybeSingle();
  const chain = own.data?.fm26_chain_id || null;
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
  const plan = r.data;
  const planOk = plan == null || (plan.scope === "buyer" && !!chain
    && Object.values(plan.res || {}).every(e => Array.isArray(e?.m) && e.m.length === 1 && e.m[0] === chain && !("r" in e))
    && Object.values(plan.nums || {}).every(e => Object.keys(e || {}).every(k => k === chain)));
  rec("buyer", "fm_my_schedule: null przed publikacją / po niej każdy wpis tylko z własnym chainem", !r.error && planOk, r.error?.message || (plan ? `scope=${plan.scope} res=${Object.keys(plan.res || {}).length}` : "null"));
  r = await c.from("retailers").select("id, buyer_email, contacts:retailer_contacts(buyer_email)");
  rec("buyer", "retailers: bez kontaktów innych sieci", !r.error && (r.data || []).every(x => !x.buyer_email && !x.contacts), r.error?.message || `rows=${r.data?.length}`);
  await probeAdminViews("buyer", c);
  if (!WRITES) return;
  const p = await c.from("profiles").update({ retailer_id: 1, active: false, fm26_active: !me.fm26_active }).eq("id", me.id).select("retailer_id, active, fm26_active").maybeSingle();
  rec("buyer", "write: własne przypisanie sieci/aktywność nie do zmiany", !p.error && p.data?.retailer_id === me.retailer_id && p.data?.active === me.active && p.data?.fm26_active === me.fm26_active, p.error?.message || `retailer_id=${p.data?.retailer_id === me.retailer_id ? "bez zmian" : "ZMIENIONE"}`);
  const t = await c.rpc("fm_set_company_targets", { p_company_id: ZERO, p_items: [] });
  rec("buyer", "write: fm_set_company_targets odrzucone dla kupca", !!t.error, t.error?.message || "brak błędu!");
}

// ── admin (opcjonalnie) ──────────────────────────────────────────────────────
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
}

await probeAnon();
await probeSupplier();
await probeBuyer();
await probeAdmin();
const failed = results.filter(x => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS${WRITES ? " (z próbami zapisu)" : " (tylko odczyty)"}`);
if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
