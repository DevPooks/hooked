import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
