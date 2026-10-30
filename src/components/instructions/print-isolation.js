// [feat/instructions-split] Wydruk samej instrukcji.
//
// Reguła CSS `visibility: hidden` na całej stronie + `position: absolute` na
// instrukcji (klasyczna sztuczka) psuje wielostronicowy wydruk w Chrome. Zamiast
// tego przed drukowaniem CHOWAMY (display: none) wszystko, co nie jest
// przodkiem ani potomkiem `.fm-instr`, i przywracamy po wydruku. Działa dla
// przycisku „Drukuj", dla Ctrl+P (zdarzenia beforeprint/afterprint) i dla
// adresu z `?print=1` (strona od razu bez menu — do automatycznego zapisu PDF).
import { useCallback, useEffect } from "react";

export const PRINT_CLASS = "fm-instr-printing";
const HIDDEN_ATTR = "data-fm-print-hidden";

export function isolateForPrint(root = typeof document !== "undefined" ? document : null) {
  if (!root) return () => {};
  const target = root.querySelector(".fm-instr");
  if (!target) return () => {};
  const hidden = [];
  let node = target;
  while (node && node !== root.body && node.parentElement) {
    const parent = node.parentElement;
    for (const sib of Array.from(parent.children)) {
      if (sib === node || sib.tagName === "SCRIPT" || sib.tagName === "STYLE") continue;
      if (sib.getAttribute(HIDDEN_ATTR)) continue;
      sib.setAttribute(HIDDEN_ATTR, sib.style.display || "");
      sib.style.display = "none";
      hidden.push(sib);
    }
    node = parent;
  }
  // Zrzuty są ładowane leniwie (poza ekranem = puste na wydruku) — na czas wydruku ładuj od razu.
  for (const img of Array.from(target.querySelectorAll?.("img") || [])) { if (img.loading === "lazy") img.loading = "eager"; }
  root.body?.classList.add(PRINT_CLASS);
  return () => {
    for (const el of hidden) {
      el.style.display = el.getAttribute(HIDDEN_ATTR) || "";
      el.removeAttribute(HIDDEN_ATTR);
    }
    root.body?.classList.remove(PRINT_CLASS);
  };
}

export function wantsPrintMode(search = typeof window !== "undefined" ? window.location.search : "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  return params.get("print") === "1";
}

/** Zwraca funkcję drukującą; podpina beforeprint/afterprint i tryb `?print=1`. */
export function usePrintIsolation(onPrint = null) {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let restore = null;
    const before = () => { if (!restore) restore = isolateForPrint(); };
    const after = () => { if (restore) { restore(); restore = null; } };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    let modeRestore = null;
    if (wantsPrintMode()) modeRestore = isolateForPrint();
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
      if (modeRestore) modeRestore();
    };
  }, []);

  return useCallback(() => {
    if (onPrint) return onPrint();
    if (typeof window === "undefined" || typeof window.print !== "function") return undefined;
    // beforeprint zrobi izolację; gdyby przeglądarka go nie wysłała — zrób ją tu i cofnij po chwili
    const restore = isolateForPrint();
    try { window.print(); } finally { setTimeout(restore, 1500); }
    return undefined;
  }, [onPrint]);
}
