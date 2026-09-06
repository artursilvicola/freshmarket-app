// [feat/fm-queue] Logowanie obsługi eventu: kod operatora + 6-cyfrowy PIN.
// Nie używa /login (magic link / hasło) — obsługa dostaje kod i PIN od organizatora.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { C, deviceId } from "./staffUi";

export default function StaffLoginPage({ onLoggedIn }) {
  const [code, setCode] = useState(() => { try { return localStorage.getItem("fm_staff_code") || ""; } catch { return ""; } });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lockedFor, setLockedFor] = useState(0);
  const pinRef = useRef(null);

  useEffect(() => {
    if (!lockedFor) return;
    const t = setInterval(() => setLockedFor(s => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockedFor]);

  async function submit(e) {
    e?.preventDefault?.();
    if (busy || lockedFor) return;
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode || !/^\d{6}$/.test(pin)) { setErr("Podaj kod operatora i 6-cyfrowy PIN."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch("/.netlify/functions/staff-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode, pin, device_id: deviceId() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPin("");
        if (j.code === "FM_LOCKED" && j.retry_after_s) setLockedFor(Number(j.retry_after_s));
        setErr(j.error || "Logowanie nieudane.");
        return;
      }
      const { error } = await supabase.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
      if (error) { setErr("Nie udało się ustawić sesji: " + error.message); return; }
      try { localStorage.setItem("fm_staff_code", cleanCode); } catch { /* noop */ }
      onLoggedIn?.(j.staff);
    } catch {
      setErr("Brak połączenia z serwerem. Sprawdź Wi-Fi i spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || lockedFor > 0;
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, background: C.white, borderRadius: 18, padding: "32px 28px", boxShadow: "0 12px 40px rgba(15,23,42,0.10)", border: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: C.teal, fontWeight: 700 }}>Fresh Market 2026</div>
        <h1 style={{ margin: "6px 0 4px", fontSize: 24, color: C.ink }}>Obsługa spotkań B2B</h1>
        <p style={{ margin: "0 0 22px", color: C.slate, fontSize: 14, lineHeight: 1.5 }}>Zaloguj się kodem operatora i PIN-em od organizatora.</p>

        <label style={lbl}>Kod operatora</label>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="username"
          placeholder="np. OBSLUGA-3" disabled={disabled} style={inp} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); pinRef.current?.focus(); } }} />

        <label style={{ ...lbl, marginTop: 14 }}>PIN (6 cyfr)</label>
        <input ref={pinRef} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="\d*"
          type="password" autoComplete="current-password" placeholder="••••••" disabled={disabled}
          style={{ ...inp, letterSpacing: "0.5em", fontSize: 26, textAlign: "center", fontVariantNumeric: "tabular-nums" }} />

        {err && <div role="alert" style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: C.redBg, color: "#991b1b", fontSize: 13, lineHeight: 1.45 }}>
          {err}{lockedFor > 0 && <div style={{ fontWeight: 700, marginTop: 4 }}>Odblokowanie za {Math.floor(lockedFor / 60)}:{String(lockedFor % 60).padStart(2, "0")}</div>}
        </div>}

        <button type="submit" disabled={disabled} style={{ marginTop: 20, width: "100%", padding: "16px", borderRadius: 12, border: "none", background: disabled ? "#99f6e4" : C.teal, color: "white", fontSize: 17, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {busy ? "Logowanie…" : "Zaloguj"}
        </button>
        <div style={{ marginTop: 16, fontSize: 12, color: C.muted, textAlign: "center" }}>Problem z logowaniem? Zgłoś się do biura organizatora (Gate 1).</div>
      </form>
    </div>
  );
}

const lbl = { display: "block", fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
const inp = { width: "100%", boxSizing: "border-box", padding: "14px 14px", borderRadius: 12, border: `1.5px solid ${C.line}`, fontSize: 18, fontFamily: "inherit", color: C.ink, background: "#f8fafc", outline: "none" };
