# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Elbaz LMS — Production Docker Build for HuggingFace Spaces
#  Optimized for: fast builds, minimal image, reliable startup
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Stage 1: Install ALL dependencies (build needs dev deps) ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund 2>&1 | tail -3

# ── Stage 2: Build frontend (Vite) ──
FROM deps AS build
WORKDIR /app
COPY . .

# Build only the frontend (Vite + React)
RUN npm run build 2>&1 | tail -5

# ── Stage 3: Production dependencies only ──
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund 2>&1 | tail -3

# ── Stage 4: Production runtime (minimal image) ──
FROM node:22-alpine AS production
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Install dumb-init for proper signal handling (SIGTERM → graceful shutdown)
RUN apk add --no-cache dumb-init

# Production environment
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copy only production dependencies
COPY --from=prod-deps --chown=appuser:appgroup /app/node_modules ./node_modules

# Copy built frontend assets
COPY --from=build --chown=appuser:appgroup /app/dist/public ./dist/public

# Copy backend source + database schema + contracts
COPY --from=build --chown=appuser:appgroup /app/api ./api
COPY --from=build --chown=appuser:appgroup /app/db ./db
COPY --from=build --chown=appuser:appgroup /app/contracts ./contracts

COPY --chown=appuser:appgroup tsconfig.json ./
COPY --chown=appuser:appgroup package.json ./

USER appuser

EXPOSE 7860

# Health check: verify server responds within 5s
# HuggingFace Spaces uses this to detect when the app is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider http://localhost:7860/api/health || exit 1

# Use dumb-init for proper PID 1 signal forwarding
ENTRYPOINT ["dumb-init", "--"]

# Start with tsx (TypeScript execution for Node.js)
CMD ["npx", "tsx", "api/boot.ts"]
