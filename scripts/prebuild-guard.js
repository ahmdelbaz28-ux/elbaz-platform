#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Pre-Build Guard — Catches broken imports & stale lockfiles
//  Runs automatically before `npm run build` (prebuild hook)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
process.chdir(ROOT);

let errors = 0;
let warnings = 0;

// ── Guard 1: package-lock.json freshness ──
console.log("[GUARD 1/3] Checking package-lock.json freshness...");
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));

  if (pkg.version !== lock.version) {
    console.error(
      `  FAIL: package.json version (${pkg.version}) !== package-lock.json version (${lock.version})`
    );
    console.error(`  FIX: Run 'npm install' to regenerate the lockfile`);
    errors++;
  }

  // Check that every dependency in package.json exists in the lockfile
  const lockDeps = lock.packages?.[""]?.dependencies ?? {};
  const lockDevDeps = lock.packages?.[""]?.devDependencies ?? {};
  const allLockDeps = { ...lockDeps, ...lockDevDeps };

  for (const [name] of Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  })) {
    if (!allLockDeps[name]) {
      console.error(
        `  FAIL: '${name}' found in package.json but MISSING from package-lock.json`
      );
      console.error(`  FIX: Run 'npm install' to update the lockfile`);
      errors++;
    }
  }

  if (errors === 0) console.log("  OK: Lockfile is in sync with package.json");
}

// ── Guard 2: Relative import resolution ──
console.log("[GUARD 2/3] Scanning API imports for broken paths...");
{
  const importRe = /from\s+["'](\.[^"']+)["'];?/g;
  const excludeDirs = new Set(["node_modules", "dist", ".git"]);

  function scanDir(dir, depth = 0) {
    if (depth > 10) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !excludeDirs.has(entry.name)) {
        scanDir(join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;

      const filePath = join(dir, entry.name);
      const content = readFileSync(filePath, "utf8");
      const fileDir = dirname(filePath);

      for (const match of content.matchAll(importRe)) {
        const rawImport = match[1];

        // Skip barrel imports and index patterns that Node can resolve
        if (rawImport.includes("*")) continue;

        const resolvedBase = resolve(fileDir, rawImport);

        // ESM + TypeScript: .js imports resolve to .ts files
        // Strip .js/.jsx extension and try both .ts and .js variants
        const stripped = resolvedBase.replace(/\.jsx?$/, "");
        const candidates = [
          resolvedBase,
          stripped + ".ts",
          stripped + ".tsx",
          stripped + ".js",
          stripped + ".jsx",
          resolvedBase + ".ts",
          resolvedBase + ".tsx",
          resolvedBase + "/index.ts",
          resolvedBase + "/index.tsx",
          resolvedBase + "/index.js",
        ];

        // Deduplicate candidates
        const uniqueCandidates = [...new Set(candidates)];

        const found = uniqueCandidates.some((c) => existsSync(c));
        if (!found) {
          console.error(
            `  FAIL: '${rawImport}' not found (imported in ${filePath})`
          );
          console.error(
            `  Tried: ${candidates.map((c) => basename(c)).join(", ")}`
          );
          errors++;
        }
      }
    }
  }

  if (existsSync("api")) scanDir("api");
  if (errors === 0) console.log("  OK: All relative imports resolve correctly");
}

// ── Guard 3: Critical runtime files exist ──
console.log("[GUARD 3/3] Checking critical runtime files...");
{
  const critical = [
    "api/boot.ts",
    "api/lib/env.ts",
    "api/queries/connection.ts",
    "api/middleware/auth.ts",
    "api/middleware/security.ts",
    "db/schema.ts",
    "tsconfig.json",
    "tsconfig.server.json",
    "vite.config.ts",
  ];

  for (const file of critical) {
    if (!existsSync(file)) {
      console.error(`  FAIL: Critical file missing: ${file}`);
      errors++;
    }
  }

  if (errors === 0) console.log("  OK: All critical files present");
}

// ── Verdict ──
console.log("─".repeat(60));
if (errors > 0) {
  console.error(`[PREBUILD] BLOCKED: ${errors} error(s), ${warnings} warning(s)`);
  console.error("[PREBUILD] Fix the errors above before building.");
  process.exit(1);
}
if (warnings > 0) {
  console.warn(`[PREBUILD] PASSED with ${warnings} warning(s)`);
} else {
  console.log("[PREBUILD] ALL GUARDS PASSED — proceeding to build");
}
