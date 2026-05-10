/**
 * <EntityLogo>
 *
 * Mała kafla z logiem konkretnego bytu (firmy / sieci) lub fallbackiem
 * w postaci kolorowej ramki z inicjałami. Używany w nagłówkach paneli:
 *   - SupplierPanel: logo firmy supplera
 *   - BuyerPanel:    logo sieci kupca
 *
 * Props:
 *   logoUrl:  string|null   — URL z Supabase Storage (companies.logo_url
 *                             / retailers.logo_url)
 *   name:     string|null   — nazwa bytu, używana do generowania inicjałów
 *                             gdy brak loga
 *   bgColor:  string        — kolor tła ramki fallback (default teal)
 *   size:     number        — bok kafelka (default 32)
 *   alt:      string        — alt na <img>, default = name
 */
export default function EntityLogo({
  logoUrl,
  name,
  bgColor = "#0d9488",
  size = 32,
  alt,
}) {
  const initials = (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "•";

  const baseStyle = {
    width: size,
    height: size,
    borderRadius: 8,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  if (logoUrl) {
    return (
      <div
        style={{
          ...baseStyle,
          background: "white",
          border: "1px solid #e2e8f0",
        }}
      >
        <img
          src={logoUrl}
          alt={alt || name || ""}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: 2,
          }}
        />
      </div>
    );
  }

  // Fallback: kolorowa ramka z inicjałami (zachowuje wizualną wagę "FM" badge'a)
  return (
    <div
      style={{
        ...baseStyle,
        background: bgColor,
        color: "white",
        fontWeight: 700,
        fontSize: Math.max(11, Math.round(size * 0.4)),
        letterSpacing: "0.02em",
      }}
      aria-label={alt || name || "logo"}
    >
      {initials}
    </div>
  );
}
