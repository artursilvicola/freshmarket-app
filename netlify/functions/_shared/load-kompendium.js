/**
 * Loader bazy wiedzy PreConnect dla asystenta admina (GPT).
 * [B2B Round prod-rollout / AI knowledge base]
 *
 * Plik źródłowy: docs/PRECONNECT_KOMPENDIUM_DLA_GPT.md
 * Aby plik był dostępny w runtime Netlify Functions, musi być w
 * `included_files` w netlify.toml (dla esbuild bundlera).
 *
 * Cache:
 *   In-memory per lambda instance. Pierwsze wywołanie czyta z disk
 *   (~22 kB), kolejne wywołania w tej samej instancji zwracają już
 *   z pamięci. Lambda cold start (~co kilka minut nieaktywności)
 *   resetuje cache — wtedy następny request znów wczyta z disk.
 *
 * Path resolution:
 *   Netlify Functions w esbuild bundle deploy każdą funkcję pod
 *   `/var/task/netlify/functions/{name}.mjs` lub podobnie. Pliki
 *   z `included_files` lądują obok funkcji albo w katalogu głównym
 *   bundle — różnie w zależności od konfiguracji. Próbujemy kilku
 *   ścieżek w kolejności.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RELATIVE_NAME = "docs/PRECONNECT_KOMPENDIUM_DLA_GPT.md";
const BASENAME = "PRECONNECT_KOMPENDIUM_DLA_GPT.md";

let cached = null;
let resolveError = null;

function tryPaths() {
  // Heurystyki dla różnych konfiguracji bundle:
  //   1) Z katalogu funkcji wstecz do root: ../../docs/X.md
  //   2) Z root bundle (Netlify czasem flatten'uje): docs/X.md
  //   3) Obok funkcji (gdy included_files bundlowane lokalnie): X.md
  //   4) Absolute root: /var/task/docs/X.md
  const candidates = [
    path.resolve(__dirname, "..", "..", RELATIVE_NAME),
    path.resolve(__dirname, "..", RELATIVE_NAME),
    path.resolve(__dirname, RELATIVE_NAME),
    path.resolve(__dirname, BASENAME),
    path.resolve(process.cwd(), RELATIVE_NAME),
    path.resolve("/var/task", RELATIVE_NAME),
    path.resolve("/var/task", BASENAME),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (stat.isFile() && stat.size > 0) return candidate;
      }
    } catch (e) {
      // ignore — next candidate
    }
  }
  return null;
}

export function loadKompendium() {
  if (cached) return { ok: true, content: cached };
  if (resolveError) return { ok: false, content: "", reason: resolveError };

  const found = tryPaths();
  if (!found) {
    resolveError = "kompendium_not_found";
    console.warn("[load-kompendium] file not found in any candidate path. __dirname=", __dirname, "cwd=", process.cwd());
    return { ok: false, content: "", reason: resolveError };
  }
  try {
    cached = fs.readFileSync(found, "utf8");
    return { ok: true, content: cached, path: found };
  } catch (e) {
    resolveError = e?.message || String(e);
    console.warn("[load-kompendium] read error", resolveError);
    return { ok: false, content: "", reason: resolveError };
  }
}
