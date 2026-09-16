#!/usr/bin/env node
// [fix/security-hotfix] Sondy uprawnień PRAWDZIWYCH kont (anon / dostawca / kupiec /
// opcjonalnie admin) przez PostgREST — po zastosowaniu migracji 054.
//
// Użycie (PowerShell):
//   $env:FM_PROBE_URL="https://<ref>.supabase.co"; $env:FM_PROBE_ANON_KEY="<anon key>"
//   $env:FM_PROBE_SUPPLIER_EMAIL="…"; $env:FM_PROBE_SUPPLIER_PASSWORD="…"
//   $env:FM_PROBE_BUYER_EMAIL="…";    $env:FM_PROBE_BUYER_PASSWORD="…"
//   ($env:FM_PROBE_ADMIN_EMAIL / FM_PROBE_ADMIN_PASSWORD — opcjonalnie)
//   node scripts/fm-permission-probe.mjs            # tylko odczyty
//   node scripts/fm-permission-probe.mjs --writes   # + bezpieczne próby zapisu (patrz niżej)
//
// Odczyty niczego nie zmieniają. `--writes` wykonuje WYŁĄCZNIE próby, które po
// hotfixie mają zostać odrzucone lub przywrócone przez trigger (własny pakiet,
// własne przypisanie, cudzy folder w storage) oraz upload+usunięcie 1-bajtowego
// pliku we WŁASNYM folderze konta testowego. Nigdy nie dotyka wyborów sieci,
// odpowiedzi kupców, planu ani maili. Klucze i tokeny nie są wypisywane.
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

function client() {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function login(role) {
  const email = env(`FM_PROBE_${role.toUpperCase()}_EMAIL`), pwd = env(`FM_PROBE_${role.toUpperCase()}_PASSWORD`);
  if (!email || !pwd) return null;
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password: pwd });
  if (error || !data?.user) { console.error(`[${role}] logowanie nieudane: ${error?.message || "brak użytkownika"}`); return null; }
  const { data: me, error: meErr } = await c.from("profiles").select("id, role, company_id, retailer_id").eq("id", data.user.id).maybeSingle();
  if (meErr || !me) { console.error(`[${role}] brak profilu`); return null; }
  if (me.role !== role) { console.error(`[${role}] konto ma rolę ${me.role}, oczekiwano ${role} — sondy pominięte`); return null; }
  return { c, me };
}

// ── anon ─────────────────────────────────────────────────────────────────────
async function probeAnon() {
  const c = client();
  let r = await c.from("consent_audit").select("id", { count: "exact", head: true });
  rec("anon", "consent_audit: odczyt zabroniony", denied(r.error), r.error?.message || `count=${r.count}`);
  r = await c.from("consent_audit").delete().eq("id", ZERO);
  rec("anon", "consent_audit: delete przez widok zabroniony", denied(r.error), r.error?.message || "brak błędu!");
  r = await c.from("v_admin_registrations").select("id", { count: "exact", head: true });
  rec("anon", "v_admin_registrations: odczyt zabroniony", denied(r.error), r.error?.message || `count=${r.count}`);
  r = await c.from("v_admin_stats").select("*");
  rec("anon", "v_admin_stats: odczyt zabroniony", denied(r.error), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_capacity").select("id", { count: "exact", head: true });
  rec("anon", "company_capacity: 0 wierszy (security_invoker)", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.from("fm_settings").select("schedule, brand_logo_url");
  rec("anon", "fm_settings: schedule = null, logo czytelne", !r.error && (r.data || []).every(x => x.schedule == null), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("retailers").select("id", { count: "exact", head: true });
  rec("anon", "retailers: 0 wierszy", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.from("retailer_contacts").select("retailer_id", { count: "exact", head: true });
  rec("anon", "retailer_contacts: zabronione", denied(r.error), r.error?.message || `count=${r.count}`);
  r = await c.from("fm_plan_private").select("id", { count: "exact", head: true });
  rec("anon", "fm_plan_private: zabronione", denied(r.error), r.error?.message || `count=${r.count}`);
  r = await c.rpc("fm_my_schedule");
  rec("anon", "fm_my_schedule: null/zabronione", (!r.error && r.data == null) || denied(r.error), r.error?.message || JSON.stringify(r.data));
}

// ── dostawca ─────────────────────────────────────────────────────────────────
async function probeSupplier() {
  const s = await login("supplier");
  if (!s) { rec("supplier", "logowanie", false, "brak danych konta (FM_PROBE_SUPPLIER_*)"); return; }
  const { c, me } = s;
  let r = await c.from("retailers").select("id, name, buyer_name, buyer_email, buyer_phone, contacts:retailer_contacts(buyer_email)");
  const rows = r.data || [];
  rec("supplier", "retailers: lista sieci widoczna", !r.error && rows.length > 0, r.error?.message || `rows=${rows.length}`);
  rec("supplier", "retailers: zero kontaktów kupców", rows.every(x => !x.buyer_name && !x.buyer_email && !x.buyer_phone && !x.contacts), `z kontaktem: ${rows.filter(x => x.buyer_email || x.buyer_name || x.buyer_phone || x.contacts).length}`);
  r = await c.from("retailer_contacts").select("retailer_id", { count: "exact", head: true });
  rec("supplier", "retailer_contacts: 0 wierszy", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.from("profiles").select("id", { count: "exact", head: true }).eq("role", "buyer");
  rec("supplier", "profiles kupców: 0", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.from("fm_prefs").select("id", { count: "exact", head: true });
  rec("supplier", "fm_prefs: 0 (polityka 002 usunięta)", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.from("fm_plan_private").select("id", { count: "exact", head: true });
  rec("supplier", "fm_plan_private: 0 wierszy", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.rpc("fm_my_schedule");
  rec("supplier", "fm_my_schedule: null przed publikacją / tylko własne po", !r.error && (r.data == null || (r.data.scope === "supplier" && Object.keys(r.data.res || {}).every(k => k === me.company_id))), r.error?.message || (r.data ? `scope=${r.data.scope} keys=${Object.keys(r.data.res || {}).length}` : "null"));
  r = await c.from("fm_resps").select("supplier_company_id");
  rec("supplier", "fm_resps: tylko o sobie", !r.error && (r.data || []).every(x => x.supplier_company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_target_retailers").select("company_id");
  rec("supplier", "company_target_retailers: tylko własne", !r.error && (r.data || []).every(x => x.company_id === me.company_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("consent_audit").select("id");
  rec("supplier", "consent_audit: co najwyżej własny wiersz", !r.error ? (r.data || []).every(x => x.id === me.id) : denied(r.error), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("legacy_sends").select("data");
  rec("supplier", "legacy_sends.data bez adresów kupców", !r.error && (r.data || []).every(x => !(x.data && x.data.resendBuyerEmails)), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_inputs_snapshots").select("id", { count: "exact", head: true });
  rec("supplier", "fm_inputs_snapshots: 0 wierszy", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);

  if (!WRITES) return;
  const co = await c.from("companies").select("id, fm_b2b_tier, fm_b2b_packages, account_status").eq("id", me.company_id).maybeSingle();
  if (co.data) {
    const other = co.data.fm_b2b_tier === "premium" ? "business" : "premium";
    const w = await c.from("companies").update({ fm_b2b_tier: other, fm_b2b_packages: 9 }).eq("id", me.company_id).select("fm_b2b_tier, fm_b2b_packages").maybeSingle();
    rec("supplier", "write: własny pakiet nie do zmiany (trigger przywraca)", !w.error && w.data?.fm_b2b_tier === co.data.fm_b2b_tier && w.data?.fm_b2b_packages === co.data.fm_b2b_packages, w.error?.message || `tier=${w.data?.fm_b2b_tier} packages=${w.data?.fm_b2b_packages}`);
  }
  const p = await c.from("profiles").update({ company_id: null, active: false }).eq("id", me.id).select("company_id, active").maybeSingle();
  rec("supplier", "write: własne przypisanie firmy nie do zmiany", !p.error && p.data?.company_id === me.company_id && p.data?.active !== false, p.error?.message || `company_id=${p.data?.company_id} active=${p.data?.active}`);
  const others = await c.from("companies").select("id").neq("id", me.company_id).limit(1);
  const otherId = others.data?.[0]?.id;
  const blob = new Blob(["x"], { type: "text/plain" });
  if (otherId) {
    const up = await c.storage.from("company-logos").upload(`${otherId}/probe-${Date.now()}.txt`, blob);
    rec("supplier", "write: upload do cudzego folderu zabroniony", !!up.error, up.error?.message || "UPLOAD PRZESZEDŁ — usuń plik ręcznie!");
  }
  const ownPath = `${me.company_id}/probe-${Date.now()}.txt`;
  const own = await c.storage.from("company-logos").upload(ownPath, blob);
  rec("supplier", "write: upload do własnego folderu działa", !own.error, own.error?.message || ownPath);
  if (!own.error) {
    const del = await c.storage.from("company-logos").remove([ownPath]);
    rec("supplier", "write: usunięcie własnego pliku działa", !del.error, del.error?.message || "usunięto");
  }
}

// ── kupiec ───────────────────────────────────────────────────────────────────
async function probeBuyer() {
  const s = await login("buyer");
  if (!s) { rec("buyer", "logowanie", false, "brak danych konta (FM_PROBE_BUYER_*)"); return; }
  const { c, me } = s;
  let r = await c.from("retailer_contacts").select("retailer_id", { count: "exact", head: true });
  rec("buyer", "retailer_contacts: 0 wierszy", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.from("profiles").select("id");
  rec("buyer", "profiles: tylko własny", !r.error && (r.data || []).every(x => x.id === me.id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_prefs").select("retailer_id");
  rec("buyer", "fm_prefs: tylko własna sieć", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("company_target_retailers").select("retailer_id");
  rec("buyer", "company_target_retailers: tylko własna sieć", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_resps").select("retailer_id");
  rec("buyer", "fm_resps: tylko własna sieć", !r.error && (r.data || []).every(x => x.retailer_id === me.retailer_id), r.error?.message || `rows=${r.data?.length}`);
  r = await c.from("fm_plan_private").select("id", { count: "exact", head: true });
  rec("buyer", "fm_plan_private: 0 wierszy", !r.error && (r.count || 0) === 0, r.error?.message || `count=${r.count}`);
  r = await c.rpc("fm_my_schedule");
  rec("buyer", "fm_my_schedule: null przed publikacją / scope=buyer po", !r.error && (r.data == null || r.data.scope === "buyer"), r.error?.message || (r.data ? `scope=${r.data.scope}` : "null"));
  r = await c.from("retailers").select("id, buyer_email, contacts:retailer_contacts(buyer_email)");
  rec("buyer", "retailers: bez kontaktów innych sieci", !r.error && (r.data || []).every(x => !x.buyer_email && !x.contacts), r.error?.message || `rows=${r.data?.length}`);
  if (!WRITES) return;
  const p = await c.from("profiles").update({ retailer_id: 1, fm26_active: !me.fm26_active }).eq("id", me.id).select("retailer_id").maybeSingle();
  rec("buyer", "write: własne przypisanie sieci nie do zmiany", !p.error && p.data?.retailer_id === me.retailer_id, p.error?.message || `retailer_id=${p.data?.retailer_id}`);
}

// ── admin (opcjonalnie) ──────────────────────────────────────────────────────
async function probeAdmin() {
  const s = await login("admin");
  if (!s) { console.log("(admin: brak FM_PROBE_ADMIN_* — pominięte)"); return; }
  const { c } = s;
  let r = await c.from("retailer_contacts").select("retailer_id", { count: "exact", head: true });
  rec("admin", "retailer_contacts: widoczne", !r.error && (r.count || 0) > 0, r.error?.message || `count=${r.count}`);
  r = await c.from("retailers").select("id, contacts:retailer_contacts(buyer_email)").not("contacts", "is", null);
  rec("admin", "retailers z osadzonym kontaktem", !r.error, r.error?.message || `rows=${r.data?.length}`);
  r = await c.rpc("fm_my_schedule");
  rec("admin", "fm_my_schedule: całość lub null (brak planu)", !r.error, r.error?.message || (r.data ? `keys=${Object.keys(r.data).join(",")}` : "null"));
  r = await c.from("fm_plan_private").select("id, updated_at");
  rec("admin", "fm_plan_private: odczyt", !r.error, r.error?.message || `rows=${r.data?.length}`);
}

await probeAnon();
await probeSupplier();
await probeBuyer();
await probeAdmin();
const failed = results.filter(x => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS${WRITES ? " (z próbami zapisu)" : " (tylko odczyty)"}`);
if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
