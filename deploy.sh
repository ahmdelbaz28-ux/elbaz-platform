#!/bin/bash
set -e

# ✅ FIX: Use dynamic script directory instead of hardcoded path.
# Previously: cd /home/z/my-project/elbaz-platform (hardcoded, breaks on other machines)
# Now: cd to the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Current directory ==="
pwd
echo "=== Git remote ==="
git remote -v
echo "=== Git status (before add) ==="
git status --short

echo "=== Configuring git user ==="
git config user.email "ahmdelbaz28@users.noreply.github.com"
git config user.name "ahmdelbaz28-ux"

echo "=== Staging all changes ==="
git add -A

echo "=== Git status (after add) ==="
git status --short

echo "=== Committing ==="
git commit -m "fix: resolve critical build failures - broken imports, stale lockfile, silent npm errors

Root causes fixed:
1. api/queries/connection.ts: wrong import path ./env.js -> ../lib/env.js
2. api/promo-router.ts: 3 wrong imports using ../ instead of ./
3. package-lock.json: stale v14 vs package.json v16, missing rate-limiter-flexible
4. Dockerfile: pipe to tail silently swallowed npm ci exit codes

Preventive guards added:
- prebuild-guard.js: auto-validates lockfile sync, import paths, critical files
- Dockerfile: set -o pipefail, import guard, startup guard, node_modules verify
- .dockerignore: exclude unnecessary files from Docker context"

echo "=== Pushing to GitHub ==="
git push origin main

echo "=== Done! ==="
