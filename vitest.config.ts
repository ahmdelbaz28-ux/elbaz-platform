import { defineConfig } from "vitest/config";
import path from "node:path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@db": path.resolve(templateRoot, "db"),
    },
  },
  test: {
    environment: "node",
    include: ["api/**/*.test.ts", "api/**/*.spec.ts"],
    testTimeout: 30000, // 30s timeout for tests (Modal retry backoff can take time)
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: ["api/**/*.ts", "src/lib/**/*.ts"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.config.ts",
        "**/*.config.js",
        "api/lib/env.ts",        // env validation — tested indirectly via server startup
        "api/lib/sentry.ts",     // external monitoring SDK wrapper
        "api/lib/ai-diagnostics.ts", // diagnostic logging, hard to test
      ],
      thresholds: {
        statements: 5,
        branches: 5,
        functions: 5,
        lines: 5,
      },
    },
  },
});
