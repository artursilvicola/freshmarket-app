import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
// [B2B Round prod-rollout / i18n MVP — Krok 2 + 3b] Synchronizacja języka:
// po zalogowaniu profile.locale (z DB) wygrywa z localStorage / navigator,
// CHYBA ŻE niezalogowany user właśnie wybrał inny język (pending sync flag)
// — wtedy ten wybór nadpisuje DB.
import i18n from "../i18n";
import {
  normalizeLocale,
  persistLocale,
  readPendingLocaleSync,
  clearPendingLocaleSync,
  DEFAULT_LOCALE,
} from "../i18n/locale";

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

    // [B2B Round prod-rollout / i18n MVP — Krok 2 + 3b + 3c]
    // Synchronizacja języka po zalogowaniu — dwa scenariusze:
    //
    // A) Niezalogowany user zmienił język przed loginem (pending sync flag):
    //    readPendingLocaleSync() zwraca tę wartość (BEZ kasowania flagi).
    //    UPDATE'ujemy profile.locale w DB tym wyborem (best-effort).
    //    Flagę kasujemy DOPIERO po sukcesie DB update — żeby przy padnięciu
    //    sync mógł zostać ponowiony przy kolejnym loginie. Intencja usera
    //    wygrywa nad domyślnym 'pl' z migracji.
    //
    // B) Brak pending sync: standardowe zachowanie — profile.locale z DB
    //    wygrywa, zapisujemy do localStorage żeby kolejne wizyty bez
    //    logowania od razu trafiły na właściwy język.
    //
    // UWAGA: useTranslation() nie jest jeszcze używany w żadnym komponencie
    // (Krok 4 dopiero podłączy auth pages). Ta linia ustawia tylko stan
    // i18next — wizualnie nic się nie zmienia w aplikacji.
    if (enriched) {
      const pendingLocale = readPendingLocaleSync();
      const dbLocale = normalizeLocale(enriched.locale || DEFAULT_LOCALE);

      // Pending sync wygrywa nad DB. Jeśli nie ma pending — używamy DB.
      const desired = pendingLocale && pendingLocale !== dbLocale ? pendingLocale : dbLocale;

      if (i18n.language !== desired) {
        i18n.changeLanguage(desired).catch((e) => {
          console.warn("[Auth] i18n.changeLanguage failed:", e?.message || e);
        });
      }
      persistLocale(desired);

      // [Krok 3c] Trzy ścieżki dla pending sync:
      //   1. pending istnieje i RÓŻNI się od DB → UPDATE, flagę kasujemy
      //      DOPIERO po sukcesie. Jeśli padnie, flaga zostaje na ponowienie.
      //   2. pending istnieje i RÓWNY DB → nic do robienia, kasujemy flagę.
      //   3. brak pending → nic do robienia.
      if (pendingLocale && pendingLocale !== dbLocale) {
        supabase
          .from("profiles")
          .update({ locale: pendingLocale })
          .eq("id", userId)
          .then(({ error }) => {
            if (error) {
              console.warn("[Auth] pending locale sync to DB failed:", error.message);
              // [Krok 3c] NIE kasujemy flagi — sync zostanie ponowiony przy
              // kolejnym loginie. UI dla bieżącej sesji już jest właściwy
              // (localStorage + i18next state).
            } else {
              clearPendingLocaleSync();
              // Lokalny enriched.locale też aktualizujemy żeby nie był stale
              setProfile((prev) => prev ? { ...prev, locale: pendingLocale } : prev);
            }
          });
      } else if (pendingLocale && pendingLocale === dbLocale) {
        // [Krok 3c] Pending już zgodny z DB — flaga niepotrzebna, kasujemy.
        clearPendingLocaleSync();
      }
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
