#!/usr/bin/env node
// [feat/marketing-activation] Vite dla podglądu TESTOWEGO (uruchamiany przez netlify dev z .preview-test/).
// envDir = pusty katalog .preview-test/vite-env → Vite NIE czyta .env* z repo; zmienne VITE_* tylko z procesu
// (czyli z .env.test przez scripts/dev-test.mjs). Konfiguracja projektu (vite.config.js) bez zmian.
import { createServer } from "vite";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envDir = process.env.FM_PREVIEW_VITE_ENV_DIR || path.join(root, ".preview-test", "vite-env");
if (!existsSync(envDir)) { console.error(`vite-test: brak envDir ${envDir} — uruchom przez scripts/dev-test.mjs`); process.exit(2); }
const leftovers = readdirSync(envDir).filter((f) => f.startsWith(".env"));
if (leftovers.length) { console.error(`vite-test: envDir musi być pusty, znaleziono: ${leftovers.join(", ")}`); process.exit(2); }

const port = Number(process.env.FM_PREVIEW_VITE_PORT || 5173);
// osobny cache zależności per katalog podglądu: drugi podgląd (np. test z kanarkiem) nie przebudowuje node_modules/.vite działającego
const cacheDir = process.env.FM_PREVIEW_VITE_CACHE_DIR || path.join(path.dirname(envDir), "vite-cache");
const server = await createServer({
  configFile: path.join(root, "vite.config.js"),
  root,
  envDir,
  cacheDir,
  server: { port, strictPort: true, open: false, host: "127.0.0.1" },
});
await server.listen();
console.log(`vite-test: envDir=${path.relative(root, envDir)} (pusty) | cacheDir=${path.relative(root, cacheDir)} | VITE_* tylko z procesu | http://127.0.0.1:${port}/`);
