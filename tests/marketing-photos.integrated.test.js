// [feat/marketing-photos] Zintegrowany przebieg migracji biblioteki zdjęć na PRAWDZIWYM Postgresie (PGlite):
// tabele, niezmienność wersji, kolumny kampanii, widok użycia, uprawnienia, bucket. Logika w
// scripts/marketing-photos-sql-smoke.mjs. Bez PGLITE_PATH test jest POMIJANY i mówi o tym.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PGLITE_PATH = process.env.PGLITE_PATH;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe.skipIf(!PGLITE_PATH)("biblioteka zdjęć — zintegrowany (prawdziwy SQL)", () => {
  it("migracja + niezmienność wersji + widok użycia + uprawnienia przechodzą na PGlite", () => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/marketing-photos-sql-smoke.mjs")], { env: { ...process.env, PGLITE_PATH }, encoding: "utf8", timeout: 180_000 });
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status !== 0) console.error(out.split("\n").filter((l) => /FAIL|padła|Error|error:/.test(l)).join("\n"));
    expect(r.status, out.slice(-2000)).toBe(0);
    expect(out).toContain("WSZYSTKO OK");
    expect(out).not.toContain("FAIL");
  }, 200_000);
});
