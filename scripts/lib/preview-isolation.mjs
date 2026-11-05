// [feat/marketing-activation] Izolowany katalog podglądu odbiorowego (.preview-test, poza git).
//
// Problem (review Codexa 05.11): `netlify dev` uruchomiony w katalogu repo dociąga domyślne pliki
// `.env`, `.env.local`, `.env.development(.local)` (tu: produkcyjne PAYU_*), a Vite czyta te same
// pliki z katalogu projektu — mimo czystego środowiska procesu potomnego.
//
// Rozwiązanie bez dotykania plików `.env*` repo:
//  * netlify dev startuje z CWD = .preview-test/ z WŁASNYM netlify.toml, którego `envFiles`
//    wskazuje celowo nieistniejący plik → CLI nie wczytuje żadnego pliku .env*;
//  * funkcje = atrapy w .preview-test/functions/ re-eksportujące prawdziwe handlery z
//    netlify/functions/ (bundler podąża za importami), plus funkcja diagnostyczna
//    `preview-env-check` (zwraca OBECNOŚĆ zmiennych, nigdy wartości) — istnieje tylko w podglądzie;
//  * Vite startuje przez scripts/vite-test.mjs z `envDir` = pusty katalog .preview-test/vite-env/
//    → zmienne VITE_* wyłącznie z procesu (czyli z .env.test).
// Test jednostkowy: tests/marketing-preview-isolation.test.js; test zintegrowany z kanarkiem
// (prawdziwy start podglądu): tests/marketing-preview-isolation.integrated.test.js.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";

export const PREVIEW_DIRNAME = ".preview-test";
export const VITE_ENV_DIRNAME = "vite-env";
export const NO_ENV_FILE = ".env.preview-none"; // celowo NIE istnieje
export const CANARY_KEY = "FM_ISOLATION_CANARY";
export const ENV_CHECK_FUNCTION = "preview-env-check";

/** Treść atrapy dla funkcji `name` albo null, gdy styl eksportu nieznany (wtedy funkcja pomijana z ostrzeżeniem). */
export function stubFor(name, source) {
  const rel = `../../netlify/functions/${name}.js`;
  const head = `// atrapa podglądu testowego — re-eksport prawdziwej funkcji (generowane, poza git)\n`;
  if (/^\s*export\s+default\b/m.test(source)) return head + `export { default } from ${JSON.stringify(rel)};\n`;
  if (/^\s*export\s+(?:const|let|async\s+function|function)\s+handler\b/m.test(source)) return head + `export { handler } from ${JSON.stringify(rel)};\n`;
  return null;
}

export function renderNetlifyToml({ port = 8888, targetPort = 5173, nodeBundler = "esbuild", functionsDir = "functions" } = {}) {
  // @netlify/config rozwiązuje ścieżki względem KORZENIA repozytorium (git), nie CWD — dlatego funkcje podajemy absolutnie.
  const fn = String(functionsDir).split("\\").join("/");
  return `# WYGENEROWANE przez scripts/dev-test.mjs — podgląd odbiorowy (baza testowa). Nie edytować, poza git.
# envFiles wskazuje celowo nieistniejący plik: netlify dev NIE wczytuje żadnego .env* (ani z tego katalogu, ani z repo).
[build]
  functions = "${fn}"

[functions]
  node_bundler = "${nodeBundler}"

[dev]
  framework = "#custom"
  command = "node ../scripts/vite-test.mjs"
  targetPort = ${targetPort}
  port = ${port}
  autoLaunch = false
  envFiles = ["${NO_ENV_FILE}"]
`;
}

export function renderEnvCheckFunction() {
  return `// Funkcja diagnostyczna TYLKO podglądu testowego (.preview-test, poza git i poza produkcją).
// Zwraca obecność/klasy zmiennych środowiska procesu funkcji — nigdy wartości sekretów.
const ref = (u) => (/https?:\\/\\/([a-z0-9-]+)\\.supabase\\./i.exec(String(u || "")) || [])[1] || null;
export const handler = async () => {
  const env = process.env;
  const keys = Object.keys(env);
  const body = {
    canary_present: keys.includes(${JSON.stringify(CANARY_KEY)}),
    vite_canary_present: keys.includes(${JSON.stringify("VITE_" + CANARY_KEY)}),
    payu_keys: keys.filter((k) => k.startsWith("PAYU_")).length,
    supabase_ref: ref(env.SUPABASE_URL),
    vite_supabase_ref: ref(env.VITE_SUPABASE_URL),
    service_role_present: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    marketing_send_enabled: env.MARKETING_SEND_ENABLED ?? null,
    resend_key_prefix: String(env.RESEND_API_KEY || "").slice(0, 8),
    netlify_auth_token_present: Boolean(env.NETLIFY_AUTH_TOKEN),
    run_id: env.FM_PREVIEW_RUN_ID || null, // identyfikator przebiegu: test porównuje go z tym, który sam nadał
  };
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
};
`;
}

/**
 * Czy port TCP jest wolny. Windows pozwala nasłuchiwać na 0.0.0.0 obok cudzego nasłuchu na 127.0.0.1,
 * dlatego sprawdzamy DWIE rzeczy: próbę połączenia na 127.0.0.1 i ::1 (udane połączenie = zajęty)
 * oraz próbę nasłuchu na 127.0.0.1, 0.0.0.0, ::1 i :: (błąd = zajęty). Nigdy niczego nie zabija.
 */
export async function isPortFree(port) {
  const canConnect = (host) => new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.setTimeout(700);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => resolve(false));
  });
  const canListen = (host) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", (e) => resolve(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT")); // brak IPv6 ≠ zajęty
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
  for (const h of ["127.0.0.1", "::1"]) if (await canConnect(h)) return false;
  for (const h of ["127.0.0.1", "0.0.0.0", "::1", "::"]) if (!(await canListen(h))) return false;
  return true;
}

/**
 * Buduje/odświeża katalog podglądu. Idempotentne: atrapy generowane od nowa przy każdym starcie,
 * żaden plik .env* nie może leżeć w katalogu podglądu ani w envDir Vite.
 * @returns {{ previewDir: string, envDir: string, functionsDir: string, stubs: string[], skipped: string[] }}
 */
export function preparePreviewDir({ root, previewDir, functionsSrc, port, targetPort, log = () => {} }) {
  const dir = previewDir || path.join(root, PREVIEW_DIRNAME);
  const src = functionsSrc || path.join(root, "netlify", "functions");
  const fnDir = path.join(dir, "functions");
  const envDir = path.join(dir, VITE_ENV_DIRNAME);
  rmSync(fnDir, { recursive: true, force: true });
  mkdirSync(fnDir, { recursive: true });
  mkdirSync(envDir, { recursive: true });
  for (const f of readdirSync(envDir)) rmSync(path.join(envDir, f), { recursive: true, force: true }); // envDir ma być PUSTY
  for (const f of readdirSync(dir)) if (f.startsWith(".env")) rmSync(path.join(dir, f), { force: true });
  const stubs = [], skipped = [];
  for (const file of readdirSync(src).filter((f) => f.endsWith(".js")).sort()) {
    const name = file.slice(0, -3);
    const stub = stubFor(name, readFileSync(path.join(src, file), "utf8"));
    if (!stub) { skipped.push(name); continue; }
    writeFileSync(path.join(fnDir, file), stub);
    stubs.push(name);
  }
  writeFileSync(path.join(fnDir, `${ENV_CHECK_FUNCTION}.js`), renderEnvCheckFunction());
  writeFileSync(path.join(dir, "netlify.toml"), renderNetlifyToml({ port, targetPort, functionsDir: fnDir }));
  if (!existsSync(path.join(dir, ".gitignore"))) writeFileSync(path.join(dir, ".gitignore"), "*\n");
  log(`podgląd izolowany: ${path.relative(root, dir) || dir} | atrapy funkcji: ${stubs.length}${skipped.length ? ` | pominięte (nieznany eksport): ${skipped.join(", ")}` : ""}`);
  return { previewDir: dir, envDir, functionsDir: fnDir, stubs, skipped };
}
