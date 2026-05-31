// [Admin Companies 2.0 / Branch 2 — Commit 1]
// Reusable right-side drawer dla admin paneli.
//
// Wymagania (per docs/admin/ADMIN_COMPANIES_2_0_PLAN.md §3 + ADMIN_PIPELINE_2_0_PLAN.md §4.1):
//   - całkowicie framework-agnostic: nie wie nic o firmach / propozycjach / sieciach,
//   - przyjmuje generic propsy + `children` jako content active subtabu,
//   - exportable, gotowy do reuse w Companies B2 (firma) i Pipeline B2 (propozycja),
//   - bez importów z `src/legacy/PreconnectFM.jsx`,
//   - tylko React + ikonka X z lucide-react.
//
// Behavior:
//   - klik backdrop → close,
//   - ESC → close,
//   - Prev/Next nav w headerze (gdy callbacki przekazane),
//   - tab bar (z opcjonalnym badge i disabled),
//   - content area scroll-owalny,
//   - footer sticky (gdy `footer` przekazany).
//
// Stylistyka inline (zgodnie z resztą projektu — bez nowych dependency CSS).
// Layering Z-index: backdrop=1000, drawer=1001 (nad FloatingChat, pod toastami które
// w tym projekcie używają wyższych poziomów).

import { useEffect } from "react";
import { X } from "lucide-react";

export function AdminRightDrawer({
  open,
  onClose,
  width = 520,
  header = null,
  footer = null,
  tabs = [],
  activeTab = null,
  onTabChange,
  children,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  closeAriaLabel = "Close",
  prevAriaLabel = "Previous",
  nextAriaLabel = "Next",
  // Optional escape hatch dla guarded close (np. confirm gdy dirty notes).
  // Jeśli zwraca false → close jest anulowany. Default: zawsze close.
  beforeClose,
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") {
        handleClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    if (typeof beforeClose === "function") {
      const allow = beforeClose();
      if (allow === false) return;
    }
    onClose?.();
  }

  if (!open) return null;

  const showNav = typeof onPrev === "function" || typeof onNext === "function";
  const showTabs = Array.isArray(tabs) && tabs.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.45)",
          zIndex: 1000,
        }}
      />
      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: `${width}px`,
          maxWidth: "100vw",
          background: "white",
          boxShadow: "-2px 0 24px rgba(15,23,42,0.18)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          fontFamily: "inherit",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div
          style={{
            flexShrink: 0,
            padding: "12px 14px",
            borderBottom: "1px solid #e2e8f0",
            background: "white",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {showNav && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => onPrev?.()}
                disabled={prevDisabled || !onPrev}
                aria-label={prevAriaLabel}
                style={navBtnStyle(prevDisabled || !onPrev)}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => onNext?.()}
                disabled={nextDisabled || !onNext}
                aria-label={nextAriaLabel}
                style={navBtnStyle(nextDisabled || !onNext)}
              >
                ›
              </button>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>{header}</div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={closeAriaLabel}
            style={{
              background: "transparent",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: "5px 8px",
              cursor: "pointer",
              color: "#64748b",
              fontFamily: "inherit",
              lineHeight: 0,
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Tab bar */}
        {showTabs && (
          <div
            role="tablist"
            style={{
              flexShrink: 0,
              display: "flex",
              gap: 2,
              padding: "6px 12px 0",
              background: "white",
              borderBottom: "1px solid #e2e8f0",
              overflowX: "auto",
            }}
          >
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab;
              const isDisabled = !!tab.disabled;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={isDisabled}
                  title={tab.tooltip || undefined}
                  onClick={() => {
                    if (isDisabled) return;
                    onTabChange?.(tab.key);
                  }}
                  style={{
                    padding: "8px 12px 10px",
                    background: "transparent",
                    border: "none",
                    borderBottom: isActive
                      ? "2px solid #0d9488"
                      : "2px solid transparent",
                    color: isDisabled
                      ? "#cbd5e1"
                      : isActive
                      ? "#0d9488"
                      : "#64748b",
                    fontWeight: isActive ? 700 : 500,
                    fontSize: 13,
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    marginBottom: -1,
                    whiteSpace: "nowrap",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {tab.label}
                  {tab.badge != null && tab.badge !== "" && (
                    <span
                      style={{
                        background: isActive ? "#0d9488" : "#e2e8f0",
                        color: isActive ? "white" : "#64748b",
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 9,
                      }}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Content area (scrollable) */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            background: "#f8fafc",
          }}
        >
          {children}
        </div>

        {/* Footer sticky (optional) */}
        {footer && (
          <div
            style={{
              flexShrink: 0,
              padding: "10px 14px",
              borderTop: "1px solid #e2e8f0",
              background: "white",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

function navBtnStyle(disabled) {
  return {
    background: "transparent",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "4px 9px",
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? "#cbd5e1" : "#64748b",
    fontSize: 14,
    fontFamily: "inherit",
    lineHeight: 1,
  };
}

export default AdminRightDrawer;
