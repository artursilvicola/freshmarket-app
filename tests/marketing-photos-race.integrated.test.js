// [feat/marketing-photos] Wyścig dwóch NIEZALEŻNYCH transakcji (review Codexa P1, 7fa031f) na prawdziwym Postgresie BAZY TESTOWEJ:
// zajęcie wersji do wycofania vs. przypisanie / zatwierdzenie. Logika w scripts/marketing-photos-race-test.mjs (3 połączenia pg).
// Uruchamia się TYLKO z FM_RACE_TEST=1 i obecnym .env.test (zostawia na bazie testowej nieszkodliwe wiersze „ZZZ TEST wyścig blokad”).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enabled = process.env.FM_RACE_TEST === "1" && existsSync(path.join(root, ".env.test"));

describe.skipIf(!enabled)("biblioteka zdjęć — wyścig transakcji na bazie testowej (FM_RACE_TEST=1)", () => {
  it("zajęcie vs. przypisanie / zatwierdzenie: nigdy nie przechodzą obie; równoległe zajęcia = oba true", () => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/marketing-photos-race-test.mjs")], { encoding: "utf8", timeout: 240_000 });
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status !== 0) console.error(out.slice(-3000));
    expect(r.status, out.slice(-2000)).toBe(0);
    expect(out).toContain("WSZYSTKO OK");
    expect(out).not.toContain("FAIL");
  }, 250_000);
});
