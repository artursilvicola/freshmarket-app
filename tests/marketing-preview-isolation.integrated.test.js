// [feat/marketing-activation] Test zintegrowany izolacji podglądu z KANARKIEM (review Codexa 05.11):
// kładzie w repo tymczasowy `.env.development.local` (domyślnie czytany i przez netlify dev, i przez Vite)
// z fikcyjną zmienną kontrolną, uruchamia PRAWDZIWY podgląd (scripts/dev-test.mjs → netlify dev + Vite)
// na WŁASNYCH portach i we własnym katalogu izolowanym, i sprawdza, że kanarek NIE dotarł ani do funkcji,
// ani do frontendu, a Supabase = projekt testowy, Resend fikcyjny, wysyłka wyłączona.
// Zabezpieczenia po review Codexa (P2): porty muszą być WOLNE przed startem (cudzy podgląd nie jest
// zatrzymywany), odpowiedzi muszą nieść LOSOWY identyfikator tego przebiegu (funkcja + frontend),
// a zakończenie procesu przed gotowością = błąd testu. Nie modyfikuje ani nie usuwa istniejących plików .env*.
// Uruchamianie (wymaga .env.test i globalnego `netlify`):
//   FM_PREVIEW_ISOLATION_TEST=1 npx vitest run tests/marketing-preview-isolation.integrated.test.js
import { describe, it, expect } from "vitest";
import { spawn, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDotenv, supabaseRef } from "../scripts/lib/test-env.mjs";
import { CANARY_KEY, ENV_CHECK_FUNCTION, isPortFree } from "../scripts/lib/preview-isolation.mjs";

const ENABLED = process.env.FM_PREVIEW_ISOLATION_TEST === "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANARY_FILE = path.join(root, ".env.development.local");
// własne porty i katalog: test może biec obok podglądu prezentacyjnego (8888/5173, .preview-test)
const PORT = Number(process.env.FM_PREVIEW_TEST_PORT || 18888);
const VITE_PORT = Number(process.env.FM_PREVIEW_TEST_VITE_PORT || 15173);
const DIRNAME = ".preview-test-canary";
const BASE = `http://localhost:${PORT}`;

const killTree = (child) => {
  if (!child || child.exitCode !== null) return;
  try { if (process.platform === "win32") execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); else child.kill("SIGTERM"); } catch { /* już nie żyje */ }
};
const tail = (log) => log.join("").split("\n").slice(-25).join("\n");
/** Czeka na 200 z url; zakończenie procesu podglądu przed gotowością = błąd (z ogonem logu). */
const waitFor = async (url, ms, child, log) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`proces podglądu zakończył się (kod ${child.exitCode}) przed gotowością:\n${tail(log)}`);
    try { const r = await fetch(url); if (r.status === 200) return r; } catch { /* jeszcze nie słucha */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(`podgląd nie odpowiedział na ${url} w ${ms} ms:\n${tail(log)}`);
};

describe.skipIf(!ENABLED)("izolacja podglądu — kanarek w .env.development.local nie dociera do funkcji ani do frontendu", () => {
  it("pełny start podglądu na wolnych portach: diagnostyka i import.meta.env niosą identyfikator TEGO przebiegu, bez kanarka i bez PAYU_, Supabase = projekt testowy, Resend fikcyjny, wysyłka off", async () => {
    expect(existsSync(path.join(root, ".env.test"))).toBe(true);
    const expectedRef = supabaseRef(parseDotenv(readFileSync(path.join(root, ".env.test"), "utf8")).SUPABASE_URL);
    expect(expectedRef).toBeTruthy();
    // porty testu muszą być wolne — cudzego podglądu nie zatrzymujemy, test ma wtedy ODMÓWIĆ, nie „zaliczyć" cudzej odpowiedzi
    for (const p of [PORT, VITE_PORT]) if (!(await isPortFree(p))) throw new Error(`port ${p} zajęty — ustaw FM_PREVIEW_TEST_PORT / FM_PREVIEW_TEST_VITE_PORT na wolne`);
    // kanarek: nigdy nie nadpisujemy istniejącego pliku
    if (existsSync(CANARY_FILE)) throw new Error(`${CANARY_FILE} już istnieje — usuń go ręcznie albo nie uruchamiaj testu`);
    writeFileSync(CANARY_FILE, `# KANAREK testu izolacji — plik tymczasowy, usuwany po teście\n${CANARY_KEY}=leaked-from-dotenv\nVITE_${CANARY_KEY}=leaked-from-dotenv\n`);
    const runId = randomUUID();
    let child; const log = [];
    try {
      child = spawn(process.execPath, [path.join(root, "scripts", "dev-test.mjs")], {
        cwd: root,
        env: { ...process.env, FM_PREVIEW_PORT: String(PORT), FM_PREVIEW_VITE_PORT: String(VITE_PORT), FM_PREVIEW_DIR: DIRNAME, FM_PREVIEW_RUN_ID: runId },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => log.push(String(d)));
      child.stderr.on("data", (d) => log.push(String(d)));
      const fnRes = await waitFor(`${BASE}/.netlify/functions/${ENV_CHECK_FUNCTION}`, 180_000, child, log);
      const fn = await fnRes.json();
      expect(fn.run_id).toBe(runId); // odpowiedź pochodzi z procesu uruchomionego przez TEN test
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
      const features = await (await waitFor(`${BASE}/src/config/features.js`, 90_000, child, log)).text();
      const envLine = features.split("\n").find((l) => l.includes("import.meta.env = {")) || "";
      expect(envLine).toContain("import.meta.env = {");
      expect(envLine).toMatch(new RegExp(`"VITE_FM_PREVIEW_RUN_ID":\\s*"${runId}"`)); // frontend z TEGO przebiegu
      expect(envLine).toContain(expectedRef);
      expect(envLine).not.toContain(CANARY_KEY);
      expect(envLine).not.toContain("PAYU_");
      expect(envLine).not.toContain("SERVICE_ROLE");
      expect(envLine).not.toContain("sklyfuvzjikkqerxtulo"); // ref produkcji
      expect(envLine).toMatch(/"VITE_ADMIN_MARKETING_ACTIVATION":\s*"true"/);
      // log netlify dev: żadnego „Injected/Ignored .env file”, katalog i run_id zgodne
      const text = log.join("");
      expect(text).not.toMatch(/\.env file/);
      expect(text).toContain(`z ${DIRNAME}/`);
      expect(text).toContain(`run_id ${runId}`);
      expect(child.exitCode).toBeNull(); // nadal działa w chwili sprawdzania
    } finally {
      killTree(child);
      if (existsSync(CANARY_FILE)) unlinkSync(CANARY_FILE);
    }
  }, 300_000);
});
