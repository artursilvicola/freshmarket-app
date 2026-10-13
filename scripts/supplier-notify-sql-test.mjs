// Migracja 20261013090000 na PRAWDZIWYM Postgresie (PGlite), nie na atrapie.
//
// Powód istnienia tego pliku: błąd `42702 column reference "message_id" is ambiguous`
// w `ensure_legacy_send_notify_message` blokował zapis KAŻDEJ wiadomości, a żaden test
// na atrapie bazy nie mógł go wyłapać — atrapa nie jest Postgresem. Znalazł go Codex,
// uruchamiając migrację w PGlite. Od tej pory SQL sprawdzamy SQL-em.
//
// Uruchomienie:
//   node scripts/supplier-notify-sql-test.mjs
//
// PGlite nie jest zależnością repo (ciągnie binarkę WASM). Ścieżkę podaje się w
// PGLITE_PATH albo pakiet instaluje się lokalnie:
//   PGLITE_PATH=/sciezka/do/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/supplier-notify-sql-test.mjs
// Bez PGlite skrypt KOŃCZY SIĘ KODEM 2 i mówi, czego brakuje — nie udaje, że przeszedł.
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = path.join(here, "..", "supabase", "migrations", "20261013090000_supplier_notify_claim.sql");

async function loadPGlite() {
  const fromEnv = process.env.PGLITE_PATH;
  const candidates = [fromEnv, "@electric-sql/pglite"].filter(Boolean);
  for (const c of candidates) {
    try {
      const mod = await import(c.startsWith("@") ? c : pathToFileURL(path.resolve(c)).href);
      if (mod?.PGlite) return mod.PGlite;
    } catch { /* próbujemy dalej */ }
  }
  return null;
}

const PGlite = await loadPGlite();
if (!PGlite) {
  console.error("BRAK PGlite — testu SQL NIE wykonano.");
  console.error("Podaj PGLITE_PATH albo zainstaluj @electric-sql/pglite.");
  process.exit(2);
}

const db = new PGlite();
const wyniki = [];
async function test(nazwa, fn) {
  try { await fn(); wyniki.push(["OK", nazwa]); }
  catch (e) { wyniki.push(["BŁĄD", `${nazwa} — ${e.message}`]); }
}

// Minimum schematu, którego dotyka migracja.
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create table public.legacy_sends (
    legacy_id bigint primary key,
    data jsonb not null default '{}',
    updated_at timestamptz not null default now()
  );
  insert into public.legacy_sends(legacy_id) values (1), (2), (3);
`);
await db.exec(await readFile(migration, "utf8"));
console.log("Postgres:", (await db.query("select version() as v")).rows[0].v.split(",")[0]);

const ensure = "select * from public.ensure_legacy_send_notify_message($1,$2,$3,$4,$5::bigint[])";
const claim = "select * from public.claim_legacy_sends_supplier_notify($1::bigint[],$2,$3,$4::timestamptz)";

await test("zapis wiadomości w ogóle działa (regresja 42702)", async () => {
  const r = await db.query(ensure, ["m-1", "a@example.invalid", "Temat", "<p>A</p>", [1, 2]]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].message_id, "m-1");
  assert.deepEqual(r.rows[0].legacy_ids, [1, 2]);
});

await test("powtórka oddaje PIERWOTNĄ treść, nie nadpisuje jej", async () => {
  const pierwsza = await db.query(ensure, ["m-2", "a@example.invalid", "Pierwszy", "<p>Pierwszy</p>", [1, 2]]);
  const druga = await db.query(ensure, ["m-2", "inny@example.invalid", "Drugi", "<p>Drugi</p>", [2]]);
  assert.deepEqual(druga.rows, pierwsza.rows);
});

await test("rezerwacja: zajęcie, cudza rezerwacja, dziedziczenie messageId", async () => {
  const a = await db.query(claim, [[1], "claim-a", "msg-a", "2026-10-13T10:00:00Z"]);
  assert.equal(a.rows[0].state, "claimed");
  assert.equal(a.rows[0].message_id, "msg-a");
  assert.equal(a.rows[0].attempt, 1);

  const b = await db.query(claim, [[1], "claim-b", "msg-b", "2026-10-13T10:01:00Z"]);
  assert.equal(b.rows[0].state, "busy");

  // po wygaśnięciu dzierżawy (15 min) wiersz wraca, ale TOŻSAMOŚĆ zostaje stara
  const c = await db.query(claim, [[1], "claim-c", "msg-c", "2026-10-13T10:20:00Z"]);
  assert.equal(c.rows[0].state, "claimed");
  assert.equal(c.rows[0].message_id, "msg-a");
  assert.equal(c.rows[0].attempt, 2);
});

await test("po 25 h niepotwierdzony wiersz = needs_review BEZ znacznika niepewności", async () => {
  const r = await db.query(claim, [[1], "claim-d", "msg-d", "2026-10-14T11:00:00Z"]);
  assert.equal(r.rows[0].state, "needs_review");
  assert.equal(r.rows[0].message_id, "msg-a");
  const row = await db.query("select data from public.legacy_sends where legacy_id = 1");
  assert.equal(row.rows[0].data.supplierNotifyUncertainAt, undefined, "znacznika niepewności NIE ma, a blokada i tak działa");
});

await test("potwierdzenie działa tylko na własnym tokenie i jest policzalne", async () => {
  await db.query(claim, [[2, 3], "claim-e", "msg-e", "2026-10-13T12:00:00Z"]);
  const obcy = await db.query("select public.confirm_legacy_sends_supplier_notified(array[2,3]::bigint[], 'nie-moj') as n");
  assert.equal(obcy.rows[0].n, 0);
  const moj = await db.query("select public.confirm_legacy_sends_supplier_notified(array[2,3]::bigint[], 'claim-e', 'app_list', 2) as n");
  assert.equal(moj.rows[0].n, 2);
  const powtorka = await db.query("select public.confirm_legacy_sends_supplier_notified(array[2,3]::bigint[], 'claim-e') as n");
  assert.equal(powtorka.rows[0].n, 0, "drugie potwierdzenie nic nie zmienia");
  const r = await db.query("select data from public.legacy_sends where legacy_id = 2");
  assert.ok(r.rows[0].data.supplierNotifiedAt, "znacznik wysłania stoi");
  assert.equal(r.rows[0].data.supplierNotifyClaimToken, undefined, "rezerwacja zdjęta");
  assert.equal(r.rows[0].data.supplierNotifyMessageId, "msg-e", "tożsamość zostaje do korelacji");
});

await test("wiersz już powiadomiony wraca jako notified, nie da się go zająć", async () => {
  const r = await db.query(claim, [[2], "claim-f", "msg-f", "2026-10-13T12:30:00Z"]);
  assert.equal(r.rows[0].state, "notified");
});

await test("przeglądarkowe role nie dotkną ani tabeli, ani RPC", async () => {
  for (const rola of ["anon", "authenticated"]) {
    await db.exec(`set role ${rola}`);
    await assert.rejects(db.query("select * from public.legacy_send_notify_messages"), { code: "42501" }, `${rola} czyta tabelę`);
    await assert.rejects(db.query("select * from public.ensure_legacy_send_notify_message('x','x','x','x',array[1]::bigint[])"), { code: "42501" }, `${rola} woła ensure`);
    await assert.rejects(db.query("select * from public.claim_legacy_sends_supplier_notify(array[1]::bigint[],'t','m')"), { code: "42501" }, `${rola} woła claim`);
    await db.exec("reset role");
  }
});

await db.close();

for (const [status, nazwa] of wyniki) console.log(`${status.padEnd(5)} ${nazwa}`);
const bledy = wyniki.filter(([s]) => s !== "OK").length;
console.log(`\n${wyniki.length - bledy}/${wyniki.length} przeszło`);
process.exit(bledy ? 1 : 0);
