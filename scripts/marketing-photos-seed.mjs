#!/usr/bin/env node
// [feat/marketing-photos] Zasiew biblioteki zdjęć na BAZIE TESTOWEJ z oryginałów pobranych z Drive (Artur 06.11:
// 18 zatwierdzonych + 20 zapasowych „do przeglądu”). TYLKO środowisko testowe (.env.test; odmowa dla projektu prod).
//
//   node scripts/marketing-photos-seed.mjs [--dry-run] [--dir <katalog z oryginałami>] [--admin <uuid>]
//
// Dla każdego pliku: sharp → auto-orientacja, kadr 3:2 (attention), 1200×800, JPEG q82 (mozjpeg), BEZ metadanych
// (sharp domyślnie usuwa EXIF/GPS) → sha256 wersji + sha256 oryginału + dHash 9×8 → upload do PRYWATNEGO bucketa
// `marketing-photos-pending` (service_role, upsert:false) → wiersz marketing_photos (+ wersja 1, public_url = null).
//   zatw_*  → publikacja wersji (kopia do publicznego `marketing-photos`) + approved_version_id + status ready
//   zapas_* → status pending, plik ZOSTAJE prywatny do akceptacji kadru (review Codexa P1), review_note „zapas — do przeglądu”
// Metadane (kategoria, opis kadru) z docs/production/mail-v2-makieta-2026-11-06/zdjecia-drive/kontakt.json.
// Idempotentny: plik z tym samym source_sha256 w bazie = pomijany. Oryginały nie są zmieniane ani wysyłane.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { parseDotenv, validateTestEnv, PROD_REF } from "./lib/test-env.mjs";
import { validateMailImage, versionPath, PENDING_BUCKET } from "../netlify/functions/_shared/marketing-photos.js";
import { publishVersion } from "../netlify/functions/_shared/marketing-photo-data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const DIR = flag("--dir") || path.join(root, "docs/production/mail-v2-makieta-2026-11-06/zdjecia-drive/oryginaly/wybrane");
const KONTAKT = path.join(root, "docs/production/mail-v2-makieta-2026-11-06/zdjecia-drive/kontakt.json");

const envFile = path.join(root, ".env.test");
if (!existsSync(envFile)) { console.error("Brak .env.test — tylko środowisko testowe."); process.exit(2); }
const env = parseDotenv(readFileSync(envFile, "utf8"));
const check = validateTestEnv(env);
if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); process.exit(3); }
if (String(env.SUPABASE_URL).includes(PROD_REF)) { console.error("ODMOWA: SUPABASE_URL wskazuje na produkcję."); process.exit(3); }
if (!existsSync(DIR)) { console.error("Brak katalogu z oryginałami:", DIR); process.exit(2); }

const notes = new Map();
if (existsSync(KONTAKT)) for (const r of JSON.parse(readFileSync(KONTAKT, "utf8")).rows || []) notes.set(`${r.year}_${r.name}`, r);

const files = readdirSync(DIR).filter((f) => /^(zatw|zapas)_(\d{4})_(.+)\.(jpe?g|png|webp)$/i.test(f)).sort();
console.log(`${DRY ? "[dry-run] " : ""}plików: ${files.length} w ${path.relative(root, DIR)} → projekt testowy ${env.SUPABASE_URL}`);

const supa = DRY ? null : createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
let adminId = flag("--admin");
if (!DRY && !adminId) {
  const { data } = await supa.from("profiles").select("id").eq("role", "admin").eq("email", "codex.admin@freshmarket.test").maybeSingle();
  adminId = data?.id || null;
}
const existing = DRY ? new Map() : new Map(((await supa.from("marketing_photos").select("id, source_sha256, title")).data || []).map((p) => [p.source_sha256, p]));

const dhash = async (buf) => {
  const { data } = await sharp(buf).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let out = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  return out;
};
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const CAT_EN = { "rozmowy B2B": "B2B talks", "prezentacja firmy": "company presentation", "kontrola": "control" };

let done = 0, skipped = 0, failed = 0;
for (const f of files) {
  const m = f.match(/^(zatw|zapas)_(\d{4})_(.+)\.(jpe?g|png|webp)$/i);
  const tier = m[1], year = Number(m[2]), stem = m[3];
  const shortName = stem.replace(/_happymoon[._]pl_(www|print)$/i, ""); // nazwy z Drive: 2025 „…_happymoon.pl_www”, 2026 „…_happymoon_pl_print”
  const note = notes.get(`${year}_${shortName}`) || {};
  const original = readFileSync(path.join(DIR, f));
  const sourceSha = sha(original);
  if (existing.has(sourceSha)) { skipped++; console.log(`  pomijam (już w bazie): ${f}`); continue; }
  try {
    const meta = await sharp(original).rotate().metadata();
    let q = 82, out, info;
    for (; q >= 58; q -= 4) {
      const r = await sharp(original).rotate().resize(1200, 800, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: q, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      out = r.data; info = r.info;
      if (out.length <= 200 * 1024) break;
    }
    const v = validateMailImage(out, "image/jpeg");
    if (!v.ok) { failed++; console.error(`  ODRZUCONE ${f}: ${v.errors.join(", ")}`); continue; }
    const cat = note.cat || "rozmowy B2B";
    const row = {
      title: `${year} · ${shortName}${tier === "zapas" ? " (zapas)" : ""}`,
      alt_pl: cat === "rozmowy B2B" ? "Rozmowy dostawców z kupcami sieci handlowych przy stolikach na Fresh Market" : "Prezentacja oferty dostawcy na stoisku Fresh Market",
      alt_en: cat === "rozmowy B2B" ? "Suppliers talking to retail chain buyers at tables during Fresh Market" : "A supplier presenting their offer at a Fresh Market stand",
      caption_pl: `Zdjęcie archiwalne: rozmowy B2B na Fresh Market ${year}`,
      caption_en: `Archive photo: B2B meetings at Fresh Market ${year}`,
      kind: "authentic", year,
      source: `Google Drive „Zdjęcia Fresh Market” / ${year} / ${shortName}.jpg${note.id ? ` (id ${note.id})` : ""}`,
      rights: "Fresh Market (KJOW Sp. z o.o.) — zdjęcie własne z wydarzenia; widoczne loga sieci = uczestnicy edycji " + year + ", nie bieżący PreConnect",
      categories: [cat, ...(CAT_EN[cat] ? [CAT_EN[cat]] : [])],
      status: tier === "zatw" ? "ready" : "pending",
      review_note: tier === "zatw" ? `zatwierdzone przez Artura 06.11.2026${note.note ? " — " + note.note : ""}` : `zapas — do przeglądu${note.note ? " — " + note.note : ""}`,
      source_sha256: sourceSha, dhash: await dhash(out), created_by: adminId,
      approved_by: tier === "zatw" ? adminId : null, approved_at: tier === "zatw" ? new Date().toISOString() : null,
    };
    console.log(`  ${tier.padEnd(5)} ${year} ${shortName.padEnd(16)} ${meta.width}×${meta.height} ${(original.length / 1024 / 1024).toFixed(1)} MB → ${info.width}×${info.height} ${(out.length / 1024).toFixed(0)} KB q${q} ${row.status}`);
    if (DRY) { done++; continue; }
    const { data: photo, error } = await supa.from("marketing_photos").insert(row).select("*").maybeSingle();
    if (error) throw new Error("insert photo: " + error.message);
    const fileSha = sha(out);
    const p = versionPath(photo.id, 1, fileSha, "image/jpeg");
    const up = await supa.storage.from(PENDING_BUCKET).upload(p, out, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
    if (up.error) throw new Error("upload: " + up.error.message);
    const { data: version, error: vErr } = await supa.from("marketing_photo_versions").insert({ photo_id: photo.id, version_no: 1, storage_bucket: PENDING_BUCKET, storage_path: p, public_url: null, width: info.width, height: info.height, bytes: out.length, mime: "image/jpeg", sha256: fileSha, created_by: adminId }).select("*").maybeSingle();
    if (vErr) throw new Error("insert version: " + vErr.message);
    const patch = { current_version_id: version.id };
    if (tier === "zatw") { await publishVersion(supa, version, adminId); patch.approved_version_id = version.id; }
    const { error: uErr } = await supa.from("marketing_photos").update(patch).eq("id", photo.id);
    if (uErr) throw new Error("update photo: " + uErr.message);
    done++;
  } catch (e) { failed++; console.error(`  BŁĄD ${f}: ${e.message}`); }
}
console.log(`\ngotowe: ${done} dodanych, ${skipped} pominiętych (duplikat oryginału), ${failed} błędów`);
if (!DRY) {
  const { data: counts } = await supa.from("marketing_photos").select("status");
  const by = {}; for (const r of counts || []) by[r.status] = (by[r.status] || 0) + 1;
  console.log("stan biblioteki na bazie testowej:", JSON.stringify(by));
}
process.exit(failed ? 1 : 0);
