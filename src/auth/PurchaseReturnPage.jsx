import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { useAuth } from "./AuthProvider";
import { getPayuOrderByExt } from "../lib/db";
import FreshMarketLogo from "../components/FreshMarketLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";

/**
 * PurchaseReturnPage — landing po powrocie z PayU.
 * [B2B Round prod-rollout / faza 3]
 *
 * URL: /zakup-ok?ext={ext_order_id}
 *
 * Polling: webhook od PayU może dotrzeć kilka sekund po tym jak user
 * fizycznie wróci na tę stronę. Pollujemy payu_orders co 1.5s przez maks
 * 30 sekund. Po 30s, jeśli wciąż 'pending' — wyświetlamy info "Płatność
 * w toku, sprawdź panel za chwilę" (nie blokujemy — user może zamknąć).
 */
export default function PurchaseReturnPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ext = params.get("ext");
  const { user, role, loading: authLoading } = useAuth();
  // [B2B Round prod-rollout / i18n MVP — Krok 4]
  const { t } = useTranslation("auth");
  const [state, setState] = useState({ status: "loading", order: null, err: null });
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return () => { stopRef.current = true; };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login", { replace: true, state: { from: { pathname: `/zakup-ok?ext=${ext}` } } });
      return;
    }
    if (!ext) {
      setState({ status: "error", order: null, err: t("purchase_return.error_missing_ext") });
      return;
    }

    const POLL_MS = 1500;
    const MAX_MS = 30000;
    const start = Date.now();

    async function tick() {
      if (stopRef.current) return;
      try {
        const order = await getPayuOrderByExt(ext);
        if (stopRef.current) return;
        if (!order) {
          setState({ status: "error", order: null, err: t("purchase_return.error_order_not_found") });
          return;
        }
        if (order.status !== "pending" && order.status !== "created") {
          setState({ status: "settled", order, err: null });
          return;
        }
        // Pending — polluj dalej, do MAX_MS.
        if (Date.now() - start > MAX_MS) {
          setState({ status: "timeout", order, err: null });
          return;
        }
        setTimeout(tick, POLL_MS);
      } catch (e) {
        if (stopRef.current) return;
        setState({ status: "error", order: null, err: e?.message || t("purchase_return.error_status_fetch") });
      }
    }
    tick();
    // [Krok 4] t jest stabilną referencją per-render i18next, więc include
    // w dep array zgodnie z react-hooks/exhaustive-deps.
  }, [ext, user, authLoading, navigate, t]);

  // ── Renderery ───────────────────────────────────────────────────────
  const homeLink = role === "admin" ? "/admin" : role === "buyer" ? "/kupiec" : "/dostawca";

  if (state.status === "loading" || authLoading) {
    return (
      <Layout title={t("purchase_return.loading_title")} sub={t("purchase_return.loading_subtitle")}>
        <div style={S.spinner}>⏳</div>
        <p style={S.muted}>{t("purchase_return.loading_hint")}</p>
      </Layout>
    );
  }

  if (state.status === "error") {
    return (
      <Layout title={t("purchase_return.error_title")} sub={t("purchase_return.error_subtitle")}>
        <div style={S.errBox}>{state.err}</div>
        <Link to={homeLink} style={S.btn}>{t("purchase_return.back_to_panel")}</Link>
      </Layout>
    );
  }

  if (state.status === "timeout") {
    return (
      <Layout title={t("purchase_return.timeout_title")} sub={t("purchase_return.timeout_subtitle")}>
        <p style={S.muted}>{t("purchase_return.timeout_hint")}</p>
        <Link to={homeLink} style={S.btn}>{t("purchase_return.back_to_panel")}</Link>
      </Layout>
    );
  }

  // settled — sprawdzamy konkretny status
  const order = state.order;
  if (order.status === "completed") {
    return (
      <Layout title={t("purchase_return.completed_title")} sub={t("purchase_return.completed_subtitle")}>
        <p style={S.success}>
          {/* [Krok 4] Trans bo wewnątrz <strong>{{plan}}</strong> mieszane HTML+interpolacja */}
          <Trans
            i18nKey="purchase_return.completed_message"
            ns="auth"
            values={{ plan: order.plan_id }}
            components={{ strong: <strong /> }}
          />
        </p>
        <p style={S.muted}>
          {t("purchase_return.completed_amount", {
            amount: Number(order.price_eur).toFixed(2),
            currency: order.currency,
          })}
        </p>
        <Link to={homeLink} style={S.btn}>{t("purchase_return.go_to_panel")}</Link>
      </Layout>
    );
  }

  if (order.status === "canceled") {
    return (
      <Layout title={t("purchase_return.canceled_title")} sub={t("purchase_return.canceled_subtitle")}>
        <p style={S.muted}>{t("purchase_return.canceled_message")}</p>
        <Link to={homeLink} style={S.btn}>{t("purchase_return.back_to_panel")}</Link>
      </Layout>
    );
  }

  if (order.status === "rejected" || order.status === "failed") {
    return (
      <Layout title={t("purchase_return.rejected_title")} sub={t("purchase_return.rejected_subtitle")}>
        <p style={S.muted}>
          {order.failure_reason
            ? t("purchase_return.rejected_reason", { reason: order.failure_reason })
            : t("purchase_return.rejected_default")}
        </p>
        <Link to={homeLink} style={S.btn}>{t("purchase_return.back_to_panel")}</Link>
      </Layout>
    );
  }

  // Fallback
  return (
    <Layout title={t("purchase_return.status_fallback", { status: order.status })} sub="">
      <Link to={homeLink} style={S.btn}>{t("purchase_return.back_to_panel")}</Link>
    </Layout>
  );
}

function Layout({ title, sub, children }) {
  return (
    <div style={S.wrap}>
      <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
        <LanguageSwitcher variant="auth" />
      </div>
      <div style={S.card}>
        {/* [B2B Round prod-rollout / branding] Brand logo zamiast placeholdera FM */}
        <div style={S.brand}>
          <FreshMarketLogo variant="dark" size={44} showText={false} />
          <div>
            <h1 style={S.h1}>{title}</h1>
            {sub && <p style={S.subText}>{sub}</p>}
          </div>
        </div>
        <div style={{ marginTop: 20 }}>{children}</div>
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)", padding: 20 },
  card: { background: "white", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 36, width: "100%", maxWidth: 520 },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  logo: { width: 48, height: 48, borderRadius: 12, background: "#0d9488", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 },
  h1: { margin: 0, fontSize: 22, color: "#0f172a" },
  subText: { margin: 0, fontSize: 13, color: "#64748b" },
  spinner: { fontSize: 32, textAlign: "center", padding: 10 },
  muted: { color: "#64748b", fontSize: 14, lineHeight: 1.6 },
  success: { color: "#065f46", background: "#d1fae5", padding: "12px 14px", borderRadius: 8, fontSize: 14, lineHeight: 1.5 },
  errBox: { color: "#991b1b", background: "#fee2e2", padding: "12px 14px", borderRadius: 8, fontSize: 13, marginBottom: 14 },
  btn: { display: "inline-block", marginTop: 16, padding: "11px 18px", background: "#0d9488", color: "white", textDecoration: "none", borderRadius: 8, fontSize: 14, fontWeight: 600 },
};
