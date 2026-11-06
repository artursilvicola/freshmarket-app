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
let twice = null; try { for (const f of ["20261107100000_marketing_photos.sql", "20261107110000_marketing_photo_versions_approval.sql", "20261107120000_marketing_photo_unpublish_state.sql", "20261107130000_marketing_photo_unpublish_locks.sql", "20261107140000_marketing_photo_drop_release.sql", "20261107150000_marketing_photo_unpublish_final.sql", "20261107160000_marketing_suppression_lifts.sql", "20261107170000_marketing_review_fixes.sql"]) await db.exec(patch(read("supabase/migrations/" + f))); } catch (e) { twice = e.message; }
ok(!twice, "druga aplikacja obu migracji zdjęć (w kolejności) bez błędu" + (twice ? ": " + twice : ""));

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
const v1 = (await db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_bucket, storage_path, public_url, width, height, bytes, mime, sha256, created_by) values ($1::uuid,1,'marketing-photos-pending','photos/'||$1::text||'/v1-abc.jpg',null,1200,800,120000,'image/jpeg',repeat('b',64),$2::uuid) returning id`, [ph, ADMIN])).rows[0].id;
ok((await db.query(`select published_at, public_url from public.marketing_photo_versions where id = $1`, [v1])).rows[0].public_url === null, "wersja po wgraniu: prywatny bucket, public_url NULL (review Codexa P1)");
// publikacja = jedyne dozwolone przejście: bucket/ścieżka/adres/published_*
await db.query(`update public.marketing_photo_versions set storage_bucket = 'marketing-photos', public_url = 'https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/'||$1::text||'/v1-abc.jpg', published_at = now(), published_by = $2::uuid where id = $3`, [ph, ADMIN, v1]);
ok((await db.query(`select published_at from public.marketing_photo_versions where id = $1`, [v1])).rows[0].published_at !== null, "publikacja wersji przeszła (pending → published)");
await db.query(`update public.marketing_photos set current_version_id = $2, approved_version_id = $2, status = 'ready', approved_by = $3, approved_at = now() where id = $1`, [ph, v1, ADMIN]);
ok((await db.query(`select approved_version_id from public.marketing_photos where id = $1`, [ph])).rows[0].approved_version_id === v1, "approved_version_id = v1 (zatwierdzenie per wersja, review Codexa P2)");
ok((await db.query(`select current_version_id from public.marketing_photos where id = $1`, [ph])).rows[0].current_version_id === v1, "current_version_id wskazuje na v1");
let e = await fails_with(() => db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,2,'photos/'||$1::text||'/v1-abc.jpg',null,1200,800,120000,'image/jpeg','c')`, [ph]), /unique|duplicate/i);
ok(e && !e.startsWith("INNY"), "druga wersja pod TĄ SAMĄ ścieżką odrzucona (unique storage_path)");
e = await fails_with(() => db.query(`insert into public.marketing_photos (title, alt_pl, alt_en, source_sha256) values ('Dup','a','b',repeat('a',64))`), /unique|duplicate/i);
ok(e && !e.startsWith("INNY"), "duplikat oryginału (source_sha256) odrzucony");
e = await fails_with(() => db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,3,'photos/x/v3.gif',null,1200,800,120000,'image/gif','d')`, [ph]), /check|mime/i);
ok(e && !e.startsWith("INNY"), "wersja z mime image/gif odrzucona (check)");
e = await fails_with(() => db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,3,'photos/x/v3.jpg',null,3000,2000,120000,'image/jpeg','d')`, [ph]), /check|width/i);
e = await fails_with(() => db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,3,'photos/x/v3.jpg','https://x/z',1200,800,120000,'image/jpeg','d')`, [ph]), /check|published/i);
ok(e && !e.startsWith("INNY"), "public_url bez published_at odrzucony (check: adres tylko dla opublikowanej)");
ok(e && !e.startsWith("INNY"), "wersja 3000 px szeroka odrzucona (check width)");

console.log("2. niezmienność wersji: update/delete zatrzymane triggerem (nawet jako właściciel)");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set public_url = 'https://inny/plik.jpg' where id = $1`, [v1]), /immutable/);
ok(e && !e.startsWith("INNY"), "podmiana adresu opublikowanej wersji → wyjątek immutable");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set sha256 = repeat('f',64) where id = $1`, [v1]), /immutable/);
ok(e && !e.startsWith("INNY"), "zmiana sha256 → wyjątek immutable");
// nowy kadr v2 (prywatny) — zatwierdzenie zdjęcia nie przechodzi na niego samo
const v2 = (await db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_bucket, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,2,'marketing-photos-pending','photos/'||$1::text||'/v2-def.jpg',null,1200,800,110000,'image/jpeg',repeat('c',64)) returning id`, [ph])).rows[0].id;
await db.query(`update public.marketing_photos set current_version_id = $2 where id = $1`, [ph, v2]);
const pv = (await db.query(`select approved_version_id, current_version_id, status from public.marketing_photos where id = $1`, [ph])).rows[0];
ok(pv.approved_version_id === v1 && pv.current_version_id === v2 && pv.status === "ready", "nowy kadr v2: current=v2, approved nadal v1, status ready (v1 w rotacji, v2 czeka)");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set published_at = now(), storage_bucket = 'marketing-photos' where id = $1`, [v2]), /https/);
ok(e && !e.startsWith("INNY"), "publikacja bez adresu https odrzucona");
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
// [review Codexa 4] stan wycofywania: zajęcie atomowe tylko dla nieużywanej; blokady przypisań/zatwierdzeń; cofnięcie tylko po zajęciu
const claim = async (id) => (await db.query(`select public.marketing_photo_version_claim_unpublish($1::uuid, $2::uuid) as ok`, [id, ADMIN])).rows[0].ok;
ok((await claim(v1)) === false, "zajęcie stanu dla v1 (użyta przez kampanię + zatwierdzona) → odmowa");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set published_at = null, public_url = null, storage_bucket = 'marketing-photos-pending' where id = $1`, [v1]), /prior claim|referenced/);
ok(e && !e.startsWith("INNY"), "cofnięcie publikacji bez zajęcia stanu → odmowa triggera");
await db.query(`update public.marketing_photo_versions set storage_bucket = 'marketing-photos', public_url = 'https://x/v2-def.jpg', published_at = now() where id = $1`, [v2]);
e = await fails_with(() => db.query(`update public.marketing_photo_versions set published_at = null, public_url = null, storage_bucket = 'marketing-photos-pending' where id = $1`, [v2]), /prior claim/);
ok(e && !e.startsWith("INNY"), "cofnięcie publikacji v2 bez zajęcia → odmowa (wymagany claim)");
ok((await claim(v2)) === true && (await claim(v2)) === true, "zajęcie stanu dla v2 (nieużywana) przechodzi i jest ponawialne");
e = await fails_with(() => db.query(`update public.marketing_campaigns set photo_version_id = $2 where id = $1`, [camp.id, v2]), /being unpublished|not published/);
ok(e && !e.startsWith("INNY"), "przypisanie v2 do kampanii w trakcie wycofywania → odmowa triggera");
e = await fails_with(() => db.query(`update public.marketing_photos set approved_version_id = $2 where id = $1`, [ph, v2]), /being unpublished|must be published/);
ok(e && !e.startsWith("INNY"), "zatwierdzenie v2 w trakcie wycofywania → odmowa triggera");
e = await fails_with(() => db.query(`insert into public.marketing_campaigns (name, template_key, created_by, layout_version, photo_id, photo_version_id) values ('Nowa', 'credits_no_proposal', $1::uuid, 2, $2::uuid, $3::uuid)`, [ADMIN, ph, v2]), /being unpublished|not published/);
ok(e && !e.startsWith("INNY"), "nowa kampania z v2 w trakcie wycofywania → odmowa triggera");
const unpubV = (await db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_bucket, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,3,'marketing-photos-pending','photos/'||$1::text||'/v3-ghi.jpg',null,1200,800,100000,'image/jpeg',repeat('d',64)) returning id`, [ph])).rows[0].id;
e = await fails_with(() => db.query(`update public.marketing_campaigns set photo_version_id = $2 where id = $1`, [camp.id, unpubV]), /not published/);
ok(e && !e.startsWith("INNY"), "przypisanie wersji NIEOPUBLIKOWANEJ do kampanii → odmowa triggera (poziom bazy)");
// [review Codexa 6] ręcznego zwalniania NIE MA: funkcja usunięta, wyzerowanie znacznika odrzucone (nawet jako właściciel), stan kończy tylko wycofanie
ok((await db.query(`select count(*)::int as n from pg_proc where proname = 'marketing_photo_version_release_unpublish'`)).rows[0].n === 0, "funkcja release_unpublish nie istnieje");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set unpublishing_at = null where id = $1`, [v2]), /no manual release/);
ok(e && !e.startsWith("INNY"), "wyzerowanie unpublishing_at bez dokończenia wycofania → odmowa triggera");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set unpublishing_at = now() - interval '1 day' where id = $1`, [v2]), /cannot be changed/);
ok(e && !e.startsWith("INNY"), "zmiana ustawionego unpublishing_at → odmowa triggera");
await db.query(`update public.marketing_photo_versions set published_at = null, public_url = null, storage_bucket = 'marketing-photos-pending' where id = $1`, [v2]);
const v2row = (await db.query(`select public_url, unpublishing_at, unpublished_at from public.marketing_photo_versions where id = $1`, [v2])).rows[0];
ok(v2row.public_url === null && v2row.unpublishing_at === null && v2row.unpublished_at !== null, "cofnięcie publikacji nieużywanej, zajętej wersji przeszło; stan zakończony, TRWAŁY znacznik unpublished_at");
// [nieodwracalność] ponowna publikacja tej samej wersji → odmowa; znacznik nie do wyzerowania; claim = false; nowa wersja z nową ścieżką OK
e = await fails_with(() => db.query(`update public.marketing_photo_versions set storage_bucket = 'marketing-photos', public_url = 'https://x/v2-def.jpg', published_at = now() where id = $1`, [v2]), /cannot be published again/);
ok(e && !e.startsWith("INNY"), "ponowna publikacja wycofanej wersji → odmowa triggera (nieodwracalne)");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set unpublished_at = null where id = $1`, [v2]), /permanent/);
ok(e && !e.startsWith("INNY"), "wyzerowanie unpublished_at → odmowa (trwałe)");
e = await fails_with(() => db.query(`update public.marketing_photo_versions set unpublished_at = now() where id = $1`, [v1]), /set only by completing/);
ok(e && !e.startsWith("INNY"), "ręczne ustawienie unpublished_at na opublikowanej → odmowa");
ok((await claim(v2)) === false, "zajęcie wycofanej wersji → false (nic do zrobienia)");
e = await fails_with(() => db.query(`update public.marketing_campaigns set photo_version_id = $2 where id = $1`, [camp.id, v2]), /not published/);
ok(e && !e.startsWith("INNY"), "przypisanie wycofanej wersji do kampanii → odmowa");
const v4 = (await db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_bucket, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,4,'marketing-photos-pending','photos/'||$1::text||'/v4-new.jpg',null,1200,800,100000,'image/jpeg',repeat('e',64)) returning id`, [ph])).rows[0].id;
await db.query(`update public.marketing_photo_versions set storage_bucket = 'marketing-photos', public_url = 'https://x/v4-new.jpg', published_at = now() where id = $1`, [v4]);
ok((await db.query(`select published_at from public.marketing_photo_versions where id = $1`, [v4])).rows[0].published_at !== null, "ponowne użycie zdjęcia = NOWA wersja z nową ścieżką publikuje się normalnie");
// wyścig po przypisaniu: v3 (świeżo opublikowana logicznie) przypisana do kampanii → zajęcie odmówione; po zdjęciu → przechodzi
const v3 = unpubV;
await db.query(`update public.marketing_photo_versions set storage_bucket = 'marketing-photos', public_url = 'https://x/v3-ghi.jpg', published_at = now() where id = $1`, [v3]);
await db.query(`update public.marketing_campaigns set photo_version_id = $2 where id = $1`, [camp.id, v3]);
ok((await claim(v3)) === false, "po przypisaniu v3 do kampanii zajęcie → odmowa (wyścig zamknięty w bazie)");
await db.query(`update public.marketing_campaigns set photo_version_id = $2 where id = $1`, [camp.id, v1]);
ok((await claim(v3)) === true, "po zdjęciu przypisania zajęcie v3 przechodzi");

console.log("4. uprawnienia");
const can = async (role, sql, params = []) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role ${role};`); try { await db.query(sql, params); await db.exec("reset role"); return true; } catch { await db.exec("reset role"); return false; } };
const asUser = async (sub, sql) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub}', false); set role authenticated;`); try { return (await db.query(sql)).rows[0].n; } finally { await db.exec("reset role"); } };
ok(!(await can("anon", `select * from public.marketing_photos`)), "anon: brak SELECT na marketing_photos");
ok(!(await can("authenticated", `insert into public.marketing_photos (title, alt_pl, alt_en) values ('x','a','b')`)), "authenticated: brak INSERT na marketing_photos");
ok(!(await can("authenticated", `insert into public.marketing_photo_versions (photo_id, version_no, storage_path, public_url, width, height, bytes, mime, sha256) values ($1::uuid,9,'p/9','https://x/9',1200,800,1200,'image/jpeg','z')`, [ph])), "authenticated: brak INSERT na wersje");
ok(!(await can("service_role", `delete from public.marketing_photos where id = $1`, [ph])), "service_role: brak DELETE na marketing_photos");
ok(!(await can("service_role", `update public.marketing_photo_versions set bytes = 1 where id = $1`, [v1])), "service_role: brak UPDATE kolumn pliku w wersjach");
ok(!(await can("service_role", `delete from public.marketing_photo_versions where id = $1`, [v1])), "service_role: brak DELETE na wersje");
ok(!(await can("authenticated", `select public.marketing_photo_version_claim_unpublish($1::uuid, null)`, [v1])), "authenticated: brak EXECUTE na claim_unpublish");
ok(!(await can("service_role", `update public.marketing_photo_versions set unpublishing_at = null where id = $1`, [v2])), "service_role: brak UPDATE na unpublishing_at");
ok(await can("service_role", `select public.marketing_photo_version_claim_unpublish($1::uuid, null)`, [v1]), "service_role: EXECUTE na claim_unpublish");
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
const pol = (await db.query(`select polname, polcmd from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'marketing_photos%'`)).rows;
ok(pol.length === 1 && pol[0].polname === "marketing_photos_public_read" && pol[0].polcmd === "r", "jedna polityka storage: tylko SELECT na publicznym (" + pol.map((p) => p.polname + ":" + p.polcmd).join(",") + ")");
const pend = (await db.query(`select public from storage.buckets where id = 'marketing-photos-pending'`)).rows[0];
ok(pend && pend.public === false, "bucket marketing-photos-pending PRYWATNY i bez żadnej polityki (tylko service_role)");

console.log("6. nic nie dotknęło rozliczeń");
const legacy = (await db.query(`select (select count(*) from public.legacy_sends)::int + (select count(*) from public.wallet_tx)::int as n`)).rows[0].n;
ok(legacy === 0, "rejestry legacy puste po całym przebiegu");

console.log(fails ? `\n${fails} FAIL` : "\nWSZYSTKO OK");
process.exit(fails ? 1 : 0);
