#!/usr/bin/env node
// [feat/marketing-photos] Wyścig DWÓCH NIEZALEŻNYCH transakcji na PRAWDZIWYM Postgresie bazy testowej (review Codexa P1, 7fa031f):
// zajęcie wersji do wycofania vs. przypisanie tej wersji do kampanii / zatwierdzenie jej jako approved_version_id.
// Oczekiwanie: nigdy nie przechodzą obie. Dwa połączenia `pg`, BEGIN w obu, celowe przeplatanie z czekaniem na blokadzie.
//
//   node scripts/marketing-photos-race-test.mjs      (czyta .env.test: TEST_DATABASE_URL; odmowa dla produkcji)
//
// Dane: własne wiersze „ZZZ TEST wyścig” (zdjęcie + wersja v1 opublikowana logicznie, bez pliku — test blokad bazy, nie Storage,
// + kampania). Wersji nie da się usunąć (niezmienność), więc rzędy zostają: zdjęcie disabled, kampania closed, bez pliku w Storage.
// Kod wyjścia: 0 OK, 1 FAIL, 2 brak .env.test, 3 odmowa (produkcja).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { parseDotenv, validateTestEnv, dbUrlRef, PROD_REF } from "./lib/test-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const file = path.join(root, ".env.test");
if (!existsSync(file)) { console.error("Brak .env.test"); process.exit(2); }
const env = parseDotenv(readFileSync(file, "utf8"));
const chk = validateTestEnv(env);
if (!chk.ok) { console.error("ODMOWA (.env.test):\n - " + chk.errors.join("\n - ")); process.exit(3); }
const url = env.TEST_DATABASE_URL;
if (url.includes(PROD_REF) || !dbUrlRef(url)) { console.error("ODMOWA: TEST_DATABASE_URL nieprawidłowy albo produkcyjny."); process.exit(3); }

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const mk = async () => { const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } }); await c.connect(); await c.query("set statement_timeout = '20s'; set lock_timeout = '15s'"); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errOf = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

const A = await mk(), B = await mk(), S = await mk(); // S = setup/porządki (autocommit)
try {
  const who = await S.query("select current_database() as db, version() as v");
  console.log(`połączono: db=${who.rows[0].db} (${String(who.rows[0].v).slice(0, 28)}) ref=${dbUrlRef(url)} — 3 połączenia`);
  const admin = (await S.query(`select id from public.profiles where role = 'admin' order by created_at limit 1`)).rows[0]?.id || null;

  // ── dane testowe (idempotentne po source_sha256) ──────────────────────────
  const SHA = "f".repeat(60) + "race";
  let photo = (await S.query(`select id from public.marketing_photos where source_sha256 = $1`, [SHA])).rows[0]?.id;
  if (!photo) photo = (await S.query(`insert into public.marketing_photos (title, alt_pl, alt_en, status, source_sha256, review_note, created_by) values ('ZZZ TEST wyścig blokad', 'test', 'test', 'pending', $1, 'wiersz testu wyścigu transakcji (scripts/marketing-photos-race-test.mjs) — bez pliku w Storage', $2) returning id`, [SHA, admin])).rows[0].id;
  let v = (await S.query(`select * from public.marketing_photo_versions where photo_id = $1 and published_at is not null and unpublished_at is null order by version_no desc limit 1`, [photo])).rows[0];
  if (!v) v = (await S.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_bucket, storage_path, public_url, width, height, bytes, mime, sha256, published_at, created_by) values ($1::uuid, (select coalesce(max(version_no), 0) + 1 from public.marketing_photo_versions where photo_id = $1::uuid), 'marketing-photos', 'photos/'||$1::text||'/v'||(select coalesce(max(version_no), 0) + 1 from public.marketing_photo_versions where photo_id = $1::uuid)||'-race.jpg', 'https://race.invalid/'||$1::text||'/v-race.jpg', 1200, 800, 100000, 'image/jpeg', md5(random()::text) || md5(random()::text), now(), $3::uuid) returning *`, [photo, null, admin])).rows[0];
  // stan wyjściowy: opublikowana, niezajęta, nieprzypisana, niezatwierdzona. Ręcznego zwalniania NIE MA (review Codexa 6):
  // zajęty stan kończy tylko dokończone wycofanie (published_at → NULL), więc reset = wycofanie + ponowna publikacja (wiersz logiczny bez pliku)
  // wycofanie jest NIEODWRACALNE: zajęta wersja zostaje wycofana (trwały znacznik), a kolejny scenariusz dostaje NOWĄ wersję z nową ścieżką
  const resetVersion = async () => {
    await S.query(`update public.marketing_campaigns set photo_version_id = null, photo_id = null where photo_version_id = $1::uuid`, [v.id]);
    await S.query(`update public.marketing_photos set approved_version_id = null where approved_version_id = $1::uuid`, [v.id]);
    const cur = (await S.query(`select published_at, unpublishing_at from public.marketing_photo_versions where id = $1::uuid`, [v.id])).rows[0];
    if (cur.unpublishing_at) await S.query(`update public.marketing_photo_versions set published_at = null, public_url = null, storage_bucket = 'marketing-photos-pending' where id = $1::uuid`, [v.id]);
    const now = (await S.query(`select published_at, unpublished_at from public.marketing_photo_versions where id = $1::uuid`, [v.id])).rows[0];
    if (!now.published_at) {
      const back = await errOf(S.query(`update public.marketing_photo_versions set published_at = now(), public_url = 'https://race.invalid/x.jpg', storage_bucket = 'marketing-photos' where id = $1::uuid`, [v.id]));
      ok(back && /cannot be published again/.test(back), "wycofana wersja NIE wraca do publikacji (trigger): " + (back || "BRAK BŁĘDU"));
      v = (await S.query(`insert into public.marketing_photo_versions (photo_id, version_no, storage_bucket, storage_path, public_url, width, height, bytes, mime, sha256, published_at, created_by) values ($1::uuid, (select coalesce(max(version_no), 0) + 1 from public.marketing_photo_versions where photo_id = $1::uuid), 'marketing-photos', 'photos/'||$1::text||'/v'||(select coalesce(max(version_no), 0) + 1 from public.marketing_photo_versions where photo_id = $1::uuid)||'-race.jpg', 'https://race.invalid/'||$1::text||'/v-race.jpg', 1200, 800, 100000, 'image/jpeg', md5(random()::text) || md5(random()::text), now(), $2::uuid) returning *`, [photo, admin])).rows[0];
      await S.query(`update public.marketing_photos set current_version_id = $2 where id = $1`, [photo, v.id]);
    }
  };
  await resetVersion();
  await S.query(`update public.marketing_photos set current_version_id = $2, status = 'pending' where id = $1`, [photo, v.id]);
  // baza nadaje kampaniom własną nazwę (Grupa | #N | data), więc wiersz testowy rozpoznajemy po needs_note — jeden na bazę, nie jeden na przebieg
  let camp = (await S.query(`select id from public.marketing_campaigns where needs_note = 'ZZZ TEST wyścig blokad' order by created_at limit 1`)).rows[0]?.id;
  if (!camp) camp = (await S.query(`insert into public.marketing_campaigns (name, template_key, created_by, layout_version, status, needs_note) values ('ZZZ TEST wyścig blokad', 'selected_companies', $1, 2, 'draft', 'ZZZ TEST wyścig blokad') returning id`, [admin])).rows[0].id;
  await S.query(`update public.marketing_campaigns set status = 'draft', photo_version_id = null, frozen_photo = null where id = $1`, [camp]);
  const state = async () => (await S.query(`select (select unpublishing_at is not null from public.marketing_photo_versions where id = $1::uuid) as claimed, (select photo_version_id = $1::uuid from public.marketing_campaigns where id = $2::uuid) as assigned, (select approved_version_id = $1::uuid from public.marketing_photos where id = $3::uuid) as approved`, [v.id, camp, photo])).rows[0];

  // ── scenariusz 1: zajęcie trwa (A nie zatwierdzone), B próbuje przypisać → B czeka na blokadzie, po COMMIT A dostaje odmowę ──
  console.log("1. A zajmuje (bez commitu) → B przypisuje → B czeka → A commit → B odrzucone");
  await A.query("begin");
  const claim1 = (await A.query(`select public.marketing_photo_version_claim_unpublish($1, null) as ok`, [v.id])).rows[0].ok;
  ok(claim1 === true, "A: zajęcie przeszło w otwartej transakcji");
  await B.query("begin");
  let bDone = false;
  const bP = errOf(B.query(`update public.marketing_campaigns set photo_id = $2, photo_version_id = $1 where id = $3`, [v.id, photo, camp])).then((e) => { bDone = true; return e; });
  await sleep(1500);
  ok(bDone === false, "B: przypisanie CZEKA na blokadzie wiersza wersji (nie przeszło równolegle)");
  await A.query("commit");
  const bErr = await bP;
  ok(bErr && /being unpublished|not published/.test(bErr), "B: po commicie A przypisanie ODRZUCONE przez strażnika: " + (bErr || "BRAK BŁĘDU"));
  await errOf(B.query("rollback"));
  let s = await state();
  ok(s.claimed === true && !s.assigned, `stan: zajęte=${s.claimed}, przypisane=${s.assigned}`);
  await resetVersion();

  // ── scenariusz 2: przypisanie trwa (B nie zatwierdzone), A próbuje zająć → A czeka → B commit → A dostaje false ──
  console.log("2. B przypisuje (bez commitu) → A zajmuje → A czeka → B commit → A = false");
  await B.query("begin");
  await B.query(`update public.marketing_campaigns set photo_id = $2, photo_version_id = $1 where id = $3`, [v.id, photo, camp]);
  await A.query("begin");
  let aDone = false;
  const aP = A.query(`select public.marketing_photo_version_claim_unpublish($1, null) as ok`, [v.id]).then((r) => { aDone = true; return r.rows[0].ok; }, (e) => { aDone = true; return "ERR " + e.message; });
  await sleep(1500);
  ok(aDone === false, "A: zajęcie CZEKA na blokadzie współdzielonej przypisania");
  await B.query("commit");
  const aRes = await aP;
  ok(aRes === false, "A: po commicie B zajęcie zwraca false (widzi przypisanie po uzyskaniu blokady): " + String(aRes));
  await A.query("commit");
  s = await state();
  ok(s.assigned === true && s.claimed === false, `stan: przypisane=${s.assigned}, zajęte=${s.claimed}`);
  await resetVersion();

  // ── scenariusz 3: zajęcie trwa, B próbuje ZATWIERDZIĆ wersję (approved_version_id) → czeka → odrzucone ──
  console.log("3. A zajmuje (bez commitu) → B zatwierdza wersję → B czeka → A commit → B odrzucone");
  await A.query("begin");
  ok((await A.query(`select public.marketing_photo_version_claim_unpublish($1, null) as ok`, [v.id])).rows[0].ok === true, "A: zajęcie przeszło");
  await B.query("begin");
  let b3Done = false;
  const b3P = errOf(B.query(`update public.marketing_photos set approved_version_id = $1, status = 'ready' where id = $2`, [v.id, photo])).then((e) => { b3Done = true; return e; });
  await sleep(1500);
  ok(b3Done === false, "B: zatwierdzenie CZEKA na blokadzie");
  await A.query("commit");
  const b3Err = await b3P;
  ok(b3Err && /being unpublished|must be published/.test(b3Err), "B: zatwierdzenie ODRZUCONE: " + (b3Err || "BRAK BŁĘDU"));
  await errOf(B.query("rollback"));
  s = await state();
  ok(s.claimed === true && !s.approved, `stan: zajęte=${s.claimed}, zatwierdzone=${s.approved}`);
  await resetVersion();

  // ── scenariusz 4: zatwierdzenie trwa (B), A zajmuje → czeka → B commit → A = false ──
  console.log("4. B zatwierdza (bez commitu) → A zajmuje → A czeka → B commit → A = false");
  await B.query("begin");
  await B.query(`update public.marketing_photos set approved_version_id = $1, status = 'ready' where id = $2`, [v.id, photo]);
  await A.query("begin");
  let a4Done = false;
  const a4P = A.query(`select public.marketing_photo_version_claim_unpublish($1, null) as ok`, [v.id]).then((r) => { a4Done = true; return r.rows[0].ok; }, (e) => { a4Done = true; return "ERR " + e.message; });
  await sleep(1500);
  ok(a4Done === false, "A: zajęcie CZEKA");
  await B.query("commit");
  ok((await a4P) === false, "A: po commicie B zajęcie = false (wersja zatwierdzona)");
  await A.query("commit");

  // ── scenariusz 5: dwa równoległe zajęcia tej samej wersji → oba true (ponawialność), bez zakleszczenia ──
  console.log("5. A i B zajmują równolegle → oba true, drugie czeka na pierwsze");
  await resetVersion(); await S.query(`update public.marketing_photos set status = 'pending' where id = $1`, [photo]);
  await A.query("begin"); await B.query("begin");
  const c1 = (await A.query(`select public.marketing_photo_version_claim_unpublish($1, null) as ok`, [v.id])).rows[0].ok;
  let c2done = false; const c2P = B.query(`select public.marketing_photo_version_claim_unpublish($1, null) as ok`, [v.id]).then((r) => { c2done = true; return r.rows[0].ok; });
  await sleep(1000);
  ok(c1 === true && c2done === false, "A: true; B czeka");
  await A.query("commit");
  ok((await c2P) === true, "B: po commicie A też true (ponowne zajęcie = sukces)");
  await B.query("commit");
  await resetVersion();
} catch (e) {
  fails++; console.error("STOP: nieoczekiwany błąd:", e?.message || e);
} finally {
  for (const c of [A, B]) { await errOf(c.query("rollback")); }
  // porządki: wiersze zostają (wersji nie da się usunąć), ale w stanie nieszkodliwym
  await errOf(S.query(`update public.marketing_campaigns set photo_version_id = null, photo_id = null, status = 'closed', closed_at = now() where needs_note = 'ZZZ TEST wyścig blokad' or name like 'ZZZ TEST wyścig%'`));
  await errOf(S.query(`update public.marketing_photos set approved_version_id = null, status = 'disabled', disabled_at = now() where title = 'ZZZ TEST wyścig blokad'`));
  // WSZYSTKIE wersje testowe kończą jako WYCOFANE (wiersze logiczne bez pliku; zajęcie w bazie, potem dokończenie) — skrypt porządkowy
  // nie ma potem nic do roboty, a wycofanie jest nieodwracalne, więc kolejny przebieg zakłada nową wersję
  await errOf(S.query(`select public.marketing_photo_version_claim_unpublish(v.id, null) from public.marketing_photo_versions v join public.marketing_photos p on p.id = v.photo_id where p.title = 'ZZZ TEST wyścig blokad' and v.published_at is not null and v.unpublished_at is null`));
  await errOf(S.query(`update public.marketing_photo_versions v set published_at = null, public_url = null, storage_bucket = 'marketing-photos-pending' from public.marketing_photos p where p.id = v.photo_id and p.title = 'ZZZ TEST wyścig blokad' and v.unpublishing_at is not null`));
  for (const c of [A, B, S]) await c.end().catch(() => {});
}
console.log(fails ? `\n${fails} FAIL` : "\nWSZYSTKO OK");
process.exit(fails ? 1 : 0);
