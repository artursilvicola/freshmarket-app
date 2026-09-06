import { defineConfig } from "vitest/config";

// Testy jednostkowe czystych modułów (src/lib/**). Uruchomienie: npm test
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}", "tests/**/*.test.{js,mjs}"],
    exclude: ["node_modules", "dist", "out"],
  },
});
