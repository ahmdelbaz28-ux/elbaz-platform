# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Elbaz LMS — Docker Build
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund

FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache tini
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const m=process.memoryUsage();if(m.heapTotal<1){process.exit(1)}const r=m.heapUsed/m.heapTotal;if(r>0.9){process.exit(1)}else{process.exit(0)}"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "api/boot.ts"]
