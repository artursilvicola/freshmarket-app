import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthProvider";

/**
 * ProtectedRoute — opakowuje widok wymagający logowania.
 * Opcjonalnie wymaga konkretnej roli (allowedRoles=["admin"]).
 */
export function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, profile, loading, signOut, refreshProfile } = useAuth();
  // [B2B Round prod-rollout / i18n MVP — Krok 9 P1] Loading w common namespace.
  const { t } = useTranslation("common");

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        {t("loading")}
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  if (role === "supplier" && allowedRoles?.includes("supplier") && !profile?.company_id) {
    return (
      <AccountLinkError
        title={t("errors.no_company.title")}
        body={t("errors.no_company.body")}
        signOut={signOut}
        refreshProfile={refreshProfile}
        registerUrl="/zarejestruj-dostawce"
      />
    );
  }

  if (role === "buyer" && allowedRoles?.includes("buyer") && profile?.retailer_id == null) {
    return (
      <AccountLinkError
        title={t("errors.no_retailer.title")}
        body={t("errors.no_retailer.body")}
        signOut={signOut}
        refreshProfile={refreshProfile}
      />
    );
  }

  return children;
}

function AccountLinkError({ title, body, signOut, refreshProfile, registerUrl }) {
  const { t } = useTranslation("common");
  return (
    <div style={{ padding: 40, textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
      <h2>{title}</h2>
      <p style={{ color: "#64748b" }}>{body}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 20 }}>
        {/* [feat/orphan-reregister-cta] Sierota po przerwanej rejestracji może
            naprawić konto samodzielnie — rejestracja z tym samym e-mailem
            przechodzi dzięki auto-heal w register-supplier-self. Wylogowujemy
            przed przejściem, żeby formularz startował na czystej sesji. */}
        {registerUrl && (
          <button
            type="button"
            onClick={async () => {
              try { await signOut?.(); } catch { /* i tak nawigujemy */ }
              window.location.assign(registerUrl);
            }}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#0d9488", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            {t("errors.no_company.register_btn")}
          </button>
        )}
        <button
          type="button"
          onClick={() => signOut?.()}
          style={registerUrl
            ? { padding: "9px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }
            : { padding: "9px 18px", borderRadius: 8, border: "none", background: "#0d9488", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          {t("errors.no_role.sign_out_btn")}
        </button>
        {refreshProfile && (
          <button
            type="button"
            onClick={() => refreshProfile()}
            style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}
          >
            {t("errors.no_role.refresh_btn")}
          </button>
        )}
      </div>
    </div>
  );
}
