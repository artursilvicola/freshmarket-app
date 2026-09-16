// [fix/security-hotfix] Porównanie eksportów wejść algorytmu (scripts/fm-inputs-export.sql)
// przed/po wdrożeniu — wybór po wyborze. Czysta funkcja (testowana w vitest), używana przez
// scripts/fm-inputs-compare.mjs.
//
// Reguły (review Codexa P2/4): brak sekcji, zły format, brak klucza albo zduplikowany klucz
// = BŁĄD (nie „pusta tabela”); porównywane są wszystkie kolumny znaczące dla decyzji,
// w tym metadane mapowania (fm_resps.meta, note) i identyfikatory legacy.
export const SPEC = {
  company_target_retailers: { key: ["company_id", "retailer_id"], cols: ["priority", "note"] },
  fm_resps: { key: ["retailer_id", "supplier_company_id"], cols: ["zone", "status", "position", "meta"] },
  fm_prefs: { key: ["retailer_id"], cols: ["prefs", "submitted_at"] },
  fm_wishlists: { key: ["retailer_id", "supplier_legacy_id"], cols: ["data"] },
  fm_late_resps: { key: ["retailer_id", "supplier_legacy_id"], cols: ["zone", "responded_at", "data"] },
  company_hidden_retailers: { key: ["company_id", "retailer_id"], cols: [] },
  companies: { key: ["id"], cols: ["fm_selection_confirmed_at", "fm_b2b_enabled", "fm_b2b_tier", "fm_b2b_packages", "account_status", "legacy_fm_id", "legacy_supplier_id"] },
  profiles: { key: ["id"], cols: ["role", "company_id", "retailer_id", "active", "fm26_active"] },
  retailers: { key: ["id"], cols: ["active", "fm26_active", "fm26_chain_id", "legacy_chain_id", "fm_gate"] },
  fm_settings: { key: ["id"], cols: ["algo_phase", "selection_deadline", "event_date"] },
};

const norm = (v) => (v == null ? null : typeof v === "object" ? JSON.stringify(sortKeys(v)) : String(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

// Zwraca { errors: [], tables: { [t]: { before, after, removed, added, changed } }, diffs }
export function compareInputs(before, after, spec = SPEC) {
  const errors = [];
  const tables = {};
  for (const side of [["before", before], ["after", after]]) {
    if (!side[1] || typeof side[1] !== "object" || Array.isArray(side[1])) errors.push(`${side[0]}: eksport nie jest obiektem JSON`);
  }
  if (errors.length) return { errors, tables, diffs: 0 };
  let diffs = 0;
  for (const [table, { key, cols }] of Object.entries(spec)) {
    const rowsA = before[table], rowsB = after[table];
    for (const [label, rows] of [["before", rowsA], ["after", rowsB]]) {
      if (!Array.isArray(rows)) { errors.push(`${label}.${table}: brak sekcji albo nie jest tablicą`); continue; }
      rows.forEach((r, i) => {
        if (!r || typeof r !== "object") { errors.push(`${label}.${table}[${i}]: wiersz nie jest obiektem`); return; }
        for (const k of key) if (r[k] == null || r[k] === "") errors.push(`${label}.${table}[${i}]: brak klucza ${k}`);
        for (const c of cols) if (!(c in r)) errors.push(`${label}.${table}[${i}]: brak kolumny ${c}`);
      });
    }
    if (!Array.isArray(rowsA) || !Array.isArray(rowsB)) continue;
    const k = (r) => key.map(c => norm(r[c])).join("|");
    const mapA = new Map(), mapB = new Map();
    for (const [label, rows, map] of [["before", rowsA, mapA], ["after", rowsB, mapB]]) {
      for (const r of rows) {
        const id = k(r);
        if (map.has(id)) errors.push(`${label}.${table}: zduplikowany klucz ${id}`);
        map.set(id, r);
      }
    }
    const removed = [...mapA.keys()].filter(x => !mapB.has(x));
    const added = [...mapB.keys()].filter(x => !mapA.has(x));
    const changed = [];
    for (const [id, ra] of mapA) {
      const rb = mapB.get(id); if (!rb) continue;
      const ch = cols.filter(c => norm(ra[c]) !== norm(rb[c])).map(c => `${c}: ${norm(ra[c])} → ${norm(rb[c])}`);
      if (ch.length) changed.push(`${id} { ${ch.join("; ")} }`);
    }
    diffs += removed.length + added.length + changed.length;
    tables[table] = { before: rowsA.length, after: rowsB.length, removed, added, changed };
  }
  return { errors, tables, diffs };
}

export function formatReport({ errors, tables, diffs }) {
  const out = [];
  for (const e of errors) out.push(`BŁĄD  ${e}`);
  for (const [table, t] of Object.entries(tables)) {
    const n = t.removed.length + t.added.length + t.changed.length;
    out.push(`${table}: przed ${t.before}, po ${t.after}, ${n ? "RÓŻNICE " + n : "bez różnic"}`);
    for (const x of t.removed) out.push(`  USUNIĘTY  ${x}`);
    for (const x of t.added) out.push(`  DODANY    ${x}`);
    for (const x of t.changed) out.push(`  ZMIENIONY ${x}`);
  }
  if (errors.length) out.push(`\n${errors.length} błędów formatu — porównanie NIEWIARYGODNE, popraw eksport.`);
  else out.push(diffs ? `\n${diffs} różnic — każdą wyjaśnić (zmiana uczestnika w oknie wdrożenia czy skutek migracji) przed dalszymi krokami.` : "\nZgodne wybór po wyborze (wszystkie sekcje obecne).");
  return out.join("\n");
}
