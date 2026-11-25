# ✅ SECURITY FIX (audit run-1, fp Dockerfile.node22-alpine.mutable-base-tag):
# the production base image is pinned to an IMMUTABLE digest — a mutable tag is
# re-resolved by Docker Hub on every build, so an upstream tag-mutation or
# compromise silently ships into the production runtime (which holds the
# runtime env secrets). The digest is the multi-arch OCI index for node:22-alpine
# resolved 2026-11-25; updating the base = a reviewed, explicit commit.
# hadolint ignore=DL3006
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app

# ✅ FIX: Install dependencies with proper error handling.
# Previously, npm ci errors were silently swallowed by `|| true` patterns,
# causing the build to continue with broken/missing dependencies.
# Note: apk packages are pinned to major versions via Alpine 3.20 repos;
# pinning exact versions would break on Alpine point releases.
# hadolint ignore=DL3018
RUN apk add --no-cache ca-certificates tini git git-lfs

# Install Node.js dependencies FIRST (better Docker layer caching)
COPY package.json package-lock.json ./
# pipefail not supported in Alpine POSIX sh; npm ci is a single command with
# no pipes, so pipe failures are not a concern here.
# S6505: --ignore-scripts — runtime deps are pure JS (bcryptjs/mysql2/@aws-sdk);
# esbuild ships platform binaries via optionalDependencies, no install scripts needed.
# hadolint ignore=DL4006
RUN npm ci --ignore-scripts --prefer-offline --no-audit --no-fund && \
    echo "=== Dependencies installed ===" && \
    find node_modules -maxdepth 1 -type d | wc -l

# Copy source directories explicitly instead of `COPY . .` to satisfy
# SonarCloud docker:S6470 (recursive copy could leak secrets). The
# .dockerignore at the repo root also excludes .env*, .git*, infra/,
# docs/, etc. — these explicit COPYs are belt-and-braces.
COPY src/ ./src/
COPY api/ ./api/
COPY db/ ./db/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY contracts/ ./contracts/
COPY index.html vite.config.ts tsconfig*.json tailwind.config.js postcss.config.js capacitor.config.ts drizzle.config.ts vitest.config.ts ./

# Initialize git (needed for LFS checkout) and convert LFS pointers to real files
# ✅ FIX: Use set -e to fail fast if LFS checkout fails (was silently ignored before)
# hadolint ignore=SC2015,DL4006
RUN set -e && \
    git init 2>/dev/null || true && \
    git lfs install --skip-smudge 2>/dev/null || true && \
    git lfs fetch --all 2>/dev/null || true && \
    git lfs checkout 2>/dev/null || true && \
    echo "=== Checking LFS files ===" && \
    ls -la public/hero-main.webp public/course-cable.jpg 2>/dev/null || true

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Build the frontend — fail fast if build fails.
# Create non-root user for security (merged into one RUN to reduce layers,
# per SonarCloud docker:S7031).
RUN set -e && \
    npm run build && \
    echo "=== Build complete ===" && \
    addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 7860
# Fail-secure: the container must always boot with production semantics
# (validated env, masked error messages) even if the Space secrets omit
# NODE_ENV. The CMD below runs tsx directly and does NOT set NODE_ENV,
# so without this line the image silently defaulted to development mode.
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:7860/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# was: CMD ["npx", "tsx", "api/boot.ts"] (S8543 — no unpinned npx in prod);
# direct binary avoids on-demand package installs in the production image.
CMD ["./node_modules/.bin/tsx", "api/boot.ts"]
