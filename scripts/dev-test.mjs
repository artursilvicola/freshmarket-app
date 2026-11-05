#!/usr/bin/env node
// [feat/marketing-activation] Uruchamia `netlify dev --offline` (Vite + funkcje) na ŚRODOWISKU
// TESTOWYM z IZOLOWANEGO katalogu .preview-test/ (poza git):
//   node scripts/dev-test.mjs
// Logika sprawdzania/izolacji env: scripts/lib/test-env.mjs (testy: tests/marketing-test-env.test.js).
// Izolacja plików .env*: scripts/lib/preview-isolation.mjs (testy: tests/marketing-preview-isolation*.test.js).
// Proces potomny dostaje WYŁĄCZNIE wartości z .env.test + minimalną bazę systemową; netlify dev
// startuje z .preview-test/ z własnym netlify.toml (envFiles → plik nieistniejący), więc NIE wczytuje
// .env/.env.local/.env.development* repo; Vite (scripts/vite-test.mjs) ma pusty envDir.
// MARKETING_SEND_ENABLED=false jawnie.
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDotenv, validateTestEnv, buildChildEnv } from "./lib/test-env.mjs";
import { preparePreviewDir, PREVIEW_DIRNAME } from "./lib/preview-isolation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".env.test");
if (!existsSync(file)) { console.error("Brak .env.test — skopiuj .env.test.example i uzupełnij projektem TESTOWYM."); process.exit(2); }
const fileEnv = parseDotenv(readFileSync(file, "utf8"));
const check = validateTestEnv(fileEnv);
if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); process.exit(3); }
const env = buildChildEnv(fileEnv, process.env);
const PORT = 8888, TARGET = 5173;
const prep = preparePreviewDir({ root, port: PORT, targetPort: TARGET, log: console.log });
console.log(`netlify dev --offline z ${PREVIEW_DIRNAME}/ na projekcie testowym ${env.SUPABASE_URL} | moduł Marketing widoczny | MARKETING_SEND_ENABLED=false | Resend: ${env.RESEND_API_KEY.slice(0, 8)}… | pliki .env* repo: NIE wczytywane`);
// --offline: bez pobierania zmiennych z podlinkowanej strony Netlify (produkcja). CWD = katalog izolowany.
const child = spawn("netlify", ["dev", "--offline", "--port", String(PORT), "--no-open"], { cwd: prep.previewDir, env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
