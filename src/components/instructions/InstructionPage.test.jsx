import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import InstructionPage, { renderInline, fillYear } from "./InstructionPage.jsx";
import InstructionArchivePage from "./InstructionArchivePage.jsx";
import { isolateForPrint, wantsPrintMode } from "./print-isolation.js";
import { listInstructions, getInstruction } from "../../content/instructions/index.js";

let tree;
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const output = () => text(tree.toJSON());
const mount = (props) => act(() => { tree = create(<InstructionPage editionYear={2027} {...props} />); });
const buttons = (label) => tree.root.findAllByType("button").filter(b => text(b.children.map(c => (typeof c === "string" ? c : c.toJSON ? c.toJSON() : c)).length ? b : b) && textOf(b).includes(label));
const textOf = (inst) => {
  const walk = (n) => typeof n === "string" ? n : Array.isArray(n) ? n.map(walk).join("") : n?.children ? n.children.map(walk).join("") : "";
  return walk(inst.toJSON ? inst.toJSON() : inst);
};

beforeEach(async () => { await i18n.changeLanguage("pl"); });
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

describe("treść instrukcji — spójność", () => {
  it("każdy dokument istnieje dla każdej roli w PL i EN, z rozdziałami, krokami i unikalnymi id", () => {
    const all = listInstructions();
    expect(all).toHaveLength(12);
    for (const { doc, role, lang, content } of all) {
      expect(content, `${doc}/${role}/${lang}`).toBeTruthy();
      expect(content.title.length).toBeGreaterThan(5);
      expect(content.chapters.length).toBeGreaterThanOrEqual(5);
      const ids = content.chapters.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const ch of content.chapters) {
        expect(ch.title.length, `${doc}/${role}/${lang}/${ch.id}`).toBeGreaterThan(2);
        expect((ch.steps || []).length, `${doc}/${role}/${lang}/${ch.id} steps`).toBeGreaterThan(0);
      }
    }
  });

  it("PL i EN mają te same rozdziały (id) i tę samą liczbę kroków", () => {
    for (const doc of ["preconnect", "b2b"]) for (const role of ["supplier", "buyer", "admin"]) {
      const pl = getInstruction(doc, role, "pl"), en = getInstruction(doc, role, "en");
      expect(pl.chapters.map(c => c.id)).toEqual(en.chapters.map(c => c.id));
      expect(pl.chapters.map(c => c.steps.length)).toEqual(en.chapters.map(c => c.steps.length));
      expect(!!pl.archive).toBe(!!en.archive);
      expect((pl.questions || []).length).toBe((en.questions || []).length);
    }
  });

  it("instrukcje uczestników nie zawierają pytań administracyjnych, PIN-ów ani linków logowania", () => {
    for (const { role, content } of listInstructions()) {
      const blob = JSON.stringify(content);
      if (role !== "admin") expect(content.questions || []).toHaveLength(0);
      expect(blob).not.toMatch(/PIN\s*[:=]\s*\d/);
      expect(blob).not.toMatch(/token=|magic_link|\/auth\/v1\//i);
      expect(blob).not.toMatch(/\+48\s?\d{3}/); // telefony tylko na ekranach aplikacji, nie w treści
    }
  });

  it("dokumenty B2B mają archiwum 2026 oznaczone jako archiwum i rok edycji jako parametr", () => {
    for (const role of ["supplier", "buyer", "admin"]) for (const lang of ["pl", "en"]) {
      const c = getInstruction("b2b", role, lang);
      expect(c.archive.title).toMatch(/2026/);
      expect(c.archive.title.toLowerCase()).toMatch(/archiw|archive/);
      expect(c.title).toMatch(/\{\{year\}\}/);
    }
  });
});

describe("strona instrukcji", () => {
  it("pokazuje spis treści, ponumerowane rozdziały i kroki, po polsku", () => {
    mount({ doc: "preconnect", role: "supplier", lang: "pl" });
    const out = output();
    expect(out).toContain("PreConnect dla dostawcy");
    expect(out).toContain("Spis treści");
    expect(out).toContain("1. Czym jest PreConnect");
    expect(out).toContain("Dostawca");
    expect(tree.root.findAllByType("ol").length).toBeGreaterThan(3);
    expect(out).not.toContain("Do ustalenia przez organizatora");
    expect(tree.root.findByType("article").props["data-role"]).toBe("supplier");
  });

  it("po angielsku pokazuje angielską treść i angielskie etykiety", async () => {
    await i18n.changeLanguage("en");
    mount({ doc: "b2b", role: "buyer", lang: "en" });
    const out = output();
    expect(out).toContain("B2B Meetings 2027 for buyers");
    expect(out).toContain("Contents");
    expect(out).toContain("Print / save as PDF");
    expect(out).not.toContain("instructions.page");
  });

  it("wstawia rok edycji z konfiguracji do tytułów i archiwum", () => {
    mount({ doc: "b2b", role: "supplier", lang: "pl", editionYear: 2027 });
    expect(output()).toContain("Spotkania B2B 2027 dla dostawcy");
    expect(output()).toContain("Archiwum: edycja 2026");
    expect(output()).not.toContain("{{year}}");
  });

  it("wersja administratora ma pytania do potwierdzenia; uczestnik ich nie widzi", () => {
    mount({ doc: "b2b", role: "admin", lang: "pl" });
    expect(output()).toContain("Do ustalenia przez organizatora");
    act(() => tree.unmount());
    mount({ doc: "b2b", role: "buyer", lang: "pl" });
    expect(output()).not.toContain("Do ustalenia przez organizatora");
  });

  it("dawna połączona instrukcja 2026 NIE jest wklejana do instrukcji — jest tylko odnośnik do osobnej strony", () => {
    const onArchive = vi.fn();
    mount({ doc: "preconnect", role: "buyer", lang: "pl", archiveHref: "/kupiec/instrukcja/archiwum-2026", onArchive });
    expect(tree.root.findAll(n => n.props?.dangerouslySetInnerHTML)).toHaveLength(0);
    const link = tree.root.findByProps({ className: "fm-instr__archive-link" });
    expect(link.props.href).toBe("/kupiec/instrukcja/archiwum-2026");
    expect(textOf(link)).toContain("Archiwum instrukcji 2026");
    act(() => link.props.onClick({ preventDefault() {} }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
    mount({ doc: "b2b", role: "buyer", lang: "pl" });            // bez odnośnika — instrukcja spotkań
    expect(tree.root.findAll(n => n.props?.className === "fm-instr__archive-link")).toHaveLength(0);
  });

  it("instrukcja spotkań mówi, że dotyczy edycji z treści, nie z dat modułu", () => {
    mount({ doc: "b2b", role: "supplier", lang: "pl", editionYear: 2027 });
    expect(output()).toContain("Instrukcja dotyczy edycji Fresh Market 2027");
    expect(tree.root.findByType("article").props["data-edition"]).toBe(2027);
    act(() => tree.unmount());
    mount({ doc: "preconnect", role: "supplier", lang: "pl", editionYear: 2027 });
    expect(output()).not.toContain("Instrukcja dotyczy edycji Fresh Market");
  });

  it("przełącznik wersji dla admina i przycisk drukowania", () => {
    const onChange = vi.fn(); const onPrint = vi.fn();
    mount({ doc: "preconnect", role: "admin", lang: "pl", onPrint,
      roleSwitcher: { value: "admin", onChange, options: [{ value: "admin", label: "Administrator" }, { value: "supplier", label: "Dostawca" }, { value: "buyer", label: "Kupiec" }] } });
    const btns = tree.root.findAllByType("button");
    const supplierBtn = btns.find(b => textOf(b) === "Dostawca");
    act(() => supplierBtn.props.onClick());
    expect(onChange).toHaveBeenCalledWith("supplier");
    const printBtn = btns.find(b => textOf(b).includes("Drukuj / zapisz jako PDF"));
    act(() => printBtn.props.onClick());
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(btns.find(b => textOf(b) === "Administrator").props["aria-pressed"]).toBe(true);
  });

  it("brak dokumentu → czytelny komunikat zamiast pustej strony", () => {
    mount({ doc: "nieznany", role: "supplier", lang: "pl" });
    expect(output()).toContain("Brak instrukcji dla tej roli.");
  });

  it("pomocnicze: pogrubienia i rok", () => {
    expect(fillYear("Spotkania {{year}} i {{ year }}", 2027)).toBe("Spotkania 2027 i 2027");
    const nodes = renderInline("a **b** c");
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes[1].type).toBe("strong");
    expect(renderInline("bez pogrubień")).toBe("bez pogrubień");
  });
});

// Zrzuty ekranu przy rozdziałach muszą istnieć w public/ (inaczej strona pokaże pusty obraz)
describe("zrzuty ekranu instrukcji", () => {
  it("każdy plik z `figure.src` istnieje w public/, a PL i EN wskazują ten sam plik", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "public");
    let count = 0;
    for (const { doc, role, lang, content } of listInstructions()) {
      for (const ch of content.chapters) {
        if (!ch.figure) continue;
        count += 1;
        expect(ch.figure.src, `${doc}/${role}/${lang}/${ch.id}`).toMatch(/^\/instrukcje\/[a-z0-9-]+\.(jpg|png)$/);
        expect(fs.existsSync(path.join(root, ch.figure.src)), ch.figure.src).toBe(true);
        expect(ch.figure.alt.length).toBeGreaterThan(5);
        const other = getInstruction(doc, role, lang === "pl" ? "en" : "pl").chapters.find(c => c.id === ch.id);
        expect(other.figure?.src).toBe(ch.figure.src);
      }
    }
    expect(count).toBeGreaterThanOrEqual(10);
  });
});

describe("archiwum instrukcji 2026 (osobna strona)", () => {
  it("pokazuje HTML z Brandingu z ostrzeżeniem, że to nie bieżąca instrukcja, i odnośnik powrotu", () => {
    const onBack = vi.fn();
    act(() => { tree = create(<InstructionArchivePage role="buyer" lang="pl" html="<h3>Witamy</h3><p>CZĘŚĆ I — Spotkania B2B 2026</p>" backHref="/kupiec/instrukcja/preconnect" onBack={onBack} />); });
    const out = output();
    expect(out).toContain("Archiwum instrukcji 2026");
    expect(out).toContain("Nie opisuje bieżącej edycji");
    expect(tree.root.findByProps({ className: "fm-instr__chapter fm-instr__archive-body" }).props.dangerouslySetInnerHTML.__html).toContain("CZĘŚĆ I");
    const back = tree.root.findAll(n => n.type === "a" && n.props.href === "/kupiec/instrukcja/preconnect")[0];
    act(() => back.props.onClick({ preventDefault() {} }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
  it("bez treści w bazie — komunikat, nie pusta strona", async () => {
    await i18n.changeLanguage("en");
    act(() => { tree = create(<InstructionArchivePage role="supplier" lang="en" html="  " />); });
    expect(output()).toContain("No archived content");
  });
});

// Środowisko testów to node (bez jsdom) — minimalna atrapa drzewa DOM wystarcza, bo
// print-isolation używa tylko children / parentElement / style / atrybutów / classList.
function fakeEl(tag, { cls = "", children = [] } = {}) {
  const el = { tagName: tag, className: cls, children, parentElement: null, style: { display: "" }, _attrs: {},
    getAttribute(k) { return this._attrs[k] ?? null; }, setAttribute(k, v) { this._attrs[k] = String(v); }, removeAttribute(k) { delete this._attrs[k]; } };
  for (const c of children) c.parentElement = el;
  return el;
}
function fakeDoc(root) {
  const all = []; (function walk(n) { all.push(n); n.children.forEach(walk); })(root);
  const body = root;
  body.classList = { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } };
  return { body, querySelector: (sel) => all.find(n => (" " + n.className + " ").includes(" " + sel.slice(1) + " ")) || null };
}

describe("izolacja wydruku", () => {
  it("chowa wszystko poza instrukcją (rodzeństwo każdego przodka) i przywraca po wydruku", () => {
    const banner = fakeEl("DIV", { cls: "banner" });
    const instr = fakeEl("ARTICLE", { cls: "fm-instr" });
    const main = fakeEl("MAIN", { children: [banner, instr] });
    const menu = fakeEl("ASIDE", { cls: "menu" });
    const shell = fakeEl("DIV", { children: [menu, main] });
    const top = fakeEl("HEADER", { cls: "top" });
    const foot = fakeEl("FOOTER", { cls: "foot" });
    const script = fakeEl("SCRIPT");
    const body = fakeEl("BODY", { children: [top, shell, foot, script] });
    const doc = fakeDoc(body);
    const restore = isolateForPrint(doc);
    expect([top.style.display, menu.style.display, foot.style.display, banner.style.display]).toEqual(["none", "none", "none", "none"]);
    expect([shell.style.display, main.style.display, instr.style.display, script.style.display]).toEqual(["", "", "", ""]);
    expect(doc.body.classList.contains("fm-instr-printing")).toBe(true);
    restore();
    expect([top.style.display, menu.style.display, foot.style.display, banner.style.display]).toEqual(["", "", "", ""]);
    expect(doc.body.classList.contains("fm-instr-printing")).toBe(false);
  });
  it("bez instrukcji w drzewie nic nie zmienia", () => {
    const body = fakeEl("BODY", { children: [fakeEl("DIV", { cls: "x" })] });
    const doc = fakeDoc(body);
    isolateForPrint(doc)();
    expect(body.children[0].style.display).toBe("");
  });
  it("?print=1 włącza tryb wydruku", () => {
    expect(wantsPrintMode("?print=1")).toBe(true);
    expect(wantsPrintMode("?rola=kupiec")).toBe(false);
    expect(wantsPrintMode("")).toBe(false);
  });
});
