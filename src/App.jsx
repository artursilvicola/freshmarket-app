import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import LoginPage from "./auth/LoginPage";
import RegisterPage from "./auth/RegisterPage";
import RegisterSupplierPage from "./auth/RegisterSupplierPage";
import PurchaseReturnPage from "./auth/PurchaseReturnPage";
import ResetPasswordPage from "./auth/ResetPasswordPage";
import AdminPanel from "./panels/AdminPanel";
import SupplierPanel from "./panels/SupplierPanel";
import BuyerPanel from "./panels/BuyerPanel";
import { isSupabaseConfigured } from "./lib/supabase";

export default function App() {
  if (!isSupabaseConfigured) {
    return <ConfigError />;
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* [B2B Round auth-forgot-password] Strona resetu hasla.
              Uzytkownik laduje tu po kliknieciu linku z emaila. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* [B2B Round supplier-onboarding-access-and-communication] Publiczna
              self-registration dostawcy. Konto trafia do account_status='pending_review'
              — dostawca może zalogować się i uzupełniać profil, ale gating w
              SupplierPanel blokuje wysyłki i Spotkania B2B do czasu zatwierdzenia. */}
          <Route path="/zarejestruj-dostawce" element={<RegisterSupplierPage />} />
          {/* [B2B Round prod-rollout / faza 3] PayU continueUrl — sprawdza status
              po stronie payu_orders i pokazuje wynik. Wymaga zalogowania. */}
          <Route path="/zakup-ok" element={<PurchaseReturnPage />} />
          {/* /register jest dostepny tylko dla zalogowanego admina (B2B Round 2). */}
          <Route
            path="/register"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <RegisterPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/*"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminPanel />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dostawca/*"
            element={
              <ProtectedRoute allowedRoles={["supplier"]}>
                <SupplierPanel />
              </ProtectedRoute>
            }
          />
          <Route
            path="/kupiec/*"
            element={
              <ProtectedRoute allowedRoles={["buyer"]}>
                <BuyerPanel />
              </ProtectedRoute>
            }
          />

          {/* Root: przekieruj według roli */}
          <Route path="/" element={<RoleRedirect />} />
          <Route path="*" element={<RoleRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

/** Po zalogowaniu kieruje do właściwego panelu wg roli z profilu. */
function RoleRedirect() {
  const { user, role, loading } = useAuth();
  // [B2B Round prod-rollout / i18n MVP — Krok 9 P1] Tłumaczenia shell.
  const { t } = useTranslation("common");

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        {t("loading")}
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  if (role === "admin") return <Navigate to="/admin" replace />;
  if (role === "supplier") return <Navigate to="/dostawca" replace />;
  if (role === "buyer") return <Navigate to="/kupiec" replace />;

  // Brak roli — coś poszło nie tak z profilem
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h2>{t("errors.no_role.title")}</h2>
      <p style={{ color: "#64748b" }}>
        {t("errors.no_role.body")}
      </p>
    </div>
  );
}

function ConfigError() {
  // [Krok 9 P1] Tłumaczenia shell — ConfigError renderowany przed AuthProvider,
  // ale i18n init w main.jsx jest synchroniczny, więc useTranslation działa.
  const { t } = useTranslation("common");
  return (
    <div style={{ padding: 40, fontFamily: "system-ui", color: "#1e293b", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ color: "#dc2626" }}>{t("config_error.title")}</h1>
      <p>
        <Trans i18nKey="config_error.body" ns="common" components={{ code: <code /> }} />
      </p>
      <ol>
        <li>
          <Trans i18nKey="config_error.step_1" ns="common" components={{ code: <code /> }} />
        </li>
        <li>{t("config_error.step_2")}</li>
        <li>
          <Trans i18nKey="config_error.step_3" ns="common" components={{ code: <code /> }} />
        </li>
      </ol>
      <p>
        <Trans i18nKey="config_error.full_instruction" ns="common" components={{ code: <code /> }} />
      </p>
    </div>
  );
}
