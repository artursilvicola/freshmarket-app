import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUiContent } from "../lib/db";

/**
 * <PartnersStrip>
 *
 * Pasek logotypow partnerow/sponsorow Fresh Market — [feat/footer-partners].
 *
 * Renderowany nad <LegalFooter/> w kazdym panelu (Buyer / Supplier / Admin),
 * wiec kupiec i dostawca widza sponsorow na kazdym ekranie aplikacji.
 *
 * Zrodlo danych: fm_settings.ui_content.partners (JSONB, migracja 045 — ta sama
 * kolumna co instrukcje i komunikaty, wiec funkcja NIE wymaga nowej migracji).
 * Edycja: panel admina → Branding → "Partnerzy". Logo laduje w buckecie
 * "brand-assets" (publiczny odczyt).
 *
 * Komponent sam pobiera tresc (jeden lekki SELECT przy montowaniu panelu) —
 * dzieki temu jest niezalezny od stanu legacy-shella i dziala tak samo we
 * wszystkich trzech panelach.
 *
 * Gdy lista jest pusta albo wszyscy partnerzy sa wylaczeni — nie renderuje nic
 * (zero pustego paska w stopce, zanim admin cokolwiek doda).
 */
export default function PartnersStrip() {
  const { t } = useTranslation("common");
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ui = await getUiContent();
        if (!cancelled) setPartners((ui?.partners || []).filter(p => p.enabled !== false));
      } catch (e) {
        // Stopka jest dekoracyjna — blad odczytu nie moze wywrocic panelu.
        console.warn("[PartnersStrip]", e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!partners.length) return null;

  return (
    <div
      style={{
        marginTop: "auto",
        padding: "14px 24px 12px",
        borderTop: "1px solid #e2e8f0",
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        gap: 22,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#94a3b8",
          whiteSpace: "nowrap",
        }}
      >
        {t("partners.title")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
        {partners.map(p => {
          const img = (
            <img
              src={p.logoUrl}
              alt={p.name || t("partners.title")}
              title={p.name || undefined}
              style={{ height: 30, width: "auto", maxWidth: 190, objectFit: "contain", display: "block" }}
            />
          );
          // Link tylko gdy admin poda adres — bez URL logo zostaje statyczne.
          return p.url ? (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "block", lineHeight: 0 }}
            >
              {img}
            </a>
          ) : (
            <div key={p.id} style={{ lineHeight: 0 }}>{img}</div>
          );
        })}
      </div>
    </div>
  );
}
