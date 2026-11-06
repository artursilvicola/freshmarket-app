#!/usr/bin/env node
// [feat/marketing-photos] Porządki po review Codexa P1 — TYLKO BAZA TESTOWA (.env.test):
// wersje plików opublikowane w publicznym buckecie PRZED migracją 20261107110000, które NIE są zatwierdzoną wersją
// zdjęcia i NIE są użyte przez żadną kampanię (szkic/zamrożenie), wracają do prywatnego bucketa marketing-photos-pending
// (public_url = null). Wersje użyte przez kampanie albo zatwierdzone zostają nietknięte (trigger i tak by odmówił).
//
//   node scripts/marketing-photos-unpublish-pending.mjs [--dry-run]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { parseDotenv, validateTestEnv, PROD_REF } from "./lib/test-env.mjs";
import { unpublishVersion } from "../netlify/functions/_shared/marketing-photo-data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const DRY = process.argv.includes("--dry-run");

const envFile = path.join(root, ".env.test");
if (!existsSync(envFile)) { console.error("Brak .env.test — tylko środowisko testowe."); process.exit(2); }
const env = parseDotenv(readFileSync(envFile, "utf8"));
const check = validateTestEnv(env);
if (!check.ok) { console.error("ODMOWA (.env.test):\n - " + check.errors.join("\n - ")); process.exit(3); }
if (String(env.SUPABASE_URL).includes(PROD_REF)) { console.error("ODMOWA: SUPABASE_URL wskazuje na produkcję."); process.exit(3); }
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: photos } = await supa.from("marketing_photos").select("id, title, status, approved_version_id, current_version_id");
const { data: versions } = await supa.from("marketing_photo_versions").select("*");
const { data: camps } = await supa.from("marketing_campaigns").select("id, name, status, photo_version_id, frozen_photo");
const usedBy = new Map();
for (const c of camps || []) {
  for (const vid of [c.photo_version_id, c.frozen_photo?.version_id].filter(Boolean)) { const a = usedBy.get(String(vid)) || []; a.push(`${c.name} (${c.status})`); usedBy.set(String(vid), a); }
}
const approvedIds = new Set((photos || []).map((p) => String(p.approved_version_id)).filter((x) => x !== "null"));
let done = 0, kept = 0, failed = 0;
for (const v of versions || []) {
  if (!v.published_at) continue;
  const photo = (photos || []).find((p) => p.id === v.photo_id);
  const uses = usedBy.get(String(v.id)) || [];
  if (approvedIds.has(String(v.id)) || uses.length) { kept++; console.log(`  zostaje  ${photo?.title || v.photo_id} v${v.version_no}: ${approvedIds.has(String(v.id)) ? "zatwierdzona" : ""} ${uses.length ? "użyta: " + uses.join("; ") : ""}`); continue; }
  console.log(`  ${DRY ? "[dry] cofam" : "cofam  "} ${photo?.title || v.photo_id} v${v.version_no} (status zdjęcia: ${photo?.status})`);
  if (DRY) { done++; continue; }
  try { await unpublishVersion(supa, v); done++; } catch (e) { failed++; console.error("  BŁĄD:", e.message); }
}
console.log(`\n${DRY ? "[dry-run] " : ""}cofnięte: ${done}, zostają opublikowane: ${kept}, błędy: ${failed}`);
process.exit(failed ? 1 : 0);
