// [feat/marketing-activation] Test zintegrowany izolacji podglądu z KANARKIEM (review Codexa 05.11):
// kładzie w repo tymczasowy `.env.development.local` (domyślnie czytany i przez netlify dev, i przez Vite)
// z fikcyjną zmienną kontrolną, uruchamia PRAWDZIWY podgląd (scripts/dev-test.mjs → netlify dev + Vite)
// i sprawdza, że kanarek NIE dotarł ani do funkcji, ani do frontendu, a Supabase = projekt testowy,
// Resend fikcyjny, wysyłka wyłączona. Nie modyfikuje ani nie usuwa istniejących plików .env*.
// Uruchamianie (wymaga .env.test, globalnego `netlify` i wolnych portów 8888/5173):
//   FM_PREVIEW_ISOLATION_TEST=1 npx vitest run tests/marketing-preview-isolation.integrated.test.js
import { describe, it, expect } from "vitest";
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDotenv, supabaseRef } from "../scripts/lib/test-env.mjs";
import { CANARY_KEY, ENV_CHECK_FUNCTION } from "../scripts/lib/preview-isolation.mjs";

const ENABLED = process.env.FM_PREVIEW_ISOLATION_TEST === "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANARY_FILE = path.join(root, ".env.development.local");
const BASE = "http://localhost:8888";

const killTree = (child) => {
  if (!child || child.exitCode !== null) return;
  try { if (process.platform === "win32") execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); else child.kill("SIGTERM"); } catch { /* już nie żyje */ }
};
const waitFor = async (url, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.status === 200) return r; } catch { /* jeszcze nie słucha */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(`podgląd nie odpowiedział na ${url} w ${ms} ms`);
};

describe.skipIf(!ENABLED)("izolacja podglądu — kanarek w .env.development.local nie dociera do funkcji ani do frontendu", () => {
  it("pełny start podglądu: funkcja diagnostyczna i import.meta.env frontendu bez kanarka i bez PAYU_, Supabase = projekt testowy, Resend fikcyjny, wysyłka off", async () => {
    expect(existsSync(path.join(root, ".env.test"))).toBe(true);
    const expectedRef = supabaseRef(parseDotenv(readFileSync(path.join(root, ".env.test"), "utf8")).SUPABASE_URL);
    expect(expectedRef).toBeTruthy();
    // kanarek: nigdy nie nadpisujemy istniejącego pliku
    if (existsSync(CANARY_FILE)) throw new Error(`${CANARY_FILE} już istnieje — usuń go ręcznie albo nie uruchamiaj testu`);
    writeFileSync(CANARY_FILE, `# KANAREK testu izolacji — plik tymczasowy, usuwany po teście\n${CANARY_KEY}=leaked-from-dotenv\nVITE_${CANARY_KEY}=leaked-from-dotenv\n`);
    let child; const log = [];
    try {
      child = spawn(process.execPath, [path.join(root, "scripts", "dev-test.mjs")], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (d) => log.push(String(d)));
      child.stderr.on("data", (d) => log.push(String(d)));
      const fnRes = await waitFor(`${BASE}/.netlify/functions/${ENV_CHECK_FUNCTION}`, 150_000);
      const fn = await fnRes.json();
      expect(fn.canary_present).toBe(false);
      expect(fn.vite_canary_present).toBe(false);
      expect(fn.payu_keys).toBe(0);
      expect(fn.supabase_ref).toBe(expectedRef);
      expect(fn.vite_supabase_ref).toBe(expectedRef);
      expect(fn.service_role_present).toBe(true);
      expect(fn.marketing_send_enabled).toBe("false");
      expect(fn.resend_key_prefix).toBe("re_test_");
      expect(fn.netlify_auth_token_present).toBe(false);
      // frontend: Vite wstrzykuje `import.meta.env = {...}` na początek każdego modułu, który go używa
      // (src/config/features.js czyta VITE_ADMIN_MARKETING_ACTIVATION) — to dokładnie to, co widzi przeglądarka
      const features = await (await waitFor(`${BASE}/src/config/features.js`, 60_000)).text();
      const envLine = features.split("\n").find((l) => l.includes("import.meta.env = {")) || "";
      expect(envLine).toContain("import.meta.env = {");
      expect(envLine).toContain(expectedRef);
      expect(envLine).not.toContain(CANARY_KEY);
      expect(envLine).not.toContain("PAYU_");
      expect(envLine).not.toContain("SERVICE_ROLE");
      expect(envLine).not.toContain("sklyfuvzjikkqerxtulo"); // ref produkcji
      expect(envLine).toMatch(/"VITE_ADMIN_MARKETING_ACTIVATION":\s*"true"/);
      // log netlify dev: żadnego „Injected/Ignored .env file”
      const text = log.join("");
      expect(text).not.toMatch(/\.env file/);
      expect(text).toMatch(/pliki \.env\* repo: NIE wczytywane/);
    } finally {
      killTree(child);
      if (existsSync(CANARY_FILE)) unlinkSync(CANARY_FILE);
    }
  }, 240_000);
});
