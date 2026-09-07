/**
 * Netlify Function (format 2.0): fm-queue-snapshot
 * GET /.netlify/functions/fm-queue-snapshot?date=YYYY-MM-DD
 *
 * Publiczny, CACHE'OWANY snapshot tablicy kolejek (bez nazw firm, bez danych
 * prywatnych — dokładnie to, co widok fm_queue_board_v). Telefony uczestników
 * odpytują ten endpoint co 5–10 s; CDN Netlify trzyma odpowiedź 5 s, więc
 * 300 telefonów = ~1 zapytanie/5 s do Supabase zamiast 60/s.
 * Używa WYŁĄCZNIE klucza anon (RPC fm_queue_public_snapshot ma GRANT dla anon).
 * [feat/fm-queue]
 */
import { createClient } from "@supabase/supabase-js";
import { CORS, envConfig, missingOf } from "./_shared/netlify-modern.js";

const cached = (status, payload, maxAge) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    ...CORS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": maxAge ? `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=10` : "no-store",
    "Netlify-CDN-Cache-Control": maxAge ? `public, max-age=${maxAge}, stale-while-revalidate=10` : "no-store",
  },
});

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return cached(405, { error: "Method not allowed" }, 0);
  const cfg = envConfig();
  const missing = missingOf(cfg, ["supabaseUrl", "supabaseAnonKey"]);
  if (missing.length) return cached(500, { error: `Brak konfiguracji: ${missing.join(", ")}` }, 0);

  const url = new URL(request.url);
  const d = url.searchParams.get("date") || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  const anon = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("fm_queue_public_snapshot", { p_event_date: date });
  if (error) return cached(502, { error: "snapshot unavailable" }, 0);
  return cached(200, data, 5);
};
