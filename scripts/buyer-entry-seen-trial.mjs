#!/usr/bin/env node
// [fix/buyer-entry-seen] Próba end-to-end: „kredyty schodzą przy wejściu kupca na platformę,
// podgląd admina nie jest odczytem". WYŁĄCZNIE baza testowa (.env.test, ta sama kontrola co
// scripts/dev-test.mjs) + lokalny podgląd testowy:
//   node scripts/dev-test.mjs                                (w drugim oknie, port 8888)
//   node scripts/buyer-entry-seen-trial.mjs --mode=fix       kod z poprawką: sprawdza oczekiwania (kod wyjścia 1 = niezaliczone)
//   node scripts/buyer-entry-seen-trial.mjs --mode=control   stary kod: tylko opisuje, co się stało
//   node scripts/buyer-entry-seen-trial.mjs --cleanup        samo sprzątanie danych próbnych
// Opcje: --keep (zostaw dane próbne), --only-buyer (sam scenariusz kupca), --out=<katalog> (raport + zrzuty),
// --chrome=<ścieżka>. Tworzy i usuwa własne dane „ZZZ PROBA” (sieć 9901, firma, pakiet 5 kredytów,
// wysyłki 990001–990003, konto kupca); istniejących seedów nie dotyka. Przeglądarka: Chrome przez CDP.
// Sesje z jednorazowych linków generowanych kluczem serwisowym projektu TESTOWEGO; nic nie jest
// wypisywane (tokeny, klucze). Poczta: klucz Resend fikcyjny — żaden mail nie wychodzi.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseDotenv, validateTestEnv, dbUrlRef, PROD_REF } from "./lib/test-env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "package.json")).href);
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const { Client } = require("pg");

const fileEnv = parseDotenv(readFileSync(path.join(ROOT, ".env.test"), "utf8"));
const envCheck = validateTestEnv(fileEnv);
if (!envCheck.ok) { console.error("ODMOWA (.env.test): " + envCheck.errors.join("; ")); process.exit(3); }
const ref = dbUrlRef(fileEnv.TEST_DATABASE_URL);
if (!ref || ref === PROD_REF) { console.error("ODMOWA: połączenie nie wskazuje projektu testowego."); process.exit(3); }
async function connect() {
  const c = new Client({ connectionString: fileEnv.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

const arg = (n, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${n}`)); return a ? (a.includes("=") ? a.split("=")[1] : "1") : d; };
const MODE = arg("mode", "fix");
const HERE = arg("out") || path.join(tmpdir(), "fm-buyer-entry-seen-trial");
mkdirSync(HERE, { recursive: true });
const BASE = "http://localhost:8888";
const CHROME = arg("chrome") || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
let cdpPort = 9344;

const RID = 9901;
const RETAILER_NAME = "ZZZ PROBA sieć (wejście kupca)";
const COMPANY_ID = "b0000000-0000-4000-8000-00000000e001";
const COMPANY_NAME = "ZZZ PROBA dostawca (wejście kupca)";
const SUP = "sup-proba-entry";
const SENDS = [990001, 990002];
const MANUAL = 990003;
const ALL = [...SENDS, MANUAL];
const BUYER_EMAIL = "proba.kupiec.wejscie@freshmarket.test";
const BUYER_NAME = "ZZZ PROBA Kupiec";
const ADMIN_EMAIL = "codex.admin@freshmarket.test";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const svc = createClient(fileEnv.SUPABASE_URL, fileEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = await connect();
const today = new Date().toISOString().slice(0, 10);

// ── dane próbne ──────────────────────────────────────────────────────────────
async function cleanup() {
  const steps = [
    ["odczyty aplikacji", `delete from legacy_send_app_reads where legacy_id = any($1::bigint[])`, [ALL]],
    ["kolejka powiadomień", `delete from legacy_send_notify_messages where legacy_ids && $1::bigint[]`, [ALL]],
    ["wallet_tx", `delete from wallet_tx where company_id = $1`, [COMPANY_ID]],
    ["wysyłki", `delete from legacy_sends where legacy_id = any($1::bigint[])`, [ALL]],
    ["pakiety", `delete from packages where company_id = $1`, [COMPANY_ID]],
    ["firma", `delete from companies where id = $1`, [COMPANY_ID]],
  ];
  for (const [label, sql, params] of steps) {
    try { await db.query(sql, params); } catch (e) { console.log(`  (sprzątanie: ${label}: ${e.message})`); }
  }
  const { rows } = await db.query(`select id from auth.users where email = $1`, [BUYER_EMAIL]);
  for (const r of rows) {
    const { error } = await svc.auth.admin.deleteUser(r.id);
    if (error) console.log(`  (sprzątanie: konto kupca: ${error.message})`);
  }
  try { await db.query(`delete from retailers where id = $1`, [RID]); } catch (e) { console.log(`  (sprzątanie: sieć: ${e.message})`); }
}

function sendData(id) {
  return { id, supplierId: SUP, offerId: null, retailerId: RID, month: today.slice(0, 7), pos: 1, status: "sent", sentAt: today, sendDate: today, daysLeft: 14, price: 40, confirmHistory: [] };
}

async function resetSends() {
  await db.query(`delete from legacy_send_app_reads where legacy_id = any($1::bigint[])`, [ALL]);
  await db.query(`delete from legacy_send_notify_messages where legacy_ids && $1::bigint[]`, [ALL]);
  await db.query(`delete from wallet_tx where company_id = $1`, [COMPANY_ID]);
  await db.query(`delete from legacy_sends where legacy_id = any($1::bigint[])`, [ALL]);
  for (const id of ALL) {
    await db.query(
      `insert into legacy_sends (legacy_id, supplier_legacy_id, offer_legacy_id, retailer_id, status, data) values ($1,$2,null,$3,'sent',$4::jsonb)`,
      [id, SUP, RID, JSON.stringify(sendData(id))]
    );
  }
  await db.query(`update packages set qty_used = 0 where company_id = $1`, [COMPANY_ID]);
}

async function setup() {
  await cleanup();
  await db.query(`insert into retailers (id, name, country, cats, active) values ($1,$2,'PL',array['owoce','warzywa'],true)`, [RID, RETAILER_NAME]);
  await db.query(
    `insert into companies (id, name, country, legacy_supplier_id, account_status, preconnect_enabled) values ($1,$2,'PL',$3,'active',true)`,
    [COMPANY_ID, COMPANY_NAME, SUP]
  );
  await db.query(
    `insert into packages (company_id, plan, qty_total, qty_used, source, purchased_at, expires_at) values ($1,'std_5',5,0,'purchase',now(), (current_date + 300))`,
    [COMPANY_ID]
  );
  const { data, error } = await svc.auth.admin.createUser({ email: BUYER_EMAIL, password: randomBytes(24).toString("base64url"), email_confirm: true });
  if (error) throw new Error("konto kupca: " + error.message);
  const buyerId = data.user.id;
  await db.query(
    `insert into profiles (id, role, name, email, retailer_id, active) values ($1,'buyer',$2,$3,$4,true)
     on conflict (id) do update set role='buyer', name=excluded.name, email=excluded.email, retailer_id=excluded.retailer_id, company_id=null, active=true`,
    [buyerId, BUYER_NAME, BUYER_EMAIL, RID]
  );
  // zgody jak u istniejącego konta e2e kupca (żeby nie zatrzymała nas bramka regulaminu)
  await db.query(
    `update profiles p set accepted_terms_version = s.accepted_terms_version, accepted_privacy_version = s.accepted_privacy_version, accepted_at = coalesce(s.accepted_at, now()), locale = 'pl'
       from (select accepted_terms_version, accepted_privacy_version, accepted_at from profiles where email = 'codex.buyer@freshmarket.test') s
      where p.id = $1`,
    [buyerId]
  );
  await resetSends();
  return buyerId;
}

async function snapshot() {
  const sends = (await db.query(
    `select legacy_id::int as id, status, data->>'seenChannel' as seen_channel, data->>'readType' as read_type, data->>'billingStatus' as billing, (data->>'chargeAt') is not null as charged
       from legacy_sends where legacy_id = any($1::bigint[]) order by legacy_id`, [ALL])).rows;
  const pkg = (await db.query(`select qty_total, qty_used from packages where company_id = $1`, [COMPANY_ID])).rows[0];
  const reads = (await db.query(`select legacy_id::int as id, reader_role, channel, read_count from legacy_send_app_reads where legacy_id = any($1::bigint[]) order by legacy_id, channel`, [ALL])).rows;
  const notify = Number((await db.query(`select count(*) from legacy_send_notify_messages where legacy_ids && $1::bigint[]`, [ALL])).rows[0].count);
  const tx = Number((await db.query(`select count(*) from wallet_tx where company_id = $1`, [COMPANY_ID])).rows[0].count);
  return { sends, credits_used: pkg?.qty_used, app_reads: reads, notify_queue: notify, wallet_tx: tx };
}

async function sessionFor(email) {
  const { data, error } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`link ${email}: ${error.message}`);
  const anon = createClient(fileEnv.SUPABASE_URL, fileEnv.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (v.error || !v.data?.session) throw new Error(`sesja ${email}: ${v.error?.message || "brak"}`);
  return v.data.session;
}

// ── przeglądarka (Chrome przez CDP, bez dodatkowych bibliotek) ───────────────
async function openPage(session) {
  const CDP_PORT = cdpPort++; // każdy start na nowym porcie (poprzedni Chrome zwalnia port z opóźnieniem)
  const profile = mkdtempSync(path.join(tmpdir(), "fm-entry-trial-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--window-size=1500,950", "about:blank"], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page") || null;
    } catch { /* czekaj */ }
    if (!target) await sleep(200);
  }
  if (!target) { chrome.kill(); throw new Error("Chrome nie wystartował"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let seq = 0; const pending = new Map(); const calls = []; const byReq = new Map(); const consoleErrors = []; const consoleLog = []; const httpErrors = [];
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  ws.on("message", async (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); return m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    if (m.method === "Network.requestWillBeSent") {
      const u = m.params.request.url;
      if (u.includes("/.netlify/functions/")) {
        const c = { fn: u.split("/.netlify/functions/")[1].split("?")[0], method: m.params.request.method, body: m.params.request.postData || null, status: null, response: null };
        calls.push(c); byReq.set(m.params.requestId, c);
      }
    } else if (m.method === "Network.responseReceived" && byReq.has(m.params.requestId)) {
      byReq.get(m.params.requestId).status = m.params.response.status;
    } else if (m.method === "Network.loadingFinished" && byReq.has(m.params.requestId)) {
      const c = byReq.get(m.params.requestId);
      if (/mark-buyer-preconnect-seen|notify-supplier-read/.test(c.fn)) {
        try { const b = await send("Network.getResponseBody", { requestId: m.params.requestId }); c.response = b.body; } catch { /* brak treści */ }
      }
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails || {};
      const props = (d.exception?.preview?.properties || []).map((p) => `${p.name}=${String(p.value).slice(0, 160)}`).join("; ");
      consoleErrors.push(`${d.text || ""} ${d.exception?.description || ""} {${props}} @${(d.url || d.stackTrace?.callFrames?.[0]?.url || "").split("/").pop()}:${d.lineNumber ?? ""}`.slice(0, 600));
    } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
      consoleLog.push(`[${m.params.type}] ` + (m.params.args || []).map((a) => a.value ?? a.description ?? (a.preview?.properties || []).map((p) => `${p.name}=${String(p.value).slice(0, 120)}`).join("; ")).join(" ").slice(0, 400));
    } else if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
      httpErrors.push(`${m.params.response.status} ${m.params.response.url.split("?")[0].replace(/https:\/\/[a-z0-9]+\.supabase\.co/, "SB")}`);
    }
  });
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  const key = `sb-${ref}-auth-token`;
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { if (location.origin === ${JSON.stringify(BASE)} && !localStorage.getItem(${JSON.stringify(key)})) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))}); localStorage.setItem("fm_locale", "pl"); } } catch (e) {}`,
  });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const text = () => evaluate(`document.body ? document.body.innerText : ""`);
  const waitFor = async (pred, ms, label) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const t = await text().catch(() => ""); if (pred(t || "")) return t; await sleep(500); }
    throw new Error(`nie doczekałem się: ${label}; tekst strony: ${JSON.stringify(((await text().catch(() => "")) || "").slice(0, 300))}`);
  };
  const shot = async (name) => { try { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(HERE, name), Buffer.from(r.data, "base64")); } catch { /* bez zrzutu */ } };
  const close = async () => { try { ws.close(); } catch {} try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {} chrome.kill(); await sleep(1500); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, evaluate, text, waitFor, shot, close, calls, consoleErrors, consoleLog, httpErrors, goto: (p) => send("Page.navigate", { url: BASE + p }) };
}
const seenCalls = (calls) => calls.filter((c) => /mark-buyer-preconnect-seen|notify-supplier-read/.test(c.fn)).map((c) => ({ fn: c.fn, status: c.status, ids: safeIds(c.body), response: summarize(c.response) }));
function safeIds(body) { try { const b = JSON.parse(body || "{}"); return b.legacy_ids || (b.legacy_id ? [b.legacy_id] : []); } catch { return []; } }
function summarize(resp) {
  try {
    const r = JSON.parse(resp || "{}");
    return { skipped: r.skipped || null, results: (r.results || []).map((x) => ({ id: x.legacy_id, status: x.status, charged: !!x.billing?.charged, billing: x.billing?.billingStatus || null, reason: x.reason || null })), notification: r.notification?.status || r.notificationSummary?.status || null };
  } catch { return null; }
}

// ── scenariusze ──────────────────────────────────────────────────────────────
const report = { mode: MODE, base: BASE, test_project: ref, checks: [] };
const check = (name, ok, detail = "") => { report.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? "  OK  " : "  ŹLE "} ${name}${detail ? " — " + detail : ""}`); };

async function scenarioAdminPreview() {
  console.log("\n[1] Administrator: podgląd konta kupca");
  const before = await snapshot();
  const page = await openPage(await sessionFor(ADMIN_EMAIL));
  try {
    await page.goto("/admin");
    await page.waitFor((t) => /Wyloguj/.test(t) && /Kupcy \(\d+\)/.test(t), 120000, "panel admina");
    await page.waitFor((t) => !/Kupcy \(0\)/.test(t), 30000, "lista kont kupców");
    await page.evaluate(`[...document.querySelectorAll("button")].find(b => /^Kupcy/.test(b.innerText.trim())).click()`);
    await page.waitFor((t) => t.includes(BUYER_NAME), 15000, "konto próbne na liście kupców");
    const clicked = await page.evaluate(`(() => { const els = [...document.querySelectorAll("div,span")].filter(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(BUYER_NAME)}); if (!els.length) return false; els[0].click(); return true; })()`);
    if (!clicked) throw new Error("nie znalazłem konta próbnego kupca w przełączniku");
    const t = await page.waitFor((x) => /ZZZ PROBA Kupiec\s+Kupiec/.test(x), 20000, "panel kupca w podglądzie");
    await sleep(9000); // czas na ewentualne zgłoszenie odczytu przez listę propozycji
    await page.shot(`proba-${MODE}-1-admin-podglad.png`);
    report.admin_preview = { page_excerpt: (await page.text()).replace(/\s+/g, " ").slice(0, 260), seen_calls: seenCalls(page.calls), js_errors: page.consoleErrors };
    void t;
  } finally { await page.close(); }
  const after = await snapshot();
  report.admin_preview.before = before; report.admin_preview.after = after;
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (MODE === "fix") {
    check("podgląd admina: żadnego zgłoszenia odczytu z aplikacji", report.admin_preview.seen_calls.length === 0, `${report.admin_preview.seen_calls.length} wywołań`);
    check("podgląd admina: baza bez zmian (statusy, kredyty, odczyty)", !changed, `kredyty użyte: ${after.credits_used}`);
  } else {
    console.log(`  (kontrola) wywołań odczytu: ${report.admin_preview.seen_calls.length}; kredyty użyte ${before.credits_used} → ${after.credits_used}; statusy: ${after.sends.map((s) => s.id + "=" + s.status).join(", ")}`);
  }
}

async function scenarioAdminDirectCall() {
  console.log("\n[2] Administrator: bezpośrednie wywołanie funkcji serwera");
  const before = await snapshot();
  const s = await sessionFor(ADMIN_EMAIL);
  const call = async (fn, body) => {
    const r = await fetch(`${BASE}/.netlify/functions/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const a = await call("mark-buyer-preconnect-seen", { legacy_ids: SENDS, channel: "app_list" });
  const b = await call("notify-supplier-read", { legacy_id: SENDS[0] });
  const after = await snapshot();
  report.admin_direct = { mark: { status: a.status, skipped: a.body.skipped || null, results: (a.body.results || []).length }, notify: { status: b.status, skipped: b.body.skipped || null, results: (b.body.results || []).length }, after };
  check("funkcja listy: admin dostaje pusty wynik (admin_preview)", a.status === 200 && a.body.skipped === "admin_preview" && !(a.body.results || []).length, `HTTP ${a.status}, skipped=${a.body.skipped}`);
  check("funkcja szczegółu: admin dostaje pusty wynik (admin_preview)", b.status === 200 && b.body.skipped === "admin_preview" && !(b.body.results || []).length, `HTTP ${b.status}, skipped=${b.body.skipped}`);
  check("po wywołaniach admina baza bez zmian", JSON.stringify(before) === JSON.stringify(after), `kredyty użyte: ${after.credits_used}`);
}

async function scenarioManualConfirm() {
  console.log("\n[3] Administrator: ręczne potwierdzenie odczytu (jak przycisk w Pipeline)");
  const before = await snapshot();
  const s = await sessionFor(ADMIN_EMAIL);
  const admin = createClient(fileEnv.SUPABASE_URL, fileEnv.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${s.access_token}` } } });
  const ts = new Date().toISOString();
  const updated = { ...sendData(MANUAL), status: "read_manual", readAt: ts, readType: "manual_phone", manualNote: "próba", daysLeft: 0, confirmHistory: [{ action: "confirm", type: "manual_phone", note: "próba", at: ts }] };
  // dokładnie to, co robi confirmManual → upsertLegacySend w aplikacji
  const { error } = await admin.from("legacy_sends").upsert({ legacy_id: MANUAL, supplier_legacy_id: SUP, offer_legacy_id: null, retailer_id: RID, status: "read_manual", data: updated }, { onConflict: "legacy_id" });
  const after = await snapshot();
  const row = after.sends.find((x) => x.id === MANUAL);
  report.manual_confirm = { error: error?.message || null, send: row, credits_used_before: before.credits_used, credits_used_after: after.credits_used };
  console.log(`  status wysyłki ${MANUAL}: ${row?.status}; kredyty użyte ${before.credits_used} → ${after.credits_used}; rozliczona: ${row?.charged}`);
}

async function scenarioBuyerEntry() {
  console.log("\n[4] Kupiec: wejście na platformę (pulpit, bez otwierania listy)");
  const before = await snapshot();
  const page = await openPage(await sessionFor(BUYER_EMAIL));
  let afterEntry, afterReload, callsEntry, callsReload, dash;
  try {
    await page.goto("/kupiec");
    await page.waitFor((t) => /Wyloguj/.test(t), 120000, "panel kupca");
    const end = Date.now() + 15000;
    while (Date.now() < end && !seenCalls(page.calls).some((c) => c.response)) await sleep(500);
    await sleep(2500);
    dash = (await page.text()).replace(/\s+/g, " ");
    await page.shot(`proba-${MODE}-4-kupiec-wejscie.png`);
    callsEntry = seenCalls(page.calls);
    afterEntry = await snapshot();
    const n = page.calls.length;
    await page.send("Page.reload");
    await page.waitFor((t) => /Wyloguj/.test(t), 60000, "panel kupca po odświeżeniu");
    await sleep(9000);
    callsReload = seenCalls(page.calls.slice(n));
    afterReload = await snapshot();
    report.buyer_entry = { landing_excerpt: dash.slice(0, 420), new_count_text: (dash.match(/[^.]{0,40}(now[ya]\w*|nieprzeczytan\w*)[^.]{0,40}/i) || [null])[0], calls_on_entry: callsEntry, calls_on_reload: callsReload, before, after_entry: afterEntry, after_reload: afterReload, js_errors: page.consoleErrors, console: page.consoleLog, http_errors: page.httpErrors };
  } finally { await page.close(); }
  const st = (snap, id) => snap.sends.find((s) => s.id === id);
  if (MODE === "fix") {
    check("wejście kupca: jedno zgłoszenie odczytu z obiema propozycjami", callsEntry.length === 1 && callsEntry[0].fn === "mark-buyer-preconnect-seen" && SENDS.every((id) => callsEntry[0].ids.map(Number).includes(id)), JSON.stringify(callsEntry.map((c) => ({ fn: c.fn, ids: c.ids, status: c.status }))));
    check("wejście kupca: obie propozycje „read”, rozliczone", SENDS.every((id) => st(afterEntry, id)?.status === "read" && st(afterEntry, id)?.charged), afterEntry.sends.map((s) => `${s.id}=${s.status}/${s.billing}`).join(", "));
    check("wejście kupca: zeszły dokładnie 2 kredyty", afterEntry.credits_used === before.credits_used + 2, `${before.credits_used} → ${afterEntry.credits_used}`);
    check("wejście kupca: odczyt przypisany kupcowi (kanał app_list)", afterEntry.app_reads.filter((r) => SENDS.includes(r.id) && r.reader_role === "buyer" && r.channel === "app_list").length === 2, JSON.stringify(afterEntry.app_reads));
    check("ręcznie potwierdzona wysyłka nie jest ruszana przez wejście kupca", st(afterEntry, MANUAL)?.status === "read_manual", `${MANUAL}=${st(afterEntry, MANUAL)?.status}, rozliczona: ${st(afterEntry, MANUAL)?.charged}`);
    check("odświeżenie strony: brak drugiego pobrania", afterReload.credits_used === afterEntry.credits_used && callsReload.length === 0, `kredyty ${afterReload.credits_used}, wywołań ${callsReload.length}`);
    check("pulpit kupca nadal pokazuje liczbę nowych propozycji z wejścia", /\b2\b/.test(report.buyer_entry.new_count_text || ""), JSON.stringify(report.buyer_entry.new_count_text));
  } else {
    console.log(`  (kontrola) wywołań odczytu przy wejściu: ${callsEntry.length}; kredyty użyte ${before.credits_used} → ${afterEntry.credits_used}; statusy: ${afterEntry.sends.map((s) => s.id + "=" + s.status).join(", ")}`);
  }
}

// ── przebieg ─────────────────────────────────────────────────────────────────
let code = 0;
try {
  if (arg("cleanup")) { await cleanup(); console.log("posprzątane"); }
  else {
    const up = await fetch(BASE + "/.netlify/functions/admin-env-status").then((r) => r.status).catch(() => 0);
    if (!up) throw new Error(`podgląd testowy nie działa na ${BASE} (node scripts/dev-test.mjs)`);
    console.log(`Próba (${MODE}) na projekcie testowym ${ref}, podgląd ${BASE}`);
    await setup();
    if (!arg("only-buyer")) {
      await scenarioAdminPreview();
      await resetSends();
      if (MODE === "fix") { await scenarioAdminDirectCall(); await resetSends(); }
      await scenarioManualConfirm();
    }
    await scenarioBuyerEntry();
    writeFileSync(path.join(HERE, `proba-${MODE}-raport.json`), JSON.stringify(report, null, 2));
    console.log("Raport i zrzuty: " + HERE);
    const bad = report.checks.filter((c) => !c.ok);
    console.log(`\nWynik: ${report.checks.length - bad.length}/${report.checks.length} kontroli OK${bad.length ? " — NIEZALICZONE: " + bad.map((b) => b.name).join("; ") : ""}`);
    if (bad.length) code = 1;
  }
} catch (e) {
  console.error("BŁĄD PRÓBY:", e.message);
  code = 2;
} finally {
  if (!arg("keep") && !arg("cleanup")) { try { await cleanup(); console.log("dane próbne usunięte"); } catch (e) { console.log("sprzątanie nieudane: " + e.message); } }
  await db.end();
}
process.exit(code);
