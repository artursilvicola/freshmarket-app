// [feat/fm-decision-source] Oznaczenie „ⓘ Wybrane przez administratora” przy konkretnym
// wyborze sieci (panel dostawcy) albo konkretnej decyzji (panel kupca). Renderuje się
// TYLKO, gdy źródło = admin. Zwykły użytkownik widzi sam komunikat (bez nazwiska
// administratora); administrator dodatkowo autora i czas. Tekst PL/EN z i18n (legacy).
import { useTranslation } from "react-i18next";
import { isAdminSet, formatSourceMeta } from "../../lib/fm-decision-sources.js";

export default function DecisionSourceBadge({ source, viewerIsAdmin = false, variant = null, style }) {
  const { t, i18n } = useTranslation("legacy");
  if (!isAdminSet(source)) return null;
  // variant "target" / "resp": etykieta z nazwą strony (widok administratora, obie pary obok siebie)
  const label = variant ? t(`fm.decision_source.admin_badge_${variant}`, { defaultValue: t("fm.decision_source.admin_badge") }) : t("fm.decision_source.admin_badge");
  const tooltip = t("fm.decision_source.admin_tooltip");
  const meta = viewerIsAdmin ? formatSourceMeta(source, { locale: i18n?.language, unknownAuthor: t("fm.decision_source.unknown_author") }) : null;
  return (
    <span data-testid="decision-source-admin" role="note" title={tooltip} style={{ display: "inline-flex", flexDirection: "column", gap: 1, ...style }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "1px 7px", whiteSpace: "nowrap" }}>
        <span aria-hidden="true">ⓘ </span>{label}
      </span>
      {meta && (
        <span data-testid="decision-source-meta" style={{ fontSize: 10, color: "#64748b" }}>
          {t("fm.decision_source.admin_meta", { who: meta.who, when: meta.when })}
        </span>
      )}
    </span>
  );
}
