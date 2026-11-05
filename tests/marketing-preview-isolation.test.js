// [feat/marketing-activation] Izolowany katalog podglądu (review Codexa 05.11): netlify dev nie może
// dociągać plików .env* repo, atrapy funkcji re-eksportują prawdziwe handlery, Vite dostaje pusty envDir.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { preparePreviewDir, stubFor, renderNetlifyToml, renderEnvCheckFunction, isPortFree, NO_ENV_FILE, CANARY_KEY, ENV_CHECK_FUNCTION } from "../scripts/lib/preview-isolation.mjs";

let root;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "fm-preview-iso-"));
  mkdirSync(path.join(root, "netlify", "functions", "_shared"), { recursive: true });
  writeFileSync(path.join(root, "netlify", "functions", "alpha.js"), 'import { x } from "./_shared/x.js";\nexport const handler = async () => ({ statusCode: 200, body: x });\n');
  writeFileSync(path.join(root, "netlify", "functions", "beta.js"), "export async function handler(event) { return { statusCode: 200 }; }\n");
  writeFileSync(path.join(root, "netlify", "functions", "gamma.js"), "export default async (request) => new Response('ok');\n");
  writeFileSync(path.join(root, "netlify", "functions", "legacy-cjs.js"), "exports.handler = async () => ({ statusCode: 200 });\n");
  writeFileSync(path.join(root, "netlify", "functions", "notes.md"), "# nie funkcja\n");
  // produkcyjne pliki env w repo — mają zostać NIETKNIĘTE i NIEWCZYTANE
  writeFileSync(path.join(root, ".env"), "PAYU_SECOND_KEY=prod\nVITE_SUPABASE_URL=https://prod.supabase.co\n");
  writeFileSync(path.join(root, ".env.development.local"), `${CANARY_KEY}=leak\n`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("stubFor — atrapy re-eksportujące prawdziwe funkcje", () => {
  it("nazwany handler (const / async function) → export { handler }; default → export { default }; CJS → null", () => {
    expect(stubFor("a", "export const handler = async () => {}")).toContain('export { handler } from "../../netlify/functions/a.js"');
    expect(stubFor("b", "export async function handler(e) {}")).toContain('export { handler } from "../../netlify/functions/b.js"');
    expect(stubFor("c", "export default async (req) => {}")).toContain('export { default } from "../../netlify/functions/c.js"');
    expect(stubFor("d", "exports.handler = async () => {}")).toBeNull();
  });
});

describe("preparePreviewDir — katalog izolowany", () => {
  it("generuje netlify.toml z nieistniejącym envFiles i #custom, atrapy dla każdej funkcji ESM, funkcję diagnostyczną, pusty envDir; .env* repo nietknięte", () => {
    const log = [];
    const r = preparePreviewDir({ root, port: 8888, targetPort: 5173, log: (m) => log.push(m) });
    expect(r.previewDir).toBe(path.join(root, ".preview-test"));
    expect(r.stubs).toEqual(["alpha", "beta", "gamma"]);
    expect(r.skipped).toEqual(["legacy-cjs"]);
    const toml = readFileSync(path.join(r.previewDir, "netlify.toml"), "utf8");
    expect(toml).toContain(`envFiles = ["${NO_ENV_FILE}"]`);
    expect(existsSync(path.join(r.previewDir, NO_ENV_FILE))).toBe(false);
    expect(toml).toContain('framework = "#custom"');
    expect(toml).toContain('command = "node ../scripts/vite-test.mjs"');
    expect(toml).toContain("targetPort = 5173");
    expect(toml).toContain("port = 8888");
    expect(toml).toContain(`functions = "${r.functionsDir.split("\\").join("/")}"`); // absolutnie: @netlify/config liczy ścieżki od korzenia repo, nie CWD
    // atrapa wskazuje na prawdziwy plik (ścieżka względna rozwiązuje się do netlify/functions)
    const stub = readFileSync(path.join(r.functionsDir, "alpha.js"), "utf8");
    const rel = /from "([^"]+)"/.exec(stub)[1];
    expect(path.resolve(r.functionsDir, rel)).toBe(path.join(root, "netlify", "functions", "alpha.js"));
    expect(readFileSync(path.join(r.functionsDir, "gamma.js"), "utf8")).toContain("export { default }");
    expect(existsSync(path.join(r.functionsDir, "legacy-cjs.js"))).toBe(false);
    expect(existsSync(path.join(r.functionsDir, "notes.md"))).toBe(false);
    expect(existsSync(path.join(r.functionsDir, `${ENV_CHECK_FUNCTION}.js`))).toBe(true);
    expect(readdirSync(r.envDir)).toEqual([]);
    expect(readdirSync(r.previewDir).filter((f) => f.startsWith(".env"))).toEqual([]);
    expect(readFileSync(path.join(r.previewDir, ".gitignore"), "utf8")).toBe("*\n");
    // pliki env repo bez zmian
    expect(readFileSync(path.join(root, ".env"), "utf8")).toContain("PAYU_SECOND_KEY=prod");
    expect(readFileSync(path.join(root, ".env.development.local"), "utf8")).toContain(`${CANARY_KEY}=leak`);
    expect(log.join("\n")).toMatch(/atrapy funkcji: 3/);
    expect(log.join("\n")).toMatch(/pominięte.*legacy-cjs/);
  });

  it("drugi przebieg odświeża atrapy i usuwa podrzucone pliki .env* z katalogu podglądu i envDir", () => {
    const r1 = preparePreviewDir({ root });
    writeFileSync(path.join(r1.previewDir, ".env"), "PAYU_SECOND_KEY=podrzucone\n");
    writeFileSync(path.join(r1.envDir, ".env.local"), "VITE_X=podrzucone\n");
    writeFileSync(path.join(r1.functionsDir, "stale.js"), "export const handler = 1;\n");
    const r2 = preparePreviewDir({ root });
    expect(readdirSync(r2.previewDir).filter((f) => f.startsWith(".env"))).toEqual([]);
    expect(readdirSync(r2.envDir)).toEqual([]);
    expect(existsSync(path.join(r2.functionsDir, "stale.js"))).toBe(false);
    expect(r2.stubs).toEqual(r1.stubs);
  });

  it("funkcja diagnostyczna raportuje obecność/klasy zmiennych, nie wartości", () => {
    const src = renderEnvCheckFunction();
    expect(src).toContain(`keys.includes("${CANARY_KEY}")`);
    expect(src).toContain('startsWith("PAYU_")');
    expect(src).toMatch(/resend_key_prefix: String\(env\.RESEND_API_KEY \|\| ""\)\.slice\(0, 8\)/);
    expect(src).not.toMatch(/env\.SUPABASE_SERVICE_ROLE_KEY[^)]*\}/); // tylko Boolean(...)
    expect(src).toContain("Boolean(env.SUPABASE_SERVICE_ROLE_KEY)");
    expect(renderNetlifyToml()).toContain('node_bundler = "esbuild"');
    expect(src).toContain("run_id: env.FM_PREVIEW_RUN_ID || null"); // identyfikator przebiegu do porównania w teście
  });

  it("isPortFree: zajęty port (nasłuch na 127.0.0.1) → false, po zwolnieniu → true; niczego nie zabija", async () => {
    const srv = net.createServer();
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address();
    expect(await isPortFree(port)).toBe(false);
    expect(srv.listening).toBe(true); // cudzy nasłuch nietknięty
    await new Promise((r) => srv.close(r));
    expect(await isPortFree(port)).toBe(true);
  });

  it("katalog podglądu o innej nazwie (test z kanarkiem obok prezentacji) dostaje własne atrapy i toml z własnymi portami", () => {
    const r = preparePreviewDir({ root, previewDir: path.join(root, ".preview-test-canary"), port: 18888, targetPort: 15173 });
    expect(r.previewDir).toBe(path.join(root, ".preview-test-canary"));
    const toml = readFileSync(path.join(r.previewDir, "netlify.toml"), "utf8");
    expect(toml).toContain("port = 18888");
    expect(toml).toContain("targetPort = 15173");
    const rel = /from "([^"]+)"/.exec(readFileSync(path.join(r.functionsDir, "alpha.js"), "utf8"))[1];
    expect(path.resolve(r.functionsDir, rel)).toBe(path.join(root, "netlify", "functions", "alpha.js"));
    expect(existsSync(path.join(root, ".preview-test"))).toBe(false); // domyślny katalog nietknięty
  });
});
