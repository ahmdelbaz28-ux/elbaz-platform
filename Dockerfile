FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache ca-certificates tini
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npm run build
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const m=process.memoryUsage();if(m.heapTotal<1){process.exit(1)}const r=m.heapUsed/m.heapTotal;if(r>0.9){process.exit(1)}else{process.exit(0)}"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "api/boot.ts"]
