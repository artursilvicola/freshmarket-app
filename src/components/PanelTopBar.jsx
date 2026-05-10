/**
 * <PanelTopBar>
 *
 * Wspólny nagłówek paneli (dostawca / kupiec / admin). Wcześniej każdy
 * panel miał własną kopię tej samej JSX-y; po Round branding-and-header-logos
 * jeden komponent przyjmuje element `logo` jako props (FreshMarketLogo
 * dla admina, EntityLogo dla dostawcy/kupca) — reszta układu jest identyczna.
 *
 * Props:
 *   title:     string  — np. "Panel Dostawcy"
 *   logo:      JSX     — element loga (32x32 lub zbliżony) po lewej od tytułu
 *   userLabel: string  — imię/email zalogowanego usera (po prawej)
 *   roleLabel: string  — kolorowy badge "Dostawca"/"Kupiec"/"Admin"
 *   roleColor: string  — kolor tła badge'a
 *   onSignOut: () => void
 */
export default function PanelTopBar({
  title,
  logo,
  userLabel,
  roleLabel,
  roleColor,
  onSignOut,
}) {
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
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
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
          {roleLabel}
        </span>
        <span style={{ fontSize: 13, color: "#475569" }}>{userLabel}</span>
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
          Wyloguj
        </button>
      </div>
    </div>
  );
}
