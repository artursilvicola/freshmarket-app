import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
// [B2B Round prod-rollout / i18n MVP — Krok 2] Synchronizacja języka:
// po zalogowaniu profile.locale (z DB) wygrywa z localStorage / navigator,
// i wywołujemy i18n.changeLanguage() + persistLocale() (sync do localStorage).
import i18n from "../i18n";
import { normalizeLocale, persistLocale, DEFAULT_LOCALE } from "../i18n/locale";

/**
 * AuthProvider — context z aktualnym użytkownikiem i jego profilem (rolą).
 * Hook useAuth() zwraca:
 *   - session, user, profile, role
 *   - loading: true podczas startu (sprawdzenie sesji)
 *   - signIn(email, pwd), signUp(email, pwd, meta), signOut()
 *   - sendMagicLink(email)
 *   - refreshProfile()
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Pobierz profil z tabeli profiles na podstawie zalogowanego usera
  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    // [B2B Round 2] Pobierz profil + JOIN do companies (legacy_fm_id, name, country)
    // + retailers (name) — to potrzebne w PreconnectFM App() do mapowania konta.
    // [B2B Round branding-and-header-logos] dodano logo_url do obu JOIN-ów —
    // panel dostawcy/kupca pokazuje logo bytu w nagłówku zamiast badge'a "FM".
    const { data, error } = await supabase
      .from("profiles")
      .select(`
        *,
        company:companies!company_id(id, name, country, legacy_fm_id, legacy_supplier_id, pkg_plan, logo_url),
        retailer:retailers(id, name, country, logo_url)
      `)
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[Auth] Błąd pobierania profilu:", error.message);
      setProfile(null);
      return;
    }
    // Splaszcz join w jeden obiekt zeby PreconnectFM nie musial wiedziec o JOIN-ach.
    // [B2B Round 5] legacy_supplier_id (np. "sup-s1") jest WYMAGANY przez RLS dla
    // legacy_offers / legacy_sends INSERT/UPDATE. Bez niego silent-fail przy
    // sendToChain (RLS check supplier_legacy_id = app_supplier_legacy_id()).
    const enriched = data
      ? {
          ...data,
          legacy_fm_id: data.company?.legacy_fm_id || null,
          legacy_supplier_id: data.company?.legacy_supplier_id || null,
          company_name: data.company?.name || null,
          company_country: data.company?.country || null,
          country: data.company?.country || data.retailer?.country || null,
          pkg_plan: data.company?.pkg_plan || null,
          retailer_name: data.retailer?.name || null,
          company_logo_url: data.company?.logo_url || null,
          retailer_logo_url: data.retailer?.logo_url || null,
          // [B2B Round prod-rollout / admin-team] Shortcut dla UI gating:
          // super admin = role=admin AND admin_level='super'. Aplikacja używa
          // tego do pokazania/ukrycia pozycji "Administratorzy" w sidebar
          // i przycisków zarządzania zespołem.
          is_super_admin: data.role === "admin" && data.admin_level === "super",
        }
      : null;
    setProfile(enriched);

    // [B2B Round prod-rollout / i18n MVP — Krok 2]
    // Synchronizacja języka: profile.locale (z DB) wygrywa nad localStorage/
    // navigator. Jeśli profile.locale=null (rzadkie po migracji 036), używamy
    // DEFAULT_LOCALE. persistLocale() zapisuje też do localStorage, żeby przy
    // następnym wejściu bez zalogowania od razu trafić na właściwy język.
    //
    // UWAGA: useTranslation() nie jest jeszcze używany w żadnym komponencie
    // (Krok 4 dopiero podłączy auth pages). Ta linia ustawia tylko stan
    // i18next — wizualnie nic się nie zmienia w aplikacji.
    if (enriched) {
      const desired = normalizeLocale(enriched.locale || DEFAULT_LOCALE);
      if (i18n.language !== desired) {
        i18n.changeLanguage(desired).catch((e) => {
          console.warn("[Auth] i18n.changeLanguage failed:", e?.message || e);
        });
      }
      persistLocale(desired);
    }
  }, []);

  useEffect(() => {
    // Initial: sprawdź czy jest sesja
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user?.id) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Subskrybuj zmiany sesji (login/logout/token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user?.id) {
        loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, []);

  const signUp = useCallback(async (email, password, meta = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: meta },
    });
    if (error) throw error;
    return data;
  }, []);

  const sendMagicLink = useCallback(async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  // [B2B Round auth-forgot-password] Wyslij email z linkiem do resetu hasla.
  // Supabase wysle email z tokenem recovery; po kliknieciu uzytkownik laduje
  // na /reset-password (auto-sign-in z PASSWORD_RECOVERY event) i ustawia nowe.
  const sendPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(() => {
    if (session?.user?.id) return loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? null,
    loading,
    signIn,
    signUp,
    sendMagicLink,
    sendPasswordReset,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() musi być wewnątrz <AuthProvider>");
  return ctx;
}
