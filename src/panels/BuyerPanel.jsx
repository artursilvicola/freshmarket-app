import { useAuth } from "../auth/AuthProvider";
import LegacyApp from "../legacy/PreconnectFM";
import PanelTopBar from "../components/PanelTopBar";
import EntityLogo from "../components/EntityLogo";

export default function BuyerPanel() {
  const { user, profile, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh" }}>
      <PanelTopBar
        title="Panel Kupca"
        logo={
          <EntityLogo
            logoUrl={profile?.retailer_logo_url}
            name={profile?.retailer_name}
            bgColor="#2563eb"
          />
        }
        userLabel={profile?.name || user?.email}
        roleLabel="Kupiec"
        roleColor="#2563eb"
        onSignOut={signOut}
      />
      <LegacyApp initialRole="buyer" currentUser={profile} />
    </div>
  );
}
