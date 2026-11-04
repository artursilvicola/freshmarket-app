// [feat/marketing-activation] Czysta logika środowiska odbiorowego (bez I/O) — testowana w
// tests/marketing-test-env.test.js. Używana przez scripts/dev-test.mjs i scripts/marketing-test-env.mjs.
//
// Zasady (review Codexa, runda skryptów):
//  * komplet wartości MUSI pochodzić z .env.test — zmienne odziedziczone z procesu nie liczą się
//    i nie trafiają do procesu potomnego (poza minimalną bazą systemową: PATH, TEMP, HOME…);
//  * frontend i backend muszą wskazywać TEN SAM projekt testowy, a connection string ten sam ref;
//  * ref produkcyjny odrzucany wszędzie; klucz Resend musi być fikcyjny (prefiks re_test_);
//  * MARKETING_SEND_ENABLED=false ustawiane JAWNIE (nie tylko usuwane).

export const PROD_REF = "sklyfuvzjikkqerxtulo";
export const REQUIRED_KEYS = Object.freeze([
  "TEST_DATABASE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "B2B_APP_URL", "MARKETING_UNSUBSCRIBE_SECRET", "RESEND_API_KEY",
]);
// minimalna baza systemowa przekazywana procesowi potomnemu (nic z Supabase/Resend/Netlify)
const BASE_ENV_KEYS = Object.freeze([
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "COMSPEC",
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA",
  "USERNAME", "LANG", "LC_ALL", "TERM", "NODE_OPTIONS", "NODE_ENV", "NO_COLOR", "FORCE_COLOR",
  "PROGRAMFILES", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "PROGRAMDATA", "SystemDrive", "SYSTEMDRIVE",
]);

export function parseDotenv(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function supabaseRef(url) {
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in|red)\b/i.exec(String(url || "").trim());
  return m ? m[1].toLowerCase() : null;
}
/** Rola z ładunku JWT Supabase (anon / service_role) albo null dla kluczy innego formatu (np. sb_secret_…). */
export function jwtRole(key) {
  const parts = String(key || "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role || null; } catch { return null; }
}
export function dbUrlRef(url) {
  // postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres  |  …@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?… (user postgres.<ref>)
  const s = String(url || "");
  const m1 = /@db\.([a-z0-9-]+)\.supabase\.(co|in|red)/i.exec(s);
  if (m1) return m1[1].toLowerCase();
  const m2 = /:\/\/postgres\.([a-z0-9-]+):/i.exec(s);
  return m2 ? m2[1].toLowerCase() : null;
}

/** Sprawdza WYŁĄCZNIE wartości z pliku .env.test. Zwraca { ok, errors[] }. */
export function validateTestEnv(fileEnv) {
  const errors = [];
  const f = fileEnv || {};
  for (const k of REQUIRED_KEYS) if (!String(f[k] || "").trim()) errors.push(`brak ${k} w .env.test`);
  for (const [k, v] of Object.entries(f)) if (String(v).includes(PROD_REF)) errors.push(`${k} wskazuje projekt PRODUKCYJNY`);
  const feRef = supabaseRef(f.VITE_SUPABASE_URL), beRef = supabaseRef(f.SUPABASE_URL), dbRef = dbUrlRef(f.TEST_DATABASE_URL);
  if (f.VITE_SUPABASE_URL && !feRef) errors.push("VITE_SUPABASE_URL nie wygląda na adres projektu Supabase");
  if (f.SUPABASE_URL && !beRef) errors.push("SUPABASE_URL nie wygląda na adres projektu Supabase");
  if (feRef && beRef && feRef !== beRef) errors.push(`frontend (${feRef}) i backend (${beRef}) wskazują różne projekty`);
  if (f.TEST_DATABASE_URL && !dbRef) errors.push("TEST_DATABASE_URL nie zawiera ref projektu Supabase (db.<ref>… albo postgres.<ref>)");
  if (dbRef && beRef && dbRef !== beRef) errors.push(`TEST_DATABASE_URL (${dbRef}) i SUPABASE_URL (${beRef}) wskazują różne projekty`);
  if (f.VITE_SUPABASE_ANON_KEY && f.SUPABASE_ANON_KEY && f.VITE_SUPABASE_ANON_KEY !== f.SUPABASE_ANON_KEY) errors.push("VITE_SUPABASE_ANON_KEY i SUPABASE_ANON_KEY różnią się");
  if (f.SUPABASE_SERVICE_ROLE_KEY && f.SUPABASE_ANON_KEY && f.SUPABASE_SERVICE_ROLE_KEY === f.SUPABASE_ANON_KEY) errors.push("SUPABASE_SERVICE_ROLE_KEY jest identyczny z kluczem anon — wklej klucz service_role projektu TESTOWEGO");
  const svcRole = jwtRole(f.SUPABASE_SERVICE_ROLE_KEY);
  if (svcRole && svcRole !== "service_role") errors.push(`SUPABASE_SERVICE_ROLE_KEY ma rolę '${svcRole}', a nie service_role`);
  const anonRole = jwtRole(f.SUPABASE_ANON_KEY);
  if (anonRole && anonRole !== "anon") errors.push(`SUPABASE_ANON_KEY ma rolę '${anonRole}', a nie anon (klucz service_role NIE może trafić do frontu)`);
  if (f.RESEND_API_KEY && !/^re_test_/i.test(f.RESEND_API_KEY)) errors.push("RESEND_API_KEY musi być fikcyjny (prefiks re_test_) — prawdziwego klucza nie używamy w odbiorze");
  if (String(f.MARKETING_SEND_ENABLED || "").trim().toLowerCase() === "true") errors.push("MARKETING_SEND_ENABLED=true w .env.test — niedozwolone w odbiorze");
  if (f.MARKETING_UNSUBSCRIBE_SECRET && String(f.MARKETING_UNSUBSCRIBE_SECRET).length < 24) errors.push("MARKETING_UNSUBSCRIBE_SECRET za krótki (min. 24 znaki)");
  if (f.B2B_APP_URL && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(f.B2B_APP_URL)) errors.push("B2B_APP_URL w odbiorze ma wskazywać localhost");
  return { ok: errors.length === 0, errors };
}

/**
 * Środowisko procesu potomnego: minimalna baza systemowa + WYŁĄCZNIE wartości z .env.test
 * + wymuszone blokady. Nic z Supabase/Resend/Netlify/MARKETING_* nie przechodzi z procesu rodzica.
 */
export function buildChildEnv(fileEnv, baseEnv) {
  const base = baseEnv || {};
  const out = {};
  for (const k of BASE_ENV_KEYS) if (base[k] !== undefined) out[k] = base[k];
  for (const [k, v] of Object.entries(fileEnv || {})) out[k] = v;
  out.MARKETING_SEND_ENABLED = "false";
  out.VITE_ADMIN_MARKETING_ACTIVATION = "true";
  out.NETLIFY_AUTH_TOKEN = "";          // netlify dev --offline i tak nie łączy się ze stroną; na wszelki wypadek pusto
  delete out.RESEND_WEBHOOK_SECRET;     // webhook w odbiorze nie jest potrzebny
  return out;
}
