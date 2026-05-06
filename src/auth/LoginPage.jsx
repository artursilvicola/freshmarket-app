import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function LoginPage() {
  const { signIn, sendMagicLink, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("password"); // 'password' | 'magic'
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
      } else {
        await sendMagicLink(email);
        setMsg("Link logowania wysłany na maila. Sprawdź skrzynkę.");
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
        <div style={S.brand}>
          <div style={S.logo}>FM</div>
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
            {busy ? "..." : mode === "password" ? "Zaloguj się" : "Wyślij link"}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === "password" ? "magic" : "password")}
            style={S.btnLink}
          >
            {mode === "password" ? "Albo zaloguj przez magic link" : "Wróć do logowania hasłem"}
          </button>
        </form>

        <div style={S.footer}>
          Konta B2B sa tworzone przez administratora po zatwierdzeniu rejestracji
          na <a href="https://freshmarket.eu/registration" style={S.link}>freshmarket.eu/registration</a>.
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
