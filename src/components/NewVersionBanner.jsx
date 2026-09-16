// [fix/security-hotfix] Pasek „dostępna nowa wersja — odśwież stronę”.
//
// Po deployu otwarte karty uczestników nadal wykonują stary bundle. Po migracji
// 055 stary bundle nie zapisze nowych wyborów (baza przyjmuje zapisy tylko przez
// RPC) — dane są bezpieczne, ale kliknięcie nie trafi do bazy, dopóki strona nie
// zostanie odświeżona. Ten komponent co kilka minut (i przy powrocie do karty)
// porównuje /version.json z identyfikatorem wbudowanym w bundle i prosi
// o odświeżenie. Nie jest mechanizmem egzekwowania — tym jest baza.
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const CURRENT_BUILD_ID = typeof __FM_BUILD_ID__ !== "undefined" ? __FM_BUILD_ID__ : "dev";

export async function fetchRemoteBuildId(fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res || !res.ok) return null;
  const json = await res.json();
  return json && typeof json.build === "string" ? json.build : null;
}

export default function NewVersionBanner({ intervalMs = 5 * 60 * 1000, firstCheckMs = 30 * 1000, fetchImpl, currentBuildId = CURRENT_BUILD_ID }) {
  const { t } = useTranslation("common");
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (!currentBuildId || currentBuildId === "dev") return undefined; // lokalny dev / testy bez builda
    let stopped = false;
    const check = async () => {
      try {
        const remote = await fetchRemoteBuildId(fetchImpl);
        if (!stopped && remote && remote !== currentBuildId) setOutdated(true);
      } catch {
        /* brak sieci / brak pliku — sprawdzimy następnym razem */
      }
    };
    const first = setTimeout(check, firstCheckMs);
    const timer = setInterval(check, intervalMs);
    const onVisible = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") check(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, firstCheckMs, fetchImpl, currentBuildId]);

  if (!outdated) return null;
  return (
    <div role="alert" style={{
      position: "sticky", top: 0, zIndex: 10000, display: "flex", gap: 12, alignItems: "center", justifyContent: "center",
      padding: "10px 16px", background: "#fef3c7", borderBottom: "1px solid #f59e0b", color: "#78350f", fontSize: 14, fontWeight: 600,
    }}>
      <span>{t("new_version.text")}</span>
      <button type="button" onClick={() => window.location.reload()} style={{
        padding: "6px 14px", background: "#b45309", color: "white", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      }}>
        {t("new_version.button")}
      </button>
    </div>
  );
}
