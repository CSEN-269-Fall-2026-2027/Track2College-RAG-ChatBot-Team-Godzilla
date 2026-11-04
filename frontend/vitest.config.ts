import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same root .env as vite.config.ts (this config doesn't inherit it).
  envDir: "..",
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
  },
});
