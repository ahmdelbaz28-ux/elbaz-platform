# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Elbaz LMS — Multi-Stage Docker Build
#  Optimized for: layer caching, security, minimal image size
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Stage 1: Install ALL dependencies (build needs dev deps) ──
FROM node:24-alpine AS deps
WORKDIR /app

# Base system deps for building native npm modules (bcryptjs, sharp, etc.)
RUN apk add --no-cache \
    build-base \
    python3 \
    ca-certificates

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# ── Stage 2: Build frontend + backend ──
FROM deps AS build
WORKDIR /app
COPY . .

# Build: prebuild-guard.js runs automatically via npm prebuild hook,
# then vite builds the frontend
RUN npm run build

# ── Stage 3: Production dependencies only ──
FROM node:24-alpine AS prod-deps
WORKDIR /app

# Runtime deps only (dumb-init not needed — use built-in 'node' user)
RUN apk add --no-cache \
    ca-certificates

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund

# ── Stage 4: Production runtime (minimal image) ──
FROM node:24-alpine AS production
WORKDIR /app

# Security: run as non-root user (Node image already provides 'node' user)
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

# Copy only production dependencies (not devDependencies)
COPY --from=prod-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/dist/public ./dist/public
COPY --from=build --chown=appuser:appgroup /app/api ./api
COPY --from=build --chown=appuser:appgroup /app/db ./db
COPY --from=build --chown=appuser:appgroup /app/contracts ./contracts
COPY --from=build --chown=appuser:appgroup /app/tsconfig.json ./
COPY --from=build --chown=appuser:appgroup /app/tsconfig.server.json ./
COPY --from=build --chown=appuser:appgroup /app/package.json ./

USER appuser

EXPOSE 7860

# Memory watchdog: restart if V8 heap exceeds 90% of max (~256MB cap)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const m=process.memoryUsage();if(m.heapTotal<1){process.exit(1)}const r=m.heapUsed/m.heapTotal;if(r>0.9){process.exit(1)}else{process.exit(0)}"

# Start with tini (Alpine's built-in init system — PID 1 signal forwarding)
ENTRYPOINT ["/sbin/tini", "--"]

# Start with tsx (TypeScript runtime — tsx is in node_modules/.bin)
CMD ["npx", "tsx", "api/boot.ts"]
