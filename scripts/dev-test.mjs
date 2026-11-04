#!/usr/bin/env node
// [feat/marketing-activation] Uruchamia `netlify dev --offline` (Vite + funkcje) na ŚRODOWISKU
// TESTOWYM. Logika sprawdzania/izolacji: scripts/lib/test-env.mjs (testy: tests/marketing-test-env.test.js).
//   node scripts/dev-test.mjs
// Proces potomny dostaje WYŁĄCZNIE wartości z .env.test + minimalną bazę systemową;
// nic z Supabase/Resend/Netlify nie dziedziczy z procesu rodzica. MARKETING_SEND_ENABLED=false jawnie.
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDotenv, validateTestEnv, buildChildEnv } from "./lib/test-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".env.test");
if (!existsSync(file)) { console.error("Brak .env.test — skopiuj .env.test.example i uzupełnij projektem TESTOWYM."); process.exit(2); }
const fileEnv = parseDotenv(readFileSync(file, "utf8"));
const check = validateTestEnv(fileEnv);
if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); process.exit(3); }
const env = buildChildEnv(fileEnv, process.env);
console.log(`netlify dev --offline na projekcie testowym ${env.SUPABASE_URL} | moduł Marketing widoczny | MARKETING_SEND_ENABLED=false | Resend: ${env.RESEND_API_KEY.slice(0, 8)}…`);
// --offline: bez pobierania zmiennych z podlinkowanej strony Netlify (produkcja). Zmienne z .env.test są
// w procesie, więc netlify dev i Vite ich NIE nadpisują wartościami z .env (proces ma pierwszeństwo).
const child = spawn("netlify", ["dev", "--offline", "--port", "8888", "--no-open"], { cwd: root, env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
