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
    include: ["api/**/*.test.ts", "api/**/*.spec.ts", "src/**/*.test.ts", "src/**/*.spec.ts"],
    testTimeout: 30000, // 30s timeout for tests (Modal retry backoff can take time)
    hookTimeout: 30000,
    // ✅ ROOT-CURE (2026-11-13): security-audit-run1/run2 failed at IMPORT
    // time in any bare environment because validateEnv (env.ts, loaded via
    // the jwt/connection import chain) requires APP_SECRET + GOOGLE_CLIENT_ID.
    // CI exported them by hand (sonarcloud.yml); the suite is now self-
    // contained with the SAME test-only dummies CI uses — never real secrets.
    env: {
      NODE_ENV: "test",
      APP_SECRET: "test-secret-not-for-production-minimum-32-chars",
      GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
      OPENROUTER_API_KEY: "sk-or-v1-test-key-for-ci-only",
      DATABASE_URL: "mysql2://test:test@localhost:3306/test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["api/**", "src/**", "contracts/**", "db/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/node_modules/**",
        "**/dist/**",
      ],
      reportsDirectory: "./coverage",
    },
  },
});
