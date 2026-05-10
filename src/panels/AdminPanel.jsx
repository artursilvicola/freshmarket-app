import { useAuth } from "../auth/AuthProvider";
import LegacyApp from "../legacy/PreconnectFM";
import PanelTopBar from "../components/PanelTopBar";
import FreshMarketLogo from "../components/FreshMarketLogo";

/**
 * AdminPanel — wrapper na istniejącą aplikację z wymuszonym kontekstem admina.
 *
 * Twój istniejący PreconnectFM.jsx ma już logikę admina (PageAdminDash,
 * PageAdminPipeline, PageAdminRetailers, PageAdminFM, etc.).
 * Tutaj tylko wstrzykujemy informację o roli, żeby legacy app zaczynał
 * w widoku admina.
 */
export default function AdminPanel() {
  const { user, profile, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh" }}>
      <PanelTopBar
        title="Panel Administratora"
        // [B2B Round branding-and-header-logos] admin nie reprezentuje jednej
        // firmy ani sieci — w nagłówku siedzi systemowe logo Fresh Market
        // (variant="dark" — ciemne litery na białym pasku).
        logo={<FreshMarketLogo variant="dark" size={26} showText={false} />}
        userLabel={profile?.name || user?.email}
        roleLabel="Admin"
        roleColor="#7c3aed"
        onSignOut={signOut}
      />
      <LegacyApp initialRole="admin" currentUser={profile} />
    </div>
  );
}
