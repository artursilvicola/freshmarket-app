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
  const b2bAppUrl = getFirstEnv("B2B_APP_URL") || "https://freshmarketb2b.netlify.app";

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    resendApiKey,
    b2bAppUrl,
  };
}

export function missingEnvNames(config, requiredKeys = []) {
  const mapping = {
    supabaseUrl: "SUPABASE_URL (lub VITE_SUPABASE_URL)",
    supabaseAnonKey: "SUPABASE_ANON_KEY (lub VITE_SUPABASE_ANON_KEY)",
    supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
    resendApiKey: "RESEND_API_KEY",
    b2bAppUrl: "B2B_APP_URL",
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
