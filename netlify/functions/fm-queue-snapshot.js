/**
 * Netlify Function: fm-queue-snapshot
 * GET /.netlify/functions/fm-queue-snapshot?date=YYYY-MM-DD
 *
 * Publiczny, CACHE'OWANY snapshot tablicy kolejek (bez nazw firm, bez danych
 * prywatnych — dokładnie to, co widok fm_queue_board_v). Telefony uczestników
 * odpytują ten endpoint co 5–10 s; CDN Netlify trzyma odpowiedź 5 s, więc
 * 300 telefonów = ~1 zapytanie/5 s do Supabase zamiast 60/s.
 * Używa WYŁĄCZNIE klucza anon (RPC fm_queue_public_snapshot ma GRANT dla anon).
 *
 * [feat/fm-queue]
 */
import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: cors, body: "Method not allowed" };
  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey"]);
  if (missing.length) return json(500, envErrorPayload("fm-queue-snapshot", missing), 0);

  const date = /^\d{4}-\d{2}-\d{2}$/.test(event.queryStringParameters?.date || "") ? event.queryStringParameters.date : null;
  const anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("fm_queue_public_snapshot", { p_event_date: date });
  if (error) return json(502, { error: "snapshot unavailable" }, 0);
  return json(200, data, 5);
};

function json(status, payload, maxAge) {
  return {
    statusCode: status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=10` : "no-store",
      "Netlify-CDN-Cache-Control": maxAge ? `public, max-age=${maxAge}, stale-while-revalidate=10` : "no-store",
    },
    body: JSON.stringify(payload),
  };
}
