FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install --prefer-offline --no-audit
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/db ./db
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/package.json ./
COPY --from=build /app/register-paths.cjs ./
RUN chown -R 1000:1000 /app
USER 1000
EXPOSE 7860
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "tsx", "-r", "./register-paths.cjs", "api/boot.ts"]
