import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

/**
 * ProtectedRoute — opakowuje widok wymagający logowania.
 * Opcjonalnie wymaga konkretnej roli (allowedRoles=["admin"]).
 */
export function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Ładowanie...
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
