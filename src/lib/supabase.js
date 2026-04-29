import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "[Supabase] Brakuje zmiennych środowiskowych. Skopiuj .env.example do .env i uzupełnij VITE_SUPABASE_URL oraz VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Helper: czy zmienne ENV są ustawione (do warning bannera)
export const isSupabaseConfigured = Boolean(url && anonKey);
