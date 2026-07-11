import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    globalSetup: ["./tests/globalSetup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
