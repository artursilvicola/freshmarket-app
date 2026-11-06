#!/usr/bin/env node
// [feat/marketing-photos] Przebieg migracji biblioteki zdjęć na PRAWDZIWYM Postgresie (PGlite) z całym łańcuchem
// migracji repo: tabele, FK, niezmienność wersji (trigger + brak uprawnień), kolumny kampanii, widok użycia,
// uprawnienia (anon/authenticated bez zapisu; admin czyta przez RLS), bucket bez polityk zapisu.
//
//   PGLITE_PATH=<...>/@electric-sql/pglite/dist/index.js node scripts/marketing-photos-sql-smoke.mjs
//
// Bez PGLITE_PATH kończy się kodem 2 i mówi o tym — nie udaje, że przeszedł.
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const PGLITE_PATH = process.env.PGLITE_PATH;
if (!PGLITE_PATH) { console.error("Brak PGLITE_PATH — nie uruchomiono."); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?pgcrypto"?\s*;/gi, "")
  .replace(/create extension if not exists "?pg_trgm"?\s*;/gi, "")
  .replace(/create extension if not exists "?citext"?\s*;/gi, "");

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) fails++; };
const fails_with = async (fn, rx) => { try { await fn(); return null; } catch (e) { return rx.test(e.message) ? e.message : "INNY BŁĄD: " + e.message; } };

const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
const db = new PGlite();
await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  try { await db.exec(patch(read("supabase/migrations/" + f))); }
  catch (e) { console.error("migracja padła:", f, e.message); process.exit(1); }
}
console.log(`migracje: ${files.length} OK (ostatnia ${files[files.length - 1]})`);
ok(files.includes("20261107100000_marketing_photos.sql"), "migracja biblioteki zdjęć w łańcuchu");
console.log("idempotencja: migracja zdjęć drugi raz");
let twice = null; try { await db.exec(patch(read("supabase/migrations/20261107100000_marketing_photos.sql"))); } catch (e) { twice = e.message; }
ok(!twice, "druga aplikacja bez błędu" + (twice ? ": " + twice : ""));

const ADMIN = "11111111-1111-4111-8111-111111111111", OWNER = "55555555-5555-4555-8555-555555555555";
const COMPANY = "44444444-4444-4444-8444-444444444444";
await db.exec(`
  insert into auth.users (id, email) values ('${ADMIN}','admin@example.invalid'), ('${OWNER}','dostawca@example.invalid') on conflict do nothing;
  insert into public.companies (id, name, legacy_supplier_id, country) values ('${COMPANY}','Dostawca testowy','sup-1','PL') on conflict do nothing;
  insert into public.profiles (id, role, name, email, active, company_id) values
    ('${ADMIN}','admin','Admin','admin@example.invalid',true,null),
    ('${OWNER}','supplier','Operator','dostawca@example.invalid',true,'${COMPANY}')
  on conflict (id) do update set role = excluded.role, email = excluded.email, company_id = excluded.company_id, active = true;
`);

console.log("1. zdjęcie + wersja; current_version_id; unikalność ścieżki i oryginału");
const ph = (await db.query(`insert into public.marketing_photos (title, alt_pl, alt_en, caption_pl, kind, year, status, source_sha256, created_by) values ('Rozmowy 2026','Rozmowy','Talks','Zdjęcie archiwalne 2026','authentic',2026,'pending',repeat('a',64),$1) returning id`, [ADMIN])).rows[0].id;
const v1 = (await db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256, created_by) values ($1::uuid,1,'photos/'||$1::text||'/v1-abc.jpg','https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/'||$1::text||'/v1-abc.jpg',1200,800,120000,'image/jpeg',repeat('b',64),$2::uuid) returning id`, [ph, ADMIN])).rows[0].id;
await db.query(`update public.marketing_photos set current_version_id = $2, status = 'ready', approved_by = $3, approved_at = now() where id = $1`, [ph, v1, ADMIN]);
ok((await db.query(`select current_version_id from public.marketing_photos where id = $1`, [ph])).rows[0].current_version_id === v1, "current_version_id wskazuje na v1");
let e = await fails_with(() => db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,2,'photos/'||$1::text||'/v1-abc.jpg','https://x/y',1200,800,120000,'image/jpeg','c')`, [ph]), /unique|duplicate/i);
ok(e && !e.startsWith("INNY"), "druga wersja pod TĄ SAMĄ ścieżką odrzucona (unique storage_path)");
e = await fails_with(() => db.query(`insert into public.marketing_photos (title, alt_pl, alt_en, source_sha256) values ('Dup','a','b',repeat('a',64))`), /unique|duplicate/i);
ok(e && !e.startsWith("INNY"), "duplikat oryginału (source_sha256) odrzucony");
e = await fails_with(() => db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,3,'photos/x/v3.gif','https://x/z',1200,800,120000,'image/gif','d')`, [ph]), /check|mime/i);
ok(e && !e.startsWith("INNY"), "wersja z mime image/gif odrzucona (check)");
e = await fails_with(() => db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,3,'photos/x/v3.jpg','https://x/z',3000,2000,120000,'image/jpeg','d')`, [ph]), /check|width/i);
ok(e && !e.startsWith("INNY"), "wersja 3000 px szeroka odrzucona (check width)");

console.log("2. niezmienność wersji: update/delete zatrzymane triggerem (nawet jako właściciel)");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set public_url = 'https://inny/plik.jpg' where id = $1`, [v1]), /immutable/);
ok(e && !e.startsWith("INNY"), "update wersji → wyjątek immutable");
e = await fails_with(() => db.query(`delete from public.marketing_photo_versions where id = $1`, [v1]), /immutable/);
ok(e && !e.startsWith("INNY"), "delete wersji → wyjątek immutable");
ok((await db.query(`select public_url from public.marketing_photo_versions where id = $1`, [v1])).rows[0].public_url.endsWith("/v1-abc.jpg"), "adres wersji bez zmian");

console.log("3. kampania: kolumny photo_id / photo_version_id / layout_version / frozen_photo; widok użycia");
const camp = (await db.query(`insert into public.marketing_campaigns (name, template_key, created_by, layout_version, photo_id, photo_version_id) values ('Ze zdjęciem', 'credits_no_proposal', $1::uuid, 2, $2::uuid, $3::uuid) returning id, layout_version`, [ADMIN, ph, v1])).rows[0];
ok(camp.layout_version === 2, "layout_version = 2 zapisany");
const old = (await db.query(`insert into public.marketing_campaigns (name, template_key, created_by) values ('Stara', 'start_with_credits', $1) returning layout_version, photo_id, frozen_photo`, [ADMIN])).rows[0];
ok(old.layout_version === 1 && old.photo_id === null && old.frozen_photo === null, "stara kampania: layout_version domyślnie 1, bez zdjęcia");
e = await fails_with(() => db.query(`update public.marketing_campaigns set layout_version = 3 where id = $1`, [camp.id]), /check|layout_version/i);
ok(e && !e.startsWith("INNY"), "layout_version 3 odrzucony (check)");
let usage = (await db.query(`select * from public.marketing_photo_usage where campaign_id = $1`, [camp.id])).rows;
ok(usage.length === 1 && usage[0].photo_id === ph && usage[0].campaign_status === "draft" && usage[0].sent_count === 0, "widok: szkic ze zdjęciem, 0 wysyłek");
await db.query(`update public.marketing_campaigns set status = 'approved', approved_at = now(), frozen_photo = jsonb_build_object('photo_id', $2::text, 'version_id', $3::text, 'url', 'https://x/v1-abc.jpg', 'alt_pl', 'Rozmowy', 'alt_en', 'Talks') where id = $1`, [camp.id, ph, v1]);
await db.query(`insert into public.marketing_messages (campaign_id, company_id, profile_id, to_email, locale, segment, consent_source, subject, html, text_body, payload_hash, idempotency_key, state, sent_at, is_test)
  values ($1::uuid,$2::uuid,$3::uuid,'dostawca@example.invalid','pl','start','regulamin','S','<p>H</p>','T','hash','marketing:'||$1::text||':'||$3::text,'accepted', now(), false),
         ($1::uuid,$2::uuid,null,'test@example.invalid','pl','start','test','S','<p>H</p>','T','hash','marketing-test:'||$1::text,'accepted', now(), true)`, [camp.id, COMPANY, OWNER]);
usage = (await db.query(`select * from public.marketing_photo_usage where campaign_id = $1`, [camp.id])).rows;
ok(usage.length === 1 && usage[0].sent_count === 1 && usage[0].first_sent_at && usage[0].photo_version_id === v1, "widok: 1 prawdziwa wysyłka (test nieliczony), wersja z zamrożenia");
// wyłączenie zdjęcia nie rusza zamrożenia ani wersji
await db.query(`update public.marketing_photos set status = 'disabled', disabled_at = now() where id = $1`, [ph]);
const fz = (await db.query(`select frozen_photo->>'url' as url from public.marketing_campaigns where id = $1`, [camp.id])).rows[0];
ok(fz.url === "https://x/v1-abc.jpg", "wyłączone zdjęcie: zamrożenie kampanii bez zmian");
e = await fails_with(() => db.query(`delete from public.marketing_photos where id = $1`, [ph]), /foreign key|violates|restrict/i);
ok(e && !e.startsWith("INNY"), "zdjęcia z wersjami nie da się skasować (FK restrict)");

console.log("4. uprawnienia");
const can = async (role, sql, params = []) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role ${role};`); try { await db.query(sql, params); await db.exec("reset role"); return true; } catch { await db.exec("reset role"); return false; } };
const asUser = async (sub, sql) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub}', false); set role authenticated;`); try { return (await db.query(sql)).rows[0].n; } finally { await db.exec("reset role"); } };
ok(!(await can("anon", `select * from public.marketing_photos`)), "anon: brak SELECT na marketing_photos");
ok(!(await can("authenticated", `insert into public.marketing_photos (title, alt_pl, alt_en) values ('x','a','b')`)), "authenticated: brak INSERT na marketing_photos");
ok(!(await can("authenticated", `insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,9,'p/9','https://x/9',1200,800,1200,'image/jpeg','z')`, [ph])), "authenticated: brak INSERT na wersje");
ok(!(await can("service_role", `delete from public.marketing_photos where id = $1`, [ph])), "service_role: brak DELETE na marketing_photos");
ok(!(await can("service_role", `update public.marketing_photo_versions set bytes = 1 where id = $1`, [v1])), "service_role: brak UPDATE na wersje");
ok(await can("service_role", `select count(*) from public.marketing_photo_usage`), "service_role: czyta widok użycia");
let rows = await asUser(OWNER, `select count(*)::int as n from public.marketing_photos`);
let viewRows = await asUser(OWNER, `select count(*)::int as n from public.marketing_photo_usage`);
ok(rows === 0 && viewRows === 0, `dostawca przez RLS widzi 0 zdjęć i 0 wierszy widoku (${rows}/${viewRows})`);
rows = await asUser(ADMIN, `select count(*)::int as n from public.marketing_photos`);
viewRows = await asUser(ADMIN, `select count(*)::int as n from public.marketing_photo_usage`);
ok(rows === 1 && viewRows === 1, `admin przez RLS widzi 1 zdjęcie i 1 wiersz widoku (${rows}/${viewRows})`);

console.log("5. bucket marketing-photos: publiczny odczyt, limit 2 MB, bez polityk zapisu");
const bucket = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'marketing-photos'`)).rows[0];
ok(bucket && bucket.public === true && Number(bucket.file_size_limit) === 2097152, "bucket publiczny, 2 MB");
ok(Array.isArray(bucket?.allowed_mime_types) && bucket.allowed_mime_types.join() === "image/jpeg,image/png,image/webp", "mime: jpeg/png/webp");
const pol = (await db.query(`select polname, polcmd from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'marketing_photos_%'`)).rows;
ok(pol.length === 1 && pol[0].polname === "marketing_photos_public_read" && pol[0].polcmd === "r", "jedna polityka storage: tylko SELECT (" + pol.map((p) => p.polname + ":" + p.polcmd).join(",") + ")");

console.log("6. nic nie dotknęło rozliczeń");
const legacy = (await db.query(`select (select count(*) from public.legacy_sends)::int + (select count(*) from public.wallet_tx)::int as n`)).rows[0].n;
ok(legacy === 0, "rejestry legacy puste po całym przebiegu");

console.log(fails ? `\n${fails} FAIL` : "\nWSZYSTKO OK");
process.exit(fails ? 1 : 0);
