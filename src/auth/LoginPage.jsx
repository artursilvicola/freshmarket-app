import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthProvider";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { loginErrorKey } from "./authErrors.js";
import { normalizeLocale } from "../i18n/locale";
import "./loginPage.css";

// [feat/login-page] Oficjalny znak Fresh Market z repozytorium (ten sam plik co w mailach).
const LOGO_SRC = "/brand/fm-email-logo-green.png";

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
      // [fix/auth-magic-link-existing-only] nieznany adres przy magic linku → czytelny tekst
      const key = loginErrorKey(e, mode);
      setErr(key ? t(key) : (e.message || t("login.error_default")));
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

  // [feat/login-page] Zmiana WYŁĄCZNIE wyglądu: te same pola, te same trzy tryby (hasło / magic link /
  // reset), ta sama rejestracja dostawcy i te same przekierowania co wcześniej. Teksty w HTML (PL/EN),
  // grafika jest tylko dekoracją. Bez daty wydarzenia — strona nie czyta konfiguracji wydarzeń.
  return (
    <div className="fm-login">
      <div className="fm-login-produce" aria-hidden="true" />

      <header className="fm-login-header">
        <div className="fm-login-brand">
          <img className="fm-login-logo" src={LOGO_SRC} alt="Fresh Market" width="130" height="52" />
          <span className="fm-login-brand-sep" aria-hidden="true" />
          <div>
            <p className="fm-login-brand-name">PreConnect</p>
            <p className="fm-login-brand-tag">{t("login.brand_tagline")}</p>
          </div>
        </div>
        <LanguageSwitcher variant="auth-light" />
      </header>

      <main className="fm-login-main">
        <section className="fm-login-card" aria-labelledby="fm-login-title">
          <h1 id="fm-login-title" className="fm-login-card-title">{t("login.card_title")}</h1>
          <p className="fm-login-card-sub">{t("login.card_subtitle")}</p>

          <form onSubmit={handleSubmit} className="fm-login-form">
            <label className="fm-login-label">
              {t("common.email")}
              <span className="fm-login-field">
                <IconMail />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="fm-login-input"
                  placeholder={t("common.email_placeholder_login")}
                  autoComplete="email"
                />
              </span>
            </label>

            {mode === "password" && (
              <label className="fm-login-label">
                {t("common.password")}
                <span className="fm-login-field">
                  <IconLock />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="fm-login-input"
                    autoComplete="current-password"
                  />
                </span>
              </label>
            )}

            {err && <div className="fm-login-err" role="alert">{err}</div>}
            {msg && <div className="fm-login-ok" role="status">{msg}</div>}

            <button type="submit" disabled={busy} className="fm-login-btn">
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
                className="fm-login-btn-link"
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
              className="fm-login-btn-link"
            >
              {mode === "password" ? t("login.magic_link_switch") : t("login.back_to_password")}
            </button>
          </form>

          {/* [B2B Round supplier-onboarding-access-and-communication] Self-register
              dostawcy. Konto trafia do stanu "pending_review" — admin zatwierdza
              osobno. Buyer dalej idzie przez admina (nie ma self-register dla kupców). */}
          <div className="fm-login-register-box">
            <p className="fm-login-register-intro">{t("login.no_account_register_intro")}</p>
            <Link to="/zarejestruj-dostawce" className="fm-login-register">
              <IconUserPlus />
              {t("login.register_link")}
            </Link>
            <p className="fm-login-buyers-note">{t("login.buyers_note")}</p>
          </div>

          {/* [B2B Round prod-rollout / legal] Linki do Regulaminu i Polityki
              Prywatności — wymóg dobrej praktyki dla aplikacji przetwarzającej
              dane osobowe. Otwierane w nowej karcie żeby nie wybić usera z loginu.
              [Krok 4] termsHref / privacyHref zależą od locale (PL → /regulamin,
              EN → /regulations). */}
          <div className="fm-login-legal">
            <a href={termsHref} target="_blank" rel="noopener">{t("login.footer_terms")}</a>
            <span aria-hidden="true">·</span>
            <a href={privacyHref} target="_blank" rel="noopener">{t("login.footer_privacy")}</a>
            <span aria-hidden="true">·</span>
            <a href="mailto:support@freshmarket.eu">{t("login.footer_contact")}</a>
          </div>
        </section>

        <section className="fm-login-info" aria-labelledby="fm-login-hero">
          <h2 id="fm-login-hero" className="fm-login-hero-title">{t("login.hero_title")}</h2>
          <p className="fm-login-hero-highlight">{t("login.hero_highlight")}</p>
          <p className="fm-login-hero-lead">{t("login.hero_lead")}</p>

          <div className="fm-login-roles">
            <div className="fm-login-role fm-login-role--supplier">
              <IconCrate />
              <div>
                <h3>{t("login.for_suppliers_title")}</h3>
                <p>{t("login.for_suppliers_text")}</p>
              </div>
            </div>
            <div className="fm-login-role fm-login-role--buyer">
              <IconCart />
              <div>
                <h3>{t("login.for_buyers_title")}</h3>
                <p>{t("login.for_buyers_text")}</p>
              </div>
            </div>
          </div>

          {/* PreConnect (online, cały rok) i Spotkania B2B (stacjonarnie) to dwa różne moduły —
              pokazane osobno i bez daty wydarzenia. */}
          <ul className="fm-login-modules">
            <li>
              <IconScreen />
              <span><strong>{t("login.module_preconnect_title")}</strong>{t("login.module_preconnect_text")}</span>
            </li>
            <li>
              <IconPeople />
              <span><strong>{t("login.module_meetings_title")}</strong>{t("login.module_meetings_text")}</span>
            </li>
            <li>
              <IconLeaf />
              <span className="fm-login-sectors">
                {t("login.sector_fruit")}<i aria-hidden="true">•</i>{t("login.sector_vegetables")}<i aria-hidden="true">•</i>{t("login.sector_flowers")}
              </span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

// Ikony: proste rysunki liniowe w kodzie (bez zewnętrznych plików), ukryte przed czytnikami ekranu.
const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" };
const IconMail = () => (<svg {...svgProps}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>);
const IconLock = () => (<svg {...svgProps}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>);
const IconUserPlus = () => (<svg {...svgProps}><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></svg>);
const IconCrate = () => (<svg {...svgProps}><path d="M3 11h18v9H3z" /><path d="M3 15.5h18M8 11v9M16 11v9" /><circle cx="9" cy="7.5" r="2.5" /><circle cx="15" cy="7.5" r="2.5" /><path d="M12 5.2c.3-1.2 1.1-2 2.2-2.2" /></svg>);
const IconCart = () => (<svg {...svgProps}><path d="M2.5 4h2.6l2.3 10.5h10.2l2-7.5H6.3" /><circle cx="9" cy="18.5" r="1.4" /><circle cx="16.5" cy="18.5" r="1.4" /></svg>);
const IconScreen = () => (<svg {...svgProps}><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /><path d="m9 10.5 2 2 4-4" /></svg>);
const IconPeople = () => (<svg {...svgProps}><circle cx="8" cy="8.5" r="3" /><circle cx="16.5" cy="9.5" r="2.5" /><path d="M2.5 19.5a5.5 5.5 0 0 1 11 0M14.5 19.5a4.2 4.2 0 0 1 7 -3" /></svg>);
const IconLeaf = () => (<svg {...svgProps}><path d="M5 19c0-8 5-13.5 15-14-.5 10-6 15-14 15" /><path d="M5 19c2-4.5 5-7.5 9.5-9.5" /></svg>);
