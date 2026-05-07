// Runtime environment configuration — single source of truth for all env vars
export const env = {
  // ─── Core ───────────────────────────────────────────────────
  isProduction: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT || "7860"),
  appSecret: process.env.APP_SECRET || "",
  appId: process.env.APP_ID || "elbaz-lms",

  // ─── Database ──────────────────────────────────────────────
   databaseUrl: (process.env.DATABASE_URL || "").replace(/[?&]ssl[-_]mode=[^&]*/g, "").replace(/[?&]$/, ""),

  // ─── CORS ──────────────────────────────────────────────────
  corsOrigins: process.env.CORS_ORIGINS || "",
  frontendUrl: process.env.FRONTEND_URL || "",

  // ─── Email ─────────────────────────────────────────────────
  emailProvider: process.env.EMAIL_PROVIDER || "console",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "noreply@elbaz.com",

  // ─── AI Chatbot ───────────────────────────────────────────
  chatbotApiKey: process.env.CHATBOT_API_KEY || "",
  chatbotApiBase: process.env.CHATBOT_API_BASE || "",
  chatbotModel: process.env.CHATBOT_MODEL || "",

  // ─── Paymob (Egypt Payment Gateway) ──────────────────────
  paymobApiKey: process.env.PAYMOB_API_KEY || "",
  paymobHmacSecret: process.env.PAYMOB_HMAC_SECRET || "",
  paymobBaseUrl: process.env.PAYMOB_BASE_URL || "https://accept.paymob.com/api",
  paymobIntegrationId: process.env.PAYMOB_INTEGRATION_ID || "",
  paymobIntegrationCard: process.env.PAYMOB_INTEGRATION_CARD || "",
  paymobIntegrationWallet: process.env.PAYMOB_INTEGRATION_WALLET || "",
  paymobIntegrationPayPal: process.env.PAYMOB_INTEGRATION_PAYPAL || "",
  paymobIntegrationCash: process.env.PAYMOB_INTEGRATION_CASH || "",
  paymobIntegrationKiosk: process.env.PAYMOB_INTEGRATION_KIOSK || "",

  // ─── Cloudflare R2 (Video Storage) ───────────────────────
  r2AccountId: process.env.R2_ACCOUNT_ID || "",
  r2Bucket: process.env.R2_BUCKET || "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",

  // ─── Video Protection ─────────────────────────────────────
  watermarkSecret: process.env.WATERMARK_SECRET || "",

  // ─── Redis ────────────────────────────────────────────────
  redisUrl: process.env.REDIS_URL || "",
};
