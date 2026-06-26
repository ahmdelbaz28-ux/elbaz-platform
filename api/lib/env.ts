import "dotenv/config";
import { z } from "zod";

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

  PAYMOB_API_KEY: z.string().optional(),
  PAYMOB_INTEGRATION_ID: z.coerce.number().min(0).optional(),
  PAYMOB_IFRAME_ID: z.coerce.number().min(0).optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  PAYMOB_WEBHOOK_SECRET: z.string().optional(),
  PAYMOB_BASE_URL: z.string().default("https://accept.paymob.com"),

  // ── AI Chatbot providers ──────────────────────────────────────
  // MODAL_API_KEY is the PRIMARY provider (zai-org/GLM-5.1-FP8 via Modal).
  // OPENROUTER_API_KEY is the FALLBACK provider (free model cascade).
  MODAL_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // 🔧 FIX: Hardcoded OAuth redirect URI to avoid redirect_uri_mismatch errors
  // when users access via different domains (custom domain vs HF Space URL).
  // Must be registered in Google Cloud Console → Credentials → Authorized redirect URIs
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("noreply@ahmedelbaz.qzz.io").transform(v => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
      console.error("\n" + "=".repeat(60));
      console.error("❌ [FATAL] Environment validation failed in production");
      console.error("The following required variables are missing or invalid:");
      for (const issue of result.error.issues) {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
      console.error("\n💡 [ACTION REQUIRED]");
      console.error("1. Open your hosting platform (e.g. HuggingFace Space Settings).");
      console.error("2. Go to 'Variables and Secrets' section.");
      console.error("3. Add the missing keys above as 'Secrets'.");
      console.error("4. Re-run or Re-deploy the application.");
      console.error("Refer to README.md for the full list of required environment variables.");
      console.error("=".repeat(60) + "\n");
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
 */
function getActiveFrontendUrl(currentRequestUrl?: string): string {
  if (!currentRequestUrl) return env.FRONTEND_URL;
  try {
    const url = new URL(currentRequestUrl);
    // If we're on a .hf.space or .qzz.io domain, trust the current host over the hardcoded secret
    if (url.hostname.includes("hf.space") || url.hostname.includes("qzz.io")) {
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

