/**
 * <LegalFooter>
 *
 * Globalna stopka z linkami do Regulaminu i Polityki Prywatności (RODO).
 * [B2B Round prod-rollout / legal-footer]
 *
 * Wstawiana na dole każdego panelu (Admin / Supplier / Buyer) — wymóg
 * dobrej praktyki dla aplikacji B2B przetwarzających dane osobowe.
 * Linki otwierają się w nowej karcie żeby nie wyrzucać użytkownika
 * z aplikacji w trakcie pracy.
 *
 * Pliki źródłowe:
 *   public/regulamin.html
 *   public/polityka-prywatnosci.html
 * (Pretty URL bez .html — rewrite w netlify.toml)
 */
export default function LegalFooter() {
  return (
    <footer
      style={{
        marginTop: "auto",
        padding: "14px 24px",
        borderTop: "1px solid #e2e8f0",
        background: "#f8fafc",
        fontSize: 11.5,
        color: "#64748b",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        © {new Date().getFullYear()} <strong style={{ color: "#0f172a" }}>Fresh Market</strong> · KJOW Sp. z o.o.
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <a
          href="/regulamin"
          target="_blank"
          rel="noopener"
          style={{ color: "#0d9488", textDecoration: "none", fontWeight: 600 }}
        >
          Regulamin
        </a>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <a
          href="/polityka-prywatnosci"
          target="_blank"
          rel="noopener"
          style={{ color: "#0d9488", textDecoration: "none", fontWeight: 600 }}
        >
          Polityka Prywatności
        </a>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <a
          href="mailto:hello@freshmarket.eu"
          style={{ color: "#0d9488", textDecoration: "none", fontWeight: 600 }}
        >
          hello@freshmarket.eu
        </a>
      </div>
    </footer>
  );
}
