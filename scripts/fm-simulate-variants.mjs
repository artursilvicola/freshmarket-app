// Warianty symulacji FM 2026 (wyłącznie lokalnie, bez bazy): B, C1, C2a/C2b, C3, C4, R5, R10.
// Użycie: node scripts/fm-simulate-variants.mjs --input <symulacja-wejscie.json> --out <folder> [--overrides kraje.json]
// Algorytm produkcyjny (src/lib/fm-algo.js) bez zmian; nakładki działają na wejściach (prefs/capacity) i po przydziale (przesunięcia + ponowna numeracja).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildFMData, scoreMatch, isPairExcluded, FM_MIN_GAP, FM_MAX_M } from "../src/lib/fm-algo.js";
import { buildInputs, classifyPolish, queueCapacityByRetailer } from "./fm-simulate-lib.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const inputPath = arg("--input"), outDir = arg("--out"); if (!inputPath || !outDir) { console.error("podaj --input i --out"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const raw = readFileSync(inputPath, "utf8"); const inputSha = createHash("sha256").update(raw).digest("hex");
const S = JSON.parse(raw); const T = S.tables;
const overrides = arg("--overrides") ? JSON.parse(readFileSync(arg("--overrides"), "utf8")) : {};

// ── PARAMETRY TESTOWE (nie zatwierdzone limity) ─────────────────────────────
const P = {
  biedronkaChain: "ch39", megaChain: "ch35",
  premium: { "88d6a20d-0b0f-4ae2-bc02-ceff5093b89f": "BIO KRETA (spółdzielnia z Chanii)", "765ea57d-a368-4909-b5fb-9f12bc5d1a5a": "Macondo Fruits SL", "b43d6616-ae4a-4e02-8398-12989456e2b9": "Agrocenter bv", "69c4b9a7-a245-44ba-a392-81a46fd9cd8c": "Orange for Agricultural Crops" },
  premiumCap: 9,
  online: { ch40: "Polomarket", ch37: "Dobronom", ch18: "Spar Polska", ch47: "Twój Market" },
  onlineSlotMin: 6, onlineChangeMin: 2, onlineWindows: { C2a: 120, C2b: 180 }, onlineReserveFrac: 0.2,
  softThreshold: 40, orgReserve: { R5: 0.05, R10: 0.10 }, attendance: [1.0, 0.9, 0.8],
};

// ── wejścia z podziałem sieci na kolejki kategorii (Dino) ──────────────────
function buildInputsSplit(snapshot) {
  const base = buildInputs(snapshot);
  const groups = (snapshot.tables.fm_queue_groups || []); const stations = snapshot.tables.fm_stations || [];
  const maxDate = groups.reduce((m, g) => (g.event_date > m ? g.event_date : m), "");
  const active = groups.filter(g => g.active && g.event_date === maxDate);
  const byRetailer = {}; for (const g of active) (byRetailer[g.retailer_id] = byRetailer[g.retailer_id] || []).push({ ...g, st: stations.filter(s => s.queue_group_id === g.id && s.active).length });
  const compCats = {}; for (const c of snapshot.tables.companies) compCats[c.id] = c.categories || [];
  const chains = []; const routeOf = {}; // parentChain -> fn(supplier) -> virtual chain id
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
  return { ...base, chains, prefs, resps, split: Object.keys(routeOf) };
}

const inputs = buildInputsSplit(S);
inputs.suppliers = classifyPolish(inputs.suppliers, overrides);
const supById = Object.fromEntries(inputs.suppliers.map(s => [s.id, s]));
const chainById = Object.fromEntries(inputs.chains.map(c => [c.id, c]));
const chainLabel = id => chainById[id]?.name || id;
const isOnline = id => !!P.online[(id || "").split("#")[0]];
const polishIds = new Set(inputs.suppliers.filter(s => s.isPL).map(s => s.id));
const premiumSid = Object.fromEntries(Object.keys(P.premium).map(uuid => [inputs.suppliers.find(s => s.companyId === uuid)?.id, uuid]).filter(([k]) => k));
const supplierCap = s => FM_MAX_M * Math.max(1, Math.min(5, Number(s.fmPackages) || 1)); // jak w algorytmie (fmPackages może być ułamkiem → limit 9)

// ── przebieg bazowy z nakładkami na wejściach ───────────────────────────────
function run(cfg) {
  const prefs = structuredClone(inputs.prefs); const exclusions = [];
  if (cfg.biedronkaNoPL) for (const s of inputs.suppliers) if (polishIds.has(s.id)) { const cid = P.biedronkaChain; exclusions.push({ supplierId: s.id, supplierName: s.name, chainId: cid, reason: "BIEDRONKA_NO_PL", originalPref: inputs.prefs[s.id]?.[cid] ?? null, originalResp: inputs.resps[cid]?.[s.id] ?? null }); (prefs[s.id] = prefs[s.id] || {})[cid] = "exclude"; }
  const suppliers = inputs.suppliers.map(s => cfg.premiumCap && premiumSid[s.id] ? { ...s, fmPackages: cfg.premiumCap / FM_MAX_M } : s);
  const chains = inputs.chains.map(c => cfg.onlineCap && isOnline(c.id) ? { ...c, capacity: cfg.onlineCap, stations: 1, onlineWindowMin: cfg.onlineWindowMin } : c);
  const r1 = buildFMData(prefs, inputs.resps, chains, suppliers);
  const r2 = buildFMData(structuredClone(prefs), structuredClone(inputs.resps), structuredClone(chains), structuredClone(suppliers));
  return { prefs, suppliers, chains, result: r1, deterministic: JSON.stringify(r1) === JSON.stringify(r2), exclusions };
}

// ── numeracja od nowa (port FAZY 3 + 5 z fm-algo.js, na zadanym zbiorze par) ──
function renumber(ctx, assigned) { // assigned: Map sid -> Set(cid)
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
function capOf(ctx, cid) { const c = ctx.chains.find(x => x.id === cid); const explicit = Number(c?.capacity); if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit); return 60 * Math.max(1, Math.floor(Number(c?.stations) || 1)); }
function assignedMap(result) { const m = new Map(); for (const [sid, r] of Object.entries(result.res)) m.set(sid, new Set(r.m)); return m; }

// ── wyrównywanie obciążenia (etap po przydziale) ───────────────────────────
function rebalance(ctx, result, { threshold, allowMain }) {
  const assigned = assignedMap(result); const moves = [];
  const load = {}; for (const c of ctx.chains) load[c.id] = result.cs[c.id]?.n || 0;
  const per = cid => load[cid] / Math.max(1, ctx.chains.find(c => c.id === cid)?.stations || 1);
  const supPay = sid => supById[sid]?.paymentDate || "9999-99-99";
  const over = ctx.chains.filter(c => per(c.id) > threshold).sort((a, b) => per(b.id) - per(a.id));
  for (const ch of over) {
    const here = [...assigned.entries()].filter(([sid, set]) => set.has(ch.id)).map(([sid]) => ({ sid, pref: ctx.prefs[sid]?.[ch.id], resp: inputs.resps[ch.id]?.[sid], score: scoreMatch(ctx.prefs[sid]?.[ch.id], inputs.resps[ch.id]?.[sid]) }))
      .filter(x => x.score < 4500 && (allowMain ? true : x.pref === "thumb"))
      .sort((a, b) => (a.score - b.score) || (supPay(b.sid) < supPay(a.sid) ? -1 : supPay(b.sid) > supPay(a.sid) ? 1 : 0) || ((supById[b.sid]?.pkg === "Premium") - (supById[a.sid]?.pkg === "Premium")));
    for (const x of here) {
      if (per(ch.id) <= threshold) break;
      const my = ctx.prefs[x.sid] || {};
      const targets = Object.keys(my).filter(t => t !== ch.id && chainById[t] && my[t] !== "exclude" && !assigned.get(x.sid).has(t) && !isPairExcluded(my[t], inputs.resps[t]?.[x.sid]) && scoreMatch(my[t], inputs.resps[t]?.[x.sid]) > 0 && (load[t] + 1) <= capOf(ctx, t) && (load[t] + 1) / Math.max(1, chainById[t].stations || 1) <= threshold)
        .sort((a, b) => (load[a] / Math.max(1, chainById[a].stations || 1)) - (load[b] / Math.max(1, chainById[b].stations || 1)));
      if (!targets.length) continue;
      const to = targets[0];
      assigned.get(x.sid).delete(ch.id); assigned.get(x.sid).add(to); load[ch.id]--; load[to]++;
      moves.push({ supplierId: x.sid, supplier: supById[x.sid].name, country: supById[x.sid].country, from: ch.id, to, fromPref: x.pref, fromResp: x.resp ?? null, toPref: my[to], toResp: inputs.resps[to]?.[x.sid] ?? null, fromScore: x.score, toScore: scoreMatch(my[to], inputs.resps[to]?.[x.sid]), fromLoadAfter: load[ch.id], toLoadAfter: load[to] });
    }
  }
  return { assigned, moves, ...renumber(ctx, assigned) };
}

// ── rezerwa organizacyjna ───────────────────────────────────────────────────
function orgReserve(ctx, result, frac) {
  const assigned = assignedMap(result); const plan = {}; const cost = [];
  for (const c of ctx.chains) {
    const cap = capOf(ctx, c.id); const need = Math.ceil(cap * frac); const n = result.cs[c.id]?.n || 0; const free = cap - n;
    let dropped = [];
    if (free < need) {
      const here = [...assigned.entries()].filter(([sid, set]) => set.has(c.id)).map(([sid]) => ({ sid, score: scoreMatch(ctx.prefs[sid]?.[c.id], inputs.resps[c.id]?.[sid]), pay: supById[sid]?.paymentDate || "9999" })).filter(x => x.score < 4500).sort((a, b) => (a.score - b.score) || (b.pay < a.pay ? -1 : b.pay > a.pay ? 1 : 0));
      dropped = here.slice(0, need - free);
      for (const d of dropped) { assigned.get(d.sid).delete(c.id); cost.push({ chain: c.id, supplierId: d.sid, supplier: supById[d.sid].name, score: d.score, reason: `rezerwa ${Math.round(frac * 100)}%: brakowało ${need - free} wolnych miejsc` }); }
    }
    plan[c.id] = { cap, need, freeBefore: free, dropped: dropped.length };
  }
  const num = renumber(ctx, assigned);
  // miejsca rezerwy: pierwsze wolne numery ZA ostatnim zajętym, w granicach pojemności
  const reserveSlots = {};
  for (const c of ctx.chains) { const q = num.cq[c.id]; const cap = capOf(ctx, c.id); let last = 0; for (let i = 0; i < Math.min(q.length, cap); i++) if (q[i]) last = i + 1; const slots = []; for (let n = last + 1; n <= cap && slots.length < plan[c.id].need; n++) slots.push(n); reserveSlots[c.id] = slots; plan[c.id].slots = slots; plan[c.id].shortfall = plan[c.id].need - slots.length; }
  return { assigned, cost, plan, reserveSlots, ...num };
}

// ── rezerwa online (lista warunkowa) i frekwencja ───────────────────────────
function onlineReserve(ctx, result) {
  const out = {};
  for (const c of ctx.chains) {
    if (!isOnline(c.id)) continue;
    const cap = capOf(ctx, c.id); const n = result.cs[c.id]?.n || 0; const reserveN = Math.ceil(cap * P.onlineReserveFrac);
    // kandydaci warunkowi: pary z oceną > 0, nieprzydzielone, firma ma wolny limit — w kolejności hierarchii
    const cands = ctx.suppliers.map(s => ({ s, score: scoreMatch(ctx.prefs[s.id]?.[c.id], inputs.resps[c.id]?.[s.id]) })).filter(x => x.score > 0 && !(result.res[x.s.id]?.m || []).includes(c.id) && (result.res[x.s.id]?.m.length || 0) < supplierCap(x.s))
      .sort((a, b) => (b.score - a.score) || ((a.s.paymentDate || "9999") < (b.s.paymentDate || "9999") ? -1 : 1) || (a.s._sortIdx - b.s._sortIdx)).slice(0, reserveN);
    const scenarios = P.attendance.map(a => { const invited = n + cands.length; const present = Math.round(invited * a); const served = Math.min(present, cap); return { attendance: a, invited, present, served, unserved: present - served, absent: invited - present }; });
    out[c.id] = { name: c.name, windowMin: c.onlineWindowMin, slotMin: P.onlineSlotMin + P.onlineChangeMin, cap, assigned: n, reserve: cands.map(x => ({ supplierId: x.s.id, supplier: x.s.name, score: x.score })), scenarios };
  }
  return out;
}

// ── kontrole ────────────────────────────────────────────────────────────────
function checks(ctx, R, { forbidden = [], exclusions = [], caps = {} }) {
  const issues = []; const excl = new Set(exclusions.map(e => `${e.supplierId}::${e.chainId}`)); const forb = new Set(forbidden);
  for (const s of ctx.suppliers) {
    const m = R.res[s.id]?.m || []; const lim = caps[s.id] ?? supplierCap(s);
    if (m.length > lim) issues.push(`limit firmy: ${s.name} ${m.length}/${lim}`);
    if (new Set(m.map(c => c.split("#")[0])).size !== m.length) issues.push(`podwójna sieć: ${s.name}`);
    for (const cid of m) { if (forb.has(cid.split("#")[0])) issues.push(`zakazana sieć ${cid}: ${s.name}`); if (excl.has(`${s.id}::${cid.split("#")[0]}`)) issues.push(`para wykluczona przydzielona: ${s.name}×${cid}`); if (isPairExcluded(inputs.prefs[s.id]?.[cid], inputs.resps[cid]?.[s.id])) issues.push(`odrzucona para: ${s.name}×${cid}`); }
    const nums = Object.values(R.nums[s.id] || {}).sort((a, b) => a - b); for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] < FM_MIN_GAP) issues.push(`odstęp: ${s.name} ${nums.join(",")}`);
  }
  for (const c of ctx.chains) { const n = R.cs[c.id]?.n || 0; if (n > capOf(ctx, c.id)) issues.push(`pojemność: ${c.name} ${n}/${capOf(ctx, c.id)}`); const q = (R.cq[c.id] || []).filter(Boolean); if (new Set(q).size !== q.length) issues.push(`duplikat w kolejce ${c.name}`); }
  return issues;
}
function protectedWantsLost(before, after) { const lost = []; for (const [sid, r] of Object.entries(before.res)) for (const cid of r.m) if (r.r[cid] >= 4500 && !(after.res[sid]?.m || []).includes(cid)) lost.push({ supplier: supById[sid]?.name, chain: chainLabel(cid) }); return lost; }

// ── tablica (kolumny = kolejki, wiersze = numery) ───────────────────────────
function board(ctx, R, { orgSlots = {}, onlineRes = {} } = {}) {
  const cols = ctx.chains.map(c => c.id); const cap = Object.fromEntries(cols.map(cid => [cid, capOf(ctx, cid)])); const maxRows = Math.max(...Object.values(cap));
  const cells = {};
  for (const cid of cols) {
    const q = R.cq[cid] || []; let last = 0; for (let i = 0; i < q.length; i++) if (q[i]) last = i + 1;
    cells[cid] = {};
    for (let n = 1; n <= maxRows; n++) {
      const sid = q[n - 1];
      if (n > cap[cid]) { cells[cid][n] = { kind: "poza" }; continue; }
      if (sid) { const s = supById[sid]; const sc = R.res[sid].r[cid]; cells[cid][n] = { kind: sc >= 4500 ? "chce" : "szansa", supplier: s.name, country: s.country, isPL: !!s.isPL, premium: !!premiumSid[sid], score: sc, pref: ctx.prefs[sid]?.[cid] === "star" ? "główny" : ctx.prefs[sid]?.[cid] === "thumb" ? "rezerwowy" : "brak wyboru" }; continue; }
      if ((orgSlots[cid] || []).includes(n)) { cells[cid][n] = { kind: "rezerwa_org" }; continue; }
      cells[cid][n] = { kind: n < last ? "luka" : "wolne" };
    }
    const or = onlineRes[cid]; if (or) or.reserve.forEach((r, i) => { cells[cid][cap[cid] + 1 + i] = { kind: "rezerwa_online", supplier: r.supplier, score: r.score }; });
  }
  return { cols: cols.map(cid => ({ id: cid, name: chainLabel(cid), cap: cap[cid], stations: chainById[cid].stations || 1, online: isOnline(cid) })), maxRows: maxRows + 8, cells };
}
function summary(ctx, R, extra = {}) {
  const meetings = ctx.suppliers.reduce((s, x) => s + (R.res[x.id]?.m.length || 0), 0);
  const caps = extra.caps || {};
  return { meetings, shortage: ctx.suppliers.filter(x => (R.res[x.id]?.m.length || 0) < (caps[x.id] ?? supplierCap(x))).length, noMeetings: ctx.suppliers.filter(x => (R.res[x.id]?.m.length || 0) === 0).length, maxPerStation: Math.max(...ctx.chains.map(c => (R.cs[c.id]?.n || 0) / Math.max(1, c.stations || 1))), overThreshold: ctx.chains.filter(c => (R.cs[c.id]?.n || 0) / Math.max(1, c.stations || 1) > P.softThreshold).map(c => `${c.name} ${R.cs[c.id]?.n}`), loads: Object.fromEntries(ctx.chains.map(c => [c.id, { n: R.cs[c.id]?.n || 0, cap: capOf(ctx, c.id), stations: c.stations || 1 }])), ...extra };
}

// ── warianty ────────────────────────────────────────────────────────────────
const V = {};
const B = run({ biedronkaNoPL: true }); V.B = { ctx: B, R: B.result, exclusions: B.exclusions };
const C1 = run({ biedronkaNoPL: true, premiumCap: P.premiumCap }); V.C1 = { ctx: C1, R: C1.result, exclusions: C1.exclusions };
const capsC1 = Object.fromEntries(Object.keys(premiumSid).map(sid => [sid, P.premiumCap]));
for (const [key, win] of Object.entries(P.onlineWindows)) { const cap = Math.floor(win / (P.onlineSlotMin + P.onlineChangeMin)); const C2 = run({ biedronkaNoPL: true, premiumCap: P.premiumCap, onlineCap: cap, onlineWindowMin: win }); V[key] = { ctx: C2, R: C2.result, exclusions: C2.exclusions, online: onlineReserve(C2, C2.result), onlineCap: cap, windowMin: win }; }
const base3 = V.C2b; const C3 = rebalance(base3.ctx, base3.R, { threshold: P.softThreshold, allowMain: false }); V.C3 = { ctx: base3.ctx, R: C3, exclusions: base3.exclusions, moves: C3.moves, online: onlineReserve(base3.ctx, C3), wantsLost: protectedWantsLost(base3.R, C3) };
const C4 = rebalance(base3.ctx, base3.R, { threshold: P.softThreshold, allowMain: true }); V.C4 = { ctx: base3.ctx, R: C4, exclusions: base3.exclusions, moves: C4.moves, online: onlineReserve(base3.ctx, C4), wantsLost: protectedWantsLost(base3.R, C4) };
for (const [key, frac] of Object.entries(P.orgReserve)) { const Rr = orgReserve(base3.ctx, C3, frac); V[key] = { ctx: base3.ctx, R: Rr, exclusions: base3.exclusions, reserve: Rr.plan, cost: Rr.cost, reserveSlots: Rr.reserveSlots, online: onlineReserve(base3.ctx, Rr), wantsLost: protectedWantsLost(C3, Rr), basedOn: "C3" }; }

const out = { generated_at: new Date().toISOString(), snapshot_exported_at: S.exported_at, input_sha256: inputSha, app_commit: S.app_commit, params: P, split: inputs.split, chains: inputs.chains.map(c => ({ id: c.id, name: c.name, parent: c.parent, stations: c.stations, capacity: capOf(inputs, c.id), online: isOnline(c.id) })), suppliers: inputs.suppliers.map(s => ({ id: s.id, companyId: s.companyId, name: s.name, country: s.country, isPL: s.isPL, countrySource: s.countrySource, pkg: s.pkg, fmPackages: s.fmPackages, cap: premiumSid[s.id] ? P.premiumCap : supplierCap(s), paymentDate: s.paymentDate, premium: !!premiumSid[s.id], picks: Object.entries(inputs.prefs[s.id] || {}).map(([cid, v]) => ({ chain: cid, pref: v, resp: inputs.resps[cid]?.[s.id] ?? null })) })), noSelections: T.companies.filter(c => c.fm_b2b_enabled && (c.account_status || "active") === "active" && !T.company_target_retailers.some(t => t.company_id === c.id)).map(c => ({ id: c.id, name: c.name, country: c.country })), variants: {} };
for (const [k, v] of Object.entries(V)) {
  const caps = k === "B" ? {} : capsC1;
  out.variants[k] = { summary: summary(v.ctx, v.R, { caps, deterministic: v.ctx.deterministic ?? true, issues: checks(v.ctx, v.R, { forbidden: [P.megaChain], exclusions: v.exclusions, caps }), moves: v.moves?.length, wantsLost: v.wantsLost || [], onlineCap: v.onlineCap, windowMin: v.windowMin }), res: v.R.res, nums: v.R.nums, cs: v.R.cs, board: board(v.ctx, v.R, { orgSlots: v.reserveSlots || {}, onlineRes: v.online || {} }), moves: v.moves || [], online: v.online || {}, reserve: v.reserve || null, cost: v.cost || [], wantsLost: v.wantsLost || [] };
}
writeFileSync(`${outDir}/warianty.json`, JSON.stringify(out), "utf8");
for (const [k, v] of Object.entries(out.variants)) console.log(k.padEnd(4), JSON.stringify({ spotkania: v.summary.meetings, niedobor: v.summary.shortage, bez: v.summary.noMeetings, maxNaStan: +v.summary.maxPerStation.toFixed(1), nadProg: v.summary.overThreshold, ruchy: v.summary.moves ?? 0, utraconeChce: v.wantsLost.length, kontrole: v.summary.issues.length ? v.summary.issues.slice(0, 3) : "OK", det: v.summary.deterministic }));
console.log("premium:", JSON.stringify(Object.entries(premiumSid).map(([sid, u]) => ({ name: supById[sid].name.slice(0, 24), B: out.variants.B.res[sid].m.length, C1: out.variants.C1.res[sid].m.length }))));
console.log("zapisano:", `${outDir}/warianty.json`);
