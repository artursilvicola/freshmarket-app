// [B2B Round auth-forgot-password] Strona ustawienia nowego hasla.
// Uzytkownik laduje tu po kliknieciu linku z emaila resetu. Supabase auto
// sign-in z PASSWORD_RECOVERY event — sesja jest gotowa. Uzytkownik wpisuje
// nowe haslo (+ powtorzenie) i klikamy auth.updateUser({password}).

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import FreshMarketLogo from "../components/FreshMarketLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  // [B2B Round prod-rollout / i18n MVP — Krok 4]
  const { t } = useTranslation("auth");

  const [pwd, setPwd] = useState("");
  const [cf, setCf] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Po wejsciu z linku resetu Supabase wysyla PASSWORD_RECOVERY event.
    // Sluchamy auth state change, zeby wiedziec czy sesja recovery zostala
    // ustanowiona (jesli nie, link wygasl albo jest nieprawidlowy).
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    // Sprawdz takze biezaca sesje (gdy event mial juz miejsce zanim subskrybowalismy)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription?.unsubscribe();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!pwd || pwd.length < 8) {
      setErr(t("reset_password.password_too_short"));
      return;
    }
    if (pwd !== cf) {
      setErr(t("reset_password.passwords_dont_match"));
      return;
    }
    try {
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      setMsg(t("reset_password.success_redirect"));
      setTimeout(() => navigate("/", { replace: true }), 1500);
    } catch (e) {
      setErr(e?.message || t("reset_password.default_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.wrap}>
      <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
        <LanguageSwitcher variant="auth" />
      </div>
      <div style={S.card}>
        {/* [B2B Round prod-rollout / branding] Brand logo zamiast placeholdera FM */}
        <div style={S.brand}>
          <FreshMarketLogo variant="dark" size={44} showText={false} />
          <div>
            <h1 style={S.h1}>{t("reset_password.title")}</h1>
            <p style={S.sub}>{t("reset_password.subtitle")}</p>
          </div>
        </div>

        {!ready ? (
          <div style={S.info}>
            {t("reset_password.verifying")}
            <div style={{ marginTop: 12 }}>
              <a href="/login" style={S.link}>{t("reset_password.back_to_login")}</a>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={S.form}>
            <label style={S.label}>
              {t("reset_password.new_password_label")}
              <div style={{ position: "relative" }}>
                <input
                  type={show ? "text" : "password"}
                  required
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  style={S.input}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  style={S.showBtn}
                  title={show ? t("reset_password.hide_title") : t("reset_password.show_title")}
                >
                  {show ? t("reset_password.hide") : t("reset_password.show")}
                </button>
              </div>
            </label>

            <label style={S.label}>
              {t("reset_password.repeat_password_label")}
              <input
                type={show ? "text" : "password"}
                required
                value={cf}
                onChange={(e) => setCf(e.target.value)}
                style={S.input}
                autoComplete="new-password"
              />
            </label>

            {err && <div style={S.err}>{err}</div>}
            {msg && <div style={S.ok}>{msg}</div>}

            <button type="submit" disabled={busy} style={S.btn}>
              {busy ? t("reset_password.submitting") : t("reset_password.submit_button")}
            </button>
          </form>
        )}
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
    width: "100%",
    boxSizing: "border-box",
  },
  showBtn: {
    position: "absolute",
    right: 10,
    top: 10,
    padding: "2px 8px",
    background: "transparent",
    border: "none",
    color: "#64748b",
    fontSize: 11,
    cursor: "pointer",
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
  err: { color: "#dc2626", fontSize: 13, padding: 8, background: "#fee2e2", borderRadius: 6 },
  ok: { color: "#059669", fontSize: 13, padding: 8, background: "#d1fae5", borderRadius: 6 },
  info: { fontSize: 13, color: "#64748b", lineHeight: 1.6, textAlign: "center", padding: "12px 0" },
  link: { color: "#0d9488", fontWeight: 600, textDecoration: "none" },
};
