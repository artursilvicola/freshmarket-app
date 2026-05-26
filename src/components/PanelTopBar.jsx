import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * <PanelTopBar>
 *
 * Wspólny nagłówek paneli (dostawca / kupiec / admin). Wcześniej każdy
 * panel miał własną kopię tej samej JSX-y; po Round branding-and-header-logos
 * jeden komponent przyjmuje element `logo` jako props (FreshMarketLogo
 * dla admina, EntityLogo dla dostawcy/kupca) — reszta układu jest identyczna.
 *
 * [B2B Round prod-rollout / i18n MVP — Krok 3]
 * Dodany LanguageSwitcher (variant="panel") między user info a buttonem
 * "Wyloguj" — dostępny we wszystkich 3 panelach (Admin/Supplier/Buyer)
 * po zalogowaniu. Przed loginem switcher jest w stronach auth.
 *
 * [B2B Round prod-rollout / i18n MVP — Krok 8 P1]
 * Tłumaczenia przez useTranslation('panel'). API jest backward-compatible:
 *   - jeśli caller poda `titleKey` / `roleKey` → render przez t(key)
 *   - jeśli caller dalej używa starych `title` / `roleLabel` (stringów) → render bez tłumaczenia
 * Pozwala migrować callerów stopniowo bez psucia istniejących użyć
 * (np. legacy/PreconnectFM gdyby kiedyś wywołał ten komponent bezpośrednio).
 *
 * Props:
 *   title:     string  — np. "Panel Dostawcy" (legacy, surowy string)
 *   titleKey:  string  — klucz i18n w namespace 'panel', np. "title.supplier" (preferowane)
 *   logo:      JSX     — element loga (32x32 lub zbliżony) po lewej od tytułu
 *   userLabel: string  — imię/email zalogowanego usera (po prawej)
 *   roleLabel: string  — kolorowy badge "Dostawca"/"Kupiec"/"Admin" (legacy)
 *   roleKey:   string  — klucz i18n w namespace 'panel', np. "role.supplier" (preferowane)
 *   roleColor: string  — kolor tła badge'a
 *   onSignOut: () => void
 */
export default function PanelTopBar({
  title,
  titleKey,
  logo,
  userLabel,
  roleLabel,
  roleKey,
  roleColor,
  onSignOut,
}) {
  const { t } = useTranslation("panel");
  // Klucze i18n wygrywają nad surowymi stringami (backward compat).
  const displayTitle = titleKey ? t(titleKey) : title;
  const displayRole = roleKey ? t(roleKey) : roleLabel;

  return (
    <div
      style={{
        background: "white",
        borderBottom: "1px solid #e2e8f0",
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {logo}
        <div style={{ fontWeight: 600, fontSize: 14 }}>{displayTitle}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            background: roleColor,
            color: "white",
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          {displayRole}
        </span>
        <span style={{ fontSize: 13, color: "#475569" }}>{userLabel}</span>
        <LanguageSwitcher variant="panel" />
        <button
          onClick={onSignOut}
          style={{
            background: "none",
            border: "1px solid #cbd5e1",
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            color: "#475569",
          }}
        >
          {t("topbar.signout")}
        </button>
      </div>
    </div>
  );
}
