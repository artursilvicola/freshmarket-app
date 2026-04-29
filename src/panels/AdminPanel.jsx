import { useAuth } from "../auth/AuthProvider";
import LegacyApp from "../legacy/PreconnectFM";

/**
 * AdminPanel — wrapper na istniejącą aplikację z wymuszonym kontekstem admina.
 *
 * Twój istniejący PreconnectFM.jsx ma już logikę admina (PageAdminDash,
 * PageAdminPipeline, PageAdminRetailers, PageAdminFM, etc.).
 * Tutaj tylko wstrzykujemy informację o roli, żeby legacy app zaczynał
 * w widoku admina.
 *
 * KROK PÓŹNIEJSZY: Twój PreconnectFM.jsx trzeba lekko zmodyfikować, żeby
 * - usunął wewnętrzny przełącznik ról (AccountSwitcherBar)
 * - czytał aktualną rolę z props zamiast z lokalnego state
 *
 * Tu wystarczy props "initialRole" i "currentUser".
 */
export default function AdminPanel() {
  const { user, profile, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopBar
        title="Panel Administratora"
        userLabel={profile?.name || user?.email}
        roleLabel="Admin"
        roleColor="#7c3aed"
        onSignOut={signOut}
      />
      <LegacyApp initialRole="admin" currentUser={profile} />
    </div>
  );
}

function TopBar({ title, userLabel, roleLabel, roleColor, onSignOut }) {
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
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#0d9488",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
          }}
        >
          FM
        </div>
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
