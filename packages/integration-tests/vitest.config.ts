import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    globalSetup: ["./src/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Cap file workers because each one starts its own workerd processes.
    maxWorkers: 3,
  },
});
