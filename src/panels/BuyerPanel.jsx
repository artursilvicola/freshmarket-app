import { useAuth } from "../auth/AuthProvider";
import LegacyApp from "../legacy/PreconnectFM";
import PanelTopBar from "../components/PanelTopBar";
import EntityLogo from "../components/EntityLogo";
import LegalFooter from "../components/LegalFooter";
import MobilePortraitNotice from "../components/MobilePortraitNotice";
import PartnersStrip from "../components/PartnersStrip";

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
      <MobilePortraitNotice />
      {/* [feat/footer-partners] Pasek sponsorow + stopka prawna jako jeden blok
          dociskany do dolu (marginTop:auto na wrapperze — wewnatrz zwyklego
          diva auto-marginesy obu dzieci sa neutralne). */}
      <div style={{ marginTop: "auto" }}>
        <PartnersStrip />
        <LegalFooter />
      </div>
    </div>
  );
}
