// [feat/marketing-photos] Próba pakietu wdrożeniowego na schemacie sprzed migracji zdjęć (review Codexa 07.11): kontrola przed/po,
// plik łączony 1:1 z migracjami, drugi Run, dane bez zmian, ochrona wypisów, reaktywacja ze zgodą i historią, sprzątanie.
// Logika w scripts/marketing-photos-deploy-check.mjs. Bez PGLITE_PATH test jest POMIJANY.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PGLITE_PATH = process.env.PGLITE_PATH;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe.skipIf(!PGLITE_PATH)("pakiet wdrożeniowy zdjęć — próba na PGlite", () => {
  it("sekwencja przed → migracje → po → reaktywacja przechodzi bez zmiany danych", () => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/marketing-photos-deploy-check.mjs")], { env: { ...process.env, PGLITE_PATH }, encoding: "utf8", timeout: 180_000 });
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status !== 0) console.error(out.split("\n").filter((l) => /FAIL|padła|error:/.test(l)).join("\n"));
    expect(r.status, out.slice(-2000)).toBe(0);
    expect(out).toContain("WSZYSTKO OK");
    expect(out).not.toContain("FAIL");
  }, 200_000);
});
