#!/usr/bin/env node
// [fix/security-hotfix] Porównanie wejść algorytmu PRZED i PO wdrożeniu — wybór po wyborze.
//
// 1. Przed wdrożeniem w SQL Editorze uruchom scripts/fm-inputs-export.sql i zapisz
//    wynik (jedna komórka JSON) jako before.json; po wdrożeniu tak samo jako after.json.
// 2. node scripts/fm-inputs-compare.mjs before.json after.json
//
// Porównuje klucz po kluczu:
//   company_target_retailers  (company_id, retailer_id)          → priority, note
//   fm_resps                  (retailer_id, supplier_company_id) → zone, status, position
//   companies                 (id) → fm_selection_confirmed_at, fm_b2b_enabled, fm_b2b_tier, fm_b2b_packages, account_status
//   profiles                  (id) → role, company_id, retailer_id, active, fm26_active
//   retailers                 (id) → active, fm26_active, fm26_chain_id, fm_gate
//   fm_settings               (id) → algo_phase, selection_deadline
// Każda różnica jest wypisana; kod wyjścia 1 = są różnice (do wyjaśnienia:
// zmiana uczestnika w oknie wdrożenia czy skutek migracji). Bez danych osobowych.
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("Użycie: node scripts/fm-inputs-compare.mjs before.json after.json"); process.exit(2); }
const load = (f) => { const j = JSON.parse(readFileSync(f, "utf8")); return Array.isArray(j) ? (j[0]?.export ?? j[0]) : (j.export ?? j); };
const before = load(a), after = load(b);

const SPEC = {
  company_target_retailers: { key: ["company_id", "retailer_id"], cols: ["priority", "note"] },
  fm_resps: { key: ["retailer_id", "supplier_company_id"], cols: ["zone", "status", "position"] },
  companies: { key: ["id"], cols: ["fm_selection_confirmed_at", "fm_b2b_enabled", "fm_b2b_tier", "fm_b2b_packages", "account_status"] },
  profiles: { key: ["id"], cols: ["role", "company_id", "retailer_id", "active", "fm26_active"] },
  retailers: { key: ["id"], cols: ["active", "fm26_active", "fm26_chain_id", "fm_gate"] },
  fm_settings: { key: ["id"], cols: ["algo_phase", "selection_deadline"] },
};
const norm = (v) => (v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
let diffs = 0;
for (const [table, { key, cols }] of Object.entries(SPEC)) {
  const rowsA = before?.[table] || [], rowsB = after?.[table] || [];
  const k = (r) => key.map(c => norm(r[c])).join("|");
  const mapA = new Map(rowsA.map(r => [k(r), r])), mapB = new Map(rowsB.map(r => [k(r), r]));
  const removed = [...mapA.keys()].filter(x => !mapB.has(x));
  const added = [...mapB.keys()].filter(x => !mapA.has(x));
  const changed = [];
  for (const [id, ra] of mapA) {
    const rb = mapB.get(id); if (!rb) continue;
    const ch = cols.filter(c => norm(ra[c]) !== norm(rb[c])).map(c => `${c}: ${norm(ra[c])} → ${norm(rb[c])}`);
    if (ch.length) changed.push(`${id} { ${ch.join("; ")} }`);
  }
  const n = removed.length + added.length + changed.length;
  diffs += n;
  console.log(`${table}: przed ${rowsA.length}, po ${rowsB.length}, ${n ? "RÓŻNICE " + n : "bez różnic"}`);
  for (const x of removed) console.log(`  USUNIĘTY  ${x}`);
  for (const x of added) console.log(`  DODANY    ${x}`);
  for (const x of changed) console.log(`  ZMIENIONY ${x}`);
}
console.log(diffs ? `\n${diffs} różnic — każdą wyjaśnić (zmiana uczestnika w oknie wdrożenia czy skutek migracji) przed dalszymi krokami.` : "\nZgodne wybór po wyborze.");
process.exit(diffs ? 1 : 0);
