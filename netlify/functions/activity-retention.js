/**
 * Netlify Scheduled Function: activity-retention (codziennie, netlify.toml)
 *
 * [feat/admin-activity] Retencja dziennika wejść: usuwa wizyty starsze niż 12 miesięcy
 * (RPC purge_app_visits, tylko service_role). To samo czyszczenie wykonuje się też przy
 * każdej nowej wizycie i przy odczycie raportu — ta funkcja gwarantuje usuwanie nawet
 * wtedy, gdy nikt nie wchodzi do aplikacji.
 *
 * Nie przyjmuje żadnych danych wejściowych i nie zwraca danych osobowych (tylko liczbę).
 * Wielokrotne wywołanie jest bezpieczne (idempotentne).
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const handler = async () => {
  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missing.length) return json(500, envErrorPayload("activity-retention", missing));

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data, error } = await supaSvc.rpc("purge_app_visits");
  if (error) {
    // brak migracji (PGRST202) — moduł nie jest jeszcze wdrożony; nie traktujemy jak awarii
    if (error.code === "PGRST202") return json(200, { skipped: "migration_missing" });
    console.error("[activity-retention] purge_app_visits failed:", error.message);
    return json(500, { error: "purge_failed" });
  }
  const deleted = Number(data) || 0;
  console.log(`[activity-retention] usunięte wizyty starsze niż 12 miesięcy: ${deleted}`);
  return json(200, { deleted });
};
