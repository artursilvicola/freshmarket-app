import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
 */
export default function RegisterPage() {
  const { session } = useAuth();
  const navigate = useNavigate();

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
      if (!email) throw new Error("Email wymagany");
      if (role === "supplier" && !companyId && !createNewCompany) {
        throw new Error("Wybierz firme lub zaznacz 'Stworz nowa firme'");
      }
      if (role === "supplier" && createNewCompany && !newCompanyName) {
        throw new Error("Nazwa nowej firmy wymagana");
      }
      if (role === "buyer" && !retailerId) {
        throw new Error("Wybierz siec handlowa");
      }

      // Krok 1 (opcjonalny): stworz nowa firme
      let finalCompanyId = companyId || null;
      if (role === "supplier" && createNewCompany) {
        const { data: co, error: coErr } = await supabase
          .from("companies")
          .insert({ name: newCompanyName, country: newCompanyCountry })
          .select()
          .single();
        if (coErr) throw new Error("Nie udalo sie utworzyc firmy: " + coErr.message);
        finalCompanyId = co.id;
      }

      // Krok 2: wywolaj Netlify Function
      const token = session?.access_token;
      if (!token) throw new Error("Brak tokenu admina (zaloguj sie ponownie)");

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
      if (!res.ok) throw new Error(json.error || "Nieznany blad");

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
        <h1 style={S.h1}>Utworz konto B2B (admin)</h1>
        <p style={S.sub}>
          Konto powstaje natychmiast. Magic link pojawi sie ponizej — skopiuj go
          albo wyslij uzytkownikowi mailem. Twoja sesja admina pozostaje aktywna.
        </p>

        <div style={S.tabs}>
          {[
            ["supplier", "Dostawca"],
            ["buyer", "Kupiec"],
            ["admin", "Admin"],
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
            Imie i nazwisko (opcjonalnie)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={S.input}
            />
          </label>

          {role === "supplier" && !createNewCompany && (
            <label style={S.label}>
              Firma (istniejaca)
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                style={S.input}
              >
                <option value="">— wybierz —</option>
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
                Albo stworz nowa firme
              </button>
            </label>
          )}

          {role === "supplier" && createNewCompany && (
            <>
              <label style={S.label}>
                Nazwa nowej firmy
                <input
                  required
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  style={S.input}
                />
              </label>
              <label style={S.label}>
                Kraj
                <select
                  value={newCompanyCountry}
                  onChange={(e) => setNewCompanyCountry(e.target.value)}
                  style={S.input}
                >
                  <option value="PL">Polska</option>
                  <option value="ES">Hiszpania</option>
                  <option value="IT">Wlochy</option>
                  <option value="DE">Niemcy</option>
                  <option value="NL">Holandia</option>
                  <option value="FR">Francja</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setCreateNewCompany(false)}
                style={S.linkBtn}
              >
                Wybierz istniejaca firme
              </button>
            </>
          )}

          {role === "buyer" && (
            <label style={S.label}>
              Siec handlowa
              <select
                required
                value={retailerId}
                onChange={(e) => setRetailerId(e.target.value)}
                style={S.input}
              >
                <option value="">— wybierz —</option>
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
                Konto utworzone. Email: {result.email}
              </p>
              {result.magic_link ? (
                <p style={{ marginTop: 8, fontSize: 12, wordBreak: "break-all" }}>
                  Magic link (skopiuj i wyslij uzytkownikowi):
                  <br />
                  <code style={{ fontSize: 11 }}>{result.magic_link}</code>
                </p>
              ) : (
                <p style={{ marginTop: 8 }}>{result.warning || "Magic link nie wygenerowany."}</p>
              )}
            </div>
          )}

          <button type="submit" disabled={busy} style={S.btn}>
            {busy ? "..." : "Utworz konto"}
          </button>
        </form>

        <div style={S.footer}>
          <Link to="/admin" style={S.link}>← Powrot do panelu admina</Link>
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
