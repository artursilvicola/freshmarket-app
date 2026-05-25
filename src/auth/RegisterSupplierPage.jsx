import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { selfRegisterSupplier } from "../lib/db";
import { supabase } from "../lib/supabase";
import FreshMarketLogo from "../components/FreshMarketLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";
import i18n from "../i18n";
import { normalizeLocale } from "../i18n/locale";
import { TERMS_VERSION, PRIVACY_VERSION } from "../lib/legal-versions";

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (!form.accept) throw new Error("Zaakceptuj informację o procesie zatwierdzenia konta.");
      if (form.password.length < 8) throw new Error("Hasło musi mieć minimum 8 znaków.");

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
        locale: normalizeLocale(i18n.language),
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
      setErr(e.message || "Błąd rejestracji.");
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
              <h1 style={S.h1}>Rejestracja przyjęta</h1>
              <p style={S.sub}>Czekamy na decyzję administratora</p>
            </div>
          </div>
          <div style={S.ok}>
            ✓ Konto zostało utworzone. Wysłaliśmy potwierdzenie na <strong>{form.email}</strong>.
            Konto firmy <strong>{form.company_name}</strong> czeka na zatwierdzenie przez administratora.
          </div>
          <p style={{ fontSize: 13, color: "#475569", marginTop: 16, lineHeight: 1.6 }}>
            W tym czasie możesz zalogować się i uzupełnić profil firmy: dodać logo, opis,
            certyfikaty. PreConnect (wysyłka ofert do sieci) i Spotkania B2B będą dostępne
            po aktywacji.
          </p>
          {!done.autoLogin && (
            <Link to="/login" style={{ ...S.btn, display: "inline-block", textAlign: "center", marginTop: 16, textDecoration: "none" }}>
              Przejdź do logowania
            </Link>
          )}
          {done.autoLogin && (
            <div style={{ marginTop: 16, fontSize: 13, color: "#64748b" }}>Logowanie…</div>
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
            <h1 style={S.h1}>Rejestracja dostawcy</h1>
            <p style={S.sub}>Fresh Market PreConnect</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.label}>
            Email służbowy *
            <input type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} style={S.input} placeholder="kontakt@firma.pl" autoComplete="email"/>
          </label>
          <label style={S.label}>
            Hasło (min. 8 znaków) *
            <input type="password" required minLength={8} value={form.password} onChange={(e) => set("password", e.target.value)} style={S.input} autoComplete="new-password"/>
          </label>
          <label style={S.label}>
            Nazwa firmy *
            <input type="text" required value={form.company_name} onChange={(e) => set("company_name", e.target.value)} style={S.input}/>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={S.label}>
              Kraj
              <select value={form.country} onChange={(e) => set("country", e.target.value)} style={S.input}>
                <option value="PL">Polska</option>
                <option value="DE">Niemcy</option>
                <option value="CZ">Czechy</option>
                <option value="SK">Słowacja</option>
                <option value="HU">Węgry</option>
                <option value="LT">Litwa</option>
                <option value="UA">Ukraina</option>
                <option value="ES">Hiszpania</option>
                <option value="IT">Włochy</option>
                <option value="NL">Holandia</option>
                <option value="FR">Francja</option>
                <option value="RO">Rumunia</option>
              </select>
            </label>
            <label style={S.label}>
              NIP / VAT
              <input type="text" value={form.nip} onChange={(e) => set("nip", e.target.value)} style={S.input}/>
            </label>
          </div>
          <label style={S.label}>
            Imię i nazwisko (osoba kontaktowa)
            <input type="text" value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} style={S.input}/>
          </label>
          <label style={S.label}>
            Telefon kontaktowy
            <input type="tel" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} style={S.input}/>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#475569", lineHeight: 1.5, cursor: "pointer" }}>
            <input type="checkbox" checked={form.accept} onChange={(e) => set("accept", e.target.checked)} style={{ marginTop: 3 }}/>
            <span>
              Akceptuję{" "}
              <a href="/regulamin" target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600 }}>Regulamin</a>
              {" "}oraz{" "}
              <a href="/polityka-prywatnosci" target="_blank" rel="noopener" style={{ color: "#0d9488", fontWeight: 600 }}>Politykę Prywatności</a>.
              Rozumiem, że konto trafia do <strong>weryfikacji administratora</strong>.
              Do czasu zatwierdzenia mogę zalogować się i uzupełnić profil, ale nie wysyłam ofert
              do sieci ani nie biorę udziału w Spotkaniach B2B.
              <br/><br/>
              Moje dane będą widoczne dla <strong>kupców z sieci handlowych i dystrybutorów</strong> wyłącznie
              w zakresie, w jakim sam wyślę im propozycję, wybiorę ich w ramach Spotkań B2B
              albo zostanę z nimi dopasowany w ramach zaakceptowanej procedury FM B2B.
              Operator <strong>nie udostępnia danych innym odbiorcom w celach marketingowych</strong>;
              dane mogą być przetwarzane przez <strong>dostawców technicznych działających na zlecenie
              Operatora</strong> (lista w Polityce Prywatności).
            </span>
          </label>

          {err && <div style={S.err}>{err}</div>}

          <button type="submit" disabled={busy} style={S.btn}>
            {busy ? "Rejestrowanie…" : "Załóż konto dostawcy"}
          </button>
        </form>
        <div style={S.footer}>
          Masz już konto? <Link to="/login" style={S.link}>Zaloguj się</Link>
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
