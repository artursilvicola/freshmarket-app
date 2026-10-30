import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import InstructionPage, { renderInline, fillYear } from "./InstructionPage.jsx";
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
    expect(out).not.toContain("Do potwierdzenia przez organizatora");
    expect(tree.root.findByType("article").props["data-role"]).toBe("supplier");
  });

  it("po angielsku pokazuje angielską treść i angielskie etykiety", async () => {
    await i18n.changeLanguage("en");
    mount({ doc: "b2b", role: "buyer", lang: "en" });
    const out = output();
    expect(out).toContain("B2B Meetings 2027 for buyers");
    expect(out).toContain("Contents");
    expect(out).toContain("Download PDF / print");
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
    expect(output()).toContain("Do potwierdzenia przez organizatora");
    act(() => tree.unmount());
    mount({ doc: "b2b", role: "buyer", lang: "pl" });
    expect(output()).not.toContain("Do potwierdzenia przez organizatora");
  });

  it("informacja od organizatora pojawia się tylko w PreConnect uczestnika", () => {
    const organizerBoxes = () => tree.root.findAll(n => n.props?.className === "fm-instr__organizer");
    mount({ doc: "preconnect", role: "buyer", lang: "pl", organizerHtml: "<b>Przerwa techniczna 1.11</b>" });
    expect(organizerBoxes()).toHaveLength(1);
    expect(organizerBoxes()[0].findByProps({ className: "fm-instr__organizer-body" }).props.dangerouslySetInnerHTML.__html).toContain("Przerwa techniczna");
    act(() => tree.unmount());
    mount({ doc: "preconnect", role: "admin", lang: "pl", organizerHtml: "<b>Przerwa techniczna 1.11</b>" });
    expect(organizerBoxes()).toHaveLength(0);
    act(() => tree.unmount());
    mount({ doc: "b2b", role: "buyer", lang: "pl", organizerHtml: "<b>x</b>" });
    expect(organizerBoxes()).toHaveLength(0);
    act(() => tree.unmount());
    mount({ doc: "preconnect", role: "buyer", lang: "pl", organizerHtml: "   " });
    expect(organizerBoxes()).toHaveLength(0);
  });

  it("przełącznik wersji dla admina i przycisk drukowania", () => {
    const onChange = vi.fn(); const onPrint = vi.fn();
    mount({ doc: "preconnect", role: "admin", lang: "pl", onPrint,
      roleSwitcher: { value: "admin", onChange, options: [{ value: "admin", label: "Administrator" }, { value: "supplier", label: "Dostawca" }, { value: "buyer", label: "Kupiec" }] } });
    const btns = tree.root.findAllByType("button");
    const supplierBtn = btns.find(b => textOf(b) === "Dostawca");
    act(() => supplierBtn.props.onClick());
    expect(onChange).toHaveBeenCalledWith("supplier");
    const printBtn = btns.find(b => textOf(b).includes("Pobierz PDF"));
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
