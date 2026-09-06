// [feat/fm-plan-export] Model kart spotkań B2B — z surowych danych (fm-plan-data)
// do gotowych obiektów kart dostawcy i sieci. Czysty JS (Node + przeglądarka).
//
// Źródło par: fm_settings.schedule (zatwierdzony plan): nums[sid][cid] = numer.
//   sid = UUID firmy (po fix/fm-real-companies) lub legacy id, cid = retailers.fm26_chain_id.
// Gdy planu nie ma (faza preferencji) a caller prosi o symulację — budujemy
// robocze pary z wyborów dostawców (gwiazdki/rezerwowe), a przy ich braku
// losowo-deterministycznie, żeby dało się obejrzeć karty na realnych firmach.
// Karty z symulacji dostają znak wodny i flagę mode="simulation".
import { langFor, countryName, categoryLabel } from "./i18n.js";

const PKG_LABEL = { business: "Business", premium: "Premium" };
const norm = (s) => (s == null ? "" : String(s).trim());

export function initials(name) {
  const words = norm(name).replace(/&amp;/g, "&").split(/[\s\-–]+/).filter((w) => /^[A-ZÀ-Ż0-9]/.test(w) && !/^(sp|z|o\.?o|s\.?a|s\.?l|b\.?v|spa|lda|ltd|gmbh|srl|sas)\.?$/i.test(w));
  return (words.slice(0, 3).map((w) => w[0]).join("") || norm(name).slice(0, 2)).toUpperCase();
}

function pickContact(company) {
  const list = Array.isArray(company.company_contacts) ? [...company.company_contacts] : [];
  list.sort((a, b) => (a.role === "sales" ? -1 : 0) - (b.role === "sales" ? -1 : 0) || (a.sort_order || 0) - (b.sort_order || 0));
  const c = list.find((x) => norm(x.name) || norm(x.phone)) || null;
  return c ? { name: norm(c.name), position: norm(c.position), phone: norm(c.phone), email: norm(c.email) } : { name: "", position: "", phone: "", email: "" };
}

function shortDescription(company, lang) {
  const pl = norm(company.description_short) || norm(company.description);
  const en = norm(company.description_short_en) || norm(company.description_en);
  const s = lang === "pl" ? (pl || en) : (en || pl);
  // twarde przycięcie do ~2 linii (ok. 190 znaków) — pdfmake nie ma line-clamp
  return s.length > 190 ? s.slice(0, 187).replace(/\s+\S*$/, "") + "…" : s;
}

function pkgLabel(company) {
  const tier = PKG_LABEL[norm(company.fm_b2b_tier).toLowerCase()] || "Business";
  const n = Math.max(1, Math.min(5, Number(company.fm_b2b_packages) || 1));
  return n > 1 ? `${tier} ×${n}` : tier;
}

// ── symulacja par (tylko draft) ──────────────────────────────────────────
function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function simulatePairs(companies, retailers, prefs) {
  const rnd = seededRandom(20260924);
  const chainOf = new Map(retailers.map((r) => [r.id, r]));
  const perChainNext = new Map(retailers.map((r) => [r.fm26_chain_id, 1]));
  const pairs = []; // {sid, cid, nr}
  const usedBySupplier = new Map(); // sid -> Set(nr) — jak FM_MIN_GAP: numery jednej firmy nie stykają się
  for (const co of companies) {
    const cap = 5 * Math.max(1, Math.min(5, Number(co.fm_b2b_packages) || 1));
    const wanted = prefs.filter((p) => p.company_id === co.id).sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .map((p) => chainOf.get(p.retailer_id)).filter(Boolean);
    const pool = [...wanted];
    const rest = retailers.filter((r) => !wanted.includes(r));
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    for (const r of rest) if (pool.length < cap) pool.push(r);
    for (const r of pool.slice(0, cap)) {
      const cid = r.fm26_chain_id; if (!cid) continue;
      const used = usedBySupplier.get(co.id) || new Set();
      let nr = perChainNext.get(cid) || 1;
      while ([...used].some((u) => Math.abs(u - nr) < 2)) nr++;
      perChainNext.set(cid, nr + 1); used.add(nr); usedBySupplier.set(co.id, used);
      pairs.push({ sid: co.id, cid, nr });
    }
  }
  return pairs;
}

function pairsFromSchedule(schedule, companies) {
  const nums = schedule && schedule.nums ? schedule.nums : null;
  if (!nums || !Object.keys(nums).length) return null;
  const byLegacy = new Map(companies.filter((c) => c.legacy_fm_id).map((c) => [String(c.legacy_fm_id), c.id]));
  const pairs = [];
  for (const [sidRaw, chains] of Object.entries(nums)) {
    const sid = byLegacy.get(String(sidRaw)) || sidRaw;
    for (const [cid, nr] of Object.entries(chains || {})) {
      const n = Number(nr); if (!Number.isFinite(n) || n <= 0) continue;
      pairs.push({ sid, cid, nr: n });
    }
  }
  return pairs;
}

// ── główny builder ───────────────────────────────────────────────────────
export function buildPlanModel(raw, { simulate = false } = {}) {
  const companies = (raw.companies || []).slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name), "pl"));
  const retailers = (raw.retailers || []).filter((r) => r.fm26_chain_id).slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name), "pl"));
  const prefs = raw.prefs || [];
  const profilesByCompany = new Map();
  for (const p of raw.supplier_profiles || []) {
    if (!p.company_id || !p.email || p.active === false || p.role !== "supplier") continue;
    if (!profilesByCompany.has(p.company_id)) profilesByCompany.set(p.company_id, []);
    profilesByCompany.get(p.company_id).push(p);
  }

  let pairs = pairsFromSchedule(raw.settings && raw.settings.schedule, companies);
  let mode = "working";
  if (!pairs) {
    if (!simulate) pairs = [];
    else { pairs = simulatePairs(companies, retailers, prefs); mode = "simulation"; }
  } else if (/^(published|final_published|event_day)$/i.test(String(raw.settings?.algo_phase || "").trim())) {
    mode = "final";
  }

  const chainByCid = new Map(retailers.map((r) => [r.fm26_chain_id, r]));
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const chainView = (r, lang) => ({
    id: r.id, cid: r.fm26_chain_id, name: norm(r.name), country: norm(r.country).toUpperCase(),
    countryName: countryName(r.country, lang),
    cats: (Array.isArray(r.cats) ? r.cats : []).map((c) => categoryLabel(c, lang)),
    gate: Number(r.fm_gate) === 2 ? 2 : Number(r.fm_gate) === 1 ? 1 : null,
    logoUrl: norm(r.logo_url) || null, color: norm(r.color) || "#1f8f4e", initials: norm(r.initials) || initials(r.name),
  });

  // karty dostawców
  const suppliers = companies.map((co, idx) => {
    const lang = langFor(co.country);
    const my = pairs.filter((p) => p.sid === co.id).map((p) => ({ nr: p.nr, chain: chainByCid.get(p.cid) })).filter((m) => m.chain)
      .sort((a, b) => a.nr - b.nr).map((m) => ({ nr: m.nr, chain: chainView(m.chain, lang) }));
    const contact = pickContact(co);
    return {
      kind: "supplier", id: co.id, card: String(idx + 1).padStart(3, "0"), lang,
      name: norm(co.name), country: norm(co.country).toUpperCase(), countryName: countryName(co.country, lang),
      contact, pkg: pkgLabel(co), logoUrl: norm(co.logo_url) || null, initials: initials(co.name),
      products: norm(co.products), desc: shortDescription(co, lang),
      hasDescPl: !!(norm(co.description_short) || norm(co.description)), hasDescEn: !!(norm(co.description_short_en) || norm(co.description_en)),
      emails: (profilesByCompany.get(co.id) || []).map((p) => p.email),
      meetings: my,
    };
  });

  // karty sieci — dostawca z logo, krajem, opisem i kontaktem z profilu
  const chains = retailers.map((r, idx) => {
    const lang = langFor(r.country);
    const list = pairs.filter((p) => p.cid === r.fm26_chain_id).map((p) => ({ nr: p.nr, co: companyById.get(p.sid) })).filter((m) => m.co)
      .sort((a, b) => a.nr - b.nr).map((m) => ({
        nr: m.nr,
        supplier: {
          id: m.co.id, name: norm(m.co.name), country: norm(m.co.country).toUpperCase(), countryName: countryName(m.co.country, lang),
          desc: shortDescription(m.co, lang), products: norm(m.co.products), pkg: pkgLabel(m.co),
          logoUrl: norm(m.co.logo_url) || null, initials: initials(m.co.name), contact: pickContact(m.co),
        },
      }));
    const buyers = (r.buyers || []).filter((b) => b.active !== false && b.fm26_active !== false && b.role === "buyer");
    return {
      kind: "chain", id: r.id, cid: r.fm26_chain_id, card: `S-${String(idx + 1).padStart(2, "0")}`, lang,
      ...chainView(r, lang),
      buyers: buyers.map((b) => ({ name: norm(b.name), position: norm(b.position), cats: (b.buyer_categories || []).map((c) => categoryLabel(c, lang)) })),
      emails: buyers.map((b) => norm(b.email)).filter(Boolean),
      meetings: list,
    };
  });

  return { generatedAt: raw.generated_at || new Date().toISOString(), mode, pairs, suppliers, chains };
}

// ── obrazy: URL → data URI (pdfmake wymaga osadzonych obrazów) ──────────
// loader(url) → Promise<string|null> (data URI). Cache po URL, błędy = brak logo (fallback: inicjały).
export async function resolveImages(model, loader) {
  const cache = new Map();
  const get = async (url) => {
    if (!url) return null;
    if (!cache.has(url)) cache.set(url, loader(url).catch(() => null));
    return cache.get(url);
  };
  for (const s of model.suppliers) {
    s.logo = await get(s.logoUrl);
    for (const m of s.meetings) m.chain.logo = await get(m.chain.logoUrl);
  }
  for (const c of model.chains) {
    c.logo = await get(c.logoUrl);
    for (const m of c.meetings) m.supplier.logo = await get(m.supplier.logoUrl);
  }
  return model;
}
