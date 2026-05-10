/**
 * <FreshMarketLogo>
 *
 * Inline SVG logo Fresh Market — apple-with-leaf icon + wordmark.
 * Używany w:
 *   - sidebarze PreconnectFM (variant="light" — białe litery na ciemnym tle)
 *   - nagłówku panelu admina (variant="dark" — ciemne litery na białym tle)
 *
 * Inline (zamiast pliku w /public) bo:
 *   - vite.config nie ma publicDir, a B2B app nie ma własnego /public,
 *   - SVG i tak idzie do bundla, więc inline = jeden mniej request,
 *   - łatwiej dopasować kolory do `variant` bez generowania 2 plików.
 *
 * Props:
 *   variant: "light" | "dark"  — kolor tekstu i ikony
 *   size:    number             — wysokość ikony w px (tekst skaluje się proporcjonalnie)
 *   showText: boolean           — domyślnie true; false = tylko ikona (np. compact header)
 */
export default function FreshMarketLogo({ variant = "light", size = 22, showText = true }) {
  const isLight = variant === "light";
  const textColor = isLight ? "#ffffff" : "#0f172a";
  // Apple body: zielony (świeże owoce/warzywa), liść jaśniejszy zielony
  const appleColor = "#16a34a";
  const leafColor = "#65a30d";
  const fontSize = Math.round(size * 0.72);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        style={{ flexShrink: 0, display: "block" }}
        aria-hidden="true"
      >
        {/* Apple body — dwa zaokrąglone owale, lekko nachodzące */}
        <path
          d="M22.5 11.8c-1.5-1-3.3-1.4-4.8-0.6-0.5 0.3-1 0.7-1.5 1.1-0.5-0.4-1-0.8-1.5-1.1-1.5-0.8-3.3-0.4-4.8 0.6-2.5 1.7-3.5 5.2-2.2 8.6 1.3 3.4 4.4 6.6 6.7 6.6 0.7 0 1.3-0.2 1.8-0.5 0.5 0.3 1.1 0.5 1.8 0.5 2.3 0 5.4-3.2 6.7-6.6 1.3-3.4 0.3-6.9-2.2-8.6z"
          fill={appleColor}
        />
        {/* Liść u góry */}
        <path
          d="M16.5 9.5c-0.3-2.4 1.4-4.6 3.8-5.1 0.4 2.4-1.3 4.7-3.8 5.1z"
          fill={leafColor}
        />
        {/* Mały błysk (highlight) na jabłku — biały, ledwo widoczny */}
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
