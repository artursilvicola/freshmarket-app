import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// [B2B Round prod-rollout / i18n MVP — Krok 1]
// Side-effect import: inicjalizuje i18next (initReactI18next ustawia
// globalny kontekst React, dlatego nie potrzebujemy <I18nextProvider>
// wokół <App />). Krok 1: żaden komponent jeszcze nie używa
// useTranslation() — to tylko fundament, PL działa identycznie jak dotąd.
import "./i18n";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
