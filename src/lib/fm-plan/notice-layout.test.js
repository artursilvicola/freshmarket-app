import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { supplierDoc, chainDoc } from "./layout.js";
import { FM_PLAN_FONTS_VFS, FM_PLAN_FONT_FAMILIES } from "./fonts.js";
const require = createRequire(import.meta.url);
const PdfPrinter = require("pdfmake");
const { PDFDocument } = require("pdf-lib");
const fonts = Object.fromEntries(Object.entries(FM_PLAN_FONT_FAMILIES).map(([family, files]) => [family, Object.fromEntries(Object.entries(files).map(([key, file]) => [key, Buffer.from(FM_PLAN_FONTS_VFS[file], "base64")]))]));
const printer = new PdfPrinter(fonts);
function nodes(value, key) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(v => nodes(v, key));
  return [...(key in value ? [value[key]] : []), ...Object.entries(value).filter(([k]) => k !== "image").flatMap(([, v]) => nodes(v, key))];
}
function render(def) { return new Promise((resolve, reject) => { const doc = printer.createPdfKitDocument(def), chunks = []; doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); doc.end(); }); }
function card(lang, kind, n) {
  const supplier = { name: "Firma testowa - Świeże Owoce i Warzywa Spółka z o.o.", initials: "FT", country: "PL", countryName: lang === "pl" ? "Polska" : "Poland", pkg: "Business", contact: { name: "Jan Kowalski", phone: "+48 500 000 000" }, desc: "Testowy opis firmy o rozbudowanej ofercie świeżych produktów. ".repeat(3) };
  const chain = { name: n === 5 ? "Makro Polska" : "Sieć testowa - International Retail Group", countryName: lang === "pl" ? "Polska" : "Poland", cats: ["fruit", "vegetables"], gate: 1 };
  return { ...supplier, ...(kind === "chain" ? chain : {}), card: "QA-TEST", lang, gate: 1, buyers: [], meetings: Array.from({ length: n }, (_, i) => ({ nr: i + 1, chain: { ...chain, name: chain.name + " " + (i + 1) }, supplier: { ...supplier, name: supplier.name + " " + (i + 1) } })) };
}

describe("meeting cards from the production pdfmake renderer", () => {
  for (const lang of ["pl", "en"]) for (const [kind, n] of [["supplier", 5], ["supplier", 9], ["supplier", 17], ["chain", 5], ["chain", 72]]) {
    it(`renders ${kind} ${n} ${lang}, preserving rows and audience-specific print content`, async () => {
      const c = card(lang, kind, n), def = (kind === "supplier" ? supplierDoc : chainDoc)(c, { mode: "simulation" });
      expect(nodes(def.content, "qr")).toEqual(kind === "supplier" ? ["https://b2b.freshmarket.eu", "https://b2b.freshmarket.eu/tablice"] : []);
      expect(nodes(def.content, "dontBreakRows")).toContain(true);
      const text = nodes(def.content, "text").flat(Infinity).filter(v => typeof v === "string").join(" ");
      expect(text.match(/Oksana Kozłowska/g)).toHaveLength(1);
      expect(text.match(/Jagoda Knadel/g)).toHaveLength(1);
      expect(text).toContain("+48 509 086 949");
      if (kind === "chain") {
        expect(text).not.toMatch(/PreConnect|Biedron|płatności|payment|Ważne informacje dotyczące|Important information about B2B|Śledź kolejność|Follow the meeting/);
        expect(nodes(def.content, "link")).not.toContain("https://b2b.freshmarket.eu/tablice");
        expect(text).toContain(lang === "pl" ? "NOTATKI" : "NOTES");
        expect(text).toContain(lang === "pl" ? "numery telefonów i adresy e-mail" : "phone numbers and email addresses");
        expect(text).toContain("b2b.freshmarket.eu");
        expect(text).toContain("Jan Kowalski · +48 500 000 000");
      }
      else { expect(text).toContain("PreConnect"); expect(text).toContain(lang === "pl" ? "Przegapiłeś numer?" : "Missed your number?"); }
      const pdf = await render(def), parsed = await PDFDocument.load(pdf);
      expect(parsed.getPageCount()).toBeGreaterThanOrEqual(kind === "chain" && n === 5 ? 1 : 2);
      // Buyer rows now reserve handwriting space; long names/descriptions need more pages.
      expect(parsed.getPageCount()).toBeLessThanOrEqual(kind === "chain" ? (n === 5 ? 3 : 16) : n === 5 ? 2 : 4);
      if (process.env.FM_NOTICE_QA_OUT) {
        await fs.mkdir(process.env.FM_NOTICE_QA_OUT, { recursive: true });
        await fs.writeFile(path.join(process.env.FM_NOTICE_QA_OUT, `${kind}-${n}-${lang}.pdf`), pdf);
        await fs.writeFile(path.join(process.env.FM_NOTICE_QA_OUT, `${kind}-${n}-${lang}.json`), JSON.stringify({ kind, n, lang, pages: parsed.getPageCount() }));
      }
    }, 30000);
  }
});
