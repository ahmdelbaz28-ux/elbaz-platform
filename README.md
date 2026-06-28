# Elbaz Platform — Electrical Engineering LMS

A production-grade learning management system for electrical engineering
courses (ETAP, SKM, PowerFactory, PVSyst, protection, renewable energy).
Built by Eng. Ahmed Elbaz.

**Production**: https://ahmedelbaz.qzz.io

---

## Tech Stack

| Layer        | Technology                                                    |
|--------------|---------------------------------------------------------------|
| Frontend     | React 19, Vite 7, TypeScript 5.9, TailwindCSS 3, shadcn/ui   |
| API          | Hono 4, tRPC 11, Zod 4, superjson                             |
| Database     | MySQL (Aiven) via Drizzle ORM 0.45                            |
| Auth         | JWT (jose), bcryptjs, Google OAuth, TOTP 2FA, sliding sessions|
| Storage      | Cloudflare R2 (S3-compatible) for videos                      |
| Payments     | Paymob (Egyptian gateway), promo codes, multi-method          |
| Email        | Resend                                                        |
| Cache        | Redis (optional) + in-memory LRU                              |
| AI Chatbot   | 4-tier cascade: Modal → Groq → NVIDIA → OpenRouter            |
| Mobile       | Capacitor 8 (Android + iOS)                                   |
| Desktop      | Electron 42                                                   |
| PWA          | vite-plugin-pwa with custom cache-nuke.js                     |
| Monitoring   | Sentry, Microsoft Clarity                                     |
| Deployment   | Docker (HF Spaces) + Cloudflare Worker (WAF) + K8s manifests  |

---

## Quick Start (Development)

```bash
# 1. Install dependencies
npm ci

# 2. Copy env template and fill in your values
cp .env.example .env
# Edit .env with your DATABASE_URL, APP_SECRET, GOOGLE_CLIENT_ID, etc.

# 3. Start the dev server (Vite + Hono together via @hono/vite-dev-server)
npm run dev
# → http://localhost:3000

# 4. Run tests
npm test
```

The database auto-migrates on first boot via `api/lib/db-init.ts` — no
manual SQL execution needed. The `users` table is the migration sentinel;
if it doesn't exist, `db/init-schema.sql` is executed in full.

---

## Production Deployment

### Option A: Docker (HuggingFace Spaces)

```bash
docker build -t elbaz-platform .
docker run -p 7860:7860 --env-file .env elbaz-platform
```

The Dockerfile uses `node:22-alpine`, runs as non-root user `appuser`,
and includes a `HEALTHCHECK` hitting `/api/health`.

### Option B: Kubernetes

Manifests are in `infra/k8s-manifests/`. Apply in order:

```bash
cd infra/k8s-manifests
./apply-all.sh
```

Includes HPA, VPA, network policies, PDB, Redis StatefulSet, cert-manager,
Prometheus, Grafana, Loki, Jaeger, and a DB backup CronJob.

### Option C: Manual (Node.js)

```bash
npm ci --omit=dev
npm run build
npm start  # → runs: cross-env NODE_ENV=production npx tsx api/boot.ts
```

### Cloudflare Worker (WAF)

The Cloudflare Worker at `infra/security-audit/worker-v7-hardened.js`
provides bot protection, WAF rules, and request filtering at the edge.
Deploy with:

```bash
npm run deploy:worker
```

---

## Environment Variables

See `.env.example` for the complete list with documentation.

**Required in production** (server will refuse to boot without):
- `NODE_ENV`, `PORT`, `HOST`
- `APP_SECRET` (≥32 chars)
- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`

**Recommended** (functionality degrades without):
- `DATABASE_SSL_CA` (security — without this, MySQL connection uses `rejectUnauthorized:false`)
- `RESEND_API_KEY` + `EMAIL_FROM` (password reset / verification emails)
- `R2_*` (video streaming)
- `PAYMOB_*` (payments)
- `SENTRY_DSN`, `CLARITY_ID` (monitoring)
- `OPENROUTER_API_KEY` (AI chatbot)

---

## Database Migrations

Migrations run automatically on every boot via `api/lib/db-init.ts`:

1. Acquire MySQL `GET_LOCK('elbaz_db_migration', 30)` (prevents concurrent
   HPA pod startup races).
2. Check if `users` table exists.
3. If NO → execute `db/init-schema.sql` (creates all 24 tables).
4. If YES → run incremental column migrations (idempotent — uses
   `INFORMATION_SCHEMA` checks before each `ALTER TABLE`).
5. Run seed data (`INSERT IGNORE` — idempotent).
6. Release lock.

For manual schema changes, use Drizzle Kit:

```bash
npm run db:generate  # Generate SQL from schema.ts changes
npm run db:migrate   # Apply generated SQL
npm run db:push      # Push schema directly (dev only)
```

---

## Testing

```bash
# Unit tests (Vitest)
npm test

# E2E tests (Playwright)
cd infra/test-automation
npx playwright test

# Load tests (k6)
cd infra/test-automation
k6 run tests/load/k6-load-test.js
```

Coverage: 86 unit tests covering JWT, password hashing, rate limiter,
cache, and chatbot. E2E tests cover auth, courses, security, accessibility,
performance, and support flows.

---

## Project Structure

```
.
├── api/                  # Hono backend + tRPC routers
│   ├── boot.ts           # Server entry (CSP, static, SPA fallback)
│   ├── router.ts         # tRPC root router (composes all sub-routers)
│   ├── context.ts        # tRPC context (auth, sliding session, cache)
│   ├── middleware.ts     # publicQuery / authedQuery / adminQuery
│   ├── middleware/       # security.ts (CSP), shield.ts (rate limit)
│   ├── lib/              # env, jwt, r2, paymob, email, rate-limiter, sentry
│   └── *-router.ts       # 19 sub-routers (auth, course, payment, etc.)
├── db/                   # Drizzle schema + SQL migrations
│   ├── schema.ts         # Source of truth for all 24 tables
│   ├── init-schema.sql   # Full schema (run on first boot)
│   └── relations.ts      # Drizzle relations for joins
├── src/                  # React frontend
│   ├── App.tsx           # Router (17 lazy-loaded pages)
│   ├── providers/        # tRPC + React Query provider
│   ├── pages/            # Home, Login, Register, Dashboard, CourseDetail, etc.
│   ├── components/       # Navbar, Footer, ChatBot, CourseCard, etc.
│   ├── hooks/            # useAuth, useWatchTracker, useTranslation, etc.
│   └── lib/              # google-auth, hls-loader, clarity, qr-code
├── contracts/            # Shared types between frontend and backend
├── infra/                # Infrastructure as code
│   ├── k8s-manifests/    # 22 K8s manifests (deploy, HPA, monitoring, etc.)
│   ├── sre-observability/# Prometheus, Grafana, Loki, Jaeger, alerts
│   ├── security-audit/   # Cloudflare Worker WAF, DNS, WAF rules
│   └── test-automation/  # Playwright E2E + k6 load tests
├── electron/             # Electron desktop wrapper
├── android/              # Capacitor Android app
├── public/               # Static assets (favicon, manifest, hero images)
├── Dockerfile            # Production Docker image
└── package.json
```

---

## Security

- **CSP**: nonce-based per-request, with `unsafe-inline` fallback only for
  Cloudflare-cached HTML (set in `api/middleware/security.ts`).
- **Auth**: httpOnly + Secure + SameSite=None cookies (for cross-domain
  HF Spaces / custom domain). JWT with `tokenVersion` for instant revocation.
- **2FA**: TOTP RFC 6238 with backup codes (HMAC-hashed with APP_SECRET).
- **Rate limiting**: per-IP shield middleware (200 req/10s) + per-action
  auth limits (login: 10/15min, forgotPassword: 5/15min, etc.).
- **Payments**: Paymob HMAC-SHA512 webhook verification + amount check.
- **Videos**: R2 presigned URLs (30-minute expiry) + watermark secret.
- **DB**: parameterized queries everywhere (Drizzle ORM). No raw SQL
  string concatenation.

Report security issues to: ahmdelbaz28@users.noreply.github.com

---

## License

Proprietary. All rights reserved. © Eng. Ahmed Elbaz.
