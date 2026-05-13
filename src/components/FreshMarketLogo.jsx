import { useEffect, useState } from "react";
import { getBrandSettings } from "../lib/db";

/**
 * <FreshMarketLogo>
 *
 * Brand logo Fresh Market. Renderuje:
 *   1. img z fm_settings.brand_logo_url (uploaded by admin) jeśli dostępne
 *   2. fallback: inline SVG jabłka + wordmark "Fresh Market"
 *
 * Cache: brand URL pobierany przez `getBrandSettings()` (public read na
 * fm_settings) raz per montaż komponentu. Po uploadzie nowego loga, useState
 * w admin panelu może wymusić remount przez key prop.
 *
 * Props:
 *   variant: "light" | "dark"  — kolor tekstu w fallback SVG
 *   size:    number             — wysokość ikony / loga w px
 *   showText: boolean           — domyślnie true; false = sama ikona/logo bez wordmarka
 *   brandUrl: string | null     — opcjonalny override (gdy parent już ma URL, np. po uploadzie)
 */
export default function FreshMarketLogo({ variant = "light", size = 22, showText = true, brandUrl: brandUrlProp }) {
  const [brandUrl, setBrandUrl] = useState(brandUrlProp || null);
  const [resolved, setResolved] = useState(!!brandUrlProp);

  useEffect(() => {
    if (brandUrlProp !== undefined) {
      setBrandUrl(brandUrlProp || null);
      setResolved(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { brandLogoUrl } = await getBrandSettings();
        if (!cancelled) setBrandUrl(brandLogoUrl || null);
      } catch (e) {
        // ignore — fallback SVG
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, [brandUrlProp]);

  const isLight = variant === "light";
  const textColor = isLight ? "#ffffff" : "#0f172a";
  const fontSize = Math.round(size * 0.72);

  // Realne logo z storage — gdy admin wgrał plik
  if (brandUrl) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <img
          src={brandUrl}
          alt="Fresh Market"
          style={{ height: size, width: "auto", display: "block", flexShrink: 0, objectFit: "contain" }}
          onError={(e) => { e.currentTarget.style.display = "none"; setBrandUrl(null); }}
        />
        {showText && !brandUrl.toLowerCase().includes("wordmark") && (
          <span
            style={{
              color: textColor,
              fontWeight: 700,
              fontSize,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            Fresh Market
          </span>
        )}
      </div>
    );
  }

  // Fallback: SVG zielonego jabłka + wordmark
  // Renderujemy też w trakcie ładowania (resolved=false) — żeby nie było pustego placeholder'a.
  const appleColor = "#16a34a";
  const leafColor = "#65a30d";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        style={{ flexShrink: 0, display: "block" }}
        aria-hidden="true"
      >
        <path
          d="M22.5 11.8c-1.5-1-3.3-1.4-4.8-0.6-0.5 0.3-1 0.7-1.5 1.1-0.5-0.4-1-0.8-1.5-1.1-1.5-0.8-3.3-0.4-4.8 0.6-2.5 1.7-3.5 5.2-2.2 8.6 1.3 3.4 4.4 6.6 6.7 6.6 0.7 0 1.3-0.2 1.8-0.5 0.5 0.3 1.1 0.5 1.8 0.5 2.3 0 5.4-3.2 6.7-6.6 1.3-3.4 0.3-6.9-2.2-8.6z"
          fill={appleColor}
        />
        <path
          d="M16.5 9.5c-0.3-2.4 1.4-4.6 3.8-5.1 0.4 2.4-1.3 4.7-3.8 5.1z"
          fill={leafColor}
        />
        <ellipse cx="13" cy="15.5" rx="1.5" ry="2.2" fill="rgba(255,255,255,0.35)" />
      </svg>
      {showText && (
        <span
          style={{
            color: textColor,
            fontWeight: 700,
            fontSize,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          Fresh Market
        </span>
      )}
    </div>
  );
}
