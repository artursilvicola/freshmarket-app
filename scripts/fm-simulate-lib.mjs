// Symulacja planu spotkań FM 2026 poza aplikacją (tylko lokalnie, bez bazy).
// Odtwarza DOKŁADNIE mapowanie wejść z panelu (src/legacy/PreconnectFM.jsx, commit 24f81d8):
//   - retailers → stan (fm26ChainId / fm26Active / active) i fmChains (stanowiska z modułu kolejek),
//   - companies → fmSuppliers (filtr B2B + aktywne, pkg z fm_b2b_tier, fmPackages, paymentDate, _sortIdx = kolejność z bazy),
//   - company_target_retailers → fmPrefs (priority >= 1000 = star, inaczej thumb; klucz sieci z note „chain:…”),
//   - fm_resps → fmResps (klucz sieci z meta.chain_id; klucz firmy z meta.supplier_legacy_id / legacy_fm_id / company_id).
// Wariant B: nakładka „exclude” w KOPII fmPrefs dla par (firma PL, Biedronka) — isPairExcluded działa przed punktacją.
import { buildFMData, FM_MAX_M, FM_MIN_GAP, isPairExcluded } from "../src/lib/fm-algo.js";

// Statyczna mapa z panelu (PreconnectFM.jsx ~1004) — fallback, gdy sieć nie ma fm26_chain_id.
export const CHAIN_TO_RETAILER = {
  "ch5":100, "ch9":103, "ch13":106, "ch2":104, "ch19":110,
  "ch1":0,   "ch3":114, "ch4":114, "ch6":100, "ch7":0,  "ch8":115,
  "ch10":107,"ch11":107,"ch12":0,  "ch14":0,  "ch15":113,
  "ch16":0,  "ch17":112,"ch18":120,"ch20":0,  "ch21":118,
  "ch22":0,  "ch23":0,  "ch24":118,"ch25":0,  "ch26":0,  "ch27":108,
};
export const RETAILER_TO_CHAIN = Object.fromEntries(Object.entries(CHAIN_TO_RETAILER).map(([ch, rid]) => [rid, ch]));

export function resolveChainIdFromRetailer(retailerId, retailers = [], meta = {}) {
  if (meta?.chain_id) return meta.chain_id;
  if (typeof meta?.note === "string" && meta.note.startsWith("chain:")) return meta.note.slice(6);
  const row = (retailers || []).find(r => Number(r.id) === Number(retailerId) && r.fm26ChainId);
  if (row?.fm26ChainId) return row.fm26ChainId;
  return RETAILER_TO_CHAIN[Number(retailerId)] || null;
}

// src/lib/fm-queue.js getFmQueueCapacityByRetailer() — bez event_date: najnowszy dzień z konfiguracją
export function queueCapacityByRetailer(groups = [], stations = []) {
  const rows = groups.map(g => ({ ...g, fm_stations: stations.filter(s => s.queue_group_id === g.id).map(s => ({ id: s.id, active: s.active })) }));
  const maxDate = rows.reduce((m, r) => (r.event_date > m ? r.event_date : m), "");
  const out = {};
  for (const g of rows) {
    if (!g.active || (maxDate && g.event_date !== maxDate)) continue;
    const st = (g.fm_stations || []).filter(s => s.active).length;
    if (!st) continue;
    const cur = out[g.retailer_id] || { stations: 0, capacity: 0, groups: 0 };
    cur.stations += st; cur.capacity += st * Number(g.meetings_per_station || 0); cur.groups += 1;
    out[g.retailer_id] = cur;
  }
  return out;
}

export function buildInputs(snapshot) {
  const T = snapshot.tables;
  // retailers → stan aplikacji (kolejność z bazy: ORDER BY name)
  const retailers = T.retailers.map(r => ({
    ...r,
    fm26ChainId: r.fm26_chain_id || r.fm26ChainId || RETAILER_TO_CHAIN[r.id] || null,
    fm26Active: !!(r.fm26_active ?? r.fm26Active ?? RETAILER_TO_CHAIN[r.id]),
    active: r.active !== false,
  }));
  const caps = queueCapacityByRetailer(T.fm_queue_groups || [], T.fm_stations || []);
  const chains = retailers
    .filter(r => r.fm26Active && r.active !== false && r.fm26ChainId)
    .map(r => ({ id: r.fm26ChainId, name: r.name, country: r.country, retailerId: r.id, stations: caps[r.id]?.stations ?? null, capacity: caps[r.id]?.capacity ?? null }));
  // companies → stan (fmId = legacy_fm_id), kolejność z bazy: ORDER BY name
  const companies = T.companies.map(r => ({ ...r, fmId: r.legacy_fm_id || r.fmId || null }));
  const suppliers = companies
    .filter(co => co.fm_b2b_enabled === true && (co.account_status || "active") === "active")
    .map((co, idx) => ({
      id: co.fmId || co.id, name: co.name, pkg: co.fm_b2b_tier === "premium" ? "Premium" : "Business", country: co.country,
      companyId: co.id, paymentDate: co.fm_payment_date || co.paymentDate || co.paidAt || null,
      fmB2bEnabled: co.fm_b2b_enabled !== false, fmPackages: Math.max(1, Math.min(5, Number(co.fm_b2b_packages) || 1)), _sortIdx: idx,
    }));
  // wybory → fmPrefs (kolejność jak w zapytaniu: priority DESC, company_id, retailer_id — kolejność nie wpływa na wynik, klucze są nadpisywane)
  const prefs = {};
  for (const row of T.company_target_retailers || []) {
    const coRow = companies.find(c => c.id === row.company_id);
    const supKey = coRow?.fmId || coRow?.legacy_fm_id || row.company_id;
    const chainKey = resolveChainIdFromRetailer(row.retailer_id, retailers, { note: row.note });
    if (!supKey || !chainKey) continue;
    if (!prefs[supKey]) prefs[supKey] = {};
    prefs[supKey][chainKey] = Number(row.priority || 0) >= 1000 ? "star" : "thumb";
  }
  // odpowiedzi kupców → fmResps
  const resps = {};
  for (const r of T.fm_resps || []) {
    if (!r.retailer_id) continue;
    const chainKey = resolveChainIdFromRetailer(r.retailer_id, retailers, r.meta || {});
    const supCompany = companies.find(c => c.id === r.supplier_company_id);
    const supKey = (r.meta && r.meta.supplier_legacy_id) || supCompany?.fmId || r.supplier_company_id;
    if (!chainKey || !supKey) continue;
    if (!resps[chainKey]) resps[chainKey] = {};
    resps[chainKey][supKey] = r.zone || r.status || null;
  }
  return { retailers, chains, suppliers, prefs, resps, caps };
}

// Klasyfikacja „polska firma” = country === 'PL' w profilu; nadpisania tylko w konfiguracji symulacji.
export function classifyPolish(suppliers, overrides = {}) {
  return suppliers.map(s => {
    const ov = overrides[s.companyId];
    const isPL = ov === "PL" ? true : ov === "NOT_PL" ? false : s.country === "PL";
    return { ...s, isPL, countrySource: ov ? `nadpisanie: ${ov}` : (s.country ? `profil: ${s.country}` : "BRAK KRAJU") };
  });
}

export function runVariant(inputs, { excludeChainId = null, polishIds = new Set() } = {}) {
  const prefs = structuredClone(inputs.prefs);
  const exclusions = [];
  if (excludeChainId) {
    for (const s of inputs.suppliers) {
      if (!polishIds.has(s.id)) continue;
      const origPref = inputs.prefs[s.id]?.[excludeChainId] ?? null;
      const origResp = inputs.resps[excludeChainId]?.[s.id] ?? null;
      if (!prefs[s.id]) prefs[s.id] = {};
      prefs[s.id][excludeChainId] = "exclude";
      exclusions.push({ supplierId: s.id, supplierName: s.name, chainId: excludeChainId, reason: "BIEDRONKA_NO_PL", originalPref: origPref, originalResp: origResp });
    }
  }
  const run1 = buildFMData(prefs, inputs.resps, inputs.chains, inputs.suppliers);
  const run2 = buildFMData(structuredClone(prefs), structuredClone(inputs.resps), structuredClone(inputs.chains), structuredClone(inputs.suppliers));
  const deterministic = JSON.stringify(run1) === JSON.stringify(run2);
  return { result: run1, exclusions, deterministic, prefsUsed: prefs };
}

export function supplierCapacity(s) { return FM_MAX_M * Math.max(1, Math.min(5, Number(s.fmPackages) || 1)); }

// Kontrole wyniku (bez zgadywania przyczyn)
export function checkResult(inputs, variant, { forbiddenChainIds = [], excludePairs = [] } = {}) {
  const { result } = variant; const issues = [];
  const forbidden = new Set(forbiddenChainIds);
  const exclSet = new Set(excludePairs.map(p => `${p.supplierId}::${p.chainId}`));
  for (const s of inputs.suppliers) {
    const m = result.res[s.id]?.m || [];
    if (m.length > supplierCapacity(s)) issues.push(`limit pakietów przekroczony: ${s.name} ${m.length}/${supplierCapacity(s)}`);
    if (new Set(m).size !== m.length) issues.push(`duplikat sieci u firmy ${s.name}`);
    for (const cid of m) {
      if (forbidden.has(cid)) issues.push(`zakazana sieć ${cid} u ${s.name}`);
      if (exclSet.has(`${s.id}::${cid}`)) issues.push(`para wykluczona testowo przydzielona: ${s.name} × ${cid}`);
      const resp = inputs.resps[cid]?.[s.id];
      if (isPairExcluded(inputs.prefs[s.id]?.[cid], resp)) issues.push(`odrzucona para przydzielona: ${s.name} × ${cid} (${resp})`);
    }
    const nums = Object.values(result.nums[s.id] || {}).sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] < FM_MIN_GAP) issues.push(`odstęp numerów < ${FM_MIN_GAP}: ${s.name} ${nums.join(",")}`);
  }
  for (const ch of inputs.chains) {
    const c = result.cs[ch.id];
    if (c && c.n > c.cap) issues.push(`pojemność sieci przekroczona: ${ch.name} ${c.n}/${c.cap}`);
    const q = (result.cq[ch.id] || []).filter(Boolean);
    if (new Set(q).size !== q.length) issues.push(`duplikat w kolejce sieci ${ch.name}`);
  }
  return issues;
}

export function diffVariants(inputs, A, B) {
  const chainName = id => inputs.chains.find(c => c.id === id)?.name || id;
  const rows = [];
  for (const s of inputs.suppliers) {
    const a = new Set(A.result.res[s.id]?.m || []), b = new Set(B.result.res[s.id]?.m || []);
    const lost = [...a].filter(x => !b.has(x)), gained = [...b].filter(x => !a.has(x));
    if (lost.length || gained.length || a.size !== b.size) rows.push({ supplier: s.name, country: s.country, isPL: s.isPL ?? null, meetingsA: a.size, meetingsB: b.size, lost: lost.map(chainName), gained: gained.map(chainName), capacity: supplierCapacity(s) });
  }
  return rows;
}
