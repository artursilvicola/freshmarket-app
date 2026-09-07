// ═════════════════════════════════════════════════════════════════════════
// [feat/fm-queue] Algorytm dopasowania spotkań B2B Fresh Market — czysty moduł
// (bez React, bez Supabase), wyciągnięty z src/legacy/PreconnectFM.jsx, żeby
// dało się go testować (vitest) i żeby pojemność sieci wynikała z liczby
// stanowisk skonfigurowanych w module kolejek (fm_queue_groups / fm_stations).
//
// Hierarchia priorytetów spotkań B2B (zatwierdzona przez biznes):
//   1) mutual match wygrywa z jednostronnym ZAWSZE
//   2) w obrębie tej samej kategorii: payment_date ASC (kto wcześniej zapłacił)
//   3) sieci główne (⭐) przed zapasowymi (👍)
//   4) Premium przed Business przy remisie (pkgTier)
//   5) Standard nie idzie do matchingu
//   6) min odstęp ≥ FM_MIN_GAP między spotkaniami tej samej firmy
//
// Pojemność sieci (decyzja 7 §14 + review Codexa 6.09: 60 na stanowisko):
//   pojemność = FM_MEETINGS_PER_STATION × liczba AKTYWNYCH stanowisk sieci
//   (1 → 60, 2 równoległe → 120). FM_MAX_M=5 to limit spotkań NA PAKIET DOSTAWCY,
//   nie pojemność kupca. Brak konfiguracji stanowisk → jawny fallback 1
//   stanowisko + ostrzeżenie `no_station_config`; plan ponad pojemność →
//   ostrzeżenie `chain_full` (admin widzi je przed zatwierdzeniem).
//   FM_MAX_S pozostaje wyłącznie przestrzenią numeracji (rozmiar startowy cq),
//   NIE limitem spotkań.
//
// Output format (niezmieniony — backward compat z PageSupplierFM/Buyer/Admin):
//   { res: {sid: {m: [cid...], r: {cid: score}}},
//     cs:  {cid: {n: count, list: [sid...], cap: capacity}},
//     nums:{sid: {cid: slotNumber}},
//     cq:  {cid: [sid|null array indexed by slot-1]},
//     warnings: [{type, ...}] }
// ═════════════════════════════════════════════════════════════════════════

export const FM_MAX_M = 5;   // maks. spotkań jednej firmy na 1 pakiet
export const FM_MAX_S = 60;  // przestrzeń numeracji (startowa długość kolejki sieci)

// Ile spotkań mieści jedno fizyczne stanowisko sieci w ciągu dnia (2025: do 53).
// Parametr konfigurowalny: nadpisanie per sieć przez `chain.meetingsPerStation`
// (z fm_queue_groups.meetings_per_station) lub globalnie przez opts.meetingsPerStation.
export const FM_MEETINGS_PER_STATION = 60;

export const FM_SCORE = {
  MUTUAL_STAR_WANT:     6000, // A — firma ⭐ + sieć ✅
  MUTUAL_THUMB_WANT:    5000, // B — firma 👍 + sieć ✅
  MUTUAL_STAR_CHANCE:   4000, // D — firma ⭐ + sieć 🤝
  MUTUAL_THUMB_CHANCE:  3000, // E — firma 👍 + sieć 🤝
  ONE_SIDE_WANT:        2000, // C — sieć ✅, firma nie wybrała
  ONE_SIDE_CHANCE:      1000, // F — sieć 🤝, firma nie wybrała
};

// Minimalny odstęp numerów między spotkaniami tej samej firmy.
// 2 = firma z 1 i 3 OK, ale 1 i 2 zabronione (musi zdążyć fizycznie).
export const FM_MIN_GAP = 2;

// Pakiety wykluczone z matchmakingu (Standard = networking + Speed Dating).
export const FM_EXCLUDED_PACKAGES = new Set(["Standard"]);

// Progi stref kolorystycznych (kolejność numerków).
export const FM_ZONE_GREEN_MAX = 25;
export const FM_ZONE_ORANGE_MAX = 35;

export function getFMZone(pos) {
  if (pos == null) return "blocked";
  if (pos <= FM_ZONE_GREEN_MAX) return "green";
  if (pos <= FM_ZONE_ORANGE_MAX) return "orange";
  return "red";
}

// ZASADA 0 — twarde wykluczenia per-supplier (przed jakimkolwiek scoringiem).
export function isSupplierEligible(supplier) {
  if (!supplier) return false;
  if (FM_EXCLUDED_PACKAGES.has(supplier.pkg)) return false;
  if (supplier.fmB2bEnabled === false) return false;
  return true;
}

// ZASADA 0 — twarde wykluczenia per-pair.
//   chainResp: odpowiedź kupca w fm_resps.zone (UI buyer: ❌ Nie chcę)
//   supplierPref: pref firmy w fm_prefs (przyszłościowo 4. stan „wyklucz")
export function isPairExcluded(supplierPref, chainResp) {
  if (chainResp === "remove" || chainResp === "rejected") return true;
  if (supplierPref === "exclude" || supplierPref === "rejected" || supplierPref === "remove") return true;
  return false;
}

// Ocena pary (supplier, chain) wg hierarchii biznesowej. Tylko PO Zasadzie 0.
export function scoreMatch(supplierPref, chainResp) {
  if (!chainResp) return 0;
  const isWant   = chainResp === "want";
  const isChance = chainResp === "chance";
  const isStar   = supplierPref === "star";
  const isThumb  = supplierPref === "thumb";
  const isMutual = isStar || isThumb;
  if (isMutual && isWant   && isStar)  return FM_SCORE.MUTUAL_STAR_WANT;
  if (isMutual && isWant   && isThumb) return FM_SCORE.MUTUAL_THUMB_WANT;
  if (isMutual && isChance && isStar)  return FM_SCORE.MUTUAL_STAR_CHANCE;
  if (isMutual && isChance && isThumb) return FM_SCORE.MUTUAL_THUMB_CHANCE;
  if (!isMutual && isWant)   return FM_SCORE.ONE_SIDE_WANT;
  if (!isMutual && isChance) return FM_SCORE.ONE_SIDE_CHANCE;
  return 0;
}

// Pula spotkań firmy = FM_MAX_M × liczba pakietów Business (1–5).
export function supplierCapacity(s) {
  return FM_MAX_M * Math.max(1, Math.min(5, Number(s?.fmPackages) || 1));
}

// Pojemność sieci = meetingsPerStation × aktywne stanowiska.
// Zwraca { cap, stations, perStation, configured } — `configured: false` oznacza
// fallback 1 stanowisko (admin dostaje ostrzeżenie w buildFMData).
export function chainCapacity(chain, opts = {}) {
  // Jawna pojemność (np. suma po grupach split z różnym meetings_per_station,
  // policzona z fm_queue_groups × fm_stations) ma pierwszeństwo.
  const explicit = Number(chain?.capacity);
  if (Number.isFinite(explicit) && explicit > 0) {
    const st = Math.max(1, Math.floor(Number(chain?.stations) || 1));
    return { cap: Math.floor(explicit), stations: st, perStation: Math.floor(explicit / st), configured: true };
  }
  const fromOpts = opts.stationsByChain?.[chain?.id];
  const raw = fromOpts != null ? fromOpts : chain?.stations;
  const configured = raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0;
  const stations = configured ? Math.floor(Number(raw)) : 1;
  const perRaw = chain?.meetingsPerStation ?? opts.meetingsPerStation ?? FM_MEETINGS_PER_STATION;
  const perStation = Math.max(1, Math.floor(Number(perRaw) || FM_MEETINGS_PER_STATION));
  return { cap: perStation * stations, stations, perStation, configured };
}

// buildFMData(prefs, resps, chains, suppliers, opts?)
//   prefs: {sid: {cid: "star"|"thumb"|...}}   resps: {cid: {sid: "want"|"chance"|"remove"}}
//   chains: [{id, name, stations?, meetingsPerStation?}]
//   suppliers: [{id, name, pkg, fmPackages?, paymentDate?, fmB2bEnabled?, _sortIdx?}]
//   opts: { stationsByChain?: {cid: n}, meetingsPerStation?: n }
export function buildFMData(prefs, resps, chains, suppliers, opts = {}) {
  // BEZ fallbacku do danych demo — pusta lista ma dawać pusty plan.
  const _chains    = chains    || [];
  const _suppliers = suppliers || [];
  const _prefs = prefs || {};
  const _resps = resps || {};
  const warnings = [];

  // FAZA 0 — twarde wykluczenia per-supplier
  const eligible = _suppliers.filter(isSupplierEligible);

  // FAZA 1 — struktury wynikowe (dla WSZYSTKICH firm; wykluczone zostają z m: [])
  const res = {}, cs = {}, nums = {}, cq = {};
  const used = {};  // sid -> Set(numerów tej firmy globalnie)
  const capOfChain = {};
  _suppliers.forEach(s => { res[s.id] = { m: [], r: {} }; nums[s.id] = {}; used[s.id] = new Set(); });
  _chains.forEach(ch => {
    const c = chainCapacity(ch, opts);
    capOfChain[ch.id] = c.cap;
    cs[ch.id] = { n: 0, list: [], cap: c.cap, stations: c.stations, perStation: c.perStation };
    cq[ch.id] = new Array(Math.max(60, FM_MAX_S)).fill(null);
    if (!c.configured) {
      warnings.push({
        type: "no_station_config",
        chainId: ch.id,
        chainName: ch.name,
        capacity: c.cap,
        message: `Sieć ${ch.name || ch.id}: brak konfiguracji stanowisk w module kolejek — przyjęto 1 stanowisko (pojemność ${c.cap} spotkań). Ustaw stanowiska w „Dzień wydarzenia" i uruchom algorytm ponownie.`,
      });
    }
  });

  // FAZA 2 — kandydaci (pary z score > 0 po Zasadzie 0 per-pair)
  const candidates = [];
  eligible.forEach(s => {
    _chains.forEach(ch => {
      const sPref = _prefs[s.id]?.[ch.id];
      const cResp = _resps[ch.id]?.[s.id];
      if (isPairExcluded(sPref, cResp)) return;
      const score = scoreMatch(sPref, cResp);
      if (score <= 0) return;
      candidates.push({
        supplier: s, chain: ch, score,
        paymentDate: s.paymentDate || s.paidAt || "9999-99-99",
        pkgTier: s.pkg === "Premium" ? 0 : s.pkg === "Business" ? 1 : 2,
        sortIdx: s._sortIdx ?? 999,
      });
    });
  });

  // FAZA 3 — sortowanie: score DESC → payment ASC → pkg (Premium first) → idx → id
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.paymentDate !== b.paymentDate) return a.paymentDate < b.paymentDate ? -1 : 1;
    if (a.pkgTier !== b.pkgTier) return a.pkgTier - b.pkgTier;
    if (a.sortIdx !== b.sortIdx) return a.sortIdx - b.sortIdx;
    return String(a.supplier.id).localeCompare(String(b.supplier.id));
  });

  // FAZA 4 — przypisywanie multi-pass (round-robin po liczbie spotkań firmy)
  const maxPass = eligible.reduce((m, s) => Math.max(m, supplierCapacity(s)), FM_MAX_M);
  const pairsAssigned = new Set();
  const rejectedByCap = {};  // cid -> liczba par odrzuconych przez pojemność sieci
  for (let pass = 1; pass <= maxPass; pass++) {
    for (const cand of candidates) {
      const sid = cand.supplier.id;
      const cid = cand.chain.id;
      if (res[sid].m.length >= supplierCapacity(cand.supplier)) continue;
      if (res[sid].m.length >= pass) continue;
      if (res[sid].m.length < pass - 1) continue;
      if (pairsAssigned.has(`${sid}::${cid}`)) continue;
      if (cs[cid].n >= capOfChain[cid]) { rejectedByCap[cid] = (rejectedByCap[cid] || 0) + 1; continue; }
      res[sid].m.push(cid);
      res[sid].r[cid] = cand.score;
      cs[cid].n++;
      cs[cid].list.push(sid);
      pairsAssigned.add(`${sid}::${cid}`);
    }
  }

  // FAZA 5 — numerowanie z FM_MIN_GAP (ten sam porządek co przy przypisaniu)
  for (const cand of candidates) {
    const sid = cand.supplier.id;
    const cid = cand.chain.id;
    if (!pairsAssigned.has(`${sid}::${cid}`)) continue;
    if (nums[sid][cid] != null) continue;
    let n = 1, safety = 0;
    while (safety++ < 1000) {
      const idx = n - 1;
      if (idx >= cq[cid].length) cq[cid].push(null);
      if (cq[cid][idx] !== null) { n++; continue; }
      let hasNearby = false;
      for (const prev of used[sid]) { if (Math.abs(n - prev) < FM_MIN_GAP) { hasNearby = true; break; } }
      if (hasNearby) { n++; continue; }
      break;
    }
    cq[cid][n - 1] = sid;
    used[sid].add(n);
    nums[sid][cid] = n;
  }

  // FAZA 6 — ostrzeżenia dla admina
  for (const ch of _chains) {
    const rej = rejectedByCap[ch.id] || 0;
    if (rej > 0) {
      warnings.push({
        type: "chain_full",
        chainId: ch.id,
        chainName: ch.name,
        capacity: capOfChain[ch.id],
        rejected: rej,
        message: `Sieć ${ch.name || ch.id}: pojemność ${capOfChain[ch.id]} spotkań (${cs[ch.id].stations} × ${cs[ch.id].perStation}) wyczerpana — ${rej} dopasowań nie weszło. Dodaj stanowisko lub zwiększ liczbę spotkań na stanowisko.`,
      });
    }
  }
  for (const s of eligible) {
    const sid = s.id;
    const mtgs = res[sid].m;
    if (mtgs.length === 0) {
      warnings.push({
        type: "no_meetings", supplierId: sid, supplierName: s.name,
        message: `Firma ${s.name} (${s.pkg}) nie ma żadnych spotkań — sprawdź czy sieci ją odrzuciły lub dodaj alternatywy ręcznie.`,
      });
      continue;
    }
    const starRed = mtgs.filter(cid => {
      const score = res[sid].r[cid];
      const isStar = score === FM_SCORE.MUTUAL_STAR_WANT || score === FM_SCORE.MUTUAL_STAR_CHANCE;
      return isStar && nums[sid][cid] > FM_ZONE_ORANGE_MAX;
    });
    const thumbGreen = mtgs.filter(cid => {
      const score = res[sid].r[cid];
      const isThumb = score === FM_SCORE.MUTUAL_THUMB_WANT || score === FM_SCORE.MUTUAL_THUMB_CHANCE;
      return isThumb && nums[sid][cid] <= FM_ZONE_GREEN_MAX;
    });
    if (starRed.length > 0 && thumbGreen.length > 0) {
      const starCid = starRed[0], thumbCid = thumbGreen[0];
      const starCh = _chains.find(c => c.id === starCid);
      const thumbCh = _chains.find(c => c.id === thumbCid);
      warnings.push({
        type: "swap_star_thumb", supplierId: sid, supplierName: s.name,
        message: `Firma ${s.name}: sieć GŁÓWNA ${starCh?.name || starCid} ma numer ${nums[sid][starCid]} (czerwona), a REZERWOWA ${thumbCh?.name || thumbCid} ma numer ${nums[sid][thumbCid]} (zielona). Rozważ zamianę priorytetu w korektach.`,
        starChainId: starCid, thumbChainId: thumbCid,
      });
    }
  }

  return { res, cs, nums, cq, warnings };
}
