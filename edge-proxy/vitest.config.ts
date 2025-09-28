import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "html"],
    reportsDirectory: "./coverage",
    include: [
      "src/cache.ts",
      "src/context.ts",
      "src/crypto.ts",
      "src/entitlements-client.ts",
      "src/merchant-client.ts",
      "src/origin.ts",
      "src/redeem-client.ts",
    ],
  },
});
