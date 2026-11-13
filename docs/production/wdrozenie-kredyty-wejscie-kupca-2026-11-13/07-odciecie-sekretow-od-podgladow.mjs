#!/usr/bin/env node
// [fix/buyer-entry-seen] Odcina produkcyjne klucze od kontekstów deploy-preview i branch-deploy
// projektu Netlify. PRODUKCJA BEZ ZMIAN.
//
//   node docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs
//        → PRÓBA NA SUCHO (domyślnie): tylko odczyt, plan i symulacja wyniku
//   node docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs --apply
//        → zapis; DOPIERO PO ZGODZIE RECENZENTA (13.11.2026: NO-GO dla wersji pierwszej, ta jest poprawiona)
//
// Uruchamia Artur albo Codex w katalogu repo, z zalogowanym `netlify` CLI. Claude nie wykonuje zapisów
// w magazynie sekretów (zablokowane w jego środowisku) — uruchamiał wyłącznie przebieg na sucho.
//
// Logika i jej testy: scripts/lib/netlify-context-isolation.mjs, tests/netlify-context-isolation.test.js.
//  * ODCZYTY idą przez `netlify api` — do linii poleceń trafiają tylko identyfikatory i nazwy zmiennych.
//  * ZAPISY idą przez HTTPS: wartości wyłącznie w treści żądania, nigdy w argumentach procesu.
//  * Żaden komunikat (także błędu) nie zawiera wartości, treści odpowiedzi ani polecenia.
//  * Kody wyjścia: 0 = odcięte i produkcja bez zmian · 1 = niezaliczone · 2 = STAN NIEPEWNY (awaria
//    po zapisie; skrypt ustala stan i NIE cofa automatycznie) · 3 = odmowa (warunki wstępne; nic nie zapisano).
//
// Zakres:
//  A) zmienne z JEDNĄ wartością „all” (dziedziczoną przez podglądy i gałęzie) → ta sama wartość tylko
//     dla production i dev, jednym żądaniem;
//  B) sekrety z osobnymi wpisami na kontekst → usunięcie WYŁĄCZNIE wskazanych wpisów; wpis production
//     nietykany, a jego niezmienność potwierdza identyfikator wpisu (wartości API nie zwraca).
// Wpisów usuniętych w kroku B nie da się odtworzyć bez znajomości wartości — tak ma być.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { isolateContexts, assertReadOnlyArgs, createHttpWriter, loadNetlifyToken, SafeError, toSafeError, EXIT } from "../../../scripts/lib/netlify-context-isolation.mjs";

const SPLIT = ["PAYU_ENV", "PAYU_OAUTH_CLIENT_ID", "PAYU_OAUTH_CLIENT_SECRET", "PAYU_POS_ID", "PAYU_SECOND_KEY", "FM_EXPORT_TOKEN", "RESEND_WEBHOOK_SECRET"];
const DROP = {
  RESEND_API_KEY: ["deploy-preview", "branch-deploy"],
  OPENAI_API_KEY: ["deploy-preview", "branch-deploy"],
  SUPABASE_SERVICE_ROLE_KEY: ["branch-deploy"], // w deploy-preview jest klucz projektu testowego — zostaje
};
const EXPECTED_PROJECT = "freshmarketb2b";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APPLY = process.argv.includes("--apply");
const bail = (e) => { console.error("BŁĄD: " + toSafeError(e, "nieoczekiwany błąd").message); process.exit(EXIT.UNCERTAIN); };
process.on("uncaughtException", bail);
process.on("unhandledRejection", bail);

// odczyt przez CLI: w argumentach wyłącznie identyfikatory (assertReadOnlyArgs); błąd bez treści polecenia i wyjścia
function read(op, data) {
  assertReadOnlyArgs(op, data);
  let out;
  try {
    out = execSync(`netlify api ${op} --data "${JSON.stringify(data).replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new SafeError(`odczyt ${op}: polecenie netlify zakończyło się błędem${Number.isInteger(e?.status) ? " (kod " + e.status + ")" : ""}`);
  }
  const i = out.search(/[\[{]/);
  if (i < 0) throw new SafeError(`odczyt ${op}: pusta odpowiedź`);
  try { return JSON.parse(out.slice(i)); } catch { throw new SafeError(`odczyt ${op}: odpowiedź nie jest poprawnym JSON-em`); }
}

let siteId;
try { siteId = JSON.parse(readFileSync(path.join(ROOT, ".netlify", "state.json"), "utf8")).siteId; }
catch { console.error("ODMOWA: brak .netlify/state.json — katalog nie jest podlinkowany do projektu Netlify."); process.exit(EXIT.REFUSED); }
const site = read("getSite", { site_id: siteId });
if (site.name !== EXPECTED_PROJECT || !site.account_id) { console.error(`ODMOWA: katalog jest podlinkowany do innego projektu niż ${EXPECTED_PROJECT}.`); process.exit(EXIT.REFUSED); }

const refuseWrite = async () => { throw new SafeError("zapis w trybie próby na sucho — to błąd skryptu", { rejected: true }); };
let writer = { putVar: refuseWrite, deleteValue: refuseWrite };
if (APPLY) {
  const token = loadNetlifyToken({ env: process.env, readFile: (f) => readFileSync(f, "utf8"), platform: process.platform, homedir: os.homedir(), appData: process.env.APPDATA });
  writer = createHttpWriter({ fetchImpl: fetch, token, accountId: site.account_id, siteId });
}
const client = {
  listVars: async () => read("getEnvVars", { account_id: site.account_id, site_id: siteId }),
  getVar: async (key) => read("getEnvVar", { account_id: site.account_id, key, site_id: siteId }),
  ...writer,
};

const result = await isolateContexts({ client, split: SPLIT, drop: DROP, dry: !APPLY, log: (line) => console.log(line) });
if (!APPLY) console.log("\n(próba na sucho — nic nie zapisano; zapis: --apply, dopiero po zgodzie recenzenta)");
process.exit(result.exitCode);
