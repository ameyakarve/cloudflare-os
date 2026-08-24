import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    capnwebValidate(),
    cloudflareTest({
      main: "./__tests__/workerd/worker.ts",
      miniflare: {
        compatibilityDate: "2026-02-02",
        compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_als"],
        bindings: {CLIENT_ID: "test-client", CLIENT_SECRET: "test-secret"},
        durableObjects: {
          UserAccount: {className: "UserAccount", useSQLite: true},
          GmailGatekeeperImpl: {className: "GmailGatekeeperImpl", useSQLite: true},
          TestHooks: {className: "TestHooks", useSQLite: true},
        },
      },
    }),
  ],
  test: {
    include: ["__tests__/workerd/*.test.ts"],
    setupFiles: ["../../scripts/assert-workerd.ts"],
  },
});
