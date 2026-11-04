#!/usr/bin/env node
// [feat/marketing-activation] Uruchamia `netlify dev` (Vite + funkcje) na ŚRODOWISKU TESTOWYM:
// czyta .env.test, odmawia przy wartościach produkcyjnych, wymusza brak MARKETING_SEND_ENABLED.
//   node scripts/dev-test.mjs
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".env.test");
if (!existsSync(file)) { console.error("Brak .env.test — skopiuj .env.test.example i uzupełnij projektem TESTOWYM."); process.exit(2); }
const env = { ...process.env };
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const PROD_REF = "sklyfuvzjikkqerxtulo";
for (const k of ["VITE_SUPABASE_URL", "SUPABASE_URL", "TEST_DATABASE_URL"]) {
  if (String(env[k] || "").includes(PROD_REF)) { console.error(`ODMOWA: ${k} wskazuje projekt produkcyjny.`); process.exit(3); }
}
delete env.MARKETING_SEND_ENABLED;                 // poczta zawsze wyłączona w odbiorze
env.VITE_ADMIN_MARKETING_ACTIVATION = env.VITE_ADMIN_MARKETING_ACTIVATION || "true";
for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "MARKETING_UNSUBSCRIBE_SECRET", "RESEND_API_KEY"]) {
  if (!env[k]) { console.error(`Brak ${k} w .env.test — bez kompletu zmiennych netlify dev dociągnąłby wartości z .env / ustawień strony (produkcja).`); process.exit(2); }
}
console.log("netlify dev na projekcie testowym:", env.SUPABASE_URL, "| moduł Marketing widoczny | wysyłka wyłączona");
// --offline: bez pobierania zmiennych środowiskowych z podlinkowanej strony Netlify (produkcja);
// zmienne z .env.test są w procesie, więc netlify dev / Vite NIE nadpisują ich wartościami z .env.
// Globalne `netlify` (netlify-cli w PATH); lokalnego nie ma w node_modules.
const child = spawn("netlify", ["dev", "--offline", "--port", "8888", "--no-open"], { cwd: root, env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
