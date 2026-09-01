import { useTranslation, Trans } from "react-i18next";
import { normalizeLocale } from "../i18n/locale";

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
 *   PL: public/regulamin.html, public/polityka-prywatnosci.html
 *   EN: public/regulations.html, public/privacy-policy.html
 * (Pretty URL bez .html — rewrite w netlify.toml)
 *
 * [B2B Round prod-rollout / i18n MVP — Krok 5]
 * Stopka jest bilingual — labelki + URL-e zależne od aktualnego locale
 * (z react-i18next). Email kontaktowy zostaje literalnym tekstem
 * "support@freshmarket.eu" (nazwa własna; nie wymaga tłumaczenia).
 * Klucze: common.footer.{terms,privacy,copyright}.
 */
export default function LegalFooter() {
  // Namespace "common" zawiera footer.* klucze dodane w Kroku 1.
  const { t, i18n } = useTranslation("common");
  const locale = normalizeLocale(i18n.language);

  // URL-e legal zależne od języka — anglojęzyczny user idzie do EN draftów
  // (public/regulations.html + public/privacy-policy.html z banerem
  // subject to legal review), PL user do oficjalnych dokumentów.
  const termsHref = locale === "en" ? "/regulations" : "/regulamin";
  const privacyHref = locale === "en" ? "/privacy-policy" : "/polityka-prywatnosci";

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
        {/* Copyright zachowuje <strong> na "Fresh Market" (color #0f172a)
            — Trans z components, klucz w common.json używa <bold>…</bold>. */}
        <Trans
          i18nKey="footer.copyright"
          ns="common"
          values={{ year: new Date().getFullYear() }}
          components={{ bold: <strong style={{ color: "#0f172a" }} /> }}
        />
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <a
          href={termsHref}
          target="_blank"
          rel="noopener"
          style={{ color: "#0d9488", textDecoration: "none", fontWeight: 600 }}
        >
          {t("footer.terms")}
        </a>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <a
          href={privacyHref}
          target="_blank"
          rel="noopener"
          style={{ color: "#0d9488", textDecoration: "none", fontWeight: 600 }}
        >
          {t("footer.privacy")}
        </a>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <a
          href="mailto:support@freshmarket.eu"
          style={{ color: "#0d9488", textDecoration: "none", fontWeight: 600 }}
        >
          support@freshmarket.eu
        </a>
      </div>
    </footer>
  );
}
