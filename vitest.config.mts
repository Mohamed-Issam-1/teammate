import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Mirror the integration config so server-only composition modules (the
      // runtime auth/email boundary) can be imported by node-environment tests
      // without contacting a provider or a database.
      "server-only": path.resolve(
        import.meta.dirname,
        "./tests/integration/server-only.ts",
      ),
    },
  },
});
