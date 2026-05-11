import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { getPayuOrderByExt } from "../lib/db";

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
      setState({ status: "error", order: null, err: "Brak parametru ext w URL." });
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
          setState({ status: "error", order: null, err: "Zamówienie nie znalezione." });
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
        setState({ status: "error", order: null, err: e?.message || "Błąd pobierania statusu." });
      }
    }
    tick();
  }, [ext, user, authLoading, navigate]);

  // ── Renderery ───────────────────────────────────────────────────────
  const homeLink = role === "admin" ? "/admin" : role === "buyer" ? "/kupiec" : "/dostawca";

  if (state.status === "loading" || authLoading) {
    return (
      <Layout title="Sprawdzamy płatność…" sub="Łączymy się z PayU.">
        <div style={S.spinner}>⏳</div>
        <p style={S.muted}>To może chwilę potrwać.</p>
      </Layout>
    );
  }

  if (state.status === "error") {
    return (
      <Layout title="Wystąpił błąd" sub="Nie udało się sprawdzić statusu płatności.">
        <div style={S.errBox}>{state.err}</div>
        <Link to={homeLink} style={S.btn}>Wróć do panelu</Link>
      </Layout>
    );
  }

  if (state.status === "timeout") {
    return (
      <Layout title="Płatność w toku" sub="PayU jeszcze nie potwierdził transakcji.">
        <p style={S.muted}>
          To czasem trwa kilka minut (zwłaszcza przelewy bankowe). Sprawdź panel za chwilę —
          pakiet zostanie aktywowany automatycznie po potwierdzeniu od PayU.
        </p>
        <Link to={homeLink} style={S.btn}>Wróć do panelu</Link>
      </Layout>
    );
  }

  // settled — sprawdzamy konkretny status
  const order = state.order;
  if (order.status === "completed") {
    return (
      <Layout title="Pakiet aktywny ✓" sub="Płatność zaksięgowana.">
        <p style={S.success}>
          Twój pakiet <strong>{order.plan_id}</strong> został aktywowany. Wysyłki dostępne od zaraz.
        </p>
        <p style={S.muted}>Kwota: {Number(order.price_eur).toFixed(2)} {order.currency}</p>
        <Link to={homeLink} style={S.btn}>Przejdź do panelu</Link>
      </Layout>
    );
  }

  if (order.status === "canceled") {
    return (
      <Layout title="Płatność anulowana" sub="Nie pobrano środków.">
        <p style={S.muted}>Zamówienie zostało anulowane przed potwierdzeniem płatności.</p>
        <Link to={homeLink} style={S.btn}>Wróć do panelu</Link>
      </Layout>
    );
  }

  if (order.status === "rejected" || order.status === "failed") {
    return (
      <Layout title="Płatność odrzucona" sub="Transakcja nie została zrealizowana.">
        <p style={S.muted}>
          {order.failure_reason
            ? `Powód: ${order.failure_reason}`
            : "Bank lub PayU odrzucił płatność. Spróbuj ponownie lub wybierz inną metodę."}
        </p>
        <Link to={homeLink} style={S.btn}>Wróć do panelu</Link>
      </Layout>
    );
  }

  // Fallback
  return (
    <Layout title={`Status: ${order.status}`} sub="">
      <Link to={homeLink} style={S.btn}>Wróć do panelu</Link>
    </Layout>
  );
}

function Layout({ title, sub, children }) {
  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>
          <div style={S.logo}>FM</div>
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
