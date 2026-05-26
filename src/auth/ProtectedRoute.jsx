import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthProvider";

/**
 * ProtectedRoute — opakowuje widok wymagający logowania.
 * Opcjonalnie wymaga konkretnej roli (allowedRoles=["admin"]).
 */
export function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading } = useAuth();
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

  return children;
}
