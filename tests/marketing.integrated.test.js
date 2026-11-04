// [feat/marketing-activation] Zintegrowany przebieg migracji marketingowej na PRAWDZIWYM
// Postgresie (PGlite) z całym łańcuchem migracji repo: claim/dzierżawa/odzyskanie/
// needs_review/suppresja/ingest/uprawnienia. Logika w scripts/marketing-sql-smoke.mjs
// (uruchamialna także ręcznie). Bez PGLITE_PATH test jest POMIJANY i mówi o tym.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PGLITE_PATH = process.env.PGLITE_PATH;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe.skipIf(!PGLITE_PATH)("marketing — zintegrowany (prawdziwy SQL)", () => {
  it("migracje + RPC + uprawnienia przechodzą na PGlite", () => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/marketing-sql-smoke.mjs")], { env: { ...process.env, PGLITE_PATH }, encoding: "utf8", timeout: 180_000 });
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status !== 0) console.error(out.split("\n").filter((l) => /FAIL|padła|Error|error:/.test(l)).join("\n"));
    expect(r.status, out.slice(-2000)).toBe(0);
    expect(out).toContain("WSZYSTKO OK");
    expect(out).not.toContain("FAIL");
  }, 200_000);
});
