#!/usr/bin/env node
// [feat/marketing-activation] Przebieg migracji marketingowej na PRAWDZIWYM Postgresie
// (PGlite) z całym łańcuchem migracji repo + próba RPC (claim / dzierżawa / odzyskanie /
// needs_review / suppresja / ingest z deduplikacją / brak zgody) + uprawnienia.
//
//   PGLITE_PATH=<...>/@electric-sql/pglite/dist/index.js node scripts/marketing-sql-smoke.mjs
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

const { PGlite } = await import(pathToFileURL(path.resolve(PGLITE_PATH)).href);
const db = new PGlite();
await db.exec(patch(read("supabase/tests/000_supabase_shim.sql")));
const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  try { await db.exec(patch(read("supabase/migrations/" + f))); }
  catch (e) { console.error("migracja padła:", f, e.message); process.exit(1); }
}
console.log(`migracje: ${files.length} OK (ostatnia ${files[files.length - 1]})`);

const ADMIN = "11111111-1111-4111-8111-111111111111", OWNER = "55555555-5555-4555-8555-555555555555", OWNER2 = "66666666-6666-4666-8666-666666666666";
const COMPANY = "44444444-4444-4444-8444-444444444444";
await db.exec(`
  insert into auth.users (id, email) values ('${ADMIN}','admin@example.invalid'), ('${OWNER}','dostawca@example.invalid'), ('${OWNER2}','drugi@example.invalid')
  on conflict do nothing;
  insert into public.companies (id, name, legacy_supplier_id, country) values ('${COMPANY}','Dostawca testowy','sup-1','PL') on conflict do nothing;
  insert into public.profiles (id, role, name, email, active, company_id) values
    ('${ADMIN}','admin','Admin','admin@example.invalid',true,null),
    ('${OWNER}','supplier','Operator','dostawca@example.invalid',true,'${COMPANY}'),
    ('${OWNER2}','supplier','Operator 2','drugi@example.invalid',true,'${COMPANY}')
  on conflict (id) do update set role = excluded.role, email = excluded.email, company_id = excluded.company_id, active = true;
`);

const camp = (await db.query(`insert into public.marketing_campaigns (name, template_key, created_by) values ('Test', 'start_with_credits', $1) returning id`, [ADMIN])).rows[0].id;
const msg = async (profile, email, consent) => (await db.query(
  `insert into public.marketing_messages (campaign_id, company_id, profile_id, to_email, locale, segment, consent_source, subject, html, text_body, payload_hash, idempotency_key)
   values ($1::uuid,$2::uuid,$3::uuid,$4,'pl','start',$5,'S','<p>H</p>','T','hash',$6) returning id`,
  [camp, COMPANY, profile, email, consent, `marketing:${camp}:${profile}`])).rows[0].id;

console.log("1. duplikat adresata w kampanii");
const m1 = await msg(OWNER, "Dostawca@Example.invalid", "regulamin 1.0 — potwierdzone przez Artura 4.11");
let dup = null; try { await msg(OWNER, "dostawca@example.invalid", "x"); } catch (e) { dup = e.message; }
ok(dup && /uq_marketing_messages_campaign_profile|duplicate key/.test(dup), "drugi wiersz dla tego samego profilu w kampanii odrzucony: " + (dup || "BRAK BŁĘDU"));

console.log("2. claim: brak zgody blokuje, suppresja wyklucza, reszta zajęta z dzierżawą");
const m2 = await msg(OWNER2, "drugi@example.invalid", null);
await db.query(`select public.marketing_suppress_email('wypisany@example.invalid','unsubscribe','one-click',$1,null)`, [camp]);
const claimed = (await db.query(`select id, state, attempts, lease_until, first_claim_at from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp])).rows;
ok(claimed.length === 1 && claimed[0].id === m1, "zajęty dokładnie 1 wiersz (ze zgodą)");
const st2 = (await db.query(`select state, last_error from public.marketing_messages where id = $1`, [m2])).rows[0];
ok(st2.state === "blocked_no_consent", "bez consent_source → blocked_no_consent (" + st2.last_error + ")");
const again = (await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp])).rows;
ok(again.length === 0, "drugie wywołanie w trakcie dzierżawy nic nie zajmuje (brak dubla)");

console.log("3. odzyskanie po przerwaniu: wygasła dzierżawa → ten sam wiersz zajęty ponownie, attempts rośnie");
await db.query(`update public.marketing_messages set lease_until = now() - interval '1 minute' where id = $1`, [m1]);
const re = (await db.query(`select id, attempts from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp])).rows;
ok(re.length === 1 && re[0].id === m1 && re[0].attempts === 2, "odzyskany ten sam wiersz, attempts = 2");

console.log("4. wynik: uncertain zostawia claimed z dzierżawą; accepted zapisuje id i dopina czekające zdarzenia");
let r = (await db.query(`select public.marketing_record_result($1,'uncertain',null,'timeout') as r`, [m1])).rows[0].r;
ok(r.ok === true && (await db.query(`select state from public.marketing_messages where id=$1`, [m1])).rows[0].state === "claimed", "uncertain → claimed (do odzyskania)");
const ev0 = (await db.query(`select public.marketing_ingest_email_event('svix-1','resend-m1','email.delivered',now(),'{"to":["dostawca@example.invalid"]}'::jsonb) as r`)).rows[0].r;
ok(ev0.duplicate === false && ev0.status === "pending", "zdarzenie przed powiązaniem czeka jako pending");
r = (await db.query(`select public.marketing_record_result($1,'accepted','resend-m1',null) as r`, [m1])).rows[0].r;
ok(r.ok === true && r.linked_events === 1, "accepted dopiął 1 czekające zdarzenie");
const evdup = (await db.query(`select public.marketing_ingest_email_event('svix-1','resend-m1','email.delivered',now(),'{}'::jsonb) as r`)).rows[0].r;
ok(evdup.duplicate === true, "ten sam svix-id → duplicate");
r = (await db.query(`select public.marketing_record_result($1,'accepted','resend-other',null) as r`, [m1])).rows[0].r;
ok(r.ok === false && r.reason === "not_claimed", "powtórny wynik po accepted nie nadpisuje");
const idNow = (await db.query(`select resend_message_id from public.marketing_messages where id=$1`, [m1])).rows[0].resend_message_id;
ok(idNow === "resend-m1", "resend_message_id bez zmian po powtórce");

console.log("5. odbicie → suppresja; kolejna kampania do tego adresu wykluczona przy claim");
const evb = (await db.query(`select public.marketing_ingest_email_event('svix-2','resend-m1','email.bounced',now(),'{}'::jsonb) as r`)).rows[0].r;
ok(evb.suppressed === true, "bounce zapisany jako suppresja");
const sup = (await db.query(`select reason from public.marketing_suppressions where email = 'dostawca@example.invalid'`)).rows[0];
ok(sup && sup.reason === "bounce", "adres w suppresji z powodem bounce (lower/trim)");
const camp2 = (await db.query(`insert into public.marketing_campaigns (name, template_key) values ('Druga','return_active') returning id`)).rows[0].id;
const m3 = (await db.query(`insert into public.marketing_messages (campaign_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, consent_source) values ($1::uuid,$2::uuid,'dostawca@example.invalid','S','H','T','h',$3,'lista') returning id`, [camp2, OWNER, `marketing:${camp2}:${OWNER}`])).rows[0].id;
const c2 = (await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp2])).rows;
ok(c2.length === 0 && (await db.query(`select state from public.marketing_messages where id=$1`, [m3])).rows[0].state === "suppressed", "wiersz do adresu w suppresji → suppressed, nie wysłany");

console.log("6. poza oknem ochrony → needs_review");
const m4 = (await db.query(`insert into public.marketing_messages (campaign_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, consent_source, state, first_claim_at, claimed_at, lease_until) values ($1,$2,'drugi@example.invalid','S','H','T','h','k4','lista','claimed', now() - interval '25 hours', now() - interval '25 hours', now() - interval '24 hours') returning id`, [camp2, OWNER2])).rows[0].id;
const c3 = (await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp2])).rows;
ok(c3.length === 0 && (await db.query(`select state from public.marketing_messages where id=$1`, [m4])).rows[0].state === "needs_review", "stara dzierżawa poza 23 h → needs_review");

console.log("6b. [review #4] odbicie z data.to PRZED powiązaniem → suppresja; skarga przed powiązaniem dopięta przy accepted");
const evEarly = (await db.query(`select public.marketing_ingest_email_event('svix-early','resend-early','email.bounced',now(),'{"type":"email.bounced","data":{"to":["wczesny@example.invalid"]}}'::jsonb) as r`)).rows[0].r;
ok(evEarly.status === "pending" && evEarly.suppressed === true, "odbicie przed powiązaniem: pending + adres z data.to w suppresji");
ok((await db.query(`select 1 from public.marketing_suppressions where email = 'wczesny@example.invalid' and reason = 'bounce'`)).rows.length === 1, "suppresja wczesny@ zapisana");
const camp3 = (await db.query(`insert into public.marketing_campaigns (name, template_key) values ('Trzecia','start_with_credits') returning id`)).rows[0].id;
const m5 = (await db.query(`insert into public.marketing_messages (campaign_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, consent_source) values ($1::uuid,$2::uuid,'Pozny@Example.invalid','S','H','T','h',$3,'lista') returning id`, [camp3, OWNER2, `marketing:${camp3}:${OWNER2}`])).rows[0].id;
await db.query(`select public.marketing_ingest_email_event('svix-late','resend-late','email.complained',now(),'{"type":"email.complained","data":{}}'::jsonb)`);
const cl3 = (await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp3])).rows;
ok(cl3.length === 1, "wiersz zajęty");
const rl = (await db.query(`select public.marketing_record_result($1,'accepted','resend-late',null) as r`, [m5])).rows[0].r;
ok(rl.linked_events === 1 && (await db.query(`select reason from public.marketing_suppressions where email = 'pozny@example.invalid'`)).rows[0]?.reason === "complaint", "skarga sprzed powiązania → suppresja complaint przy accepted");

console.log("6c. [review #2] precheck tuż przed wysyłką: wypis w trakcie partii zatrzymuje mail");
const camp4 = (await db.query(`insert into public.marketing_campaigns (name, template_key, status) values ('Czwarta','start_with_credits','sending') returning id`)).rows[0].id; // precheck wymaga kampanii sending/approved (r3 #2)
const m6 = (await db.query(`insert into public.marketing_messages (campaign_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, consent_source) values ($1::uuid,$2::uuid,'partia@example.invalid','S','H','T','h',$3,'lista') returning id`, [camp4, OWNER, `marketing:${camp4}:${OWNER}`])).rows[0].id;
ok((await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp4])).rows.length === 1, "zajęty do partii");
let pc = (await db.query(`select public.marketing_precheck_message($1) as r`, [m6])).rows[0].r;
ok(pc.ok === true, "precheck przed wypisem: ok");
await db.query(`select public.marketing_suppress_email('partia@example.invalid','unsubscribe','one-click',null,null)`);
pc = (await db.query(`select public.marketing_precheck_message($1) as r`, [m6])).rows[0].r;
ok(pc.ok === false && ["suppressed", "not_claimed"].includes(pc.reason), "precheck po wypisie w trakcie partii odrzuca (" + pc.reason + ") — mail nie wyjdzie");
ok((await db.query(`select state from public.marketing_messages where id=$1`, [m6])).rows[0].state === "suppressed", "wiersz oznaczony suppressed");
pc = (await db.query(`select public.marketing_precheck_message($1) as r`, [m1])).rows[0].r;
ok(pc.ok === false && pc.reason === "not_claimed", "precheck na wierszu accepted: not_claimed (nie wyśle drugi raz)");

console.log("6d. [r3 #1] wypis W TRAKCIE żądania: poczta przyjęła → id i sent_at zapisane, stan zostaje suppressed");
const camp5 = (await db.query(`insert into public.marketing_campaigns (name, template_key, status) values ('Piata','start_with_credits','sending') returning id`)).rows[0].id;
const m7 = (await db.query(`insert into public.marketing_messages (campaign_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, consent_source) values ($1::uuid,$2::uuid,'wlocie@example.invalid','S','H','T','h',$3,'lista') returning id`, [camp5, OWNER2, `marketing:${camp5}:${OWNER2}`])).rows[0].id;
ok((await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp5])).rows.length === 1, "zajęty");
ok((await db.query(`select public.marketing_precheck_message($1) as r`, [m7])).rows[0].r.ok === true, "precheck ok (kampania sending)");
await db.query(`select public.marketing_suppress_email('wlocie@example.invalid','unsubscribe','one-click',null,null)`); // wypis, gdy POST do Resend już trwa
const rr = (await db.query(`select public.marketing_record_result($1,'accepted','resend-wlocie',null) as r`, [m7])).rows[0].r;
const row7 = (await db.query(`select state, resend_message_id, sent_at, last_error from public.marketing_messages where id=$1`, [m7])).rows[0];
ok(rr.ok === true && rr.sent_before_unsubscribe === true, "record_result przyjął wynik mimo suppressed");
ok(row7.state === "suppressed" && row7.resend_message_id === "resend-wlocie" && row7.sent_at !== null, "stan suppressed + id Resend + sent_at zapisane (" + row7.last_error + ")");
const rr2 = (await db.query(`select public.marketing_record_result($1,'accepted','resend-inny',null) as r`, [m7])).rows[0].r;
ok(rr2.ok === false && (await db.query(`select resend_message_id from public.marketing_messages where id=$1`, [m7])).rows[0].resend_message_id === "resend-wlocie", "powtórka nie nadpisuje id");

console.log("6d2. [r4] webhook delivered PRZED zapisem odpowiedzi Resend + wypis w locie: zdarzenie dopięte, stan suppressed, id nie nadpisane");
const camp5b = (await db.query(`insert into public.marketing_campaigns (name, template_key, status) values ('Piata-b','start_with_credits','sending') returning id`)).rows[0].id;
const m7b = (await db.query(`insert into public.marketing_messages (campaign_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, consent_source) values ($1::uuid,$2::uuid,'wlocie2@example.invalid','S','H','T','h',$3,'lista') returning id`, [camp5b, OWNER, `marketing:${camp5b}:${OWNER}`])).rows[0].id;
ok((await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp5b])).rows.length === 1, "zajęty");
await db.query(`select public.marketing_suppress_email('wlocie2@example.invalid','unsubscribe','one-click',null,null)`); // 2. wypis
const evD = (await db.query(`select public.marketing_ingest_email_event('svix-deliv-early','resend-wlocie2','email.delivered',now(),'{"type":"email.delivered","data":{"to":["wlocie2@example.invalid"]}}'::jsonb) as r`)).rows[0].r; // 3. webhook przed zapisem odpowiedzi
ok(evD.status === "pending", "delivered przed powiązaniem czeka jako pending");
const rr3 = (await db.query(`select public.marketing_record_result($1,'accepted','resend-wlocie2',null) as r`, [m7b])).rows[0].r; // 4. zapis odpowiedzi Resend
const evRow = (await db.query(`select status, message_id from public.marketing_email_events where event_id = 'svix-deliv-early'`)).rows[0];
ok(rr3.ok === true && rr3.sent_before_unsubscribe === true && rr3.linked_events === 1, "accepted po wypisie dopiął 1 czekające zdarzenie");
ok(evRow.status === "processed" && evRow.message_id === m7b, "zdarzenie processed z message_id wiersza");
const row7b = (await db.query(`select state, resend_message_id, sent_at from public.marketing_messages where id=$1`, [m7b])).rows[0];
ok(row7b.state === "suppressed" && row7b.resend_message_id === "resend-wlocie2" && row7b.sent_at !== null, "stan suppressed, id i sent_at zapisane");
ok((await db.query(`select public.marketing_record_result($1,'accepted','resend-nadpis',null) as r`, [m7b])).rows[0].r.ok === false && (await db.query(`select resend_message_id from public.marketing_messages where id=$1`, [m7b])).rows[0].resend_message_id === "resend-wlocie2", "powtórka nie nadpisuje id");
ok((await db.query(`select count(*)::int as n from public.marketing_suppressions where email = 'wlocie2@example.invalid'`)).rows[0].n === 1, "wypis zachowany");

console.log("6e. [r3 #2] zamknięcie kampanii po zajęciu partii: precheck odrzuca, wiersz wraca do pending");
const camp6 = (await db.query(`insert into public.marketing_campaigns (name, template_key, status) values ('Szosta','start_with_credits','sending') returning id`)).rows[0].id;
const m8 = (await db.query(`insert into public.marketing_messages (campaign_id, profile_id, to_email, subject, html, text_body, payload_hash, idempotency_key, consent_source) values ($1::uuid,$2::uuid,'zamknieta@example.invalid','S','H','T','h',$3,'lista') returning id`, [camp6, OWNER, `marketing:${camp6}:${OWNER}`])).rows[0].id;
ok((await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp6])).rows.length === 1, "zajęty");
await db.query(`update public.marketing_campaigns set status = 'closed', closed_at = now() where id = $1`, [camp6]);
const pc6 = (await db.query(`select public.marketing_precheck_message($1) as r`, [m8])).rows[0].r;
ok(pc6.ok === false && pc6.reason === "campaign_not_active" && pc6.campaign_status === "closed", "precheck po zamknięciu kampanii: campaign_not_active");
ok((await db.query(`select state, lease_until from public.marketing_messages where id=$1`, [m8])).rows[0].state === "pending", "wiersz wrócił do pending (bez dzierżawy)");
ok((await db.query(`select id from public.marketing_claim_messages($1, 50, 900, 82800)`, [camp6])).rows.length === 1 && (await db.query(`select public.marketing_precheck_message($1) as r`, [m8])).rows[0].r.ok === false, "ponowne zajęcie też nie przechodzi precheck przy zamkniętej kampanii");

console.log("7. uprawnienia: anon/authenticated bez dostępu do tabel i funkcji; admin czyta przez RLS");
const can = async (role, sql, sub) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub || ""}', false); set role ${role};`);
  try { await db.query(sql); await db.exec("reset role"); return true; } catch (e) { await db.exec("reset role"); return false; }
};
ok(!(await can("anon", "select * from public.marketing_messages")), "anon: brak SELECT na marketing_messages");
ok(!(await can("authenticated", `select public.marketing_claim_messages('${camp}'::uuid, 1, 1, 1)`, OWNER)), "authenticated: brak EXECUTE na claim");
ok(!(await can("authenticated", `select public.marketing_suppress_email('x@y.z','manual')`, OWNER)), "authenticated: brak EXECUTE na suppress");
ok(!(await can("authenticated", `select public.marketing_precheck_message('${m1}'::uuid)`, OWNER)), "authenticated: brak EXECUTE na precheck");
const rowsSupplier = await (async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${OWNER}', false); set role authenticated;`); const r = await db.query("select count(*)::int as n from public.marketing_messages"); await db.exec("reset role"); return r.rows[0].n; })();
ok(rowsSupplier === 0, "dostawca przez RLS widzi 0 wierszy");
const rowsAdmin = await (async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ADMIN}', false); set role authenticated;`); const r = await db.query("select count(*)::int as n from public.marketing_messages"); await db.exec("reset role"); return r.rows[0].n; })();
ok(rowsAdmin === 9, "admin przez RLS widzi 9 wierszy");

console.log("8. nic nie dotknęło rozliczeń");
const legacy = (await db.query(`select (select count(*) from public.legacy_send_email_events)::int as ev, (select count(*) from public.legacy_send_messages)::int as msgs`)).rows[0];
ok(legacy.ev === 0 && legacy.msgs === 0, "rejestry legacy puste po całym przebiegu");

await db.close();
console.log(fails ? `\nNIEPOWODZENIA: ${fails}` : "\nWSZYSTKO OK");
process.exit(fails ? 1 : 0);
