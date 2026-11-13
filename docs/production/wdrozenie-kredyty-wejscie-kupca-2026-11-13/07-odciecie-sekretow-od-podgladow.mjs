#!/usr/bin/env node
// [fix/buyer-entry-seen] Odcina produkcyjne klucze od kontekstów deploy-preview i branch-deploy
// projektu Netlify. PRODUKCJA BEZ ZMIAN.
//
//   node docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs --dry
//   node docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs
//
// Uruchamia Artur (albo Codex) w katalogu repo, z zalogowanym `netlify` CLI. Claude NIE wykonał
// tego kroku: zapis do magazynu sekretów został zablokowany przez zabezpieczenie jego środowiska
// (13.11.2026). Wykonane przez Claude'a: odczyt struktury, próba mechanizmu na zmiennej tymczasowej
// (utworzona, zamieniona, usunięta) i przebieg `--dry` tego skryptu.
//
// Co robi:
//  A) zmienne z JEDNĄ wartością „all” (dziedziczoną przez podglądy i gałęzie) dostają tę samą
//     wartość tylko dla `production` i `dev` — jednym wywołaniem, bez chwili bez wartości;
//  B) sekrety z osobnymi wpisami na kontekst tracą WYŁĄCZNIE wpisy wskazanych kontekstów;
//     wpis `production` nie jest dotykany (jego wartości API i tak nie zwraca).
// Po każdej operacji sprawdza, że kontekst production widzi to samo co przedtem; przy niezgodności
// przywraca zmienną i się zatrzymuje. Nie wypisuje ani nie zapisuje żadnej wartości.
// Zmiany w zmiennych nie uruchamiają builda i nie dotykają opublikowanego wdrożenia.
//
// Wpisów usuniętych w kroku B nie da się odtworzyć bez znajomości wartości — tak ma być
// (hostowane podglądy są wyłączone; gdyby wróciły, mają dostać klucze testowe).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SPLIT = ["PAYU_ENV", "PAYU_OAUTH_CLIENT_ID", "PAYU_OAUTH_CLIENT_SECRET", "PAYU_POS_ID", "PAYU_SECOND_KEY", "FM_EXPORT_TOKEN", "RESEND_WEBHOOK_SECRET"];
const DROP = {
  RESEND_API_KEY: ["deploy-preview", "branch-deploy"],
  OPENAI_API_KEY: ["deploy-preview", "branch-deploy"],
  SUPABASE_SERVICE_ROLE_KEY: ["branch-deploy"], // w deploy-preview jest klucz projektu testowego — zostaje
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SITE = JSON.parse(readFileSync(path.join(ROOT, ".netlify", "state.json"), "utf8")).siteId;
const DRY = process.argv.includes("--dry");
function api(op, data) {
  const out = execSync(`netlify api ${op} --data "${JSON.stringify(data).replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const i = out.search(/[\[{"]/);
  return i < 0 ? null : JSON.parse(out.slice(i));
}
const shape = (v) => v === undefined || v === null ? "brak" : (String(v) === "" ? "pusta" : /^\*{6,}/.test(String(v)) ? `zamaskowana(${String(v).length})` : `jawna(${String(v).length})`);
const resolvedAll = (ctx) => { const out = execSync("netlify env:list --json --context " + ctx, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); return JSON.parse(out.slice(out.indexOf("{"))); };

const site = api("getSite", { site_id: SITE });
if (site.name !== "freshmarketb2b") { console.error(`ODMOWA: katalog jest podlinkowany do projektu „${site.name}”, nie freshmarketb2b.`); process.exit(3); }
const ACC = site.account_id;
const getVar = (key) => api("getEnvVar", { account_id: ACC, key, site_id: SITE });
const ctxs = (v) => (v.values || []).map((x) => x.context).sort().join(",");
const prodBefore = resolvedAll("production");
console.log(`${DRY ? "PRÓBA NA SUCHO — " : ""}produkcja przed: ${Object.keys(prodBefore).length} zmiennych`);
let failed = false;

for (const key of SPLIT) {
  const v = getVar(key);
  const all = (v.values || []).filter((x) => x.context === "all");
  if (ctxs(v) === "dev,production") { console.log(`A ${key}: już ograniczona do production,dev — bez zmian`); continue; }
  if (v.is_secret || (v.values || []).length !== 1 || all.length !== 1 || /^\*{6,}/.test(String(all[0].value)) || String(all[0].value) === "") {
    console.log(`A ${key}: POMINIĘTA — inna struktura niż oczekiwana (konteksty: ${ctxs(v)}, sekret: ${v.is_secret})`); failed = true; continue;
  }
  const original = all[0].value;
  if (DRY) { console.log(`A ${key}: do zamiany all → production,dev (wartość ${shape(original)})`); continue; }
  api("updateEnvVar", { account_id: ACC, key, site_id: SITE, body: { key, scopes: v.scopes, is_secret: false, values: [{ context: "production", value: original }, { context: "dev", value: original }] } });
  const after = getVar(key);
  const prodVal = (after.values || []).find((x) => x.context === "production")?.value;
  const ok = ctxs(after) === "dev,production" && prodVal === original && JSON.stringify([...after.scopes].sort()) === JSON.stringify([...v.scopes].sort());
  if (!ok) {
    api("updateEnvVar", { account_id: ACC, key, site_id: SITE, body: { key, scopes: v.scopes, is_secret: false, values: [{ context: "all", value: original }] } });
    console.log(`A ${key}: NIEZGODNOŚĆ po zamianie — PRZYWRÓCONO „all” (konteksty teraz: ${ctxs(getVar(key))}). Zatrzymuję.`); failed = true; break;
  }
  console.log(`A ${key}: OK — konteksty ${ctxs(after)}, produkcja ta sama wartość`);
}

if (!failed) for (const [key, contexts] of Object.entries(DROP)) {
  const v = getVar(key);
  const prod = (v.values || []).find((x) => x.context === "production");
  if (!prod) { console.log(`B ${key}: POMINIĘTA — brak wpisu production`); failed = true; continue; }
  for (const ctx of contexts) {
    const entry = (v.values || []).find((x) => x.context === ctx);
    if (!entry) { console.log(`B ${key} / ${ctx}: brak wpisu — nic do usunięcia`); continue; }
    if (DRY) { console.log(`B ${key} / ${ctx}: do usunięcia wpis (${shape(entry.value)})`); continue; }
    try { api("deleteEnvVarValue", { account_id: ACC, key, id: entry.id, site_id: SITE }); } catch (e) { /* odpowiedź bez treści */ }
    const after = getVar(key);
    const prodAfter = (after.values || []).find((x) => x.context === "production");
    const gone = !(after.values || []).some((x) => x.context === ctx);
    const prodSame = prodAfter && prodAfter.id === prod.id && prodAfter.value === prod.value;
    console.log(`B ${key} / ${ctx}: ${gone ? "usunięty" : "NADAL JEST"} | wpis production nietknięty: ${!!prodSame} | konteksty teraz: ${ctxs(after)}`);
    if (!gone || !prodSame) { failed = true; break; }
  }
  if (failed) break;
}

const prodAfter = resolvedAll("production");
const keys = [...new Set([...Object.keys(prodBefore), ...Object.keys(prodAfter)])];
const diff = keys.filter((k) => prodBefore[k] !== prodAfter[k]);
console.log(`\nPRODUKCJA: ${diff.length === 0 ? "bez zmian — wszystkie " + keys.length + " zmiennych identyczne jak przed" : "RÓŻNICE w: " + diff.join(", ")}`);
if (!DRY) {
  const dp = resolvedAll("deploy-preview"), bd = resolvedAll("branch-deploy");
  console.log("po zmianie — co widzi podgląd PR / wdrożenie gałęzi:");
  for (const k of [...SPLIT, ...Object.keys(DROP)]) console.log(`  ${k}: podgląd ${shape(dp[k])} | gałąź ${shape(bd[k])} | produkcja ${shape(prodAfter[k])}`);
}
process.exit(failed || diff.length ? 1 : 0);
