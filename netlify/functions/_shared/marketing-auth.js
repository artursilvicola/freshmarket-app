/**
 * [feat/marketing-activation] Wspólne sprawdzenie administratora dla funkcji
 * Marketing → Aktywacja PreConnect. Ten sam wzorzec co send-retailer-batch.js:
 * JWT użytkownika → auth.getUser → profil z rolą admin i active ≠ false.
 *
 * Nigdy nie ufa frontendowi: każda funkcja marketingowa woła requireAdmin()
 * zanim cokolwiek przeczyta lub zapisze.
 */
import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./function-env.js";

export const MARKETING_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(statusCode, body) {
  return { statusCode, headers: { ...MARKETING_CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/**
 * @returns {Promise<{ ok: true, env, supaSvc, caller } | { ok: false, response }>}
 */
export async function requireAdmin(event, fnName, extraEnv = []) {
  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", ...extraEnv]);
  if (missing.length) return { ok: false, response: json(500, envErrorPayload(fnName, missing)) };

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false, response: json(401, { error: "no_auth_header" }) };
  const token = authHeader.slice(7);

  const supaUser = createClient(env.supabaseUrl, env.supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userErr } = await supaUser.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, response: json(401, { error: "invalid_token" }) };

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: caller, error: callerErr } = await supaSvc
    .from("profiles").select("id, role, name, email, locale, active").eq("id", userData.user.id).maybeSingle();
  if (callerErr || !caller) return { ok: false, response: json(403, { error: "profile_not_found" }) };
  if (caller.role !== "admin" || caller.active === false) return { ok: false, response: json(403, { error: "only_admin" }) };
  return { ok: true, env, supaSvc, caller };
}

export function parseBody(event) {
  try { return JSON.parse(event.body || "{}") || {}; } catch { return null; }
}
