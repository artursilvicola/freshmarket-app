import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// [fix/security-hotfix] Identyfikator builda: wstrzykiwany do bundla (__FM_BUILD_ID__)
// i publikowany jako /version.json. NewVersionBanner porównuje oba i prosi
// otwarte karty o odświeżenie po deployu (stary bundle nie zapisze nowych
// wyborów po migracji 055 — dane są bezpieczne, ale kliknięcia się nie zapiszą).
const BUILD_ID = String(process.env.COMMIT_REF || process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);

function versionJson() {
  return {
    name: "fm-version-json",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID, built_at: new Date().toISOString() }) });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), versionJson()],
  define: {
    __FM_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
