export function getFirstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return null;
}

export function resolveEnvConfig() {
  const supabaseUrl = getFirstEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
  const supabaseAnonKey = getFirstEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = getFirstEnv("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = getFirstEnv("RESEND_API_KEY");
  // [B2B Round prod-rollout / email-open-tracking] Resend webhooks używają
  // Svix signature scheme — wymaga signing secret z dashboardu Resend.
  const resendWebhookSecret = getFirstEnv("RESEND_WEBHOOK_SECRET");
  const openAiApiKey = getFirstEnv("OPENAI_API_KEY");
  const openAiModel = getFirstEnv("OPENAI_MODEL") || "gpt-4.1-mini";
  // [B2B Round prod-rollout / custom-domain] Primary app URL = b2b.freshmarket.eu
  // (custom domain pointing to freshmarketb2b.netlify.app via CNAME).
  // Fallback dla developmentu lub gdyby env var nie był ustawiony.
  const b2bAppUrl = getFirstEnv("B2B_APP_URL") || "https://b2b.freshmarket.eu";

  // [B2B Round prod-rollout / faza 3] PayU integration
  // PAYU_ENV controls which API endpoint to hit: 'sandbox' (secure.snd.payu.com)
  // or 'production' (secure.payu.com). Default sandbox while we're still wiring
  // the flow. Switch to 'production' once live merchant POS is configured.
  const payuEnv = getFirstEnv("PAYU_ENV") || "sandbox";
  const payuPosId = getFirstEnv("PAYU_POS_ID");
  const payuSecondKey = getFirstEnv("PAYU_SECOND_KEY");        // do weryfikacji notify (SHA-256 HMAC)
  const payuClientId = getFirstEnv("PAYU_OAUTH_CLIENT_ID");    // OAuth client_credentials
  const payuClientSecret = getFirstEnv("PAYU_OAUTH_CLIENT_SECRET");
  // Waluta MUSI odpowiadac walucie POS w panelu PayU. Cennik w DB jest w EUR,
  // wiec domyslnie wymagamy POS EUR. Dla POS w innej walucie ustaw takze
  // PAYU_EUR_TO_PAYU_RATE, zeby nie pobrac przypadkiem 276.75 PLN zamiast EUR.
  const payuCurrencyCode = (getFirstEnv("PAYU_CURRENCY_CODE") || "EUR").trim().toUpperCase();
  const payuEurToPayuRate = getFirstEnv("PAYU_EUR_TO_PAYU_RATE");
  const payuVatRate = getFirstEnv("PAYU_VAT_RATE") || "23";

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    resendApiKey,
    resendWebhookSecret,
    openAiApiKey,
    openAiModel,
    b2bAppUrl,
    payuEnv,
    payuPosId,
    payuSecondKey,
    payuClientId,
    payuClientSecret,
    payuCurrencyCode,
    payuEurToPayuRate,
    payuVatRate,
  };
}

export function missingEnvNames(config, requiredKeys = []) {
  const mapping = {
    supabaseUrl: "SUPABASE_URL (lub VITE_SUPABASE_URL)",
    supabaseAnonKey: "SUPABASE_ANON_KEY (lub VITE_SUPABASE_ANON_KEY)",
    supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
    resendApiKey: "RESEND_API_KEY",
    resendWebhookSecret: "RESEND_WEBHOOK_SECRET",
    openAiApiKey: "OPENAI_API_KEY",
    openAiModel: "OPENAI_MODEL",
    b2bAppUrl: "B2B_APP_URL",
    payuEnv: "PAYU_ENV",
    payuPosId: "PAYU_POS_ID",
    payuSecondKey: "PAYU_SECOND_KEY",
    payuClientId: "PAYU_OAUTH_CLIENT_ID",
    payuClientSecret: "PAYU_OAUTH_CLIENT_SECRET",
    payuCurrencyCode: "PAYU_CURRENCY_CODE",
    payuEurToPayuRate: "PAYU_EUR_TO_PAYU_RATE",
    payuVatRate: "PAYU_VAT_RATE",
  };

  return requiredKeys
    .filter((key) => !config[key])
    .map((key) => mapping[key] || key);
}

export function envErrorPayload(scope, missing) {
  return {
    error: `${scope}: brak konfiguracji środowiska`,
    missing,
    hint: "Ustaw brakujące zmienne w Netlify -> Site configuration -> Environment variables i zrób nowy deploy.",
  };
}
