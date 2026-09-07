/**
 * [feat/fm-queue] Helpery dla funkcji w NOWYM formacie Netlify (Functions 2.0):
 *   export default async (request: Request, context: Context) => Response
 * Zmienne przez `Netlify.env` (z fallbackiem na process.env poza runtime Netlify),
 * zaufane IP klienta z `context.ip` (NIE z nagłówków, które klient może podrobić).
 */

export function getEnv(name) {
  try {
    const v = globalThis.Netlify?.env?.get?.(name);
    if (v != null && v !== "") return v;
  } catch { /* poza runtime Netlify */ }
  return process.env[name] ?? "";
}

export function envConfig() {
  const first = (...keys) => keys.map(getEnv).find(Boolean) || "";
  return {
    supabaseUrl: first("SUPABASE_URL", "VITE_SUPABASE_URL"),
    supabaseAnonKey: first("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: first("SUPABASE_SERVICE_ROLE_KEY"),
    staffPinPepper: first("STAFF_PIN_PEPPER"),
  };
}

export function missingOf(cfg, keys) {
  return keys.filter((k) => !cfg[k]);
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept-Language",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/** Zaufane IP: context.ip (Netlify ustawia je z połączenia, nie z nagłówka). */
export function trustedIp(context) {
  const ip = String(context?.ip || "").trim();
  return ip ? ip.slice(0, 64) : null;
}

export function langOf(request) {
  return /^en/i.test(String(request.headers.get("accept-language") || "")) ? "en" : "pl";
}

export function bearer(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
