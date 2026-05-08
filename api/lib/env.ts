// Environment configuration — all app settings centralized here
export const env = {
  isProduction: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT || "7860"),
  databaseUrl: process.env.DATABASE_URL || "",
  corsOrigins: process.env.CORS_ORIGINS || "",
  appSecret: process.env.APP_SECRET || "",
  frontendUrl: process.env.FRONTEND_URL || "",
  emailProvider: process.env.EMAIL_PROVIDER || "console",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "noreply@elbaz.com",
  chatbotApiKey: process.env.CHATBOT_API_KEY || "",
  chatbotApiBase: process.env.CHATBOT_API_BASE || "",
  chatbotModel: process.env.CHATBOT_MODEL || "",
  paymobApiKey: process.env.PAYMOB_API_KEY || "",
  paymobHmacSecret: process.env.PAYMOB_HMAC_SECRET || "",
  paymobBaseUrl: process.env.PAYMOB_BASE_URL || "https://accept.paymob.com/api",
  paymobIntegrationId: process.env.PAYMOB_INTEGRATION_ID || "",
  paymobIntegrationCard: process.env.PAYMOB_INTEGRATION_CARD || "",
  paymobIntegrationPayPal: process.env.PAYMOB_INTEGRATION_PAYPAL || "",
  paymobIntegrationWallet: process.env.PAYMOB_INTEGRATION_WALLET || "",
  paymobIntegrationCash: process.env.PAYMOB_INTEGRATION_CASH || "",
  paymobIntegrationKiosk: process.env.PAYMOB_INTEGRATION_KIOSK || "",

  // Cloudflare R2 Storage
  r2AccountId: process.env.R2_ACCOUNT_ID || "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  r2Bucket: process.env.R2_BUCKET || "elbaz-videos",
  r2Endpoint: process.env.R2_ENDPOINT || "",
  watermarkSecret: process.env.WATERMARK_SECRET || "",

  // Redis (distributed cache + rate limiting)
  redisUrl: process.env.REDIS_URL || "",

  // SendGrid (email delivery)
  sendgridApiKey: process.env.SENDGRID_API_KEY || "",

  // Cloudflare API Token (Workers, R2 management, DNS)
  cloudflareToken: process.env.CLOUDFLARE_TOKEN || "",

  // Microsoft Clarity Analytics
  clarityId: process.env.CLARITY_ID || "",
  clarityExportJwt: process.env.CLARITY_EXPORT_JWT || "",

  // Aiven Platform API (for service management & monitoring)
  aivenToken: process.env.AIVEN_TOKEN || "",
  aivenProject: process.env.AIVEN_PROJECT || "ahmdelbaz",

  // Sentry Error Tracking
  sentryDsn: process.env.SENTRY_DSN || "",
};
