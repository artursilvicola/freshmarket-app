import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";
import { getCompanies, getRetailers } from "../lib/db";

/**
 * RegisterPage — admin-only ekran do tworzenia kont B2B.
 *
 * [B2B Round 2.1]
 * - NIE uzywa client supabase.auth.signUp (to przelaczyloby sesje admina).
 * - Wola Netlify Function /.netlify/functions/admin-create-user, ktora dziala
 *   z service_role i tworzy konto bez logowania.
 * - Po sukcesie pokazuje magic link admin moze go skopiowac/wyslac mailem.
 *
 * Flow:
 *   1. Admin wybiera role (supplier/buyer).
 *   2. Wskazuje istniejace company (dla supplier) lub retailer (dla buyer)
 *      z drop-downa - lub tworzy nowe inline.
 *   3. Klik "Utworz konto" -> POST do funkcji -> dostaje magic link.
 *
 * [B2B Round prod-rollout / i18n MVP — Krok 10 P1]
 * Bilingual przez useTranslation('auth') namespace, sekcja admin_register.
 * PL teksty zachowane 1:1 z oryginału (włącznie z brakiem polskich znaków
 * — admin był do tego przyzwyczajony, nie "porządkujemy" przy okazji).
 * EN czyste, terminologia v1.1.
 */
export default function RegisterPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation("auth");

  const [role, setRole] = useState("supplier");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [companies, setCompanies] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [retailerId, setRetailerId] = useState("");

  // tworzenie nowej firmy inline (gdy supplier i nie ma jej w drop-downie)
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyCountry, setNewCompanyCountry] = useState("PL");
  const [createNewCompany, setCreateNewCompany] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    getCompanies().then(setCompanies).catch(() => {});
    getRetailers().then(setRetailers).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);

    try {
      // Walidacja
      if (!email) throw new Error(t("admin_register.errors.email_required"));
      if (role === "supplier" && !companyId && !createNewCompany) {
        throw new Error(t("admin_register.errors.company_required"));
      }
      if (role === "supplier" && createNewCompany && !newCompanyName) {
        throw new Error(t("admin_register.errors.new_company_name_required"));
      }
      if (role === "buyer" && !retailerId) {
        throw new Error(t("admin_register.errors.retailer_required"));
      }

      // Krok 1 (opcjonalny): stworz nowa firme
      let finalCompanyId = companyId || null;
      if (role === "supplier" && createNewCompany) {
        const { data: co, error: coErr } = await supabase
          .from("companies")
          .insert({ name: newCompanyName, country: newCompanyCountry })
          .select()
          .single();
        if (coErr) throw new Error(t("admin_register.errors.create_company_failed", { message: coErr.message }));
        finalCompanyId = co.id;
      }

      // Krok 2: wywolaj Netlify Function
      const token = session?.access_token;
      if (!token) throw new Error(t("admin_register.errors.no_admin_token"));

      const res = await fetch("/.netlify/functions/admin-create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          role,
          name,
          company_id: role === "supplier" ? finalCompanyId : null,
          retailer_id: role === "buyer" ? Number(retailerId) : null,
          send_magic_link: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("admin_register.errors.unknown_error"));

      setResult(json);
      // Reset formularza
      setEmail("");
      setName("");
      setCompanyId("");
      setRetailerId("");
      setNewCompanyName("");
      setCreateNewCompany(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <h1 style={S.h1}>{t("admin_register.title")}</h1>
        <p style={S.sub}>{t("admin_register.subtitle")}</p>

        <div style={S.tabs}>
          {[
            ["supplier", t("admin_register.tabs.supplier")],
            ["buyer", t("admin_register.tabs.buyer")],
            ["admin", t("admin_register.tabs.admin")],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setRole(k)}
              style={{ ...S.tab, ...(role === k ? S.tabActive : {}) }}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.label}>
            {t("admin_register.labels.email")}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={S.input}
            />
          </label>

          <label style={S.label}>
            {t("admin_register.labels.name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={S.input}
            />
          </label>

          {role === "supplier" && !createNewCompany && (
            <label style={S.label}>
              {t("admin_register.labels.existing_company")}
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                style={S.input}
              >
                <option value="">{t("admin_register.select_placeholder")}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.country ? `(${c.country})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => { setCreateNewCompany(true); setCompanyId(""); }}
                style={S.linkBtn}
              >
                {t("admin_register.toggle_create_new_company")}
              </button>
            </label>
          )}

          {role === "supplier" && createNewCompany && (
            <>
              <label style={S.label}>
                {t("admin_register.labels.new_company_name")}
                <input
                  required
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  style={S.input}
                />
              </label>
              <label style={S.label}>
                {t("admin_register.labels.country")}
                <select
                  value={newCompanyCountry}
                  onChange={(e) => setNewCompanyCountry(e.target.value)}
                  style={S.input}
                >
                  <option value="PL">{t("admin_register.countries.PL")}</option>
                  <option value="ES">{t("admin_register.countries.ES")}</option>
                  <option value="IT">{t("admin_register.countries.IT")}</option>
                  <option value="DE">{t("admin_register.countries.DE")}</option>
                  <option value="NL">{t("admin_register.countries.NL")}</option>
                  <option value="FR">{t("admin_register.countries.FR")}</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setCreateNewCompany(false)}
                style={S.linkBtn}
              >
                {t("admin_register.toggle_pick_existing_company")}
              </button>
            </>
          )}

          {role === "buyer" && (
            <label style={S.label}>
              {t("admin_register.labels.retailer")}
              <select
                required
                value={retailerId}
                onChange={(e) => setRetailerId(e.target.value)}
                style={S.input}
              >
                <option value="">{t("admin_register.select_placeholder")}</option>
                {retailers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.country ? `(${r.country})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {err && <div style={S.err}>{err}</div>}
          {result && (
            <div style={S.ok}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {t("admin_register.success.account_created", { email: result.email })}
              </p>
              {result.magic_link ? (
                <p style={{ marginTop: 8, fontSize: 12, wordBreak: "break-all" }}>
                  {t("admin_register.success.magic_link_label")}
                  <br />
                  <code style={{ fontSize: 11 }}>{result.magic_link}</code>
                </p>
              ) : (
                <p style={{ marginTop: 8 }}>{result.warning || t("admin_register.success.magic_link_missing")}</p>
              )}
            </div>
          )}

          <button type="submit" disabled={busy} style={S.btn}>
            {busy ? t("admin_register.submit_busy") : t("admin_register.submit_button")}
          </button>
        </form>

        <div style={S.footer}>
          <Link to="/admin" style={S.link}>{t("admin_register.back_to_admin")}</Link>
        </div>
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)", padding: 20 },
  card: { background: "white", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 36, width: "100%", maxWidth: 520 },
  h1: { margin: 0, fontSize: 22, color: "#0f172a" },
  sub: { margin: "4px 0 18px", fontSize: 13, color: "#64748b" },
  tabs: { display: "flex", gap: 8, marginBottom: 18 },
  tab: { flex: 1, padding: "10px 12px", border: "1px solid #cbd5e1", background: "white", borderRadius: 8, cursor: "pointer", fontSize: 14, color: "#475569" },
  tabActive: { background: "#0d9488", color: "white", borderColor: "#0d9488", fontWeight: 600 },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#475569", fontWeight: 500 },
  input: { padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none" },
  btn: { padding: "12px 20px", background: "#0d9488", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 6 },
  linkBtn: { background: "none", border: "none", color: "#0d9488", textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, alignSelf: "flex-start", marginTop: 4 },
  err: { color: "#dc2626", fontSize: 13, padding: 8, background: "#fee2e2", borderRadius: 6 },
  ok: { color: "#059669", fontSize: 13, padding: 12, background: "#d1fae5", borderRadius: 6 },
  footer: { marginTop: 20, textAlign: "center", color: "#64748b", fontSize: 13 },
  link: { color: "#0d9488", fontWeight: 600, textDecoration: "none" },
};
