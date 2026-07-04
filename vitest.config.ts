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
        // Current coverage: 8.63% statements, 7.91% branches, 9.49% functions,
        // 8.74% lines. Thresholds set just below current levels to catch
        // regressions without blocking PRs that add untested code.
        // Files with good coverage: password.ts (100%), jwt.ts (84%),
        // rate-limiter.ts (68%), chatbot.ts (35%), cache.ts (30%).
        // TODO: raise thresholds as more tests are added.
        statements: 8,
        branches: 7,
        functions: 9,
        lines: 8,
      },
    },
  },
});
