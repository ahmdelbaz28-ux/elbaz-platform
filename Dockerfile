FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --prefer-offline --no-audit
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache dumb-init
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/db ./db
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/tsconfig.json ./
COPY package.json ./
RUN chown -R 1000:1000 /app
USER 1000
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:7860/api/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
ENV NODE_OPTIONS="--max-old-space-size=1024"
CMD ["npx", "tsx", "api/boot.ts"]