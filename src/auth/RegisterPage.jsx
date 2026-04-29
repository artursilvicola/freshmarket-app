import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";

/**
 * RegisterPage — rejestracja nowego użytkownika.
 * Po stworzeniu konta:
 *  - jeśli wybrano rolę 'supplier': tworzy też nową firmę (companies)
 *    i przypisuje company_id w profilu
 *  - jeśli 'buyer': zostawia retailer_id puste (admin podepnie do retailera)
 *
 * UWAGA: jeśli w Supabase włączone "Confirm email", użytkownik dostanie
 * mail i musi kliknąć link przed pierwszym logowaniem. Na czas testów
 * wyłącz to w Authentication > Settings > Email Auth.
 */
export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState("supplier");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("PL");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      // 1. Stwórz konto
      const { user } = await signUp(email, password, { name, role });
      if (!user) throw new Error("Brak userId po rejestracji");

      // 2. Update profilu (trigger w bazie utworzył domyślny z rolą supplier)
      const profileUpdate = { name, role };

      // 3. Dla suppliera: stwórz firmę i przypisz company_id
      if (role === "supplier" && companyName) {
        const { data: co, error: coErr } = await supabase
          .from("companies")
          .insert({ name: companyName, country })
          .select()
          .single();
        if (coErr) throw coErr;
        profileUpdate.company_id = co.id;
      }

      const { error: pErr } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", user.id);
      if (pErr) throw pErr;

      setMsg(
        "Konto utworzone! Jeśli Supabase wymaga potwierdzenia maila — sprawdź skrzynkę. " +
          "Zaraz przekierujemy do logowania."
      );
      setTimeout(() => navigate("/login"), 3000);
    } catch (e) {
      setErr(e.message || "Błąd rejestracji");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <h1 style={S.h1}>Rejestracja</h1>
        <p style={S.sub}>Wybierz typ konta i wypełnij formularz.</p>

        <div style={S.tabs}>
          {[
            ["supplier", "🌱 Dostawca"],
            ["buyer", "🛒 Kupiec"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setRole(k)}
              style={{
                ...S.tab,
                ...(role === k ? S.tabActive : {}),
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.label}>
            Imię i nazwisko
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={S.input}
            />
          </label>

          <label style={S.label}>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={S.input}
            />
          </label>

          <label style={S.label}>
            Hasło (min. 6 znaków)
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={S.input}
            />
          </label>

          {role === "supplier" && (
            <>
              <label style={S.label}>
                Nazwa firmy
                <input
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  style={S.input}
                />
              </label>
              <label style={S.label}>
                Kraj
                <select value={country} onChange={(e) => setCountry(e.target.value)} style={S.input}>
                  <option value="PL">Polska</option>
                  <option value="ES">Hiszpania</option>
                  <option value="IT">Włochy</option>
                  <option value="DE">Niemcy</option>
                  <option value="NL">Holandia</option>
                  <option value="FR">Francja</option>
                </select>
              </label>
            </>
          )}

          {role === "buyer" && (
            <div style={S.info}>
              Po rejestracji administrator przypisze Twoje konto do sieci handlowej.
            </div>
          )}

          {err && <div style={S.err}>{err}</div>}
          {msg && <div style={S.ok}>{msg}</div>}

          <button type="submit" disabled={busy} style={S.btn}>
            {busy ? "..." : "Utwórz konto"}
          </button>
        </form>

        <div style={S.footer}>
          Masz już konto?{" "}
          <Link to="/login" style={S.link}>
            Zaloguj się
          </Link>
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
    padding: 36,
    width: "100%",
    maxWidth: 460,
  },
  h1: { margin: 0, fontSize: 22, color: "#0f172a" },
  sub: { margin: "4px 0 18px", fontSize: 13, color: "#64748b" },
  tabs: { display: "flex", gap: 8, marginBottom: 18 },
  tab: {
    flex: 1,
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    background: "white",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    color: "#475569",
  },
  tabActive: {
    background: "#0d9488",
    color: "white",
    borderColor: "#0d9488",
    fontWeight: 600,
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#475569", fontWeight: 500 },
  input: { padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none" },
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
  err: { color: "#dc2626", fontSize: 13, padding: 8, background: "#fee2e2", borderRadius: 6 },
  ok: { color: "#059669", fontSize: 13, padding: 8, background: "#d1fae5", borderRadius: 6 },
  info: { color: "#475569", fontSize: 13, padding: 10, background: "#f1f5f9", borderRadius: 6 },
  footer: { marginTop: 20, textAlign: "center", color: "#64748b", fontSize: 13 },
  link: { color: "#0d9488", fontWeight: 600, textDecoration: "none" },
};
