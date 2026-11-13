// [fix/buyer-entry-seen] Odcięcie produkcyjnych kluczy od kontekstów deploy-preview i branch-deploy
// projektu Netlify — czysta logika z wstrzykiwanym klientem (testy: tests/netlify-context-isolation.test.js).
// Używa jej docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs.
//
// Zasady (review Codexa 13.11.2026):
//  * żadna wartość zmiennej nie trafia do argumentów procesu, logu ani komunikatu błędu;
//    zapisy idą wyłącznie w treści żądania HTTPS, błędy są przepisywane na SafeError bez szczegółów;
//  * brak wskazanych kluczy w podglądzie i gałęzi jest WYMUSZANY (kod wyjścia), nie tylko opisywany —
//    z uwzględnieniem dziedziczenia z wpisu „all”;
//  * awaria po zapisie (albo w trakcie) = STAN NIEPEWNY: żadnych dalszych zapisów ani automatycznego
//    cofania; ustalamy faktyczny stan i oddajemy decyzję człowiekowi;
//  * przy zamaskowanych sekretach niezmienność potwierdza IDENTYFIKATOR wpisu, nie pełna wartość.
import { createHash } from "node:crypto";

export const TARGET_CONTEXTS = Object.freeze(["deploy-preview", "branch-deploy"]);
export const EXIT = Object.freeze({ OK: 0, FAILED: 1, UNCERTAIN: 2, REFUSED: 3 });

/** Błąd, którego komunikat jest bezpieczny do wypisania (nie zawiera wartości, poleceń ani treści odpowiedzi). */
export class SafeError extends Error {
  constructor(message, { code = null, status = null, rejected = false } = {}) {
    super(message);
    this.name = "SafeError";
    this.code = code;
    this.status = status;
    this.rejected = rejected; // true = serwer jednoznacznie odrzucił żądanie (zapis nie został przyjęty)
  }
}
const safeCode = (e) => (typeof e?.code === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(e.code) ? e.code : typeof e?.name === "string" && /^(AbortError|TimeoutError)$/.test(e.name) ? e.name : null);
/** Dowolny błąd → SafeError; oryginalny komunikat jest ODRZUCANY (mógłby zawierać polecenie albo wartość). */
export function toSafeError(e, label) {
  if (e instanceof SafeError) return e;
  const code = safeCode(e);
  return new SafeError(`${label}: błąd${code ? " " + code : ""} — szczegóły ukryte`, { code });
}

export const isMasked = (v) => /^\*{6,}/.test(String(v ?? ""));
const digest = (v) => createHash("sha256").update(String(v)).digest("hex");
/** Kształt wartości do logu — nigdy sama wartość ani jej fragment. */
export const shape = (v) => (v === undefined || v === null ? "brak" : String(v) === "" ? "pusta" : isMasked(v) ? "zamaskowana" : `jawna(${String(v).length} zn.)`);
const contextsOf = (v) => (v?.values || []).map((x) => x.context).sort();
const describe = (v) => (v ? `konteksty: ${contextsOf(v).join(",") || "—"}; sekret: ${v.is_secret ? "tak" : "nie"}` : "brak zmiennej");
const sameScopes = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

/** Wpis, z którego dany kontekst bierze wartość: własny, a gdy go nie ma — dziedziczony „all”. */
export function resolveEntry(v, ctx) {
  const vals = v?.values || [];
  return vals.find((x) => x.context === ctx) || vals.find((x) => x.context === "all") || null;
}
/** Skąd kontekst ma wartość ([] = nie ma). Dla branch-deploy liczą się też wpisy konkretnych gałęzi („branch”). */
export function exposureOf(v, ctx) {
  const out = [];
  const e = resolveEntry(v, ctx);
  if (e && String(e.value ?? "") !== "") out.push(e.context);
  if (ctx === "branch-deploy") for (const x of v?.values || []) if (x.context === "branch" && String(x.value ?? "") !== "") out.push("branch");
  return out;
}
/** Odcisk wpisu produkcyjnego: sekret/zamaskowany → identyfikator wpisu; jawny → skrót wartości (wartość nie opuszcza pamięci). */
function printOf(v) {
  const e = resolveEntry(v, "production");
  if (!e) return null;
  return v.is_secret || isMasked(e.value) ? { kind: "id", id: String(e.id ?? ""), mask: String(e.value ?? "") } : { kind: "value", digest: digest(e.value ?? "") };
}
function samePrint(a, b) {
  if (!a && !b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "id" ? a.id === b.id && a.mask === b.mask : a.digest === b.digest;
}
const printsOf = (vars) => new Map((vars || []).map((v) => [v.key, printOf(v)]));

/**
 * @param {object} o
 * @param {{listVars:Function,getVar:Function,putVar:Function,deleteValue:Function}} o.client
 * @param {string[]} o.split  zmienne z jedną wartością „all” → ta sama wartość tylko dla production + dev
 * @param {Record<string,string[]>} o.drop  sekrety z wpisami na kontekst → usunięcie wskazanych wpisów
 * @returns {Promise<{status:string, exitCode:number, writes:number, keys:object, productionDiff:string[]|null, exposed:string[]|null}>}
 */
export async function isolateContexts({ client, split = [], drop = {}, targets = TARGET_CONTEXTS, dry = true, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 3 }) {
  const result = { status: null, exitCode: null, writes: 0, keys: {}, productionDiff: null, exposed: null };
  const finish = (status, exitCode) => Object.assign(result, { status, exitCode });
  const readRetry = async (fn) => {
    let last;
    for (let i = 0; i < retries; i++) {
      try { return await fn(); } catch (e) { last = e; if (i < retries - 1) await sleep(1500 * (i + 1)); }
    }
    throw last;
  };

  // 0. stan wyjściowy
  let before;
  try { before = await readRetry(() => client.listVars()); }
  catch (e) { log(`ODMOWA: nie udało się odczytać zmiennych (${toSafeError(e, "odczyt").message}). Nic nie zapisano.`); return finish("refused", EXIT.REFUSED); }
  const map = new Map(before.map((v) => [v.key, v]));
  const prodBefore = printsOf(before);
  log(`${dry ? "PRÓBA NA SUCHO — " : "ZAPIS — "}zmiennych w projekcie: ${before.length}`);

  // 1. warunki wstępne dla WSZYSTKICH zmiennych, zanim cokolwiek zapiszemy
  const plan = [];
  const problems = [];
  const expected = []; // pary (klucz, kontekst), w których po operacji NIE może być wartości
  for (const key of split) {
    const v = map.get(key);
    for (const ctx of targets) expected.push([key, ctx]);
    if (!v) { problems.push(`${key}: brak zmiennej`); continue; }
    if (!resolveEntry(v, "production")) { problems.push(`${key}: brak wartości dla production`); continue; }
    if (!targets.some((ctx) => exposureOf(v, ctx).length)) { plan.push({ type: "skip", key, why: "już odcięta od podglądu i gałęzi" }); continue; }
    const vals = v.values || [];
    if (v.is_secret || vals.length !== 1 || vals[0].context !== "all" || isMasked(vals[0].value) || String(vals[0].value ?? "") === "") {
      problems.push(`${key}: inna struktura niż oczekiwana (${describe(v)}) — wymaga ręcznej decyzji`); continue;
    }
    plan.push({ type: "split", key, v });
  }
  for (const [key, ctxs] of Object.entries(drop)) {
    const v = map.get(key);
    for (const ctx of ctxs) expected.push([key, ctx]);
    if (!v) { problems.push(`${key}: brak zmiennej`); continue; }
    const vals = v.values || [];
    if (!vals.some((x) => x.context === "production")) { problems.push(`${key}: brak własnego wpisu production — nie ruszam (${describe(v)})`); continue; }
    if (vals.some((x) => x.context === "all")) { problems.push(`${key}: ma wpis „all” — podgląd i gałąź DZIEDZICZĄ z niego wartość; usunięcie wpisów kontekstów nie odetnie klucza (wymaga ręcznej decyzji)`); continue; }
    if (ctxs.includes("branch-deploy") && vals.some((x) => x.context === "branch")) { problems.push(`${key}: ma wpisy dla konkretnych gałęzi („branch”) — wymaga ręcznej decyzji`); continue; }
    for (const ctx of ctxs) {
      const entry = vals.find((x) => x.context === ctx);
      plan.push(entry ? { type: "drop", key, ctx } : { type: "skip", key, why: `brak wpisu ${ctx}` });
    }
    for (const ctx of targets) if (!ctxs.includes(ctx) && exposureOf(v, ctx).length) log(`  (${key}: wpis ${ctx} zostaje celowo — poza zakresem)`);
  }
  if (problems.length) {
    for (const p of problems) log(`ODMOWA: ${p}`);
    log("Nic nie zapisano. Skrypt nie zgłasza sukcesu, dopóki wszystkie wskazane klucze nie dadzą się odciąć.");
    return finish("refused", EXIT.REFUSED);
  }

  // kontrola obowiązkowa: produkcja bez zmian + brak wskazanych kluczy w podglądzie i gałęzi
  const control = (vars, label) => {
    const now = new Map(vars.map((v) => [v.key, v]));
    const prodNow = printsOf(vars);
    const diff = [...new Set([...prodBefore.keys(), ...prodNow.keys()])].filter((k) => !samePrint(prodBefore.get(k), prodNow.get(k)));
    const exposed = expected.filter(([k, ctx]) => exposureOf(now.get(k), ctx).length).map(([k, ctx]) => `${k}@${ctx}←${exposureOf(now.get(k), ctx).join("+")}`);
    log(`\n${label}`);
    log(`  PRODUKCJA: ${diff.length ? "RÓŻNICE w: " + diff.join(", ") : `bez zmian — ${prodNow.size} zmiennych (jawne: ta sama wartość; sekrety: ten sam identyfikator wpisu)`}`);
    log(`  PODGLĄD / GAŁĄŹ: ${exposed.length ? "NADAL WIDZĄ: " + exposed.join(", ") : `żaden ze wskazanych kluczy nie jest dostępny (${expected.length} par klucz–kontekst)`}`);
    return { diff, exposed };
  };

  if (dry) {
    const sim = before.map((v) => ({ ...v, values: [...(v.values || [])] }));
    const simMap = new Map(sim.map((v) => [v.key, v]));
    for (const s of plan) {
      if (s.type === "skip") log(`  ${s.key}: bez zmian (${s.why})`);
      if (s.type === "split") { log(`A ${s.key}: do zamiany „all” → production + dev (wartość ${shape(s.v.values[0].value)})`); const e = s.v.values[0]; simMap.get(s.key).values = [{ ...e, context: "production" }, { ...e, id: "sim-dev", context: "dev" }]; }
      if (s.type === "drop") { log(`B ${s.key} / ${s.ctx}: do usunięcia wpis (${shape(map.get(s.key).values.find((x) => x.context === s.ctx).value)})`); simMap.get(s.key).values = simMap.get(s.key).values.filter((x) => x.context !== s.ctx); }
    }
    const now = control(before, "STAN OBECNY:");
    const c = control(sim, "STAN PO PLANOWANYCH ZMIANACH (symulacja, nic nie zapisano):");
    Object.assign(result, { productionDiff: c.diff, exposed: c.exposed, exposedNow: now.exposed });
    return finish("dry", c.diff.length || c.exposed.length ? EXIT.FAILED : EXIT.OK);
  }

  // 2. zapisy — po kolei; pierwszy problem zatrzymuje wszystko
  const settle = async (key, classify, reason) => {
    log(`!! ${key}: STAN NIEPEWNY — ${reason}. Wstrzymuję dalsze zapisy; niczego nie cofam automatycznie.`);
    let state = "unknown";
    try { state = classify(await readRetry(() => client.getVar(key))); } catch (e) { log(`   nie udało się ustalić stanu (${toSafeError(e, "odczyt").message})`); }
    const words = { applied: "zmiana WESZŁA (stan docelowy)", not_applied: "zmiana NIE weszła (stan wyjściowy)", other: "stan INNY niż wyjściowy i docelowy — sprawdź ręcznie w panelu Netlify", unknown: "stan NIEZNANY — sprawdź ręcznie w panelu Netlify" };
    log(`   ustalony stan ${key}: ${words[state]}`);
    result.keys[key] = state;
    return state;
  };
  let outcome = "ok";
  for (const s of plan) {
    if (s.type === "skip") { log(`  ${s.key}: bez zmian (${s.why})`); continue; }

    if (s.type === "split") {
      const { key, v } = s;
      const original = v.values[0].value;
      const want = digest(original);
      const classify = (a) => {
        const vals = a?.values || [];
        const p = vals.find((x) => x.context === "production"), d = vals.find((x) => x.context === "dev");
        if (!a?.is_secret && vals.length === 2 && p && d && digest(p.value ?? "") === want && digest(d.value ?? "") === want && sameScopes(a.scopes, v.scopes)) return "applied";
        if (!a?.is_secret && vals.length === 1 && vals[0].context === "all" && digest(vals[0].value ?? "") === want && sameScopes(a.scopes, v.scopes)) return "not_applied";
        return "other";
      };
      let after;
      try {
        result.writes += 1;
        await client.putVar(key, { key, scopes: v.scopes, is_secret: false, values: [{ context: "production", value: original }, { context: "dev", value: original }] });
      } catch (e) {
        const se = toSafeError(e, "zapis");
        const state = await settle(key, classify, se.message);
        outcome = se.rejected && state === "not_applied" ? "failed" : "uncertain";
        break;
      }
      try { after = await client.getVar(key); }
      catch (e) { await settle(key, classify, `zapis wysłany, ale odczyt kontrolny się nie powiódł (${toSafeError(e, "odczyt").message})`); outcome = "uncertain"; break; }
      const state = classify(after);
      result.keys[key] = state;
      if (state === "applied") { log(`A ${key}: OK — konteksty ${contextsOf(after).join(",")}, produkcja ta sama wartość`); continue; }
      // odczyt się udał i pokazuje jednoznaczną niezgodność → jedyny przypadek automatycznego przywrócenia
      log(`A ${key}: NIEZGODNOŚĆ po zapisie (${describe(after)}) — przywracam jedną wartość „all”`);
      try {
        result.writes += 1;
        await client.putVar(key, { key, scopes: v.scopes, is_secret: false, values: [{ context: "all", value: original }] });
        const back = classify(await client.getVar(key));
        result.keys[key] = back;
        if (back === "not_applied") { log(`A ${key}: przywrócono stan wyjściowy. Zatrzymuję.`); outcome = "failed"; }
        else { log(`!! ${key}: przywrócenie NIE zostało potwierdzone — STAN NIEPEWNY, sprawdź ręcznie.`); outcome = "uncertain"; }
      } catch (e) {
        await settle(key, classify, `przywracanie się nie powiodło (${toSafeError(e, "zapis").message})`);
        outcome = "uncertain";
      }
      break;
    }

    if (s.type === "drop") {
      const { key, ctx } = s;
      let cur;
      try { cur = await readRetry(() => client.getVar(key)); }
      catch (e) { log(`B ${key} / ${ctx}: odczyt przed usunięciem się nie powiódł (${toSafeError(e, "odczyt").message}) — tego wpisu nie ruszono. Zatrzymuję.`); outcome = "failed"; break; }
      const entry = (cur.values || []).find((x) => x.context === ctx);
      const prod = (cur.values || []).find((x) => x.context === "production");
      if (!entry) { log(`  ${key} / ${ctx}: wpisu już nie ma`); continue; }
      if (!prod) { log(`B ${key} / ${ctx}: zniknął wpis production — nie ruszam. Zatrzymuję.`); outcome = "failed"; break; }
      const idsBefore = (cur.values || []).map((x) => String(x.id)).sort();
      const classify = (a) => {
        const vals = a?.values || [];
        const p = vals.find((x) => x.context === "production");
        const prodSame = !!p && String(p.id) === String(prod.id) && String(p.value ?? "") === String(prod.value ?? "");
        const ids = vals.map((x) => String(x.id)).sort();
        const gone = !vals.some((x) => String(x.id) === String(entry.id) || x.context === ctx);
        if (prodSame && gone && JSON.stringify(ids) === JSON.stringify(idsBefore.filter((i) => i !== String(entry.id)))) return "applied";
        if (prodSame && JSON.stringify(ids) === JSON.stringify(idsBefore)) return "not_applied";
        return "other";
      };
      let after;
      try { result.writes += 1; await client.deleteValue(key, entry.id); }
      catch (e) {
        const se = toSafeError(e, "usunięcie");
        const state = await settle(key, classify, se.message);
        outcome = se.rejected && state === "not_applied" ? "failed" : "uncertain";
        break;
      }
      try { after = await client.getVar(key); }
      catch (e) { await settle(key, classify, `usunięcie wysłane, ale odczyt kontrolny się nie powiódł (${toSafeError(e, "odczyt").message})`); outcome = "uncertain"; break; }
      const state = classify(after);
      result.keys[`${key}@${ctx}`] = state;
      if (state === "applied") { log(`B ${key} / ${ctx}: usunięty; wpis production nietknięty (ten sam identyfikator)`); continue; }
      if (state === "not_applied") { log(`B ${key} / ${ctx}: wpis NADAL JEST — nic się nie zmieniło. Zatrzymuję.`); outcome = "failed"; break; }
      log(`!! ${key} / ${ctx}: po usunięciu stan jest INNY niż oczekiwany (${describe(after)}) — wpis production mógł się zmienić. Sprawdź ręcznie w panelu Netlify. Zatrzymuję.`);
      outcome = "uncertain";
      break;
    }
  }

  // 3. kontrola końcowa — obowiązkowa także po awarii
  let after;
  try { after = await readRetry(() => client.listVars()); }
  catch (e) {
    log(`\n!! KONTROLA KOŃCOWA NIEMOŻLIWA (${toSafeError(e, "odczyt").message}). Stan produkcji i podglądów NIEPOTWIERDZONY — sprawdź w panelu Netlify.`);
    return finish("uncertain", EXIT.UNCERTAIN);
  }
  const c = control(after, "KONTROLA KOŃCOWA:");
  Object.assign(result, { productionDiff: c.diff, exposed: c.exposed });
  if (outcome === "uncertain") { log("\nWYNIK: STAN NIEPEWNY — nie uruchamiaj ponownie przed sprawdzeniem stanu powyżej."); return finish("uncertain", EXIT.UNCERTAIN); }
  if (outcome === "failed" || c.diff.length || c.exposed.length) {
    log(`\nWYNIK: NIEZALICZONE${c.exposed.length ? " — wskazane klucze nadal są dostępne w podglądzie lub gałęzi" : ""}${c.diff.length ? " — PRODUKCJA SIĘ ZMIENIŁA" : ""}.`);
    return finish("failed", EXIT.FAILED);
  }
  log("\nWYNIK: OK — klucze odcięte, produkcja bez zmian.");
  return finish("ok", EXIT.OK);
}

// ── transporty ────────────────────────────────────────────────────────────────

/** Odczyty przez `netlify api`: do linii poleceń trafiają wyłącznie identyfikatory i nazwy zmiennych. */
export function assertReadOnlyArgs(op, data) {
  if (!/^(getSite|getEnvVars|getEnvVar)$/.test(op)) throw new SafeError(`odmowa: operacja ${op} nie jest odczytem`);
  for (const [k, val] of Object.entries(data || {})) {
    if (!["site_id", "account_id", "key"].includes(k) || typeof val !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(val)) throw new SafeError(`odmowa: argument ${k} nie jest identyfikatorem`);
  }
  return true;
}

/** Zapisy przez HTTPS: wartości tylko w treści żądania; błędy bez treści odpowiedzi i bez nagłówków. */
export function createHttpWriter({ fetchImpl, token, accountId, siteId, base = "https://api.netlify.com/api/v1", timeoutMs = 20000 }) {
  if (!token) throw new SafeError("brak tokenu Netlify");
  const call = async (label, method, pathPart, body) => {
    let res;
    try {
      res = await fetchImpl(`${base}${pathPart}?site_id=${encodeURIComponent(siteId)}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (e) {
      throw new SafeError(`${label}: brak odpowiedzi${safeCode(e) ? " (" + safeCode(e) + ")" : ""} — nie wiadomo, czy żądanie doszło`, { code: safeCode(e) });
    }
    if (res.status >= 400 && res.status < 500) throw new SafeError(`${label}: serwer odrzucił żądanie (HTTP ${res.status})`, { status: res.status, rejected: true });
    if (!res.ok) throw new SafeError(`${label}: błąd serwera (HTTP ${res.status}) — nie wiadomo, czy żądanie zostało wykonane`, { status: res.status });
    return true;
  };
  const enc = encodeURIComponent;
  return {
    putVar: (key, body) => call(`zapis ${key}`, "PUT", `/accounts/${enc(accountId)}/env/${enc(key)}`, body),
    deleteValue: (key, id) => call(`usunięcie wpisu ${key}`, "DELETE", `/accounts/${enc(accountId)}/env/${enc(key)}/value/${enc(id)}`),
  };
}

/** Token Netlify: zmienna NETLIFY_AUTH_TOKEN albo plik konfiguracji CLI. Nigdy nie jest wypisywany. */
export function loadNetlifyToken({ env, readFile, platform, homedir, appData }) {
  if (env.NETLIFY_AUTH_TOKEN) return env.NETLIFY_AUTH_TOKEN;
  const candidates = [
    platform === "win32" && appData ? `${appData}/netlify/Config/config.json` : null,
    platform === "darwin" ? `${homedir}/Library/Preferences/netlify/config.json` : null,
    `${homedir}/.config/netlify/config.json`,
    `${homedir}/.netlify/config.json`,
  ].filter(Boolean);
  for (const file of candidates) {
    let cfg;
    try { cfg = JSON.parse(readFile(file)); } catch { continue; }
    const token = cfg?.users?.[cfg?.userId]?.auth?.token;
    if (token) return token;
  }
  throw new SafeError("nie znaleziono tokenu Netlify (zaloguj `netlify login` albo ustaw NETLIFY_AUTH_TOKEN)");
}
