import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import FreshMarketLogo from "../components/FreshMarketLogo";

export default function LoginPage() {
  const { signIn, sendMagicLink, sendPasswordReset, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // [B2B Round auth-forgot-password] 3 tryby: password (zwykle logowanie),
  // magic (link zalogowania), forgot (reset hasla przez email)
  const [mode, setMode] = useState("password"); // 'password' | 'magic' | 'forgot'
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  if (user) {
    // Już zalogowany - od razu do /
    navigate("/", { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (mode === "password") {
        await signIn(email, password);
        const redirectTo = location.state?.from?.pathname || "/";
        navigate(redirectTo, { replace: true });
      } else if (mode === "magic") {
        await sendMagicLink(email);
        setMsg("Link logowania wysłany na maila. Sprawdź skrzynkę.");
      } else if (mode === "forgot") {
        await sendPasswordReset(email);
        setMsg("Link do resetu hasła wysłany na maila. Sprawdź skrzynkę (także folder spam).");
      }
    } catch (e) {
      setErr(e.message || "Błąd logowania");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        {/* [B2B Round prod-rollout / branding] Zamiast placeholdera "FM" —
            FreshMarketLogo (img z fm_settings.brand_logo_url, fallback SVG
            jabłka). variant="dark" bo karta logowania ma białe tło. */}
        <div style={S.brand}>
          <FreshMarketLogo variant="dark" size={44} showText={false} />
          <div>
            <h1 style={S.h1}>Fresh Market</h1>
            <p style={S.sub}>Panel B2B — owoce i warzywa</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.label}>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={S.input}
              placeholder="ty@firma.pl"
              autoComplete="email"
            />
          </label>

          {mode === "password" && (
            <label style={S.label}>
              Hasło
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={S.input}
                autoComplete="current-password"
              />
            </label>
          )}

          {err && <div style={S.err}>{err}</div>}
          {msg && <div style={S.ok}>{msg}</div>}

          <button type="submit" disabled={busy} style={S.btn}>
            {busy
              ? "..."
              : mode === "password"
                ? "Zaloguj się"
                : mode === "forgot"
                  ? "Wyślij link resetu hasła"
                  : "Wyślij link logowania"}
          </button>

          {mode === "password" && (
            <button
              type="button"
              onClick={() => { setMode("forgot"); setErr(null); setMsg(null); }}
              style={{ ...S.btnLink, marginTop: 0 }}
            >
              Zapomniałeś hasła?
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setErr(null); setMsg(null);
              if (mode === "password") setMode("magic");
              else setMode("password");
            }}
            style={S.btnLink}
          >
            {mode === "password" ? "Albo zaloguj przez magic link" : "Wróć do logowania hasłem"}
          </button>
        </form>

        <div style={S.footer}>
          {/* [B2B Round supplier-onboarding-access-and-communication] Self-register
              dostawcy. Konto trafia do stanu "pending_review" — admin zatwierdza
              osobno. Buyer dalej idzie przez admina (nie ma self-register dla kupców). */}
          Nie masz konta dostawcy? <Link to="/zarejestruj-dostawce" style={S.link}>Zarejestruj firmę</Link>
        </div>

        {/* [B2B Round prod-rollout / legal] Linki do Regulaminu i Polityki
            Prywatności — wymóg dobrej praktyki dla aplikacji przetwarzającej
            dane osobowe. Otwierane w nowej karcie żeby nie wybić usera z loginu. */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0", textAlign: "center", fontSize: 11, color: "#94a3b8" }}>
          <a href="/regulamin" target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600, textDecoration: "none" }}>Regulamin</a>
          <span style={{ margin: "0 8px", color: "#cbd5e1" }}>·</span>
          <a href="/polityka-prywatnosci" target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600, textDecoration: "none" }}>Polityka Prywatności</a>
          <span style={{ margin: "0 8px", color: "#cbd5e1" }}>·</span>
          <a href="mailto:hello@freshmarket.eu" style={{ color: "#0d9488", fontWeight: 600, textDecoration: "none" }}>Kontakt</a>
        </div>
      </div>
    </div>
  );
}

const S = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)",
    padding: 20,
  },
  card: {
    background: "white",
    borderRadius: 16,
    boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
    padding: 40,
    width: "100%",
    maxWidth: 420,
  },
  brand: { display: "flex", alignItems: "center", gap: 12, marginBottom: 28 },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: "#0d9488",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 18,
  },
  h1: { margin: 0, fontSize: 22, color: "#0f172a" },
  sub: { margin: 0, fontSize: 13, color: "#64748b" },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#475569", fontWeight: 500 },
  input: {
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  },
  btn: {
    padding: "12px 20px",
    background: "#0d9488",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 6,
  },
  btnLink: {
    background: "none",
    border: "none",
    color: "#0d9488",
    fontSize: 13,
    cursor: "pointer",
    textDecoration: "underline",
  },
  err: { color: "#dc2626", fontSize: 13, padding: 8, background: "#fee2e2", borderRadius: 6 },
  ok: { color: "#059669", fontSize: 13, padding: 8, background: "#d1fae5", borderRadius: 6 },
  footer: { marginTop: 24, textAlign: "center", color: "#64748b", fontSize: 13 },
  link: { color: "#0d9488", fontWeight: 600, textDecoration: "none" },
};
