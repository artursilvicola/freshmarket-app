#!/usr/bin/env node
// [fix/security-hotfix] Porównanie wejść algorytmu PRZED i PO wdrożeniu — wybór po wyborze.
//
// 1. Przed wdrożeniem w SQL Editorze uruchom scripts/fm-inputs-export.sql i zapisz
//    wynik (jedna komórka JSON) jako before.json; po wdrożeniu tak samo jako after.json.
// 2. node scripts/fm-inputs-compare.mjs before.json after.json
//
// Logika i lista porównywanych kolumn: src/lib/fm-inputs-compare.js (testy w vitest).
// Brak sekcji / zły format / zduplikowany klucz = kod wyjścia 2 (porównanie niewiarygodne),
// różnice = 1 (każdą wyjaśnić: zmiana uczestnika w oknie wdrożenia czy skutek migracji), 0 = zgodne.
// Pliki nie zawierają nazwisk, e-maili ani telefonów; mimo to trzymać je poza repo.
import { readFileSync } from "node:fs";
import { compareInputs, formatReport } from "../src/lib/fm-inputs-compare.js";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("Użycie: node scripts/fm-inputs-compare.mjs before.json after.json"); process.exit(2); }
const load = (f) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  // SQL Editor eksportuje [{ "export": {...} }] albo samą komórkę
  return Array.isArray(j) ? (j[0]?.export ?? j[0]) : (j.export ?? j);
};
const result = compareInputs(load(a), load(b));
console.log(formatReport(result));
process.exit(result.errors.length ? 2 : result.diffs ? 1 : 0);
