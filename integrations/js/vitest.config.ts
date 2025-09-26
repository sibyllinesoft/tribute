import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts"],
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "html"],
    reportsDirectory: "./coverage",
    include: ["packages/**/src/**/*.ts", "extras/**/*.ts"],
  },
  resolve: {
    alias: {
      "@tribute/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
});
