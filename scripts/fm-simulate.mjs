// Uruchomienie symulacji A/B na lokalnej kopii (bez bazy, bez zapisu do aplikacji).
// Użycie: node scripts/fm-simulate.mjs --input <symulacja-wejscie.json> --out <folder> [--overrides <kraje.json>] [--biedronka ch39] [--mega ch35]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { buildInputs, classifyPolish, runVariant, checkResult, diffVariants, supplierCapacity } from "./fm-simulate-lib.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const inputPath = arg("--input"); const outDir = arg("--out"); if (!inputPath || !outDir) { console.error("podaj --input i --out"); process.exit(2); }
const BIEDRONKA = arg("--biedronka", "ch39"); const MEGA = arg("--mega", "ch35");
if (/supabase\.co|sklyfuvzjikkqerxtulo/.test(JSON.stringify(process.env.FM_PROBE_URL || ""))) { /* brak połączeń: skrypt nie tworzy klienta */ }
mkdirSync(outDir, { recursive: true });
const raw = readFileSync(inputPath, "utf8"); const inputSha = createHash("sha256").update(raw).digest("hex");
const snapshot = JSON.parse(raw);
const overrides = arg("--overrides") ? JSON.parse(readFileSync(arg("--overrides"), "utf8")) : {};
const inputs = buildInputs(snapshot);
inputs.suppliers = classifyPolish(inputs.suppliers, overrides);
const chainName = id => inputs.chains.find(c => c.id === id)?.name || id;
const biedronka = inputs.chains.find(c => c.id === BIEDRONKA); if (!biedronka) { console.error(`brak sieci ${BIEDRONKA} wśród aktywnych — sprawdź fm26_chain_id`); process.exit(2); }
const megaRow = inputs.retailers.find(r => r.fm26ChainId === MEGA);
const megaActive = !!inputs.chains.find(c => c.id === MEGA);
// lista krajów do weryfikacji
const toVerify = inputs.suppliers.filter(s => { const nip = String(snapshot.tables.companies.find(c => c.id === s.companyId)?.nip || "").trim(); const pref = (nip.toUpperCase().match(/^[A-Z]{2}/) || [""])[0]; return !s.country || (s.country === "PL" && pref && pref !== "PL") || (s.country !== "PL" && pref === "PL") || (s.country === "PL" && !pref && !/^\d{10}$/.test(nip.replace(/[-\s]/g, ""))); }).map(s => ({ company_id: s.companyId, name: s.name, country: s.country || "", nip: String(snapshot.tables.companies.find(c => c.id === s.companyId)?.nip || ""), decision: overrides[s.companyId] || "DO DECYZJI", treatedAsPL: s.isPL }));
const polishIds = new Set(inputs.suppliers.filter(s => s.isPL).map(s => s.id));
// A — kontrolny (Mega Image poza siecią aktywną), B — Biedronka bez PL
const A = runVariant(inputs, {});
const B = runVariant(inputs, { excludeChainId: BIEDRONKA, polishIds });
const issuesA = checkResult(inputs, A, { forbiddenChainIds: [MEGA] });
const issuesB = checkResult(inputs, B, { forbiddenChainIds: [MEGA], excludePairs: B.exclusions });
const meetingsCount = V => inputs.suppliers.reduce((s, x) => s + (V.result.res[x.id]?.m.length || 0), 0);
const shortage = V => inputs.suppliers.filter(x => (V.result.res[x.id]?.m.length || 0) < supplierCapacity(x)).length;
const noMeetings = V => inputs.suppliers.filter(x => (V.result.res[x.id]?.m.length || 0) === 0).length;
const summary = { snapshot_exported_at: snapshot.exported_at, input_sha256: inputSha, app_commit: snapshot.app_commit, chains_active: inputs.chains.length, suppliers: inputs.suppliers.length, polish_suppliers: polishIds.size, mega_image: megaRow ? { retailer_id: megaRow.id, fm26_active: megaRow.fm26_active, in_active_chains: megaActive } : "brak", biedronka: { chain: BIEDRONKA, retailer_id: biedronka.retailerId, stations: biedronka.stations, cap: A.result.cs[BIEDRONKA]?.cap },
  A: { meetings: meetingsCount(A), suppliers_with_shortage: shortage(A), suppliers_without_meetings: noMeetings(A), deterministic: A.deterministic, issues: issuesA, warnings: A.result.warnings.length },
  B: { meetings: meetingsCount(B), suppliers_with_shortage: shortage(B), suppliers_without_meetings: noMeetings(B), deterministic: B.deterministic, issues: issuesB, warnings: B.result.warnings.length, exclusions: B.exclusions.length, exclusions_with_original_choice: B.exclusions.filter(e => e.originalPref).length, exclusions_with_buyer_want: B.exclusions.filter(e => e.originalResp === "want").length },
  countries_to_verify: toVerify.length };
const diff = diffVariants(inputs, A, B);
const stamp = `SYMULACJA - NIEPUBLIKOWANY PLAN | dane: ${snapshot.exported_at} | algorytm: commit ${snapshot.app_commit} | wygenerowano: ${new Date().toISOString()}`;
// Excel
const wb = XLSX.utils.book_new();
const sheet = (name, rows, header) => { const ws = XLSX.utils.aoa_to_sheet([[stamp], header, ...rows]); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
sheet("Podsumowanie A-B", [
  ["Wariant", "Spotkania", "Firmy z niedoborem", "Firmy bez spotkań", "Deterministyczny", "Kontrole", "Ostrzeżenia algorytmu"],
  ["A kontrolny (bez Mega Image)", summary.A.meetings, summary.A.suppliers_with_shortage, summary.A.suppliers_without_meetings, A.deterministic ? "tak" : "NIE", issuesA.length ? issuesA.join("; ") : "OK", A.result.warnings.length],
  ["B test (Biedronka bez PL)", summary.B.meetings, summary.B.suppliers_with_shortage, summary.B.suppliers_without_meetings, B.deterministic ? "tak" : "NIE", issuesB.length ? issuesB.join("; ") : "OK", B.result.warnings.length],
  [], ["Firm w symulacji", inputs.suppliers.length, "polskich (wg profilu/nadpisań)", polishIds.size, "sieci aktywnych", inputs.chains.length],
  ["Biedronka", `${BIEDRONKA} / retailer ${biedronka.retailerId}`, "stanowiska", biedronka.stations ?? "brak konfiguracji", "pojemność", A.result.cs[BIEDRONKA]?.cap],
  ["Mega Image", megaRow ? `retailer ${megaRow.id}, fm26_active=${megaRow.fm26_active}` : "brak", "w aktywnych sieciach", megaActive ? "TAK (!)" : "nie"],
  ["Wykorzystanie pojemności B"], ...inputs.chains.map(c => [c.name, `${B.result.cs[c.id]?.n}/${B.result.cs[c.id]?.cap}`, `stanowiska ${B.result.cs[c.id]?.stations}`]),
], ["Wiersz", "Wartość", "", "", "", "", ""]);
sheet("Plan dostawców B", inputs.suppliers.map(s => { const m = B.result.res[s.id]?.m || []; return [s.name, s.country || "", s.isPL ? "PL" : "", s.pkg, s.fmPackages, supplierCapacity(s), s.paymentDate || "", m.length, supplierCapacity(s) - m.length, m.map(cid => `${chainName(cid)} #${B.result.nums[s.id]?.[cid] ?? "?"}`).join("; ")]; }), ["Firma", "Kraj", "PL?", "Poziom", "Pakiety", "Limit spotkań", "Data wpłaty", "Spotkań B", "Niedobór B", "Sieci i numery (B)"]);
sheet("Kolejki sieci B", inputs.chains.flatMap(c => (B.result.cq[c.id] || []).map((sid, i) => sid ? [c.name, i + 1, inputs.suppliers.find(s => s.id === sid)?.name || sid, inputs.suppliers.find(s => s.id === sid)?.country || "", B.result.res[sid]?.r[c.id] ?? ""] : null).filter(Boolean)), ["Sieć", "Numer", "Dostawca", "Kraj", "Ocena pary"]);
sheet("Wpływ Biedronki", B.exclusions.map(e => { const s = inputs.suppliers.find(x => x.id === e.supplierId); const a = A.result.res[e.supplierId]?.m || [], b = B.result.res[e.supplierId]?.m || []; return [e.supplierName, s?.country || "", s?.countrySource || "", e.originalPref || "(brak wyboru)", e.originalResp || "(brak odpowiedzi)", a.includes(BIEDRONKA) ? `TAK #${A.result.nums[e.supplierId]?.[BIEDRONKA]}` : "nie", a.length, b.length, supplierCapacity(s) - b.length, a.filter(x => !b.includes(x)).map(chainName).join("; "), b.filter(x => !a.includes(x)).map(chainName).join("; ")]; }), ["Polska firma", "Kraj", "Źródło kraju", "Oryginalny wybór Biedronki", "Oryginalna decyzja Biedronki", "Spotkanie z Biedronką w A", "Spotkań A", "Spotkań B", "Niedobór B", "Utracone (A→B)", "Dodane (A→B)"]);
sheet("Przesunięcia A-B", diff.map(d => [d.supplier, d.country || "", d.isPL ? "PL" : "", d.meetingsA, d.meetingsB, d.capacity, d.lost.join("; "), d.gained.join("; ")]), ["Firma", "Kraj", "PL?", "Spotkań A", "Spotkań B", "Limit", "Utracone", "Dodane"]);
const megaChoosers = (snapshot.tables.company_target_retailers || []).filter(r => megaRow && Number(r.retailer_id) === Number(megaRow.id)).map(r => { const s = inputs.suppliers.find(x => x.companyId === r.company_id); return [s?.name || r.company_id, s?.country || "", Number(r.priority || 0) >= 1000 ? "główny" : "rezerwowy", s ? (B.result.res[s.id]?.m.length || 0) : "(poza FM)", s ? supplierCapacity(s) : ""]; });
sheet("Wpływ Mega Image", megaChoosers, ["Dostawca, który wskazał Mega Image", "Kraj", "Rodzaj wyboru", "Spotkań w B", "Limit"]);
const unassigned = [];
for (const s of inputs.suppliers) for (const cid of Object.keys(inputs.prefs[s.id] || {})) { if ((B.result.res[s.id]?.m || []).includes(cid)) continue; const resp = inputs.resps[cid]?.[s.id] ?? null; const chainActive = !!inputs.chains.find(c => c.id === cid); const excl = B.exclusions.find(e => e.supplierId === s.id && e.chainId === cid); const reason = !chainActive ? (cid === MEGA ? "wycofanie sieci (Mega Image)" : "sieć nieaktywna w FM") : excl ? "wykluczenie testowe BIEDRONKA_NO_PL" : (resp === "remove" || resp === "rejected") ? "odmowa kupca" : (B.result.res[s.id]?.m.length || 0) >= supplierCapacity(s) ? "limit pakietów firmy" : (B.result.cs[cid]?.n >= B.result.cs[cid]?.cap) ? "pojemność sieci" : "niższa ocena / kolejność (algorytm)"; unassigned.push([s.name, s.country || "", chainName(cid), inputs.prefs[s.id][cid], resp || "(brak)", reason]); }
sheet("Nieprzydzielone B", unassigned, ["Firma", "Kraj", "Sieć", "Wybór firmy", "Decyzja kupca", "Przyczyna (ustalona)"]);
sheet("Ostrzeżenia algorytmu", [...A.result.warnings.map(w => ["A", w.type, w.message]), ...B.result.warnings.map(w => ["B", w.type, w.message])], ["Wariant", "Typ", "Komunikat"]);
sheet("Kraje do weryfikacji", toVerify.map(v => [v.name, v.country, v.nip, v.decision, v.treatedAsPL ? "PL" : "nie PL"]), ["Firma", "Kraj w profilu", "NIP/VAT", "Decyzja Artura", "W symulacji traktowana jako"]);
sheet("Dane wejściowe i kontrola", [["Eksport danych", snapshot.exported_at], ["SHA-256 wejścia", inputSha], ["Commit algorytmu", snapshot.app_commit], ["Firm FM aktywnych", inputs.suppliers.length], ["Wybory (wiersze)", (snapshot.tables.company_target_retailers || []).length], ["Odpowiedzi kupców", (snapshot.tables.fm_resps || []).length], ["Sieci aktywne", inputs.chains.length], ["Kontrole A", issuesA.length ? issuesA.join("; ") : "OK"], ["Kontrole B", issuesB.length ? issuesB.join("; ") : "OK"], ["Determinizm A/B", `${A.deterministic}/${B.deterministic}`], ["Nadpisania krajów", JSON.stringify(overrides)]], ["Pozycja", "Wartość"]);
const xlsxPath = `${outDir}/FM2026_symulacja_AB_${snapshot.exported_at.slice(0, 16).replace(/[:T]/g, "-")}.xlsx`;
XLSX.writeFile(wb, xlsxPath);
writeFileSync(`${outDir}/wynik-symulacji.json`, JSON.stringify({ summary, exclusions: B.exclusions, diff, toVerify, warningsA: A.result.warnings, warningsB: B.result.warnings, resA: A.result.res, numsA: A.result.nums, resB: B.result.res, numsB: B.result.nums, csA: A.result.cs, csB: B.result.cs }, null, 1), "utf8");
console.log(JSON.stringify(summary, null, 1));
console.log("xlsx:", xlsxPath);
