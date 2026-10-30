// [feat/instructions-split] Adresy instrukcji w panelach.
//
// Panele (dostawca / kupiec / admin) trzymają bieżącą stronę w stanie `pg`,
// nie w adresie. Instrukcje dostają osobne, stałe adresy, żeby dało się je
// otworzyć bezpośrednio (link w mailu, zakładka) i wydrukować:
//
//   /dostawca/instrukcja/preconnect        /dostawca/instrukcja/spotkania-b2b
//   /kupiec/instrukcja/preconnect          /kupiec/instrukcja/spotkania-b2b
//   /admin/instrukcja/preconnect?rola=…    /admin/instrukcja/spotkania-b2b?rola=…
//
// `rola` (admin|dostawca|kupiec) wybiera wersję dokumentu w widoku admina.
// Dostęp do /admin/* i tak wymaga roli admin (ProtectedRoute) — parametr nie
// otwiera niczego uczestnikom.

export const INSTRUCTION_DOCS = Object.freeze({
  preconnect: { slug: "preconnect" },
  b2b: { slug: "spotkania-b2b" },
});

// klucz strony (pg) → dokument
export const INSTRUCTION_PAGE_KEYS = Object.freeze({
  "instr-preconnect": "preconnect",
  "instr-b2b": "b2b",
  "a-instr-preconnect": "preconnect",
  "a-instr-b2b": "b2b",
});

// Stary link „Instrukcja" (klucz `instructions`) prowadzi do instrukcji PreConnect.
export const LEGACY_INSTRUCTIONS_KEY = "instructions";

const BASE_BY_PANEL = Object.freeze({ supplier: "/dostawca", buyer: "/kupiec", admin: "/admin" });
const PANEL_BY_BASE = Object.freeze({ dostawca: "supplier", kupiec: "buyer", admin: "admin" });
const ROLE_PARAM = Object.freeze({ admin: "admin", supplier: "dostawca", buyer: "kupiec" });
const ROLE_BY_PARAM = Object.freeze({ admin: "admin", dostawca: "supplier", kupiec: "buyer", supplier: "supplier", buyer: "buyer" });

export function isInstructionPage(pg) {
  return Object.prototype.hasOwnProperty.call(INSTRUCTION_PAGE_KEYS, pg);
}

export function instructionDocForPage(pg) {
  return INSTRUCTION_PAGE_KEYS[pg] || null;
}

/** Klucz strony dla dokumentu w panelu danej roli konta (admin ma własne klucze). */
export function instructionPageKey(doc, panelRole) {
  if (!INSTRUCTION_DOCS[doc]) return null;
  return panelRole === "admin" ? `a-instr-${doc}` : `instr-${doc}`;
}

/** Stary klucz `instructions` → nowy klucz instrukcji PreConnect; inne klucze bez zmian. */
export function normalizeInstructionKey(pg, panelRole) {
  if (pg === LEGACY_INSTRUCTIONS_KEY) return instructionPageKey("preconnect", panelRole);
  return pg;
}

/**
 * Adres instrukcji. `panelRole` = rola panelu z adresu (/dostawca, /kupiec, /admin),
 * `viewRole` = rola, której wersję ma pokazać admin (pomijana poza panelem admina
 * i dla własnej roli admina).
 */
export function instructionPath({ panelRole, doc, viewRole = null }) {
  const base = BASE_BY_PANEL[panelRole];
  const d = INSTRUCTION_DOCS[doc];
  if (!base || !d) return null;
  let path = `${base}/instrukcja/${d.slug}`;
  if (panelRole === "admin" && viewRole && viewRole !== "admin" && ROLE_PARAM[viewRole]) {
    path += `?rola=${ROLE_PARAM[viewRole]}`;
  }
  return path;
}

/** Bazowy adres panelu (po wyjściu z instrukcji wracamy na niego). */
export function panelBasePath(panelRole) {
  return BASE_BY_PANEL[panelRole] || "/";
}

/**
 * Rozpoznaje adres instrukcji. Zwraca { panelRole, doc, pg, viewRole } albo null.
 * `viewRole` ma sens tylko dla panelu admina; domyślnie "admin".
 */
export function parseInstructionLocation(pathname = "", search = "") {
  const m = String(pathname || "").match(/^\/(dostawca|kupiec|admin)\/instrukcja\/([a-z0-9-]+)\/?$/i);
  if (!m) return null;
  const panelRole = PANEL_BY_BASE[m[1].toLowerCase()];
  const slug = m[2].toLowerCase();
  const doc = Object.keys(INSTRUCTION_DOCS).find((k) => INSTRUCTION_DOCS[k].slug === slug);
  if (!panelRole || !doc) return null;
  let viewRole = panelRole === "admin" ? "admin" : panelRole;
  if (panelRole === "admin") {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    const r = ROLE_BY_PARAM[String(params.get("rola") || params.get("role") || "").toLowerCase()];
    if (r) viewRole = r;
  }
  return { panelRole, doc, pg: instructionPageKey(doc, panelRole), viewRole };
}

/** Rola panelu z bieżącego adresu (pierwszy segment), gdy stan aplikacji jej nie zna. */
export function panelRoleFromPath(pathname = "") {
  const m = String(pathname || "").match(/^\/(dostawca|kupiec|admin)(\/|$)/i);
  return m ? PANEL_BY_BASE[m[1].toLowerCase()] : null;
}
