import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { selfRegisterSupplier } from "../lib/db";
import { supabase } from "../lib/supabase";
import FreshMarketLogo from "../components/FreshMarketLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";
import i18n from "../i18n";
import { normalizeLocale } from "../i18n/locale";
import { TERMS_VERSION, PRIVACY_VERSION } from "../lib/legal-versions";
import { NIP_REQUIRED } from "../config/features";
// [feat/shared-countries] Ta sama lista krajów co w aplikacji (jedno źródło).
import { getSortedCountries, FLAGS } from "../lib/countries";

/**
 * RegisterSupplierPage — publiczna self-registration dostawcy.
 * [B2B Round supplier-onboarding-access-and-communication]
 *
 * Tworzy konto + firmę w stanie account_status='pending_review'.
 * Admin musi zatwierdzić ręcznie zanim supplier zacznie wysyłać oferty
 * lub korzystać ze Spotkań B2B.
 *
 * UX: po sukcesie automatycznie loguje supplera (signIn z hasłem) i
 * przerzuca do panelu /dostawca, gdzie banner powie że konto czeka na
 * review.
 */
export default function RegisterSupplierPage() {
  const navigate = useNavigate();
  // [B2B Round prod-rollout / i18n MVP — Krok 4] Tłumaczenia z namespace "auth".
  const { t } = useTranslation("auth");
  const locale = normalizeLocale(i18n.language);

  const [form, setForm] = useState({
    email: "",
    password: "",
    company_name: "",
    country: "PL",
    contact_name: "",
    contact_phone: "",
    nip: "",
    accept: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // [Krok 4] Linki do regulaminu/polityki zależne od języka — anglojęzyczny
  // user nie powinien być rzucony na polskie dokumenty. EN wersja /regulations
  // i /privacy-policy zostanie wgrana w osobnym PR w P0.
  const termsHref = locale === "en" ? "/regulations" : "/regulamin";
  const privacyHref = locale === "en" ? "/privacy-policy" : "/polityka-prywatnosci";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (!form.accept) throw new Error(t("register.accept_required"));
      if (form.password.length < 8) throw new Error(t("register.password_too_short"));
      // [feat/nip-required #1] NIP obowiązkowy do rejestracji (za flagą NIP_REQUIRED).
      if (NIP_REQUIRED && !form.nip.trim()) throw new Error(t("register.nip_required"));

      const result = await selfRegisterSupplier({
        email: form.email,
        password: form.password,
        company_name: form.company_name,
        country: form.country,
        contact_name: form.contact_name,
        contact_phone: form.contact_phone,
        nip: form.nip,
        accepted_terms_version: TERMS_VERSION,
        accepted_privacy_version: PRIVACY_VERSION,
        // [B2B Round prod-rollout / i18n MVP — Krok 3b]
        // Przekazujemy aktualnie wybrany język żeby nowy profile.locale
        // od razu miał właściwą wartość (zamiast domyślnego 'pl'). Backend
        // (register-supplier-self) walidouje i zapisuje do profiles.locale
        // + auth.users.user_metadata.locale (dla maili welcome).
        locale,
      });

      // Auto-login: supplier od razu trafia do panelu (w stanie pending_review)
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (signInErr) {
        setDone({ ok: true, autoLogin: false, ...result });
      } else {
        // [B2B Round prod-rollout / legal-versioning] Zapisz wersje zaakceptowanych
        // dokumentów do profiles — wymóg art. 7 RODO (obowiązek wykazania zgody).
        // Robimy PO signIn żeby RLS pozwoliło na update (auth.uid() = profile.id).
        try {
          const { data: sess } = await supabase.auth.getUser();
          if (sess?.user?.id) {
            await supabase
              .from("profiles")
              .update({
                accepted_terms_version: TERMS_VERSION,
                accepted_privacy_version: PRIVACY_VERSION,
                accepted_at: new Date().toISOString(),
              })
              .eq("id", sess.user.id);
          }
        } catch (e) {
          console.warn("[register] consent versioning save failed", e?.message || e);
          // Nie blokujemy rejestracji — fallback w bazie zapisuje "pre-1.0" przez migrację
        }
        // navigate dopiero po krótkim opóźnieniu, żeby AuthProvider zdążył pociągnąć profil
        setDone({ ok: true, autoLogin: true, ...result });
        setTimeout(() => navigate("/dostawca", { replace: true }), 800);
      }
    } catch (e) {
      setErr(e.message || t("register.error_default"));
    } finally {
      setBusy(false);
    }
  };

  if (done?.ok) {
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
              <h1 style={S.h1}>{t("register.success_title")}</h1>
              <p style={S.sub}>{t("register.success_subtitle")}</p>
            </div>
          </div>
          <div style={S.ok}>
            {/* [Krok 4] success_description_email + success_description_company mają
                <strong> tagi i interpolation, więc Trans z components+values. */}
            <Trans
              i18nKey="register.success_description_email"
              ns="auth"
              values={{ email: form.email }}
              components={{ strong: <strong /> }}
            />
            {" "}
            <Trans
              i18nKey="register.success_description_company"
              ns="auth"
              values={{ company: form.company_name }}
              components={{ strong: <strong /> }}
            />
          </div>
          <p style={{ fontSize: 13, color: "#475569", marginTop: 16, lineHeight: 1.6 }}>
            {t("register.success_profile_hint")}
          </p>
          {!done.autoLogin && (
            <Link to="/login" style={{ ...S.btn, display: "inline-block", textAlign: "center", marginTop: 16, textDecoration: "none" }}>
              {t("register.success_go_to_login")}
            </Link>
          )}
          {done.autoLogin && (
            <div style={{ marginTop: 16, fontSize: 13, color: "#64748b" }}>{t("register.success_logging_in")}</div>
          )}
        </div>
      </div>
    );
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
            <h1 style={S.h1}>{t("register.title")}</h1>
            <p style={S.sub}>{t("register.subtitle")}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.label}>
            {t("register.labels.email")}
            <input type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} style={S.input} placeholder={t("common.email_placeholder_business")} autoComplete="email"/>
          </label>
          <label style={S.label}>
            {t("register.labels.password")}
            <input type="password" required minLength={8} value={form.password} onChange={(e) => set("password", e.target.value)} style={S.input} autoComplete="new-password"/>
          </label>
          <label style={S.label}>
            {t("register.labels.company_name")}
            <input type="text" required value={form.company_name} onChange={(e) => set("company_name", e.target.value)} style={S.input}/>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={S.label}>
              {t("register.labels.country")}
              {/* [Krok 4] Nazwy krajów po ISO code → label. Lista jest krótka i
                  tłumaczenia per-locale są bardzo proste — trzymamy w JSX jako
                  ternary, bo wynoszenie do JSON wymuszałoby 12+ kluczy które
                  są de facto nazwami własnymi państw. */}
              <select value={form.country} onChange={(e) => set("country", e.target.value)} style={S.input}>
                {getSortedCountries().map(([code, label]) => (
                  <option key={code} value={code}>{FLAGS[code] ? `${FLAGS[code]} ` : ""}{label}</option>
                ))}
              </select>
            </label>
            <label style={S.label}>
              {t("register.labels.nip")}{NIP_REQUIRED ? " *" : ""}
              <input type="text" required={NIP_REQUIRED} value={form.nip} onChange={(e) => set("nip", e.target.value)} style={S.input}/>
            </label>
          </div>
          <label style={S.label}>
            {t("register.labels.contact_name")}
            <input type="text" value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} style={S.input}/>
          </label>
          <label style={S.label}>
            {t("register.labels.contact_phone")}
            <input type="tel" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} style={S.input}/>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#475569", lineHeight: 1.5, cursor: "pointer" }}>
            <input type="checkbox" checked={form.accept} onChange={(e) => set("accept", e.target.checked)} style={{ marginTop: 3 }}/>
            <span>
              {t("register.consent_accept_intro")}
              <a href={termsHref} target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600 }}>{t("register.consent_terms")}</a>
              {t("register.consent_and")}
              <a href={privacyHref} target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600 }}>{t("register.consent_privacy")}</a>
              .
              {" "}
              <Trans i18nKey="register.consent_process_understanding" ns="auth" components={{ strong: <strong /> }} />
              <br/><br/>
              <Trans i18nKey="register.consent_data_visibility" ns="auth" components={{ strong: <strong /> }} />
            </span>
          </label>

          {err && <div style={S.err}>{err}</div>}

          <button type="submit" disabled={busy} style={S.btn}>
            {busy ? t("register.submitting") : t("register.submit_button")}
          </button>
        </form>
        <div style={S.footer}>
          {t("register.already_have_account")} <Link to="/login" style={S.link}>{t("register.sign_in_link")}</Link>
        </div>
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)", padding: 20 },
  card: { background: "white", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 40, width: "100%", maxWidth: 480 },
  brand: { display: "flex", alignItems: "center", gap: 12, marginBottom: 24 },
  logo: { width: 48, height: 48, borderRadius: 12, background: "#0d9488", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 },
  h1: { margin: 0, fontSize: 22, color: "#0f172a" },
  sub: { margin: 0, fontSize: 13, color: "#64748b" },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, color: "#475569", fontWeight: 500 },
  input: { padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  btn: { padding: "12px 20px", background: "#0d9488", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 6 },
  err: { color: "#dc2626", fontSize: 13, padding: 8, background: "#fee2e2", borderRadius: 6 },
  ok: { color: "#059669", fontSize: 13, padding: "10px 12px", background: "#d1fae5", borderRadius: 8, lineHeight: 1.5 },
  footer: { marginTop: 20, textAlign: "center", color: "#64748b", fontSize: 13 },
  link: { color: "#0d9488", fontWeight: 600, textDecoration: "none" },
};
