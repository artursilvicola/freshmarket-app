#!/usr/bin/env node
// [feat/marketing-photos] Generuje netlify/functions/_shared/marketing-logo-data.js: oba logotypy maila (zielony układu 2,
// biały układu 1) jako data URI do PODGLĄDU w panelu. Ramka podglądu (iframe sandbox) ma „obce” pochodzenie i przeglądarka
// blokuje jej pobieranie obrazków z localhost/adresów prywatnych — w podglądzie logo nie wczytywało się na środowisku testowym.
// Prawdziwy mail NADAL dostaje adres HTTPS (b2b.freshmarket.eu/brand/…); osadzenie dotyczy wyłącznie podglądu.
//   node scripts/marketing-logo-data.mjs   (uruchomić po każdej zmianie plików w public/brand/)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uri = (f) => "data:image/png;base64," + readFileSync(path.join(root, "public/brand", f)).toString("base64");
const out = `// GENEROWANE przez scripts/marketing-logo-data.mjs — nie edytować ręcznie. Logotypy maila jako data URI (tylko podgląd w panelu).
export const LOGO_GREEN_DATA_URI = "${uri("fm-email-logo-green.png")}";
export const LOGO_WHITE_DATA_URI = "${uri("fm-email-logo-white.png")}";
`;
writeFileSync(path.join(root, "netlify/functions/_shared/marketing-logo-data.js"), out);
console.log("ok", out.length, "znaków");
