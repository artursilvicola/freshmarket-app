#!/usr/bin/env node
// [feat/instructions-split] Rzeczywisty wydruk instrukcji do PDF przez Chrome (CDP),
// bez puppeteera. Używane do kontroli przed review; nie jest częścią builda.
//
// Użycie (PowerShell/bash):
//   node scripts/instructions-pdf.mjs --chrome "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
//     --base http://localhost:5173 --session "<fragment #access_token=…&refresh_token=…>" \
//     --panel dostawca --out tmp/pdf --lang pl,en --doc preconnect,spotkania-b2b
//
// `--session` = fragment adresu po zalogowaniu magic linkiem (hash z tokenami Supabase),
// uzyskany np. przez `curl -D -` na link „verify" z maila. Konto musi być TESTOWE.
// Dla admina: `--panel admin --role dostawca|kupiec|admin` (wymaga sesji admina).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"] : []).filter(Boolean));
const CHROME = args.chrome || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = (args.base || "http://localhost:5173").replace(/\/$/, "");
const PANEL = args.panel || "dostawca";
const ROLE = args.role || "";
const OUT = args.out || "tmp/pdf";
const LANGS = (args.lang || "pl,en").split(",");
const DOCS = (args.doc || "preconnect,spotkania-b2b").split(",");
const SESSION = args.session || "";
const PORT = Number(args.port || 9333);
if (!SESSION) { console.error("Podaj --session (fragment z tokenami)."); process.exit(2); }

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), "fm-instr-pdf-"));
// `--attach 1` = użyj już uruchomionego Chrome z --remote-debugging-port=PORT (np. z konsoli)
const chrome = args.attach ? { kill() {} } : spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--window-size=1280,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
if (chrome.stderr) chrome.stderr.on("data", (d) => { const t = String(d); if (/error|cannot|failed/i.test(t)) process.stderr.write(t); });
chrome.on?.("error", (e) => { console.error("Nie udało się uruchomić Chrome:", e.message); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpConnect() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { const j = await r.json(); return j.webSocketDebuggerUrl; } } catch { /* czekaj */ }
    await sleep(250);
  }
  throw new Error("Chrome nie odpowiada na porcie " + PORT);
}

function makeClient(ws) {
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else listeners.forEach((l) => l(msg));
  });
  return {
    send: (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); }),
    on: (fn) => listeners.push(fn),
  };
}

async function evalIn(c, sid, expression) {
  const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sid);
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

async function waitFor(c, sid, expression, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await evalIn(c, sid, expression)) return true; await sleep(300); }
  return false;
}

(async () => {
  const wsUrl = await cdpConnect();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const c = makeClient(ws);
  const { targetId } = await c.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await c.send("Target.attachToTarget", { targetId, flatten: true });
  await c.send("Page.enable", {}, sid); await c.send("Runtime.enable", {}, sid);

  // 1) logowanie: adres bazowy panelu z fragmentem tokenów
  await c.send("Page.navigate", { url: `${BASE}/${SESSION.startsWith("#") ? SESSION : "#" + SESSION}` }, sid);
  const logged = await waitFor(c, sid, `!!document.querySelector('nav') && /\\/(dostawca|kupiec|admin)/.test(location.pathname)`, 30000);
  if (!logged) throw new Error("Logowanie nie powiodło się (brak panelu).");
  const results = [];
  for (const lang of LANGS) {
    await evalIn(c, sid, `localStorage.setItem('fm_locale', ${JSON.stringify(lang)}); 'ok'`);
    for (const doc of DOCS) {
      const roleQ = PANEL === "admin" && ROLE ? `&rola=${ROLE}` : "";
      const url = `${BASE}/${PANEL}/instrukcja/${doc}?print=1${roleQ}`;
      await c.send("Page.navigate", { url }, sid);
      const ready = await waitFor(c, sid, `!!document.querySelector('.fm-instr') && document.body.classList.contains('fm-instr-printing') && [...document.images].every(i => i.complete)`, 30000);
      if (!ready) { results.push({ lang, doc, ok: false, error: "strona nie załadowała się" }); continue; }
      // język: panel może nadpisać localStorage profilem — przełącz przyciskiem, jeśli trzeba
      // po zalogowaniu panel może nadpisać język z profilu — odczekaj, zanim sprawdzisz
      await sleep(2500);
      const langOk = `(document.querySelector('.fm-instr')?.getAttribute('lang') || '').toLowerCase().startsWith(${JSON.stringify(lang)})`;
      if (!(await evalIn(c, sid, langOk))) {
        await evalIn(c, sid, `(document.querySelector('button[aria-label="${lang === "en" ? "English" : "Polski"}"]')||{click(){}}).click(); 'sw'`);
        if (!(await waitFor(c, sid, langOk, 15000))) { results.push({ lang, doc, ok: false, error: "nie udało się przełączyć języka" }); continue; }
        await waitFor(c, sid, `[...document.images].every(i => i.complete)`, 15000);
      }
      const title = await evalIn(c, sid, `document.querySelector('.fm-instr__title')?.textContent || ''`);
      const { data } = await c.send("Page.printToPDF", { printBackground: true, paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5, preferCSSPageSize: false }, sid);
      const file = path.join(OUT, `instrukcja-${PANEL}${ROLE ? "-" + ROLE : ""}-${doc}-${lang}.pdf`);
      writeFileSync(file, Buffer.from(data, "base64"));
      results.push({ lang, doc, ok: true, title, file });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  ws.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* profil tymczasowy */ }
})().catch((e) => { console.error(e.message || e); chrome.kill(); process.exit(1); });
