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

// Lista plików kompendium ładowanych do system promptu (kolejność = kolejność
// w prompt). Każdy plik MUSI być w `included_files` w netlify.toml.
const KOMPENDIUM_FILES = [
  {
    relativeName: "docs/PRECONNECT_KOMPENDIUM_DLA_GPT.md",
    basename: "PRECONNECT_KOMPENDIUM_DLA_GPT.md",
    headerLabel: "CZĘŚĆ A — Kompendium PreConnect (panel B2B, role, workflow, pakiety wysyłek)",
  },
  {
    relativeName: "docs/FRESH_MARKET_EVENT_2026_KOMPENDIUM.md",
    basename: "FRESH_MARKET_EVENT_2026_KOMPENDIUM.md",
    headerLabel: "CZĘŚĆ B — Kompendium Fresh Market 2026 (event: cennik, pakiety uczestnictwa, stoiska, agenda, FAQ)",
  },
];

let cachedContent = null;
let cachedLoaded = null;

function tryPaths(relativeName, basename) {
  // Heurystyki dla różnych konfiguracji bundle Netlify Functions:
  //   1) Z katalogu funkcji wstecz do root: ../../docs/X.md
  //   2) Z root bundle (Netlify czasem flatten'uje): docs/X.md
  //   3) Obok funkcji (gdy included_files bundlowane lokalnie): X.md
  //   4) Absolute /var/task root
  const candidates = [
    path.resolve(__dirname, "..", "..", relativeName),
    path.resolve(__dirname, "..", relativeName),
    path.resolve(__dirname, relativeName),
    path.resolve(__dirname, basename),
    path.resolve(process.cwd(), relativeName),
    path.resolve("/var/task", relativeName),
    path.resolve("/var/task", basename),
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

function stripBom(text) {
  if (!text) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function loadOnce() {
  if (cachedContent !== null || cachedLoaded !== null) return;

  const parts = [];
  const loaded = [];
  for (const file of KOMPENDIUM_FILES) {
    const found = tryPaths(file.relativeName, file.basename);
    if (!found) {
      console.warn("[load-kompendium] missing:", file.relativeName);
      loaded.push({ file: file.relativeName, ok: false, reason: "not_found" });
      continue;
    }
    try {
      const raw = stripBom(fs.readFileSync(found, "utf8")).trim();
      parts.push(
        "═══════════════════════════════════════════════════════════════════",
        file.headerLabel,
        "═══════════════════════════════════════════════════════════════════",
        "",
        raw,
        ""
      );
      loaded.push({ file: file.relativeName, ok: true, path: found, bytes: raw.length });
    } catch (e) {
      console.warn("[load-kompendium] read error", file.relativeName, e?.message || e);
      loaded.push({ file: file.relativeName, ok: false, reason: e?.message || String(e) });
    }
  }

  cachedContent = parts.length ? parts.join("\n") : "";
  cachedLoaded = loaded;
}

export function loadKompendium() {
  loadOnce();
  const anyOk = (cachedLoaded || []).some((entry) => entry.ok);
  return {
    ok: anyOk,
    content: cachedContent || "",
    loaded: cachedLoaded || [],
  };
}
