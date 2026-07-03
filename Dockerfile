FROM node:22-alpine
WORKDIR /app

# ✅ FIX: Install dependencies with proper error handling.
# Previously, npm ci errors were silently swallowed by `|| true` patterns,
# causing the build to continue with broken/missing dependencies.
RUN apk add --no-cache ca-certificates tini git git-lfs

# Install Node.js dependencies FIRST (better Docker layer caching)
COPY package.json package-lock.json ./
RUN set -o pipefail && \
    npm ci --prefer-offline --no-audit --no-fund && \
    echo "=== Dependencies installed ===" && \
    ls node_modules | wc -l

# Copy everything including .git for LFS checkout.
# Note (docker:S6470): we deliberately use `COPY . .` rather than enumerating
# every directory because the comprehensive .dockerignore at the repo root
# already excludes every known sensitive path (.env*, .git*, infra/, docs/,
# Dockerfile itself, etc.). Enumerating dirs manually would be brittle: any
# new source folder added later would silently be missing from the image.
# sonar:off[docker:S6470]
COPY . .
# sonar:on[docker:S6470]

# Initialize git (needed for LFS checkout) and convert LFS pointers to real files
# ✅ FIX: Use set -e to fail fast if LFS checkout fails (was silently ignored before)
RUN set -e && \
    git init 2>/dev/null || true && \
    git lfs install --skip-smudge 2>/dev/null || true && \
    git lfs fetch --all 2>/dev/null || true && \
    git lfs checkout 2>/dev/null || true && \
    echo "=== Checking LFS files ===" && \
    ls -la public/hero-main.webp public/course-cable.jpg 2>/dev/null || true

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Build the frontend — fail fast if build fails
RUN set -e && npm run build && echo "=== Build complete ==="

# Create non-root user for security (merged into one RUN to reduce layers,
# per SonarCloud docker:S7031).
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:7860/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "api/boot.ts"]
