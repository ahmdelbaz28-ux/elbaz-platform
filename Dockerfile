# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Elbaz LMS — Multi-Stage Docker Build
#  Optimized for: layer caching, security, minimal image size
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Stage 1: Install ALL dependencies (build needs dev deps) ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund 2>&1 | tail -3

# ── Stage 2: Build frontend + backend ──
FROM deps AS build
WORKDIR /app
COPY . .

# Build frontend (Vite) + generate types
RUN npm run build

# ── Stage 2.5: Production dependencies only ──
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund 2>&1 | tail -3

# ── Stage 3: Production runtime (minimal image) ──
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Install dumb-init for proper signal handling (SIGTERM → graceful shutdown)
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copy only production dependencies (not devDependencies)
COPY --from=prod-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/dist ./dist
COPY --from=build --chown=appuser:appgroup /app/api ./api
COPY --from=build --chown=appuser:appgroup /app/db ./db
COPY --from=build --chown=appuser:appgroup /app/contracts ./contracts
COPY --from=build --chown=appuser:appgroup /app/tsconfig.json ./
COPY --from=build --chown=appuser:appgroup /app/package.json ./

USER appuser

EXPOSE 7860

# Health check: verify server responds within 5s
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://localhost:7860/api/health || exit 1

# Use dumb-init for proper PID 1 signal forwarding
ENTRYPOINT ["dumb-init", "--"]

# Start with tsx
CMD ["npx", "tsx", "api/boot.ts"]
