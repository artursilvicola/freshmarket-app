import { useAuth } from "../auth/AuthProvider";
import LegacyApp from "../legacy/PreconnectFM";
import PanelTopBar from "../components/PanelTopBar";
import EntityLogo from "../components/EntityLogo";
import LegalFooter from "../components/LegalFooter";

export default function BuyerPanel() {
  const { user, profile, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <PanelTopBar
        titleKey="title.buyer"
        logo={
          <EntityLogo
            logoUrl={profile?.retailer_logo_url}
            name={profile?.retailer_name}
            bgColor="#2563eb"
          />
        }
        userLabel={profile?.name || user?.email}
        roleKey="role.buyer"
        roleColor="#2563eb"
        onSignOut={signOut}
      />
      <div style={{ flex: 1 }}>
        <LegacyApp initialRole="buyer" currentUser={profile} />
      </div>
      <LegalFooter />
    </div>
  );
}
