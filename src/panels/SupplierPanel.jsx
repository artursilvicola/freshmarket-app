import { useAuth } from "../auth/AuthProvider";
import LegacyApp from "../legacy/PreconnectFM";
import PanelTopBar from "../components/PanelTopBar";
import EntityLogo from "../components/EntityLogo";
import LegalFooter from "../components/LegalFooter";
import MobilePortraitNotice from "../components/MobilePortraitNotice";

export default function SupplierPanel() {
  const { user, profile, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <PanelTopBar
        titleKey="title.supplier"
        logo={
          <EntityLogo
            logoUrl={profile?.company_logo_url}
            name={profile?.company_name}
            bgColor="#0d9488"
          />
        }
        userLabel={profile?.name || user?.email}
        roleKey="role.supplier"
        roleColor="#0d9488"
        onSignOut={signOut}
      />
      <div style={{ flex: 1 }}>
        <LegacyApp initialRole="supplier" currentUser={profile} />
      </div>
      <MobilePortraitNotice />
      <LegalFooter />
    </div>
  );
}
