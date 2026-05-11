import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import LoginPage from "./auth/LoginPage";
import RegisterPage from "./auth/RegisterPage";
import RegisterSupplierPage from "./auth/RegisterSupplierPage";
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
          {/* [B2B Round supplier-onboarding-access-and-communication] Publiczna
              self-registration dostawcy. Konto trafia do account_status='pending_review'
              — dostawca może zalogować się i uzupełniać profil, ale gating w
              SupplierPanel blokuje wysyłki i Spotkania B2B do czasu zatwierdzenia. */}
          <Route path="/zarejestruj-dostawce" element={<RegisterSupplierPage />} />
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

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Ładowanie...
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
      <h2>Konto bez roli</h2>
      <p style={{ color: "#64748b" }}>
        Twoje konto nie ma jeszcze przypisanej roli. Skontaktuj się z administratorem.
      </p>
    </div>
  );
}

function ConfigError() {
  return (
    <div style={{ padding: 40, fontFamily: "system-ui", color: "#1e293b", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ color: "#dc2626" }}>Brak konfiguracji Supabase</h1>
      <p>
        Plik <code>.env</code> nie ma ustawionych <code>VITE_SUPABASE_URL</code> lub{" "}
        <code>VITE_SUPABASE_ANON_KEY</code>.
      </p>
      <ol>
        <li>
          Skopiuj <code>.env.example</code> jako <code>.env</code>
        </li>
        <li>
          Wstaw klucze z panelu Supabase (Project Settings → API)
        </li>
        <li>
          Zrestartuj <code>npm run dev</code>
        </li>
      </ol>
      <p>
        Pełna instrukcja: <code>SETUP_INSTRUKCJA.md</code>
      </p>
    </div>
  );
}
