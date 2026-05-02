# ─── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry https://npm.mirrors.msh.team
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit

# ─── Stage 2: Build ────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# ✅ SECURITY: .env is NOT copied — build-time env vars injected via CI/CD
RUN npm run build

# ─── Stage 3: Production (minimal attack surface) ──────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# ✅ Run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S appuser -u 1001

# ✅ SECURITY: Install dumb-init for proper signal handling (PID 1 problem)
RUN apk add --no-cache dumb-init

COPY --from=deps --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=appuser:nodejs /app/dist ./dist
COPY --chown=appuser:nodejs package.json ./

# ✅ SECURITY: NO .env file copied — environment variables injected at runtime:
#    docker run -e APP_SECRET=xxx -e DATABASE_URL=yyy ...
#    OR use Docker secrets / Kubernetes secrets

USER appuser
EXPOSE 3000

# ✅ Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# ✅ PRODUCTION FIX: Use dumb-init to handle signals properly
# Without it, Node.js runs as PID 1 and doesn't handle SIGTERM correctly
# → container takes 30+ seconds to stop, or gets SIGKILL
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/boot.js"]
