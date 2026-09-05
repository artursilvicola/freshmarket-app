#!/usr/bin/env node
/**
 * [feat/fm-plan-export] Generator kart spotkań B2B — CLI (Node 20+).
 *
 *   node scripts/fm-plan-export.mjs --data <plik.json | URL> [--out out/fm-plan] [--simulate]
 *
 * Źródło danych: JSON z funkcji fm-plan-data (lokalnie: `netlify dev` +
 * nagłówek x-fm-local: 1; w produkcji: Bearer JWT admina — patrz --token).
 * Wynik w katalogu --out:
 *   karty/dostawcy/<karta>-<slug>.pdf, karty/sieci/<karta>-<slug>.pdf  — pojedyncze PDF-y (do maili)
 *   DRUK-dostawcy.pdf, DRUK-sieci.pdf                                   — zbiorcze pliki do drukarni
 *   plan-spotkan.xlsx                                                   — master Excel (tylko organizator)
 *   karty.zip                                                           — wszystko razem
 *   index.html                                                          — lista z linkami
 * --simulate: gdy w bazie nie ma zatwierdzonego planu, buduje robocze pary
 *             (karty ze znakiem wodnym SYMULACJA) — do podglądu układu na realnych firmach.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { buildPlanModel, resolveImages } from "../src/lib/fm-plan/model.js";
import { supplierDoc, chainDoc } from "../src/lib/fm-plan/layout.js";
import { buildMasterWorkbook, workbookToBuffer } from "../src/lib/fm-plan/excel.js";
import { FM_PLAN_FONTS_VFS, FM_PLAN_FONT_FAMILIES } from "../src/lib/fm-plan/fonts.js";

const require = createRequire(import.meta.url);
const PdfPrinter = require("pdfmake");
const { PDFDocument } = require("pdf-lib");
const JSZip = require("jszip");

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true] : [])).filter((x) => x.length));
const OUT = path.resolve(args.out || "out/fm-plan");
const SIMULATE = !!args.simulate;
if (!args.data) { console.error("Użycie: --data <plik.json|URL> [--out dir] [--simulate] [--token JWT]"); process.exit(1); }

async function loadRaw(src) {
  if (/^https?:\/\//.test(src)) {
    const headers = args.token ? { Authorization: `Bearer ${args.token}` } : { "x-fm-local": "1" };
    const r = await fetch(src, { headers });
    if (!r.ok) throw new Error(`fm-plan-data ${r.status}: ${await r.text()}`);
    return r.json();
  }
  return JSON.parse(await fs.readFile(src, "utf-8"));
}
let sharp = null;
try { sharp = require("sharp"); } catch { /* bez sharp: WebP/SVG → fallback inicjały */ }
const imgStats = { ok: 0, converted: 0, failed: 0 };
async function imageToDataUri(url) {
  const r = await fetch(url);
  if (!r.ok) { imgStats.failed++; return null; }
  const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
  let b = Buffer.from(await r.arrayBuffer());
  if (/^image\/(png|jpe?g)$/.test(ct)) { imgStats.ok++; return `data:${ct};base64,${b.toString("base64")}`; }
  // pdfmake czyta tylko PNG/JPEG — uploader zapisuje logotypy jako WebP, wiec konwertujemy
  if (!sharp) { imgStats.failed++; return null; }
  try {
    b = await sharp(b, { density: 300 }).resize({ width: 600, height: 300, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    imgStats.converted++;
    return `data:image/png;base64,${b.toString("base64")}`;
  } catch { imgStats.failed++; return null; }
}
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&amp;/g, "and").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const fonts = Object.fromEntries(Object.entries(FM_PLAN_FONT_FAMILIES).map(([fam, v]) => [fam, Object.fromEntries(Object.entries(v).map(([k, f]) => [k, Buffer.from(FM_PLAN_FONTS_VFS[f], "base64")]))]));
const printer = new PdfPrinter(fonts);
function renderPdf(docDef) {
  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDef);
    const chunks = []; doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); doc.end();
  });
}
async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const b of buffers) { const src = await PDFDocument.load(b); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach((p) => out.addPage(p)); }
  return Buffer.from(await out.save());
}
async function pageCount(b) { return (await PDFDocument.load(b)).getPageCount(); }

const raw = await loadRaw(args.data);
const model = buildPlanModel(raw, { simulate: SIMULATE });
console.log(`Tryb: ${model.mode} · dostawców ${model.suppliers.length} · sieci ${model.chains.length} · par ${model.pairs.length}`);
if (!model.pairs.length) { console.error("Brak par spotkań (plan niezatwierdzony). Użyj --simulate dla podglądu."); process.exit(2); }
process.stdout.write("Pobieram logotypy… ");
await resolveImages(model, imageToDataUri);
console.log(`ok (png/jpeg ${imgStats.ok}, skonwertowane ${imgStats.converted}, nieudane ${imgStats.failed})`);

await fs.mkdir(path.join(OUT, "karty", "dostawcy"), { recursive: true });
await fs.mkdir(path.join(OUT, "karty", "sieci"), { recursive: true });
const zip = new JSZip();
const index = [];
const supBufs = [], chainBufs = [];
for (const card of model.suppliers) {
  if (!card.meetings.length) continue;
  const b = await renderPdf(supplierDoc(card, { mode: model.mode }));
  const f = `karty/dostawcy/${card.card}-${slug(card.name)}-${card.lang}.pdf`;
  await fs.writeFile(path.join(OUT, f), b); zip.file(f, b); supBufs.push(b);
  index.push({ kind: "dostawca", card: card.card, name: card.name, lang: card.lang, n: card.meetings.length, pages: await pageCount(b), file: f, emails: card.emails.join(", ") });
}
for (const card of model.chains) {
  if (!card.meetings.length) continue;
  const b = await renderPdf(chainDoc(card, { mode: model.mode }));
  const f = `karty/sieci/${card.card}-${slug(card.name)}-${card.lang}.pdf`;
  await fs.writeFile(path.join(OUT, f), b); zip.file(f, b); chainBufs.push(b);
  index.push({ kind: "sieć", card: card.card, name: card.name, lang: card.lang, n: card.meetings.length, pages: await pageCount(b), file: f, emails: card.emails.join(", ") });
}
if (supBufs.length) { const m = await mergePdfs(supBufs); await fs.writeFile(path.join(OUT, "DRUK-dostawcy.pdf"), m); zip.file("DRUK-dostawcy.pdf", m); }
if (chainBufs.length) { const m = await mergePdfs(chainBufs); await fs.writeFile(path.join(OUT, "DRUK-sieci.pdf"), m); zip.file("DRUK-sieci.pdf", m); }
const xlsx = workbookToBuffer(buildMasterWorkbook(model));
await fs.writeFile(path.join(OUT, "plan-spotkan.xlsx"), xlsx); zip.file("plan-spotkan.xlsx", xlsx);
await fs.writeFile(path.join(OUT, "karty.zip"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

const rowsHtml = index.map((r) => `<tr><td>${r.kind}</td><td>${r.card}</td><td><a href="${r.file}">${r.name}</a></td><td>${r.lang.toUpperCase()}</td><td>${r.n}</td><td>${r.pages}</td><td>${r.emails || "<i>brak</i>"}</td></tr>`).join("");
await fs.writeFile(path.join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Karty spotkań FM 2026 — ${model.mode}</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}th{background:#f3f3f3}</style><h1>Karty spotkań FM 2026 — ${model.mode === "simulation" ? "SYMULACJA" : model.mode}</h1><p>Wygenerowano ${new Date().toLocaleString("pl-PL")} · <a href="DRUK-dostawcy.pdf">DRUK-dostawcy.pdf</a> · <a href="DRUK-sieci.pdf">DRUK-sieci.pdf</a> · <a href="plan-spotkan.xlsx">plan-spotkan.xlsx</a> · <a href="karty.zip">karty.zip</a></p><table><tr><th>Rodzaj</th><th>Karta</th><th>Firma</th><th>Język</th><th>Spotkań</th><th>Stron</th><th>E-maile (wysyłka)</th></tr>${rowsHtml}</table>`);
console.log(`Gotowe → ${OUT}\n  dostawcy: ${supBufs.length} kart, sieci: ${chainBufs.length} kart, Excel + ZIP + DRUK-*.pdf`);
