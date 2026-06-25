FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache ca-certificates tini git git-lfs
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund
# Copy everything including .git for LFS checkout
COPY . .
# Initialize git (needed for LFS checkout) and convert LFS pointers to real files
RUN git init 2>/dev/null || true && \
    git lfs install --skip-smudge 2>/dev/null || true && \
    git lfs fetch --all 2>/dev/null || true && \
    git lfs checkout 2>/dev/null || true && \
    echo "=== Checking LFS files ===" && \
    ls -la public/hero-main.webp public/course-cable.jpg 2>/dev/null || true
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npm run build
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:7860/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "api/boot.ts"]
