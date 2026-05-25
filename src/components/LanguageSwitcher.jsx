import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import {
  SUPPORTED_LOCALES,
  normalizeLocale,
  persistLocale,
} from "../i18n/locale";

/**
 * <LanguageSwitcher>
 *
 * [B2B Round prod-rollout / i18n MVP — Krok 3]
 *
 * Przełącznik języka aplikacji PL / EN.
 *
 * Logika:
 *   1. Wywołuje i18n.changeLanguage(locale) — i18next zmienia stan natychmiast,
 *      wszystkie komponenty używające useTranslation() re-renderują się.
 *   2. persistLocale() zapisuje wybór do localStorage 'fm_locale' — żeby przy
 *      następnym wejściu (też niezalogowanym) trafić na właściwy język.
 *   3. Jeśli user JEST zalogowany (sesja istnieje), DODATKOWO zapisujemy
 *      profile.locale w bazie — żeby maile transakcyjne i przyszłe sesje
 *      przyszły w tym samym języku.
 *   4. SAFETY: jeśli zapis do DB się nie uda (RLS error, offline, itp.),
 *      aplikacja NIE wywala się — tylko console.warn. Local state + localStorage
 *      pozostają zaktualizowane, więc UX dla bieżącej sesji działa.
 *
 * Props:
 *   variant: "auth" | "panel" | "compact"
 *     - auth: dla LoginPage/RegisterPage/ResetPage — pełne labelki Polski/English
 *     - panel: dla PanelTopBar (Admin/Supplier/Buyer) — kompaktowy
 *     - compact: minimalistyczny (tylko PL/EN buttons)
 *
 * NIE używany jeszcze w PreconnectFM.jsx — Krok 4+ doda to.
 */
export default function LanguageSwitcher({ variant = "compact" }) {
  const { i18n } = useTranslation();
  const current = normalizeLocale(i18n.language);

  async function handleChange(newLocale) {
    const target = normalizeLocale(newLocale);
    if (target === current) return; // nic do roboty

    // 1) i18next state — komponenty re-render się momentalnie
    try {
      await i18n.changeLanguage(target);
    } catch (e) {
      console.warn("[LanguageSwitcher] i18n.changeLanguage failed:", e?.message || e);
      return; // nie persist'ujemy jeśli changeLanguage padło
    }

    // 2) LocalStorage — fallback dla niezalogowanego usera przy następnej wizycie
    persistLocale(target);

    // 3) DB — tylko jeśli user zalogowany. Best-effort, nie blokujemy UX.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (userId) {
        const { error } = await supabase
          .from("profiles")
          .update({ locale: target })
          .eq("id", userId);
        if (error) {
          console.warn("[LanguageSwitcher] profile.locale UPDATE failed:", error.message);
          // Nie revertujemy — UI już zaktualizowane. User przy następnym logowaniu
          // dostanie locale z localStorage przez detectInitialLocale fallback chain.
        }
      }
    } catch (e) {
      console.warn("[LanguageSwitcher] DB sync failed:", e?.message || e);
      // Nie wywalamy aplikacji — to jest non-critical sync.
    }
  }

  // ─── Wariant: panel (kompaktowy, dla PanelTopBar) ────────────────────
  if (variant === "panel") {
    return (
      <div
        title="Zmień język / Change language"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: 2,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {SUPPORTED_LOCALES.map((code) => {
          const active = code === current;
          return (
            <button
              key={code}
              onClick={() => handleChange(code)}
              aria-pressed={active}
              aria-label={code === "pl" ? "Polski" : "English"}
              style={{
                background: active ? "#0d9488" : "transparent",
                color: active ? "white" : "#64748b",
                border: "none",
                borderRadius: 4,
                padding: "3px 8px",
                cursor: active ? "default" : "pointer",
                fontWeight: 700,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontFamily: "inherit",
                transition: "background 0.15s",
              }}
            >
              {code}
            </button>
          );
        })}
      </div>
    );
  }

  // ─── Wariant: auth (pełne labelki dla LoginPage/RegisterPage) ────────
  if (variant === "auth") {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "rgba(255,255,255,0.85)",
        }}
      >
        {SUPPORTED_LOCALES.map((code, idx) => {
          const active = code === current;
          const label = code === "pl" ? "Polski" : "English";
          return (
            <span key={code} style={{ display: "inline-flex", alignItems: "center" }}>
              {idx > 0 && <span style={{ color: "rgba(255,255,255,0.4)", margin: "0 4px" }}>·</span>}
              <button
                onClick={() => handleChange(code)}
                aria-pressed={active}
                style={{
                  background: "none",
                  border: "none",
                  color: active ? "white" : "rgba(255,255,255,0.65)",
                  textDecoration: active ? "underline" : "none",
                  cursor: active ? "default" : "pointer",
                  fontSize: 12,
                  fontFamily: "inherit",
                  padding: 0,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {label}
              </button>
            </span>
          );
        })}
      </div>
    );
  }

  // ─── Wariant: compact (default, najmniejszy) ─────────────────────────
  return (
    <div style={{ display: "inline-flex", gap: 4, fontSize: 11 }}>
      {SUPPORTED_LOCALES.map((code) => {
        const active = code === current;
        return (
          <button
            key={code}
            onClick={() => handleChange(code)}
            aria-pressed={active}
            style={{
              background: active ? "#0d9488" : "white",
              color: active ? "white" : "#64748b",
              border: `1px solid ${active ? "#0d9488" : "#e2e8f0"}`,
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: active ? "default" : "pointer",
              textTransform: "uppercase",
              fontFamily: "inherit",
            }}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
