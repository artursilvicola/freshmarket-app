import { missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method Not Allowed" });
  }

  const env = resolveEnvConfig();
  const missingAdmin = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey"]);
  const missingSendOffer = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "resendApiKey"]);
  const missingAiFeatures = missingEnvNames(env, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey", "openAiApiKey"]);
  const missingPayu = missingEnvNames(env, [
    "supabaseUrl",
    "supabaseServiceRoleKey",
    "payuPosId",
    "payuSecondKey",
    "payuClientId",
    "payuClientSecret",
    "payuCurrencyCode",
  ]);
  if (env.payuCurrencyCode !== "EUR" && !env.payuEurToPayuRate) {
    missingPayu.push("PAYU_EUR_TO_PAYU_RATE");
  }

  return json(200, {
    ok: missingAdmin.length === 0 && missingSendOffer.length === 0 && missingAiFeatures.length === 0 && missingPayu.length === 0,
    checks: {
      adminUsers: {
        ok: missingAdmin.length === 0,
        missing: missingAdmin,
      },
      sendOffer: {
        ok: missingSendOffer.length === 0,
        missing: missingSendOffer,
      },
      aiFeatures: {
        ok: missingAiFeatures.length === 0,
        missing: missingAiFeatures,
      },
      payu: {
        ok: missingPayu.length === 0,
        missing: missingPayu,
      },
    },
    hint: "Ustaw brakujące zmienne w Netlify -> Site configuration -> Environment variables i zrób nowy deploy.",
  });
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
