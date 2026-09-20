// Warianty „D” symulacji FM 2026 (wyłącznie lokalnie, bez bazy) — zestaw z notatki Codexa z 20.09:
//   A0  = stan bieżący (prawdziwe dane: odmowy Biedronki zapisane w fm_resps, kraje z profili, pojemności z panelu)
//   D1  = A0 + sieci online (POLOmarket, Dobronom, SPAR, Twój Market) twardo 20 rozmów, 1 stanowisko  (to, co Artur ustawi w panelu)
//   D2  = D1 + 4 firmy Premium: maks. 9 spotkań z sieciami (limit ALGORYTMICZNY: fmPackages 1.8 → 5×1.8 = 9; bez zmiany pakietów i dat wpłat)
//   D2t = D1 + te same 4 firmy przycięte PO przebiegu do 9 najlepszych (akceptacje kupców zachowane, potem wynik pary, główny > rezerwowy)
//   D3  = D2 + próg preferowany (miękki) na stanowisko + twardy limit z panelu: ponad progiem szukamy sieci REZERWOWEJ z miejscem,
//         przenosimy tylko spotkania-szanse przy wyborze rezerwowym (chronione akceptacje zostają); bez alternatywy — zostaje ponad progiem
//   D3+ = jak D3, ale przenosić wolno także szanse przy wyborze GŁÓWNYM (test, nie rekomendacja)
//   D5 / D10 = D3 + rezerwa organizacyjna 5 % / 10 %: pojemność PIERWSZEGO przydziału = twarda − ceil(frac × twarda) dla sieci
//         stacjonarnych; online bez rezerwy (lista oczekujących); miejsca rezerwy = wolne numery w granicach twardej pojemności
// Użycie: node scripts/fm-simulate-variants-d.mjs --input <symulacja-wejscie.json> --out <folder> [--config <json z nadpisaniem P>]
// Algorytm produkcyjny (src/lib/fm-algo.js) bez zmian; nakładki działają na wejściach (capacity/fmPackages) i po przydziale (przesunięcia + ponowna numeracja).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildFMData, scoreMatch, isPairExcluded, FM_MIN_GAP, FM_MAX_M } from "../src/lib/fm-algo.js";
import { buildInputs, classifyPolish } from "./fm-simulate-lib.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const inputPath = arg("--input"), outDir = arg("--out"); if (!inputPath || !outDir) { console.error("podaj --input i --out"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const raw = readFileSync(inputPath, "utf8"); const inputSha = createHash("sha256").update(raw).digest("hex");
const S = JSON.parse(raw); const T = S.tables;

// ── PARAMETRY (do zatwierdzenia; --config nadpisuje pola) ───────────────────
const P = {
  megaChain: "ch35", biedronkaChain: "ch39",
  premium: { "88d6a20d-0b0f-4ae2-bc02-ceff5093b89f": "BIO KRETA (spółdzielnia z Chanii)", "765ea57d-a368-4909-b5fb-9f12bc5d1a5a": "Macondo Fruits SL", "b43d6616-ae4a-4e02-8398-12989456e2b9": "Agrocenter bv", "69c4b9a7-a245-44ba-a392-81a46fd9cd8c": "Orange for Agricultural Crops" },
  premiumCap: 9,
  online: { ch40: "Polomarket", ch37: "Dobronom", ch18: "Spar Polska", ch47: "Twój Market" }, onlineCap: 20,
  onlineSlotMin: 6, onlineChangeMin: 2, onlineReserveFrac: 0.2, attendance: [1.0, 0.9, 0.8],
  // próg preferowany NA STANOWISKO; byChain: nadpisania per sieć (id łańcucha, np. { ch11: 50 } dla Dino — do uzupełnienia przez Artura)
  soft: { default: 40, byChain: {} },
  // twardy limit per sieć (domyślnie z panelu: stanowiska × spotk./stan.; nadpisanie np. { ch05: 100 })
  hardOverride: {},
  orgReserve: { D5: 0.05, D10: 0.10 },
};
if (arg("--config")) { const c = JSON.parse(readFileSync(arg("--config"), "utf8")); for (const [k, v] of Object.entries(c)) P[k] = (v && typeof v === "object" && !Array.isArray(v) && P[k] && typeof P[k] === "object") ? { ...P[k], ...v } : v; }

// ── wejścia z podziałem sieci na kolejki kategorii (Dino) — jak w fm-simulate-variants.mjs ──
function buildInputsSplit(snapshot) {
  const base = buildInputs(snapshot);
  const groups = (snapshot.tables.fm_queue_groups || []); const stations = snapshot.tables.fm_stations || [];
  const maxDate = groups.reduce((m, g) => (g.event_date > m ? g.event_date : m), "");
  const active = groups.filter(g => g.active && g.event_date === maxDate);
  const byRetailer = {}; for (const g of active) (byRetailer[g.retailer_id] = byRetailer[g.retailer_id] || []).push({ ...g, st: stations.filter(s => s.queue_group_id === g.id && s.active).length });
  const compCats = {}; for (const c of snapshot.tables.companies) compCats[c.id] = c.categories || [];
  const chains = []; const routeOf = {};
  for (const ch of base.chains) {
    const gs = (byRetailer[ch.retailerId] || []).filter(g => g.st > 0);
    if (gs.length <= 1) { chains.push({ ...ch, parent: ch.id, queueLabel: null }); continue; }
    const general = gs.find(g => !(g.categories || []).length) || gs[0];
    for (const g of gs) chains.push({ id: `${ch.id}#${g.label}`, parent: ch.id, queueLabel: g.label, name: `${ch.name} · ${g.label}`, country: ch.country, retailerId: ch.retailerId, stations: g.st, capacity: g.st * Number(g.meetings_per_station || 60), categories: g.categories || [] });
    routeOf[ch.id] = (sup) => { const cats = compCats[sup.companyId] || []; const catGroup = gs.find(g => (g.categories || []).length && cats.length && cats.every(c => g.categories.includes(c))); return `${ch.id}#${(catGroup || general).label}`; };
  }
  const supById = Object.fromEntries(base.suppliers.map(s => [s.id, s]));
  const prefs = {}; for (const [sid, m] of Object.entries(base.prefs)) { prefs[sid] = {}; for (const [cid, v] of Object.entries(m)) { const dest = routeOf[cid] && supById[sid] ? routeOf[cid](supById[sid]) : cid; prefs[sid][dest] = v; } }
  const resps = {}; for (const [cid, m] of Object.entries(base.resps)) { for (const [sid, v] of Object.entries(m)) { const dest = routeOf[cid] && supById[sid] ? routeOf[cid](supById[sid]) : cid; (resps[dest] = resps[dest] || {})[sid] = v; } }
  return { ...base, chains, prefs, resps, split: Object.keys(routeOf), configDate: maxDate };
}

const inputs = buildInputsSplit(S);
inputs.suppliers = classifyPolish(inputs.suppliers, {});
const supById = Object.fromEntries(inputs.suppliers.map(s => [s.id, s]));
const chainById = Object.fromEntries(inputs.chains.map(c => [c.id, c]));
const chainLabel = id => chainById[id]?.name || id;
const parentOf = id => (id || "").split("#")[0];
const isOnline = id => !!P.online[parentOf(id)];
const premiumSid = Object.fromEntries(Object.keys(P.premium).map(uuid => [inputs.suppliers.find(s => s.companyId === uuid)?.id, uuid]).filter(([k]) => k && k !== "undefined"));
const supplierCap = s => FM_MAX_M * Math.max(1, Math.min(5, Number(s.fmPackages) || 1));
const stationsOf = cid => Math.max(1, Math.floor(Number(chainById[cid]?.stations) || 1));
// twardy limit = panel (stanowiska × spotk./stan.) lub nadpisanie; online = P.onlineCap gdy wariant to włącza
const panelHard = cid => { const c = chainById[cid]; const explicit = Number(c?.capacity); return Number.isFinite(explicit) && explicit > 0 ? Math.floor(explicit) : 60 * stationsOf(cid); };
const hardOf = (cid, cfg) => cfg.onlineCap && isOnline(cid) ? cfg.onlineCap : (P.hardOverride[parentOf(cid)] ?? P.hardOverride[cid] ?? panelHard(cid));
const softPerStation = cid => P.soft.byChain[parentOf(cid)] ?? P.soft.byChain[cid] ?? P.soft.default;
const softOf = (cid, cfg) => isOnline(cid) && cfg.onlineCap ? cfg.onlineCap : softPerStation(cid) * stationsOf(cid); // próg dla całej kolejki

// ── przebieg bazowy z nakładkami na wejściach ───────────────────────────────
function run(cfg) {
  const prefs = structuredClone(inputs.prefs);
  const suppliers = inputs.suppliers.map(s => cfg.premiumCap && premiumSid[s.id] ? { ...s, fmPackages: cfg.premiumCap / FM_MAX_M } : s);
  const chains = inputs.chains.map(c => {
    const hard = hardOf(c.id, cfg);
    const eff = cfg.reserveFrac && !isOnline(c.id) ? hard - Math.ceil(hard * cfg.reserveFrac) : hard;
    const stations = cfg.onlineCap && isOnline(c.id) ? 1 : c.stations;
    return { ...c, capacity: eff, hard, stations };
  });
  const r1 = buildFMData(prefs, inputs.resps, chains, suppliers);
  const r2 = buildFMData(structuredClone(prefs), structuredClone(inputs.resps), structuredClone(chains), structuredClone(suppliers));
  return { cfg, prefs, suppliers, chains, result: r1, deterministic: JSON.stringify(r1) === JSON.stringify(r2) };
}
const capOf = (ctx, cid) => { const c = ctx.chains.find(x => x.id === cid); return Math.floor(Number(c?.capacity) || panelHard(cid)); }; // pojemność PRZYDZIAŁU (efektywna)
const hardOfCtx = (ctx, cid) => ctx.chains.find(x => x.id === cid)?.hard ?? panelHard(cid);
const assignedMap = result => { const m = new Map(); for (const [sid, r] of Object.entries(result.res)) m.set(sid, new Set(r.m)); return m; };

// ── numeracja od nowa (port FAZY 3 + 5 z fm-algo.js, na zadanym zbiorze par) ──
function renumber(ctx, assigned) {
  const cands = [];
  for (const s of ctx.suppliers) for (const cid of (assigned.get(s.id) || [])) {
    const sPref = ctx.prefs[s.id]?.[cid], cResp = inputs.resps[cid]?.[s.id];
    cands.push({ sid: s.id, cid, score: scoreMatch(sPref, cResp), accepted: cResp === "want", paymentDate: s.paymentDate || "9999-99-99", pkgTier: s.pkg === "Premium" ? 0 : 1, sortIdx: s._sortIdx ?? 999 });
  }
  cands.sort((a, b) => (b.score - a.score) || (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : 0) || (a.pkgTier - b.pkgTier) || (a.sortIdx - b.sortIdx) || String(a.sid).localeCompare(String(b.sid)));
  const nums = {}, cq = {}, used = {}, res = {}, cs = {}, lastAcc = {};
  for (const s of ctx.suppliers) { nums[s.id] = {}; used[s.id] = new Set(); res[s.id] = { m: [], r: {} }; }
  for (const c of ctx.chains) { cq[c.id] = new Array(60).fill(null); cs[c.id] = { n: 0, list: [], cap: capOf(ctx, c.id), stations: c.stations || 1 }; }
  for (const cand of cands) {
    let n = cand.accepted ? 1 : (lastAcc[cand.cid] || 0) + 1; let safety = 0;
    while (safety++ < 1000) { const idx = n - 1; if (idx >= cq[cand.cid].length) cq[cand.cid].push(null); if (cq[cand.cid][idx] !== null) { n++; continue; } let near = false; for (const p of used[cand.sid]) if (Math.abs(n - p) < FM_MIN_GAP) { near = true; break; } if (near) { n++; continue; } break; }
    cq[cand.cid][n - 1] = cand.sid; used[cand.sid].add(n); nums[cand.sid][cand.cid] = n; res[cand.sid].m.push(cand.cid); res[cand.sid].r[cand.cid] = cand.score; cs[cand.cid].n++; cs[cand.cid].list.push(cand.sid);
    if (cand.accepted) lastAcc[cand.cid] = Math.max(lastAcc[cand.cid] || 0, n);
  }
  return { res, nums, cq, cs };
}

// ── próg preferowany: ponad progiem szukamy sieci rezerwowej z miejscem (etap po przydziale) ──
function rebalance(ctx, result, { sourceMode }) {
  const assigned = assignedMap(result); const moves = [];
  const load = {}; for (const c of ctx.chains) load[c.id] = result.cs[c.id]?.n || 0;
  const soft = cid => softOf(cid, ctx.cfg);
  const supPay = sid => supById[sid]?.paymentDate || "9999-99-99";
  const over = ctx.chains.filter(c => load[c.id] > soft(c.id)).sort((a, b) => (load[b.id] / stationsOf(b.id)) - (load[a.id] / stationsOf(a.id)));
  for (const ch of over) {
    // kandydaci do przeniesienia: pary-szanse (bez akceptacji kupca), najsłabsze i najpóźniej opłacone najpierw
    const here = [...assigned.entries()].filter(([sid, set]) => set.has(ch.id)).map(([sid]) => ({ sid, pref: ctx.prefs[sid]?.[ch.id], resp: inputs.resps[ch.id]?.[sid], score: scoreMatch(ctx.prefs[sid]?.[ch.id], inputs.resps[ch.id]?.[sid]) }))
      .filter(x => x.score < 4500 && (sourceMode === "any" ? true : x.pref === "thumb"))
      .sort((a, b) => (a.score - b.score) || (supPay(b.sid) < supPay(a.sid) ? -1 : supPay(b.sid) > supPay(a.sid) ? 1 : 0) || ((supById[b.sid]?.pkg === "Premium") - (supById[a.sid]?.pkg === "Premium")));
    for (const x of here) {
      if (load[ch.id] <= soft(ch.id)) break;
      const my = ctx.prefs[x.sid] || {};
      const ok = t => t !== ch.id && chainById[t] && my[t] !== "exclude" && !assigned.get(x.sid).has(t) && !isPairExcluded(my[t], inputs.resps[t]?.[x.sid]) && scoreMatch(my[t], inputs.resps[t]?.[x.sid]) > 0 && (load[t] + 1) <= capOf(ctx, t) && (load[t] + 1) <= soft(t);
      const byLoad = (a, b) => (load[a] / stationsOf(a)) - (load[b] / stationsOf(b));
      // najpierw sieci REZERWOWE (wybór rezerwowy firmy), potem główne z szansą — obie tylko pod progiem i w granicach pojemności
      const targets = [...Object.keys(my).filter(t => my[t] === "thumb" && ok(t)).sort(byLoad), ...Object.keys(my).filter(t => my[t] === "star" && ok(t)).sort(byLoad)];
      if (!targets.length) continue;
      const to = targets[0];
      assigned.get(x.sid).delete(ch.id); assigned.get(x.sid).add(to); load[ch.id]--; load[to]++;
      moves.push({ supplierId: x.sid, supplier: supById[x.sid].name, country: supById[x.sid].country, from: ch.id, to, fromPref: x.pref, fromResp: x.resp ?? null, toPref: my[to], toResp: inputs.resps[to]?.[x.sid] ?? null, fromScore: x.score, toScore: scoreMatch(my[to], inputs.resps[to]?.[x.sid]), fromLoadAfter: load[ch.id], toLoadAfter: load[to] });
    }
  }
  return { assigned, moves, ...renumber(ctx, assigned) };
}

// ── Premium: przycięcie PO przebiegu do N najlepszych (alternatywa dla limitu algorytmicznego) ──
function trimPremium(ctx, result, capN) {
  const assigned = assignedMap(result); const removed = [];
  for (const sid of Object.keys(premiumSid)) {
    const set = assigned.get(sid); if (!set || set.size <= capN) continue;
    const ranked = [...set].map(cid => ({ cid, score: result.res[sid].r[cid], pref: ctx.prefs[sid]?.[cid], resp: inputs.resps[cid]?.[sid], load: result.cs[cid]?.n || 0 }))
      // zachowaj: akceptacje kupca (score ≥ 4500), potem wyższy wynik pary, główny przed rezerwowym, mniej obciążona kolejka
      .sort((a, b) => (b.score - a.score) || ((a.pref === "star") - (b.pref === "star")) * -1 || (a.load - b.load));
    for (const x of ranked.slice(capN)) { set.delete(x.cid); removed.push({ supplierId: sid, supplier: supById[sid].name, chain: x.cid, score: x.score, pref: x.pref, resp: x.resp ?? null, protectedLost: x.score >= 4500 }); }
  }
  return { assigned, removed, ...renumber(ctx, assigned) };
}

// ── rezerwa online (lista oczekujących) i frekwencja ───────────────────────
function onlineReserve(ctx, R) {
  const out = {};
  for (const c of ctx.chains) {
    if (!isOnline(c.id)) continue;
    const cap = capOf(ctx, c.id); const n = R.cs[c.id]?.n || 0; const reserveN = Math.ceil(cap * P.onlineReserveFrac);
    const cands = ctx.suppliers.map(s => ({ s, score: scoreMatch(ctx.prefs[s.id]?.[c.id], inputs.resps[c.id]?.[s.id]) })).filter(x => x.score > 0 && !(R.res[x.s.id]?.m || []).includes(c.id) && (R.res[x.s.id]?.m.length || 0) < (premiumSid[x.s.id] && ctx.cfg.premiumCap ? ctx.cfg.premiumCap : supplierCap(x.s)))
      .sort((a, b) => (b.score - a.score) || ((a.s.paymentDate || "9999") < (b.s.paymentDate || "9999") ? -1 : 1) || (a.s._sortIdx - b.s._sortIdx)).slice(0, reserveN);
    const scenarios = P.attendance.map(a => { const invited = n + cands.length; const present = Math.round(invited * a); const served = Math.min(present, cap); return { attendance: a, invited, present, served, unserved: present - served, absent: invited - present }; });
    out[c.id] = { name: c.name, slotMin: P.onlineSlotMin + P.onlineChangeMin, windowMin: cap * (P.onlineSlotMin + P.onlineChangeMin), cap, assigned: n, demand: ctx.suppliers.filter(s => scoreMatch(ctx.prefs[s.id]?.[c.id], inputs.resps[c.id]?.[s.id]) > 0).length, reserve: cands.map(x => ({ supplierId: x.s.id, supplier: x.s.name, score: x.score })), scenarios };
  }
  return out;
}

// ── kontrole ────────────────────────────────────────────────────────────────
function checks(ctx, R, caps = {}) {
  const issues = [];
  for (const s of ctx.suppliers) {
    const m = R.res[s.id]?.m || []; const lim = caps[s.id] ?? supplierCap(s);
    if (m.length > lim) issues.push(`limit firmy: ${s.name} ${m.length}/${lim}`);
    if (new Set(m.map(parentOf)).size !== m.length) issues.push(`podwójna sieć: ${s.name}`);
    for (const cid of m) { if (parentOf(cid) === P.megaChain) issues.push(`zakazana sieć ${cid}: ${s.name}`); if (isPairExcluded(inputs.prefs[s.id]?.[cid], inputs.resps[cid]?.[s.id])) issues.push(`odrzucona para: ${s.name}×${cid}`); if (!inputs.prefs[s.id]?.[cid]) issues.push(`para bez wyboru firmy: ${s.name}×${cid}`); }
    const nums = Object.values(R.nums[s.id] || {}).sort((a, b) => a - b); for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] < FM_MIN_GAP) issues.push(`odstęp: ${s.name} ${nums.join(",")}`);
  }
  for (const c of ctx.chains) { const n = R.cs[c.id]?.n || 0; if (n > capOf(ctx, c.id)) issues.push(`pojemność: ${c.name} ${n}/${capOf(ctx, c.id)}`); if (n > hardOfCtx(ctx, c.id)) issues.push(`twardy limit: ${c.name} ${n}/${hardOfCtx(ctx, c.id)}`); const q = (R.cq[c.id] || []).filter(Boolean); if (new Set(q).size !== q.length) issues.push(`duplikat w kolejce ${c.name}`); }
  return issues;
}
const protectedWantsLost = (before, after) => { const lost = []; for (const [sid, r] of Object.entries(before.res)) for (const cid of r.m) if (r.r[cid] >= 4500 && !(after.res[sid]?.m || []).includes(cid)) lost.push({ supplier: supById[sid]?.name, chain: chainLabel(cid) }); return lost; };
const lostVs = (before, after) => { const rows = []; for (const s of inputs.suppliers) { const a = new Set(before.res[s.id]?.m || []), b = new Set(after.res[s.id]?.m || []); const lost = [...a].filter(c => !b.has(c)), gained = [...b].filter(c => !a.has(c)); if (a.size !== b.size || lost.length) rows.push({ supplierId: s.id, supplier: s.name, country: s.country, premium: !!premiumSid[s.id], before: a.size, after: b.size, lost: lost.map(chainLabel), gained: gained.map(chainLabel) }); } return rows; };

// ── tablica (kolumny = kolejki, wiersze = numery) ───────────────────────────
function board(ctx, R, { onlineRes = {} } = {}) {
  const cols = ctx.chains.map(c => c.id); const hard = Object.fromEntries(cols.map(cid => [cid, hardOfCtx(ctx, cid)])); const eff = Object.fromEntries(cols.map(cid => [cid, capOf(ctx, cid)])); const maxRows = Math.max(...Object.values(hard));
  const cells = {};
  for (const cid of cols) {
    const q = R.cq[cid] || []; let last = 0; for (let i = 0; i < q.length; i++) if (q[i]) last = i + 1;
    cells[cid] = {};
    for (let n = 1; n <= maxRows; n++) {
      const sid = q[n - 1];
      if (n > hard[cid]) { cells[cid][n] = { kind: "poza" }; continue; }
      if (sid) { const s = supById[sid]; const sc = R.res[sid].r[cid]; cells[cid][n] = { kind: sc >= 4500 ? "chce" : "szansa", supplier: s.name, country: s.country, isPL: !!s.isPL, premium: !!premiumSid[sid], score: sc, pref: ctx.prefs[sid]?.[cid] === "star" ? "główny" : ctx.prefs[sid]?.[cid] === "thumb" ? "rezerwowy" : "brak wyboru", overSoft: n > softOf(cid, ctx.cfg) }; continue; }
      if (n > eff[cid]) { cells[cid][n] = { kind: "rezerwa_org" }; continue; }
      cells[cid][n] = { kind: n < last ? "luka" : "wolne" };
    }
    const or = onlineRes[cid]; if (or) or.reserve.forEach((r, i) => { cells[cid][hard[cid] + 1 + i] = { kind: "rezerwa_online", supplier: r.supplier, score: r.score }; });
  }
  return { cols: cols.map(cid => ({ id: cid, name: chainLabel(cid), hard: hard[cid], eff: eff[cid], soft: softOf(cid, ctx.cfg), stations: stationsOf(cid), online: isOnline(cid) })), maxRows: maxRows + 8, cells };
}
function summary(ctx, R, extra = {}) {
  const caps = extra.caps || {};
  const meetings = ctx.suppliers.reduce((s, x) => s + (R.res[x.id]?.m.length || 0), 0);
  return { meetings, shortage: ctx.suppliers.filter(x => (R.res[x.id]?.m.length || 0) < (caps[x.id] ?? supplierCap(x))).length, noMeetings: ctx.suppliers.filter(x => (R.res[x.id]?.m.length || 0) === 0).length,
    maxPerStation: Math.max(...ctx.chains.map(c => (R.cs[c.id]?.n || 0) / stationsOf(c.id))), overSoft: ctx.chains.filter(c => (R.cs[c.id]?.n || 0) > softOf(c.id, ctx.cfg)).map(c => `${c.name} ${R.cs[c.id]?.n}/${softOf(c.id, ctx.cfg)}`),
    freeReserve: ctx.chains.filter(c => !isOnline(c.id)).reduce((s, c) => s + Math.max(0, hardOfCtx(ctx, c.id) - (R.cs[c.id]?.n || 0)), 0),
    loads: Object.fromEntries(ctx.chains.map(c => [c.id, { n: R.cs[c.id]?.n || 0, eff: capOf(ctx, c.id), hard: hardOfCtx(ctx, c.id), soft: softOf(c.id, ctx.cfg), stations: stationsOf(c.id), online: isOnline(c.id) }])), ...extra };
}
const premiumTable = (ctx, R) => Object.entries(premiumSid).map(([sid, uuid]) => ({ supplierId: sid, companyId: uuid, name: supById[sid].name, packages: supById[sid].fmPackages, paymentDate: supById[sid].paymentDate, meetings: (R.res[sid]?.m || []).map(cid => ({ chain: chainLabel(cid), score: R.res[sid].r[cid], pref: ctx.prefs[sid]?.[cid], resp: inputs.resps[cid]?.[sid] ?? null, nr: R.nums[sid]?.[cid] })) }));

// ── warianty ────────────────────────────────────────────────────────────────
const V = {}; const capsPremium = Object.fromEntries(Object.keys(premiumSid).map(sid => [sid, P.premiumCap]));
const A0 = run({}); V.A0 = { ctx: A0, R: A0.result, desc: "stan bieżący: prawdziwe dane (odmowy Biedronki w fm_resps, kraje z profili), pojemności z panelu (stanowiska × spotk./stan.)" };
const D1 = run({ onlineCap: P.onlineCap }); V.D1 = { ctx: D1, R: D1.result, desc: `A0 + sieci online (${Object.values(P.online).join(", ")}) twardo ${P.onlineCap} rozmów na 1 stanowisku — to, co daje ustawienie „Spotk./stan.” = ${P.onlineCap} w panelu` };
const D2 = run({ onlineCap: P.onlineCap, premiumCap: P.premiumCap }); V.D2 = { ctx: D2, R: D2.result, caps: capsPremium, desc: `D1 + 4 firmy Premium maks. ${P.premiumCap} spotkań (limit algorytmiczny, bez zmiany pakietów i dat wpłat)`, lostVsPrev: lostVs(D1.result, D2.result) };
const D2t = trimPremium(D1, D1.result, P.premiumCap); V.D2t = { ctx: D1, R: D2t, caps: capsPremium, desc: `D1 + te same 4 firmy przycięte PO przebiegu do ${P.premiumCap} najlepszych (akceptacje kupców zachowane, potem wynik pary, główny > rezerwowy)`, removed: D2t.removed, lostVsPrev: lostVs(D1.result, D2t), wantsLost: protectedWantsLost(D1.result, D2t) };
const D3 = rebalance(D2, D2.result, { sourceMode: "thumb" }); V.D3 = { ctx: D2, R: D3, caps: capsPremium, desc: `D2 + próg preferowany ${P.soft.default} na stanowisko (twardy limit z panelu): ponad progiem przenosimy szanse przy wyborze REZERWOWYM do sieci rezerwowej z miejscem; bez alternatywy — zostaje ponad progiem`, moves: D3.moves, wantsLost: protectedWantsLost(D2.result, D3), lostVsPrev: lostVs(D2.result, D3) };
const D3p = rebalance(D2, D2.result, { sourceMode: "any" }); V["D3+"] = { ctx: D2, R: D3p, caps: capsPremium, desc: "jak D3, ale przenosić wolno także szanse przy wyborze GŁÓWNYM (test; nie rekomendacja)", moves: D3p.moves, wantsLost: protectedWantsLost(D2.result, D3p), lostVsPrev: lostVs(D2.result, D3p) };
for (const [key, frac] of Object.entries(P.orgReserve)) {
  const Dr = run({ onlineCap: P.onlineCap, premiumCap: P.premiumCap, reserveFrac: frac });
  const R3 = rebalance(Dr, Dr.result, { sourceMode: "thumb" });
  V[key] = { ctx: Dr, R: R3, caps: capsPremium, desc: `D3 + rezerwa organizacyjna ${Math.round(frac * 100)} %: pojemność pierwszego przydziału = twarda − ceil(${frac} × twarda) dla sieci stacjonarnych (online bez rezerwy, lista oczekujących); miejsca rezerwy = wolne numery do twardej pojemności`, moves: R3.moves, wantsLost: protectedWantsLost(D3, R3), lostVsPrev: lostVs(D3, R3), reserveFrac: frac };
}

const noSel = T.companies.filter(c => c.fm_b2b_enabled && (c.account_status || "active") === "active" && !T.company_target_retailers.some(t => t.company_id === c.id)).map(c => ({ id: c.id, name: c.name, country: c.country, paymentDate: c.fm_payment_date || null, packages: c.fm_b2b_packages || 1 }));
const picksPerSupplier = inputs.suppliers.map(s => Object.keys(inputs.prefs[s.id] || {}).length).filter(n => n > 0);
const demandByChain = Object.fromEntries(inputs.chains.map(c => [c.id, { name: c.name, picks: inputs.suppliers.filter(s => inputs.prefs[s.id]?.[c.id] && inputs.prefs[s.id][c.id] !== "exclude").length, stars: inputs.suppliers.filter(s => inputs.prefs[s.id]?.[c.id] === "star").length, wants: inputs.suppliers.filter(s => inputs.resps[c.id]?.[s.id] === "want").length, removes: inputs.suppliers.filter(s => inputs.resps[c.id]?.[s.id] === "remove").length }]));
const out = { generated_at: new Date().toISOString(), snapshot_exported_at: S.exported_at, input_sha256: inputSha, app_commit: S.app_commit, config_date: inputs.configDate, params: P, split: inputs.split,
  chains: inputs.chains.map(c => ({ id: c.id, name: c.name, parent: c.parent, stations: stationsOf(c.id), panelHard: panelHard(c.id), online: isOnline(c.id), soft: softPerStation(c.id) })),
  suppliers: inputs.suppliers.map(s => ({ id: s.id, companyId: s.companyId, name: s.name, country: s.country, isPL: s.isPL, pkg: s.pkg, fmPackages: s.fmPackages, cap: premiumSid[s.id] ? P.premiumCap : supplierCap(s), paymentDate: s.paymentDate, premium: !!premiumSid[s.id], picks: Object.entries(inputs.prefs[s.id] || {}).map(([cid, v]) => ({ chain: cid, pref: v, resp: inputs.resps[cid]?.[s.id] ?? null })) })),
  noSelections: noSel, demand: { picksPerSupplierAvg: picksPerSupplier.reduce((a, b) => a + b, 0) / Math.max(1, picksPerSupplier.length), byChain: demandByChain, expectedLateMeetingsMax: noSel.reduce((s, c) => s + FM_MAX_M * Math.max(1, Math.min(5, Number(c.packages) || 1)), 0) },
  variants: {} };
for (const [k, v] of Object.entries(V)) {
  out.variants[k] = { desc: v.desc, summary: summary(v.ctx, v.R, { caps: v.caps || {}, deterministic: v.ctx.deterministic ?? true, issues: checks(v.ctx, v.R, v.caps || {}), moves: v.moves?.length || 0, wantsLost: v.wantsLost || [], reserveFrac: v.reserveFrac || 0 }),
    res: v.R.res, nums: v.R.nums, cs: v.R.cs, board: board(v.ctx, v.R, { onlineRes: onlineReserve(v.ctx, v.R) }), moves: v.moves || [], removed: v.removed || [], online: onlineReserve(v.ctx, v.R), premium: premiumTable(v.ctx, v.R), lostVsA0: lostVs(A0.result, v.R), lostVsPrev: v.lostVsPrev || [], wantsLost: v.wantsLost || [] };
}
writeFileSync(`${outDir}/warianty-d.json`, JSON.stringify(out), "utf8");
console.log("konfiguracja stanowisk z dnia:", inputs.configDate, "| kolejki:", inputs.chains.length, "| dostawcy:", inputs.suppliers.length, "| bez wyborów:", noSel.length, "| PL:", inputs.suppliers.filter(s => s.isPL).length);
console.log("premium:", JSON.stringify(Object.entries(premiumSid).map(([sid]) => ({ name: supById[sid].name.slice(0, 22), pk: supById[sid].fmPackages, pay: supById[sid].paymentDate, A0: V.A0.R.res[sid].m.length, D1: V.D1.R.res[sid].m.length, D2: V.D2.R.res[sid].m.length, D2t: V.D2t.R.res[sid].m.length }))));
for (const [k, v] of Object.entries(out.variants)) console.log(k.padEnd(4), JSON.stringify({ spotkania: v.summary.meetings, niedobor: v.summary.shortage, bez: v.summary.noMeetings, maxNaStan: +v.summary.maxPerStation.toFixed(1), nadProg: v.summary.overSoft, ruchy: v.summary.moves, utraconeChce: v.wantsLost.length, traciFirm: v.lostVsA0.filter(x => x.after < x.before).length, wolneRez: v.summary.freeReserve, kontrole: v.summary.issues.length ? v.summary.issues.slice(0, 3) : "OK", det: v.summary.deterministic }));
console.log("online (D1):", JSON.stringify(Object.values(out.variants.D1.online).map(o => ({ s: o.name, popyt: o.demand, przydz: o.assigned, cap: o.cap, oczek: o.reserve.length }))));
console.log("zapisano:", `${outDir}/warianty-d.json`);
