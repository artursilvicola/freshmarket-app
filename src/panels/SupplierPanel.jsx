import { useAuth } from "../auth/AuthProvider";
import LegacyApp from "../legacy/PreconnectFM";
import PanelTopBar from "../components/PanelTopBar";
import EntityLogo from "../components/EntityLogo";

export default function SupplierPanel() {
  const { user, profile, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh" }}>
      <PanelTopBar
        title="Panel Dostawcy"
        logo={
          <EntityLogo
            logoUrl={profile?.company_logo_url}
            name={profile?.company_name}
            bgColor="#0d9488"
          />
        }
        userLabel={profile?.name || user?.email}
        roleLabel="Dostawca"
        roleColor="#0d9488"
        onSignOut={signOut}
      />
      <LegacyApp initialRole="supplier" currentUser={profile} />
    </div>
  );
}
