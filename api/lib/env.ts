import "dotenv/config";
import { z } from "zod";
import { logger } from "./logger.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(7860),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL_CERT: z.string().optional(),
  DATABASE_SSL_KEY: z.string().optional(),
  DATABASE_SSL_CA: z.string().optional(),

  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  // JWT access token TTL — defaults to 7 days so the cookie (30d) actually
  // keeps the user logged in between visits. The sliding-session middleware
  // in context.ts re-issues the token when < 2h remain, so active users stay
  // logged in indefinitely. MUST be longer than SLIDING_REFRESH_THRESHOLD_S
  // (2h) or the refresh never triggers and users get logged out after the
  // token expires.
  JWT_ACCESS_EXPIRY: z.string().default("7d"),
  JWT_REFRESH_EXPIRY: z.string().default("30d"),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // ── Paymob (Intention API — official 2025+ flow) ────────────────
  // Secret/Public keys + HMAC come from Dashboard → Settings → API Keys.
  // Integration IDs come from Dashboard → Settings → Payment Integrations
  // (each has a Test and Live version; match the Secret Key's mode).
  // Public key + integration IDs may alternatively be set by the admin in
  // the dashboard UI (siteSettings section "payments") without a redeploy.
  PAYMOB_SECRET_KEY: z.string().optional(),
  PAYMOB_PUBLIC_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  PAYMOB_INTEGRATION_CARD: z.coerce.number().int().positive().optional(),
  PAYMOB_INTEGRATION_WALLET: z.coerce.number().int().positive().optional(),
  // Legacy Accept API key (JWT) — only used by the old Transaction Inquiry
  // endpoints; kept optional because Intention-API-era keys are rejected by it.
  PAYMOB_API_KEY: z.string().optional(),
  PAYMOB_INTEGRATION_ID: z.coerce.number().min(0).optional(),
  PAYMOB_IFRAME_ID: z.coerce.number().min(0).optional(),
  PAYMOB_WEBHOOK_SECRET: z.string().optional(),
  // Explicit webhook endpoint override. The default is ${FRONTEND_URL}/api/paymob/webhook,
  // but when the public domain sits behind a bot-challenge CDN (Cloudflare) the
  // server-to-server callback (non-browser UA) never reaches the origin — probed
  // live 2026-10-13. Point this at a direct origin host (e.g. the hf.space URL).
  PAYMOB_WEBHOOK_URL: z.string().url().optional(),
  PAYMOB_BASE_URL: z.string().default("https://accept.paymob.com"),

  // ── AI Chatbot providers ──────────────────────────────────────
  // KILOCODE_API_KEY is the PRIMARY provider (kilo gateway free flagship
  // lane — nemotron-3-ultra/super/vl, seeded at priority 5).
  // NVIDIA_API_KEY is the SECONDARY provider (minimaxai/minimax-m3 on NVIDIA NGC, free).
  // OPENROUTER_API_KEY is the TERTIARY provider (22-model free cascade).
  // GROQ_API_KEY is the QUATERNARY provider (ultra-fast Llama/Qwen on Groq, free).
  KILOCODE_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // 🔧 FIX: Hardcoded OAuth redirect URI to avoid redirect_uri_mismatch errors
  // when users access via different domains (custom domain vs HF Space URL).
  // Must be registered in Google Cloud Console → Credentials → Authorized redirect URIs
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("noreply@ahmedelbaz.qzz.io").transform(v => {
    // Email format check — anchored, no overlapping quantifiers, no nested
    // quantifiers that can match the same character. The `[^\\s@.]+` class
    // excludes `.` so each dot-segment is a single label and the engine
    // has exactly one way to split local-part vs. domain
    // (SonarCloud S5852 / S8786).
    const emailRegex = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
    if (!v || !emailRegex.test(v)) return "noreply@ahmedelbaz.qzz.io";
    return v;
  }),

  // Admin initial password (set on first deploy — auto-generated if empty)

  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters").optional(),

  SENTRY_DSN: z.string().url().optional(),

  CLARITY_PROJECT_ID: z.string().optional(),

  FRONTEND_URL: z.string().url().default("https://ahmedelbaz.qzz.io"),
  CORS_ORIGINS: z.string().optional(),

  REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(300),

  WATERMARK_SECRET: z.string().min(32, "WATERMARK_SECRET must be at least 32 characters").optional(),
  WEBHOOK_SECRET: z.string().optional(),
  EMAIL_PROVIDER: z.string().default("console").optional(),

  // ✅ SECURITY FIX (audit run-1): edge→origin authentication. When set on BOTH
  // the Cloudflare worker (as a worker secret/var) and this origin, shield
  // rejects any request that does not carry a fresh HMAC edge signature —
  // closing the public direct-to-origin bypass of the edge security pipeline.
  EDGE_ORIGIN_SECRET: z.string().min(32, "EDGE_ORIGIN_SECRET must be at least 32 characters").optional(),
  // Legitimate Space hostname (e.g. ahmdelbaz28-ahmdrtap.hf.space) allowed for
  // request-derived frontend URLs alongside FRONTEND_URL/CORS_ORIGINS.
  HF_SPACE_HOST: z.string().optional(),

  // ── Web Push (VAPID) — browser notifications that reach users even when ──
  // the site tab is closed. Keys are SELF-ISSUED (not a third-party service):
  // generate once with `npx tsx scripts/generate-vapid-keys.mjs` and set as
  // deployment secrets. The public key is served via /api/notifications/push
  // /public-key; the private key never leaves the server.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Contact URI sent in the VAPID JWT (push services may use it to reach you).
  VAPID_SUBJECT: z.string().default("mailto:contact@ahmedelbaz.qzz.io"),

  // ── Telegram broadcast bot — mirrors every site/YouTube announcement ──
  // to the owner's channel. Create the bot with @BotFather, add it as an
  // ADMIN of the target channel, then set both values. Without these the
  // Telegram delivery is silently skipped (everything else keeps working).
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Channel id: "@engahmedetap" or the numeric -100... chat id.
  TELEGRAM_CHAT_ID: z.string().optional(),
  // ── Telegram bot worker (api/lib/telegram-bot.ts) — join-request
  // auto-approval + private DM expert brain. Set TELEGRAM_BOT_POLLING=0 to
  // disable the worker without touching the broadcast mirror.
  TELEGRAM_BOT_POLLING: z.string().optional(),
  // Brain mode for DMs: "instant" (default, fast) or "thinking" (deep, slow).
  TELEGRAM_DM_MODE: z.string().optional(),
  // Custom group welcome text after a join approval (default built-in).
  TELEGRAM_GROUP_WELCOME: z.string().optional(),
  // Personal chat id that receives the one-line "worker is up" boot ping.
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
});

type EnvWithMeta = z.infer<typeof envSchema> & { isProduction: boolean };

function validateEnv(): EnvWithMeta {
  const raw = { ...process.env };

  // HF Spaces naming compatibility: R2_BUCKET → R2_BUCKET_NAME
  if (!raw.R2_BUCKET_NAME && raw.R2_BUCKET) {
    raw.R2_BUCKET_NAME = raw.R2_BUCKET;
  }

  // HF Spaces: GITHUB_WEBHOOK_SECRET → WEBHOOK_SECRET fallback
  if (!raw.WEBHOOK_SECRET && raw.GITHUB_WEBHOOK_SECRET) {
    raw.WEBHOOK_SECRET = raw.GITHUB_WEBHOOK_SECRET;
  }

  // HF Spaces: CLARITY_ID → CLARITY_PROJECT_ID fallback
  if (!raw.CLARITY_PROJECT_ID && raw.CLARITY_ID) {
    raw.CLARITY_PROJECT_ID = raw.CLARITY_ID;
  }

  if (raw.NODE_ENV === "production") {
    const result = envSchema.safeParse(raw);
    if (!result.success) {
      logger.error("FATAL: Environment validation failed in production — missing or invalid variables");
      for (const issue of result.error.issues) {
        logger.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
      logger.error("Action required: Add the missing keys as Secrets in your hosting platform.");
      process.exit(1);
    }
    return { ...result.data, isProduction: true } as EnvWithMeta;
  }

  return { ...envSchema.parse(raw), isProduction: false } as EnvWithMeta;
}

const env = validateEnv();

/**
 * 🚀 Elite: Smart URL Detection
 * If the configured FRONTEND_URL doesn't match the current request (detected at runtime),
 * this helper allows the system to adapt.
 *
 * ✅ SECURITY FIX (audit run-1): the request-derived host is now accepted ONLY
 * when it exactly matches an operator-owned hostname (FRONTEND_URL, CORS_ORIGINS,
 * or the optional HF_SPACE_HOST env). The previous substring check —
 * hostname.includes("hf.space") || includes("qzz.io") — trusted ANY host
 * containing those substrings (including attacker-registered names), letting an
 * unauthenticated forgotPassword call choose the origin of the password-reset /
 * email-verification links sent to victims. Unmatched hosts now fail safe to
 * the configured FRONTEND_URL.
 */
function getAllowedFrontendHosts(): string[] {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(env.FRONTEND_URL).hostname);
  } catch { /* ignore */ }
  const corsRaw: unknown = (env as { CORS_ORIGINS?: string | string[] }).CORS_ORIGINS;
  const corsList = Array.isArray(corsRaw) ? corsRaw : typeof corsRaw === "string" ? corsRaw.split(",") : [];
  for (const originRaw of corsList) {
    const origin = String(originRaw).trim();
    if (!origin) continue;
    try {
      hosts.add(new URL(origin).hostname);
    } catch {
      hosts.add(origin.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
    }
  }
  const spaceHost = process.env.HF_SPACE_HOST?.trim();
  if (spaceHost) hosts.add(spaceHost);
  return [...hosts];
}

function getActiveFrontendUrl(currentRequestUrl?: string): string {
  if (!currentRequestUrl) return env.FRONTEND_URL;
  try {
    const url = new URL(currentRequestUrl);
    if (getAllowedFrontendHosts().includes(url.hostname)) {
      return `${url.protocol}//${url.host}`;
    }
  } catch { /* ignore */ }
  return env.FRONTEND_URL;
}

function getPublicEnvKeys(): Record<string, string> {
  return {
    NODE_ENV: env.NODE_ENV,
    FRONTEND_URL: env.FRONTEND_URL,
    CLARITY_PROJECT_ID: env.CLARITY_PROJECT_ID ?? "",
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ?? "",
  };
}

export { env, getPublicEnvKeys, getActiveFrontendUrl };

