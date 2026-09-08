import { defineConfig } from "vitest/config";

// Testy jednostkowe czystych modułów (src/lib/**). Uruchomienie: npm test
export default defineConfig({
  // testy komponentu (react-test-renderer) — automatyczny JSX bez pluginu React
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}", "tests/**/*.test.{js,mjs}"],
    exclude: ["node_modules", "dist", "out"],
  },
});
