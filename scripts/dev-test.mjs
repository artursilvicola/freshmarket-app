#!/usr/bin/env node
// [feat/marketing-activation] Uruchamia `netlify dev --offline` (Vite + funkcje) na ŚRODOWISKU
// TESTOWYM z IZOLOWANEGO katalogu .preview-test/ (poza git):
//   node scripts/dev-test.mjs
// Logika sprawdzania/izolacji env: scripts/lib/test-env.mjs (testy: tests/marketing-test-env.test.js).
// Izolacja plików .env*: scripts/lib/preview-isolation.mjs (testy: tests/marketing-preview-isolation*.test.js).
// Proces potomny dostaje WYŁĄCZNIE wartości z .env.test + minimalną bazę systemową; netlify dev
// startuje z katalogu izolowanego z własnym netlify.toml (envFiles → plik nieistniejący), więc NIE wczytuje
// .env/.env.local/.env.development* repo; Vite (scripts/vite-test.mjs) ma pusty envDir i własny cache.
// MARKETING_SEND_ENABLED=false jawnie.
//
// Parametry (zmienne środowiska, opcjonalne — domyślne = podgląd do prezentacji):
//   FM_PREVIEW_PORT=8888        port netlify dev        FM_PREVIEW_VITE_PORT=5173  port Vite
//   FM_PREVIEW_DIR=.preview-test  katalog izolowany (nazwa pod korzeniem repo, musi zaczynać się od ".preview-test")
//   FM_PREVIEW_RUN_ID=<id>      identyfikator przebiegu (domyślnie losowy UUID); zwraca go funkcja
//                               diagnostyczna `preview-env-check` i frontend (VITE_FM_PREVIEW_RUN_ID)
// Zajęty port = odmowa (kod 4) — skrypt NIGDY nie zatrzymuje cudzego podglądu.
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDotenv, validateTestEnv, buildChildEnv } from "./lib/test-env.mjs";
import { preparePreviewDir, isPortFree, PREVIEW_DIRNAME } from "./lib/preview-isolation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".env.test");
if (!existsSync(file)) { console.error("Brak .env.test — skopiuj .env.test.example i uzupełnij projektem TESTOWYM."); process.exit(2); }
const fileEnv = parseDotenv(readFileSync(file, "utf8"));
const check = validateTestEnv(fileEnv);
if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); process.exit(3); }

const PORT = Number(process.env.FM_PREVIEW_PORT || 8888);
const TARGET = Number(process.env.FM_PREVIEW_VITE_PORT || 5173);
const DIRNAME = process.env.FM_PREVIEW_DIR || PREVIEW_DIRNAME;
if (!/^\.preview-test[\w.-]*$/.test(DIRNAME)) { console.error(`FM_PREVIEW_DIR musi być nazwą katalogu pod korzeniem repo zaczynającą się od ".preview-test" (jest: ${DIRNAME})`); process.exit(3); }
const RUN_ID = process.env.FM_PREVIEW_RUN_ID || randomUUID();

for (const [label, port] of [["netlify dev", PORT], ["Vite", TARGET]]) {
  if (!(await isPortFree(port))) { console.error(`ODMOWA: port ${port} (${label}) jest zajęty — działa już inny podgląd? Nie zatrzymuję go; użyj FM_PREVIEW_PORT / FM_PREVIEW_VITE_PORT.`); process.exit(4); }
}

const env = buildChildEnv(fileEnv, process.env);
const prep = preparePreviewDir({ root, previewDir: path.join(root, DIRNAME), port: PORT, targetPort: TARGET, log: console.log });
env.FM_PREVIEW_RUN_ID = RUN_ID;
env.VITE_FM_PREVIEW_RUN_ID = RUN_ID;              // frontend: import.meta.env.VITE_FM_PREVIEW_RUN_ID (tylko podgląd testowy)
env.FM_PREVIEW_VITE_ENV_DIR = prep.envDir;        // pusty envDir dla scripts/vite-test.mjs
env.FM_PREVIEW_VITE_PORT = String(TARGET);
env.FM_PREVIEW_VITE_CACHE_DIR = path.join(prep.previewDir, "vite-cache");
console.log(`netlify dev --offline z ${DIRNAME}/ na projekcie testowym ${env.SUPABASE_URL} | port ${PORT} (Vite ${TARGET}) | run_id ${RUN_ID} | moduł Marketing widoczny | MARKETING_SEND_ENABLED=false | Resend: ${env.RESEND_API_KEY.slice(0, 8)}… | pliki .env* repo: NIE wczytywane`);
// --offline: bez pobierania zmiennych z podlinkowanej strony Netlify (produkcja). CWD = katalog izolowany.
const child = spawn("netlify", ["dev", "--offline", "--port", String(PORT), "--no-open"], { cwd: prep.previewDir, env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
