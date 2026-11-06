// Plansza kontaktowa (06.11): wycina podglądy ze zrzutów ekranu Chrome (podgląd Drive w1000, tylko odczyt),
// liczy odciski treści (dHash 9×8) i wykrywa duplikaty, buduje kontakt.html + kontakt.json.
//   node plansza.mjs
// Oryginały na Drive nietknięte. Podglądy ~1000 px tylko do wyboru; po akceptacji do biblioteki idą
// zoptymalizowane kopie z ORYGINAŁÓW (pełna rozdzielczość), nie z podglądów.
import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TR = "C:/Users/Artur/.claude/projects/C--Users-Artur-OneDrive-Dokumenty-Claude/f3a4f107-f989-40c0-8af0-9bedd69cf598/tool-results/";
const out = path.join(here, "podglady"); mkdirSync(out, { recursive: true });

// kandydaci: [rok, nazwa pliku Drive (skrót), id Drive, plik zrzutu, rect [x,y,w,h], kategoria, uwaga, wybór]
const L = [283, 0, 970, 647], L2 = [283, 0, 971, 647], P = [553, 0, 431, 647];
const C = [
  [2026, "0131_R6M29805", "1OaxS7Cgy7tarfZYhdt-_UJNWlM08xjmQ", "1793978629212-v59te5", L, "rozmowy B2B", "powitanie przy stoisku Fresh Market, 2 osoby; logo Fozzy w tle", "zatw"],
  [2026, "0138_R6M29837", "17XJdtzfQD3wDl7dvxyCARJ1Q1Th7zeUl", "1793978629212-tehoax", L, "rozmowy B2B", "dwa stoliki, rozmowy; baner Fresh Market, logo albert", "zatw"],
  [2026, "0168_R6M29972", "1fRegIAMO_jLjUAhpDsZ42MntvrNSjd16", "1793978671863-xthoor", L, "rozmowy B2B", "3 osoby przy stoliku, baner Fresh Market; kadr czysty", "zatw"],
  [2026, "0169_R6M29977", "1lfE_IpbKEM1MEY8bkfMvojdVe0ccoR9k", "1793978671864-1mke3g", L, "rozmowy B2B", "3 osoby, próbki na stole; logo E.Leclerc", "zatw"],
  [2026, "0170_R6M29981", "1HUlIKMukQFRP3FSEYl4nMjvsdovukkaO", "1793978671864-wv7k3o", L, "rozmowy B2B", "3 osoby, dokumenty; logo dino", "zatw"],
  [2026, "0173_R6M20002", "1SlXjBExK5vEwlDQlpVLokuxzhHu9YDoX", "1793978671865-6acfn2", P, "rozmowy B2B", "uścisk dłoni przy stoliku; PION — do maila wymaga kadru poziomego", "zatw"],
  [2026, "0174_R6M20007", "13GGRqBCoGlia890sDX5yjbMEbqnM2Vep", "1793978726627-odiigm", L, "rozmowy B2B", "2 osoby, rozmowa; baner Fresh Market, logo Topaz", "zatw"],
  [2026, "0178_R6M20018", "1fW43eMZqUmsC8tDWYhCW_TBfvefKdmFB", "1793978726628-v2luzn", L, "prezentacja firmy", "szeroki kadr sali, 2 osoby przy stoliku; loga Umai, Frac", "rez"],
  [2026, "0179_R6M20020", "1lNtYr8tIvVBpwcz1nkB8n65yGv8PmDst", "1793978726628-29iojr", P, "rozmowy B2B", "4 osoby przy stoliku; PION; logo makro", "rez"],
  [2026, "0207_R6M20146", "1Mc_Jk2JjK2YQ-EW9OTLT9wTQ8wvzfC_n", "1793978726628-4hdgu3", L, "rozmowy B2B", "powitanie, 3 osoby, baner Fresh Market; logo dino", "zatw"],
  [2026, "0209_R6M20151", "1RfhPUuMuw-q7WOMDJPpLAQrPT42_21YQ", "1793978763163-lyc8s3", L, "rozmowy B2B", "3 osoby, dokumenty; baner Fresh Market; logo ATB", "zatw"],
  [2026, "0212_R6M20165", "1vHsZKtwVn07xpxfO_HcFrMDr-IXqZNQU", "1793978763163-woqjas", L, "rozmowy B2B", "3 osoby, uśmiech; logo Auchan duże", "zatw"],
  [2026, "0213_R6M20178", "1fsFC4hX5HS6ytgBSC_ycHm5ZpTrOVC4Z", "1793978763163-ppt9r5", L, "rozmowy B2B", "2 osoby, materiały na stole; baner Fresh Market; logo Carrefour w tle", "zatw"],
  [2026, "0250_R6M20348", "1A8vvi1gF-FEH1-YSE4Cqv5Y-Ae-ZgMuR", "1793978763163-646ehy", L, "rozmowy B2B", "uścisk dłoni, 3 osoby, baner Fresh Market; logo albert", "zatw"],
  [2025, "0134_R6M29776", "1GRtvq4EBE5oHzTFyA7vuqHmP-RJBSOn9", "1793978802478-r69g8v", L2, "prezentacja firmy", "rząd stoisk, rozmowy; wiele logotypów (Varus, Topaz, Stokrotka)", "rez"],
  [2025, "0137_R6M29785", "1gmbnUc9DpABct00Qf2IkfKjGbZY0OFKY", "1793978802478-adqsyl", L2, "rozmowy B2B", "2 osoby, materiały; baner Fresh Market; loga Billa, Spar", "zatw"],
  [2025, "0148_R6M29823", "1JRh6mmO3yKTd0gSa9p4lfmo_7tBMWFeg", "1793978802479-2aj7g3", L2, "rozmowy B2B", "dwa stoliki, 7 osób; banery Fresh Market; loga Topaz, Varus", "zatw"],
  [2025, "0152_R6M29849", "1NeiH1ClKzNOf0l2AgDCRsgIQ8K8hfmKR", "1793978802479-je20h9", L2, "prezentacja firmy", "aleja stoisk, tłum w tle; loga Auchan, albert", "rez"],
  [2025, "0155_R6M29860", "1SXqABCe2Ufd_bXP8U2FMMeJKjwTW0e8_", "1793978839141-95ls6n", L2, "rozmowy B2B", "4 osoby, laptop; logo Auchan duże", "zatw"],
  [2025, "0162_R6M29897", "1yVsgifo4UTQTgHGF2SyEeCvALbtOjIUp", "1793978839142-45ops1", L2, "produkty", "uścisk dłoni, arbuz i próbki na stole, baner Fresh Market; logo Topaz", "zatw"],
  [2025, "0198_R6M20037", "1ngOLCLRsesNc67TI8t8l713fDsCtSszk", "1793978839142-vs0syj", L2, "rozmowy B2B", "uścisk dłoni, 2 osoby, próbki na stole; bez dużych logotypów", "zatw"],
  [2025, "0200_R6M20046", "1WP-7koMrKkUwq0IQURueWGb6QQ5ETWUG", "1793978839142-ntyvjj", L2, "rozmowy B2B", "uścisk dłoni, uśmiech; baner Fresh Market", "zatw"],
  // ZAPAS (Artur 06.11: „dodaj jeszcze 20 podobnych”)
  [2026, "0133_R6M29818", "18ufyR_FXwtCMASkkW7g66SgC9-4gVSGM", "1793980104786-ssh8xg", L, "rozmowy B2B", "rząd stoisk, rozmowa 2 osób przy Fresh Market; loga dino, aibė", "zapas"],
  [2026, "0143_R6M29848", "1NpHqioWi_uiKIo7MPaol7WihRe-bGAS_", "1793980104787-hpfshj", L, "rozmowy B2B", "3 osoby przy stoliku, sala z oknami; loga Umai, Frac, ATB", "zapas"],
  [2026, "0144_R6M29851", "1nAgI217lEvIJydwmit160ID9Ui8mjD3P", "1793980104788-bog2zw", L, "rozmowy B2B", "3 mężczyzn przy stoliku, uśmiech; logo Fantastiko", "zapas"],
  [2026, "0145_R6M29859", "1h3QExCN4ZwBwlnBXl2tIxdmwEfRRY9ch", "1793980104788-gvmczm", P, "rozmowy B2B", "3 osoby przy stoliku, całe stoisko; PION; logo Fantastiko", "zapas"],
  [2026, "0146_R6M29862", "1AIc3f8EBcdriKXSx-qkd9-R07yzP4jic", "1793980150509-ulxi4q", L, "rozmowy B2B", "4 osoby, jedna stojąca; baner Fresh Market; logo Auchan", "zapas"],
  [2026, "0171_R6M29984", "1d-lSAJ2JwLAVV1t5trvcsMIXEyTwre1o", "1793980150510-oy580l", L, "rozmowy B2B", "dwa stoiska dino z rozmowami, banery Fresh Market; symetryczny kadr", "zapas"],
  [2026, "0172_R6M29990", "15HD3O2tD-0YUvuggKPDtErCmnLLHkwuY", "1793980150510-sp53si", L, "rozmowy B2B", "4 osoby stojące przy stoisku, rozmowa; baner Fresh Market; logo albert", "zapas"],
  [2026, "0211_R6M20155", "1C1sswFcLFvmKOXX3M2dioKBfXxXWXRbS", "1793980150510-wnnimp", L, "rozmowy B2B", "3 osoby przy stoliku, notatki; loga Frac, ATB", "zapas"],
  [2026, "0214_R6M20179", "1s_AV_I2vDLM8xdzH0B94T5S_YKKSzk0R", "1793980211119-jn3qvm", L, "rozmowy B2B", "2 osoby przy stoliku + hostessa; baner Fresh Market; logo Auchan", "zapas"],
  [2026, "0251_R6M20363", "19ElEocwlmNHnpPD3YfnwmgZM2LwbAOya", "1793980211119-7svl36", L, "rozmowy B2B", "3 osoby przy stoliku dino, baner Fresh Market", "zapas"],
  [2025, "0133_R6M29774", "1R0iTCUeMwrOlnvVw1ixPIlc9aH_6LHy0", "1793980327221-e6tjp6", L2, "rozmowy B2B", "dwa stoiska z rozmowami, baner Fresh Market; loga Frac, Topaz, Varus", "zapas"],
  [2025, "0135_R6M29778", "1kCeNgmMMINNwzfFvNAhmHz6A4zTbfhLm", "1793980211120-8dmddi", L2, "rozmowy B2B", "5 osób przy stoliku, baner Fresh Market; logo Nasz Sklep, albert", "zapas"],
  [2025, "0136_R6M29781", "15esBoGsoC1c9NJjp1X7bwqH0x40L-Qf4", "1793980211120-cgurm1", L2, "rozmowy B2B", "3 osoby przy stoliku, baner Fresh Market; logo Auchan", "zapas"],
  [2025, "0157_R6M29868", "1qle6Iv7ktVOXh_tewLXOpjrJC5T9S5Rs", "1793980275902-txgzzp", L2, "rozmowy B2B", "2 osoby przy stoliku, uśmiech; logo Nasz Sklep", "zapas"],
  [2025, "0159_R6M29885", "1i-a0YU7oa30anbmMn5VB_Jzy_NZFw_KU", "1793980275903-8oidg5", L2, "rozmowy B2B", "4 osoby przy stoliku, baner Fresh Market; logo Biedronka", "zapas"],
  [2025, "0192_R6M20025", "1DFFSS737i6JOjQd47TkuE1uTrrXhU5dv", "1793980275903-2hpd02", L2, "rozmowy B2B", "rząd stoisk z rozmowami, baner Fresh Market; loga Varus, Stokrotka", "zapas"],
  [2025, "0199_R6M20043", "1MXNNQXwcCZ1z4bR3cP078gNDhKpvDbR1", "1793980327220-czar6k", L2, "prezentacja firmy", "sala z rozmowami i hostessą; logo Auchan, Bingo", "zapas"],
  [2025, "0286_R6M20353", "1_epgoSnnVHc6jZI6vHn9Z4M2yp3zD-rA", "1793980327221-aoumv0", L2, "rozmowy B2B", "uścisk dłoni przy stoisku, baner Fresh Market; loga Billa, Spar", "zapas"],
  // dodatkowa rezerwa (słabsze kadry: tyłem, przechylone, ruch)
  [2026, "0189_R6M20059", "1xENRtXb8LmABY28YUdIwqziZxqCoCJrN", "1793980211119-2iq93b", L, "prezentacja firmy", "osoby tyłem, kadr przechylony; loga Umai, Frac", "rez"],
  [2025, "0191_R6M20024", "1CivxQfJbEE_Leg11424c3lI8-4JEdSeh", "1793980275903-ivw8r2", L2, "prezentacja firmy", "osoby tyłem, kadr przechylony; loga Frac, Topaz", "rez"],
  [2025, "0196_R6M20034", "1UG5q2nZ8sHyTcyZ4hjYBfCopUMs8RSci", "1793980275903-se42go", L2, "prezentacja firmy", "hostessa z notatkami na pierwszym planie, rozmowy w tle", "rez"],
  [2025, "0150_R6M29834", "1zOEbFXLi1Uy9N9CJOTj1BRJYFbTXo6L-", "1793980327221-u8va6c", L2, "prezentacja firmy", "aleja stoisk z rozmowami, owoce na stole; loga Spar, Carrefour", "rez"],
  // kontrola duplikatów: te same numery klatek w obu rocznikach
  [2026, "0136_R6M29823", "1Yc505xmfHYhAgHGYEOJC2buubEzDMchx", "1793978869991-eh7c87", L, "rozmowy B2B", "3 osoby przy stoliku, Promo/Fantastiko (ten sam nr klatki co 2025/0148 — inne zdjęcie)", "zapas"],
  [2026, "0253_R6M20367", "1rmhyvQ61FuqDRDrQTVt_LiYHyrJOdvJC", "1793978869991-54b713", L, "kontrola", "aleja z dino (ten sam nr klatki co 2025/0290 — inne zdjęcie)", "ctrl"],
  [2025, "0290_R6M20367", "1v7SF6uHxLfPlN-iEKx_xBEG2_idrEl1W", "1793978869991-yyk7g8", L2, "rozmowy B2B", "uścisk dłoni przy stoisku Nasz Sklep, baner Fresh Market w tle (ten sam nr klatki co 2026/0253 — inne zdjęcie)", "zapas"],
];

const dhash = async (buf) => {
  const { data } = await sharp(buf).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = ""; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] < data[y * 9 + x + 1] ? "1" : "0";
  return bits;
};
const ham = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

const rows = [];
for (const [year, name, id, shot, rect, cat, note, tier] of C) {
  const src = TR + "mcp-claude-in-chrome-blob-" + shot + ".jpg";
  if (!existsSync(src)) { console.error("brak zrzutu", name, src); continue; }
  const [x, y, w, h] = rect;
  const file = `${year}_${name}_${id}.jpg`;
  const buf = await sharp(src).extract({ left: x, top: y, width: w, height: h }).jpeg({ quality: 88 }).toBuffer();
  writeFileSync(path.join(out, file), buf);
  const thumb = await sharp(buf).resize({ width: 480 }).jpeg({ quality: 80 }).toBuffer();
  writeFileSync(path.join(out, "t_" + file), thumb);
  rows.push({ year, name, id, file, w, h, orientation: w > h ? "poziome" : "pionowe", cat, note, tier, pick: tier === "zatw", hash: await dhash(buf), drive: `https://drive.google.com/file/d/${id}/view` });
}
// duplikaty po treści
const dups = [];
for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const d = ham(rows[i].hash, rows[j].hash); if (d <= 10) dups.push({ a: rows[i].name, b: rows[j].name, dist: d });
}
writeFileSync(path.join(here, "kontakt.json"), JSON.stringify({ generated: new Date().toISOString(), rows, duplicates: dups }, null, 2));

const TAG = { zatw: "ZATWIERDZONE", zapas: "ZAPAS", rez: "rezerwa", ctrl: "kontrola duplikatu" };
const card = (r, i) => `<figure class="c t-${r.tier}">
  <img src="podglady/t_${r.file}" alt="${r.name}">
  <figcaption><b>${i + 1}. ${r.name}</b> · <span class="y">${r.year}</span> · ${r.orientation}· <span class="tag t-${r.tier}">${TAG[r.tier]}</span><br>
  <small>${r.cat} — ${r.note}</small><br><small class="id">Drive: <a href="${r.drive}" target="_blank" rel="noopener">${r.id}</a> · plik: ${r.name}_happymoon…jpg</small></figcaption></figure>`;
const picks = rows.filter((r) => r.tier === "zatw"), spare = rows.filter((r) => r.tier === "zapas"), rest = rows.filter((r) => r.tier === "rez"), ctrl = rows.filter((r) => r.tier === "ctrl");
const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plansza kontaktowa — zdjęcia do maili PreConnect (06.11.2026)</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:20px;color:#1a1a1a;background:#f8fafc}h1{font-size:20px}h2{font-size:16px;margin:28px 0 8px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}.c{margin:0;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
.c img{width:100%;display:block;aspect-ratio:3/2;object-fit:cover;background:#e2e8f0}.c.t-zatw{border-color:#15803d;box-shadow:0 0 0 2px #bbf7d0}.c.t-zapas{border-color:#0d9488;box-shadow:0 0 0 2px #99f6e4}.c.t-ctrl,.c.t-rez{opacity:.85}.tag.t-zapas{background:#0d9488}.tag.t-rez,.tag.t-ctrl{background:#64748b}
figcaption{padding:8px 10px;font-size:13px;line-height:1.4}.tag{background:#15803d;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px}.tag.ctrl{background:#64748b}.y{font-weight:700}.id{color:#64748b;word-break:break-all}
.note{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;font-size:13px}</style></head><body>
<h1>Plansza kontaktowa — zdjęcia do maili PreConnect (roczniki 2026 i 2025)</h1>
<div class="note">Źródło: folder Drive „Fresh Market — stoiska sieci i rozmowy” (tylko odczyt; oryginały i udostępnianie nietknięte). Przejrzane: 2026 — 40 plików (wersje „print”, 2–4 MB), 2025 — 36 plików (wersje „www”, 1,2–2 MB). Podglądy ~1000 px z Drive; do biblioteki trafią kopie z oryginałów po Twoim zatwierdzeniu i po kadrowaniu.
Duplikaty po treści (dHash, próg 10): <b>${dups.length ? dups.map((d) => `${d.a} ≈ ${d.b} (${d.dist})`).join(", ") : "brak"}</b>. Pominięte świadomie: ujęcia alej i pustych sal (0176, 0177, 0215, 0234–0239, 0253 z 2026; 0193, 0257–0260, 0284 z 2025), tłumy, serie niemal identyczne (0169/0170/0171, 0136/0137, 0196/0197, 0133/0138, 0209/0211). Widoczne logotypy sieci = kadr archiwalny z danego rocznika, opis w bibliotece ma to mówić wprost.</div>
<h2>Zatwierdzone przez Artura 06.11 (${picks.length})</h2><div class="g">${picks.map(card).join("")}</div>
<h2>Zapas — kolejne podobne kadry do biblioteki (${spare.length})</h2><div class="g">${spare.map((r, i) => card(r, picks.length + i)).join("")}</div>
<h2>Rezerwa / kadry kontekstowe i słabsze (${rest.length})</h2><div class="g">${rest.map((r, i) => card(r, picks.length + spare.length + i)).join("")}</div>
<h2>Kontrola duplikatów — te same numery klatek w obu rocznikach (${ctrl.length})</h2><div class="g">${ctrl.map((r, i) => card(r, picks.length + spare.length + rest.length + i)).join("")}</div>
</body></html>`;
writeFileSync(path.join(here, "kontakt.html"), html);
console.log("ok", rows.length, "podglądów;", picks.length, "zatwierdzonych;", spare.length, "zapas;", rest.length, "rezerwa; duplikaty:", JSON.stringify(dups));
