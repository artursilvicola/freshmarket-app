// [feat/instructions-split] Rejestr instrukcji: dokument × rola × język.
//
// Treść jest w zwykłych plikach JS (nie w JSON i18n), bo to długie dokumenty
// z rozdziałami i krokami, a nie etykiety interfejsu. Nazwy pozycji menu,
// przyciski i komunikaty strony są nadal w i18n (`instructions.*`).
//
// Zasada: tylko to, co aplikacja naprawdę robi albo co organizator potwierdził.
// Rzeczy niepotwierdzone dla bieżącej edycji trafiają do `questions` (widoczne
// wyłącznie w wersji administratora), nigdy do kroków dla uczestników.
import preconnectSupplier from "./preconnect-supplier.js";
import preconnectBuyer from "./preconnect-buyer.js";
import preconnectAdmin from "./preconnect-admin.js";
import b2bSupplier from "./b2b-supplier.js";
import b2bBuyer from "./b2b-buyer.js";
import b2bAdmin from "./b2b-admin.js";

export const INSTRUCTION_ROLES = ["supplier", "buyer", "admin"];
export const INSTRUCTION_LANGS = ["pl", "en"];

const DOCS = {
  preconnect: { supplier: preconnectSupplier, buyer: preconnectBuyer, admin: preconnectAdmin },
  b2b: { supplier: b2bSupplier, buyer: b2bBuyer, admin: b2bAdmin },
};

export function getInstruction(doc, role, lang) {
  const byRole = DOCS[doc];
  const d = byRole && byRole[role];
  if (!d) return null;
  const l = String(lang || "pl").toLowerCase().startsWith("en") ? "en" : "pl";
  return d[l] || d.pl || null;
}

/** Do testów spójności: wszystkie kombinacje. */
export function listInstructions() {
  const out = [];
  for (const doc of Object.keys(DOCS)) {
    for (const role of INSTRUCTION_ROLES) {
      for (const lang of INSTRUCTION_LANGS) out.push({ doc, role, lang, content: getInstruction(doc, role, lang) });
    }
  }
  return out;
}
