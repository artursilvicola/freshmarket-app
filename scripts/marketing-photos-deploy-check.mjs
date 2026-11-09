#!/usr/bin/env node
// [feat/marketing-photos] Lokalna próba pakietu wdrożeniowego na PGlite (review Codexa 07.11): schemat SPRZED migracji zdjęć
// z danymi jak na produkcji → kontrola „przed” → plik łączony → kontrola „po” (dane bez zmian) → drugi Run pliku → reaktywacja
// kont próbnych (bez zgody = bez zmian; ze zgodą historia wypisu zostaje) → sprzątanie po próbie.
//
//   PGLITE_PATH=<...>/@electric-sql/pglite/dist/index.js node scripts/marketing-photos-deploy-check.mjs [--write]
//
// --write składa docs/production/wdrozenie-marketing-zdjecia-2026-11-07/04-migracje-razem.sql z plików migracji.
// Bez PGLITE_PATH kończy się kodem 2 — nie udaje, że przeszedł.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const PKG = "docs/production/wdrozenie-marketing-zdjecia-2026-11-07/";
const FIRST = "20261107100000";
// Pakiet wdrożony 07.11 jest zamknięty: późniejsze migracje (np. 20261109 Aktywność) mają własne pakiety.
const LAST = "20261107170000_marketing_review_fixes.sql";
const all = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const before = all.filter((f) => f < FIRST), deploy = all.filter((f) => f >= FIRST && f <= LAST);
const combined = [
  `-- Wdrożenie mail v2 + biblioteka zdjęć: ${deploy.length} migracji w kolejności, każda we własnej transakcji (begin/commit z pliku).`,
  "-- Złożone 1:1 z supabase/migrations/ (scripts/marketing-photos-deploy-check.mjs --write). Tylko projekt sklyfuvzjikkqerxtulo, jeden Run.",
  ...deploy.flatMap((f) => ["", `-- ===== PLIK: ${f} =====`, read("supabase/migrations/" + f).replace(/\r/g, "").trimEnd()]),
  "",
].join("\n");
if (process.argv.includes("--write")) { writeFileSync(path.join(root, PKG + "04-migracje-razem.sql"), combined); console.log(`zapisano plik łączony: ${deploy.length} migracji`); }

const PGLITE_PATH = process.env.PGLITE_PATH;
if (!PGLITE_PATH) { console.error("Brak PGLITE_PATH — nie uruchomiono."); process.exit(2); }
const patch = (sql) => sql
  .replace(/create extension if not exists "?uuid-ossp"?\s*;/gi, "create or replace function public.uuid_generate_v4() returns uuid language sql as $uu$ select gen_random_uuid() $uu$;")
  .replace(/create extension if not exists "?pgcrypto"?\s*;/gi, "")
  .replace(/create extension if not exists "?pg_trgm"?\s*;/gi, "")
  .replace(/create extension if not exists "?citext"?\s*;/gi, "");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
const db = new PGlite();
await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
for (const f of before) { try { await db.exec(patch(read("supabase/migrations/" + f))); } catch (e) { console.error("migracja padła:", f, e.message); process.exit(1); } }
console.log(`schemat sprzed wdrożenia: ${before.length} migracji; do wdrożenia: ${deploy.length}`);
ok(read(PKG + "04-migracje-razem.sql").replace(/\r/g, "") === combined, "04-migracje-razem.sql jest zgodny 1:1 z plikami migracji");

// ── dane jak na produkcji: stara kampania, wiadomość, wypisy i dwa zawieszone konta próbne ──
const U1 = "d0ffee00-0000-4000-8000-000000000001", U2 = "d0ffee00-0000-4000-8000-000000000002", C1 = "c0ffee00-0000-4000-8000-000000000001", C2 = "c0ffee00-0000-4000-8000-000000000002";
const M1 = "spiker.artur@gmail.com", M2 = "artur.silvicola@gmail.com";
await db.exec(`
  insert into auth.users (id, email) values ('${U1}','${M1}'), ('${U2}','${M2}');
  insert into public.companies (id, name, legacy_supplier_id, country, account_status, preconnect_enabled) values
    ('${C1}','Próba marketingu PL (Artur)','prob-1','PL','suspended',false), ('${C2}','Marketing trial EN (Artur)','prob-2','NL','suspended',false);
  insert into public.profiles (id, role, name, email, active, company_id) values
    ('${U1}','supplier','PL','${M1}',false,'${C1}'), ('${U2}','supplier','EN','${M2}',false,'${C2}')
  on conflict (id) do update set role = excluded.role, email = excluded.email, company_id = excluded.company_id, active = false;
`);
const camp = (await db.query(`insert into public.marketing_campaigns (name, template_key, created_by) values ('Próba poczty 06.11', 'selected_companies', '${U1}') returning id`)).rows[0].id;
await db.query(`insert into public.marketing_messages (campaign_id, company_id, profile_id, to_email, locale, segment, consent_source, subject, html, text_body, payload_hash, idempotency_key, state)
  values ($1::uuid,'${C1}','${U1}','${M1}','pl','start','regulamin','S','<p>STARY HTML</p>','T','hash','marketing:'||$1::text||':p','accepted')`, [camp]);
await db.exec(`insert into public.marketing_suppressions (email, reason, source) values ('${M1}','unsubscribe','one-click'), ('${M2}','unsubscribe','strona'), ('odbity@example.invalid','bounce','resend:email.bounced');`);

const control = async () => (await db.query(read(PKG + "01-kontrola-migracji.sql"))).rows;
console.log("1. kontrola PRZED na schemacie sprzed migracji");
const pre = await control();
for (const r of pre) if (r.przed_migracja !== "zapisz") ok(r.jest === r.przed_migracja, `${r.co} = ${r.jest} (przed: ${r.przed_migracja})`);
const count = (rows, co) => rows.find((r) => r.co.startsWith(co)).jest;
const counts = (rows) => ["kampanie razem", "wiadomości razem", "wypisy razem"].map((c) => count(rows, c)).join("/");
ok(counts(pre) === "1/1/3", `liczby przed: ${counts(pre)}`);

console.log("2. plik łączony, kontrola PO");
await db.exec(patch(combined));
const post = await control();
for (const r of post) if (r.po_migracji !== "jak przed") ok(r.jest === r.po_migracji, `${r.co} = ${r.jest} (po: ${r.po_migracji})`);
ok(counts(post) === counts(pre), `liczby bez zmian: ${counts(post)}`);
const old = (await db.query(`select layout_version, photo_id from public.marketing_campaigns where id = $1`, [camp])).rows[0];
ok(old.layout_version === 1 && old.photo_id === null, "istniejąca kampania: układ 1, bez zdjęcia (stary szablon)");
ok((await db.query(`select html from public.marketing_messages where campaign_id = $1`, [camp])).rows[0].html === "<p>STARY HTML</p>", "treść wysłanej wiadomości bez zmian");

console.log("3. drugi Run pliku (po przerwanym wdrożeniu)");
let again = null; try { await db.exec(patch(combined)); } catch (e) { again = e.message; }
ok(!again, "drugi Run bez błędu" + (again ? ": " + again : ""));

console.log("3b. usunięcie profilu autora zdjęcia i kontrola importu");
const AUTHOR = "e0ffee00-0000-4000-8000-000000000001";
await db.exec(`insert into auth.users (id, email) values ('${AUTHOR}','autor@example.invalid');
  insert into public.profiles (id, role, name, email, active) values ('${AUTHOR}','admin','Autor','autor@example.invalid',true) on conflict (id) do nothing;`);
const ph = (await db.query(`insert into public.marketing_photos (title, alt_pl, alt_en, status, created_by) values ('Kontrola','a','b','pending',$1) returning id`, [AUTHOR])).rows[0].id;
const vv = (await db.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_bucket, storage_path, public_url, published_at, published_by, width, height, bytes, mime, sha256, created_by) values ($1::uuid,1,'marketing-photos','photos/k/v1.png','https://x/k.png',now(),$2::uuid,600,400,120000,'image/png',repeat('a',64),$2::uuid) returning id`, [ph, AUTHOR])).rows[0].id;
const imp = (await db.query(read(PKG + "01b-kontrola-po-imporcie.sql"))).rows[0];
ok(Number(imp.niezgodne_wersje) === 1, "kontrola po imporcie wyłapuje PNG 600×400: niezgodne_wersje = " + imp.niezgodne_wersje);
await db.exec(`delete from public.profiles where id = '${AUTHOR}'`);
const av = (await db.query(`select created_by, published_by, public_url from public.marketing_photo_versions where id = $1`, [vv])).rows[0];
ok(av.created_by === null && av.published_by === null && av.public_url === "https://x/k.png", "usunięcie profilu autora: odwołania wyzerowane, adres pliku bez zmian");
const zmiana = await (async () => { try { await db.query(`update public.marketing_photo_versions set created_by = $1 where id = $2`, [U1, vv]); return null; } catch (x) { return x.message; } })();
ok(zmiana && /immutable/.test(zmiana), "podmiana autora na inną osobę → odmowa triggera");

console.log("4. ochrona wypisów");
const fails_with = async (sql, rx) => { try { await db.exec(sql); return null; } catch (e) { await db.exec("rollback").catch(() => {}); return rx.test(e.message) ? e.message : "INNY BŁĄD: " + e.message; } };
let e = await fails_with(`delete from public.marketing_suppressions where email = '${M1}'`, /recorded consent/);
ok(e && !e.startsWith("INNY"), "usunięcie wypisu bez zapisanej zgody → odmowa triggera");
e = await fails_with(`select public.marketing_lift_suppression('odbity@example.invalid','zgoda testowa na odbicie','czat','Ktoś')`, /only an unsubscribe/);
ok(e && !e.startsWith("INNY"), "odbicia nie da się znieść");
e = await fails_with(`select public.marketing_lift_suppression('${M1}','krótko','czat','Ktoś')`, /check|consent_text/);
ok(e && !e.startsWith("INNY"), "zgoda bez treści → odmowa");
ok((await db.query(`select count(*)::int as n from public.marketing_suppressions`)).rows[0].n === 3, "po odmowach wszystkie 3 wypisy na miejscu");
const canRole = async (role, sql) => { await db.exec(`reset role; set role ${role};`); try { await db.query(sql); await db.exec("reset role"); return true; } catch { await db.exec("reset role"); return false; } };
ok(!(await canRole("service_role", `select public.marketing_lift_suppression('${M1}','zgoda testowa długa','czat','Ktoś')`)), "service_role nie zniesie wypisu (tylko SQL Editor Artura)");
ok(!(await canRole("authenticated", `select public.marketing_lift_suppression('${M1}','zgoda testowa długa','czat','Ktoś')`)), "authenticated nie zniesie wypisu");
ok(!(await canRole("service_role", `insert into public.marketing_suppression_lifts (email, suppression, consent_text, consent_source, consent_given_by) values ('a@b.c','{}','zgoda testowa długa','czat','Ktoś')`)), "service_role nie dopisze zgody do rejestru");

console.log("5. reaktywacja: bez potwierdzonej zgody nic się nie zmienia");
const script = read(PKG + "02-konta-probne-reaktywacja.sql");
const state = async () => (await db.query(`select p.active, c.account_status, c.preconnect_enabled from public.profiles p join public.companies c on c.id = p.company_id where p.id = '${U1}'`)).rows[0];
e = await fails_with(script, /BRAK POTWIERDZONEJ ZGODY/);
ok(e && !e.startsWith("INNY"), "plik w repo (flaga false) → przerwanie");
ok((await state()).active === false, "konto nadal zawieszone");
e = await fails_with(script.replace("v_consent_confirmed boolean := false", "v_consent_confirmed boolean := true"), /BRAK ŹRÓDŁA ZGODY/);
ok(e && !e.startsWith("INNY"), "zgoda bez uzupełnionego źródła → przerwanie");
ok((await db.query(`select count(*)::int as n from public.marketing_suppression_lifts`)).rows[0].n === 0, "rejestr zgód pusty");
const ready = script.replace("v_consent_confirmed boolean := false", "v_consent_confirmed boolean := true").replace("UZUPEŁNIĆ: czat Claude Code, data i godzina zgody", "czat Claude Code, próba lokalna");

console.log("6. reaktywacja ze zgodą: konflikt tożsamości przerywa, potem przechodzi z historią");
await db.exec(`update public.companies set name = 'Inna nazwa' where id = '${C2}'`);
e = await fails_with(ready, /KONFLIKT/);
ok(e && !e.startsWith("INNY"), "zła nazwa firmy → przerwanie bez zmian");
ok((await state()).active === false, "po konflikcie konto nadal zawieszone");
await db.exec(`update public.companies set name = 'Marketing trial EN (Artur)' where id = '${C2}'`);
await db.exec(ready);
const s = await state();
ok(s.active === true && s.account_status === "active" && s.preconnect_enabled === true, "konto aktywne po zgodzie");
const left = (await db.query(`select email from public.marketing_suppressions order by email`)).rows.map((r) => r.email);
ok(left.length === 1 && left[0] === "odbity@example.invalid", "zniesione tylko 2 adresy próbne, odbicie zostało: " + left.join(","));
const lifts = (await db.query(`select email, suppression, consent_text, consent_given_by from public.marketing_suppression_lifts order by email`)).rows;
ok(lifts.length === 2 && lifts[1].suppression.source === "one-click" && lifts[1].suppression.reason === "unsubscribe", "historia: kopia pierwotnego wypisu zachowana");
ok(lifts.every((l) => l.consent_text.startsWith("Zgadzam się ponownie otrzymać testowe maile")), "historia: dosłowna treść zgody zapisana");
e = await fails_with(`delete from public.marketing_suppression_lifts`, /append-only/);
ok(e && !e.startsWith("INNY"), "rejestr zgód nie do usunięcia");
e = await fails_with(`update public.marketing_suppression_lifts set consent_text = 'zmieniona treść zgody'`, /append-only/);
ok(e && !e.startsWith("INNY"), "rejestr zgód nie do zmiany");

console.log("7. kolejny wypis i sprzątanie po próbie");
await db.exec(`select public.marketing_suppress_email('${M1}', 'unsubscribe', 'one-click')`);
ok((await db.query(`select count(*)::int as n from public.marketing_suppressions where email = '${M1}'`)).rows[0].n === 1, "ponowny wypis działa jak dotąd");
e = await fails_with(`delete from public.marketing_suppressions where email = '${M1}'`, /recorded consent/);
ok(e && !e.startsWith("INNY"), "stara zgoda nie obejmuje nowego wypisu");
const stara = lifts[0]; // adres EN: wypis zniesiony wyżej, zgoda w historii
await db.query(`insert into public.marketing_suppressions (email, reason, source, created_at) values ($1, 'bounce', 'odtworzony', ($2::jsonb->>'created_at')::timestamptz)`, [stara.email, JSON.stringify(stara.suppression)]);
e = await fails_with(`delete from public.marketing_suppressions where email = '${stara.email}'`, /recorded consent/);
ok(e && !e.startsWith("INNY"), "wypis odtworzony z tą samą datą jako bounce → stara zgoda go nie usunie");
await db.exec(`update public.marketing_suppressions set reason = 'unsubscribe', source = '${stara.suppression.source}' where email = '${stara.email}'`);
e = await fails_with(`delete from public.marketing_suppressions where email = '${stara.email}'`, /recorded consent/);
ok(e && !e.startsWith("INNY"), "ten sam wiersz co w historii, ale bez nowej zgody w transakcji → odmowa");
await db.exec(`select public.marketing_lift_suppression('${stara.email}','Nowa zgoda na ponowny test','czat, próba lokalna','Artur Stasiak')`);
ok((await db.query(`select count(*)::int as n from public.marketing_suppressions where email = $1`, [stara.email])).rows[0].n === 0, "nowa zgoda w funkcji znosi wypis");
ok((await db.query(`select count(*)::int as n from public.marketing_suppression_lifts where email = $1`, [stara.email])).rows[0].n === 2, "historia ma oba zniesienia tego adresu");
await db.exec(read(PKG + "03-po-probie.sql"));
ok((await state()).active === false, "03-po-probie: konta znów zawieszone");

console.log(fails ? `\n${fails} FAIL` : "\nWSZYSTKO OK");
process.exit(fails ? 1 : 0);
