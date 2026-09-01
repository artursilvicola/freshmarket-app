import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthProvider";
import FreshMarketLogo from "../components/FreshMarketLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { normalizeLocale } from "../i18n/locale";

export default function LoginPage() {
  const { signIn, sendMagicLink, sendPasswordReset, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // [B2B Round prod-rollout / i18n MVP — Krok 4]
  // Namespace "auth" zawiera wszystkie klucze loginu/rejestracji/reset/PayU.
  // Defensywny normalizeLocale na wypadek gdy i18n.language jest "en-US" itp.
  const { t, i18n } = useTranslation("auth");
  const locale = normalizeLocale(i18n.language);

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
        setMsg(t("login.magic_link_sent"));
      } else if (mode === "forgot") {
        await sendPasswordReset(email);
        setMsg(t("login.reset_link_sent"));
      }
    } catch (e) {
      setErr(e.message || t("login.error_default"));
    } finally {
      setBusy(false);
    }
  };

  // [B2B Round prod-rollout / i18n MVP — Krok 4]
  // Linki do regulaminu/polityki zależą od języka. PL → /regulamin, /polityka-prywatnosci
  // EN → /regulations, /privacy-policy (osobne strony statyczne dla EN dostarczą
  // EN regulations w późniejszym kroku P0; jeśli na razie nie ma EN treści,
  // i18n nie powinien wymuszać polskiego URL'a anglojęzycznemu userowi).
  const termsHref = locale === "en" ? "/regulations" : "/regulamin";
  const privacyHref = locale === "en" ? "/privacy-policy" : "/polityka-prywatnosci";

  return (
    <div style={S.wrap}>
      {/* [B2B Round prod-rollout / i18n MVP — Krok 3] Przełącznik języka
          w prawym górnym rogu, na gradiencie. Wariant "auth" — białe litery. */}
      <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
        <LanguageSwitcher variant="auth" />
      </div>
      <div style={S.card}>
        {/* [B2B Round prod-rollout / branding] Zamiast placeholdera "FM" —
            FreshMarketLogo (img z fm_settings.brand_logo_url, fallback SVG
            jabłka). variant="dark" bo karta logowania ma białe tło. */}
        <div style={S.brand}>
          <FreshMarketLogo variant="dark" size={44} showText={false} />
          <div>
            <h1 style={S.h1}>{t("login.title")}</h1>
            <p style={S.sub}>{t("login.subtitle")}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.label}>
            {t("common.email")}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={S.input}
              placeholder={t("common.email_placeholder_login")}
              autoComplete="email"
            />
          </label>

          {mode === "password" && (
            <label style={S.label}>
              {t("common.password")}
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
              ? t("login.busy")
              : mode === "password"
                ? t("login.sign_in_button")
                : mode === "forgot"
                  ? t("login.send_reset_link")
                  : t("login.magic_link_send")}
          </button>

          {mode === "password" && (
            <button
              type="button"
              onClick={() => { setMode("forgot"); setErr(null); setMsg(null); }}
              style={{ ...S.btnLink, marginTop: 0 }}
            >
              {t("login.forgot_password")}
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
            {mode === "password" ? t("login.magic_link_switch") : t("login.back_to_password")}
          </button>
        </form>

        <div style={S.footer}>
          {/* [B2B Round supplier-onboarding-access-and-communication] Self-register
              dostawcy. Konto trafia do stanu "pending_review" — admin zatwierdza
              osobno. Buyer dalej idzie przez admina (nie ma self-register dla kupców). */}
          {t("login.no_account_register_intro")}
          <Link to="/zarejestruj-dostawce" style={S.link}>{t("login.register_link")}</Link>
        </div>

        {/* [B2B Round prod-rollout / legal] Linki do Regulaminu i Polityki
            Prywatności — wymóg dobrej praktyki dla aplikacji przetwarzającej
            dane osobowe. Otwierane w nowej karcie żeby nie wybić usera z loginu.
            [Krok 4] termsHref / privacyHref zależą od locale (PL → /regulamin,
            EN → /regulations). */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0", textAlign: "center", fontSize: 11, color: "#94a3b8" }}>
          <a href={termsHref} target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600, textDecoration: "none" }}>{t("login.footer_terms")}</a>
          <span style={{ margin: "0 8px", color: "#cbd5e1" }}>·</span>
          <a href={privacyHref} target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600, textDecoration: "none" }}>{t("login.footer_privacy")}</a>
          <span style={{ margin: "0 8px", color: "#cbd5e1" }}>·</span>
          <a href="mailto:support@freshmarket.eu" style={{ color: "#0d9488", fontWeight: 600, textDecoration: "none" }}>{t("login.footer_contact")}</a>
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
