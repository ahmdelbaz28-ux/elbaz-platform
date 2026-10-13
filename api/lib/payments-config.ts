/**
 * DB-backed resolution of the Paymob runtime configuration.
 *
 * Split out of payment-router.ts so the admin self-test (admin-payments.ts)
 * and the public config status (payment-router.ts) share one source of truth.
 *
 * Precedence: env var → siteSettings (section "payments", admin-editable).
 * The Secret Key + HMAC secret are env-only by design (never stored in DB).
 */

import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { siteSettings } from "@db/schema";
import { env } from "./env";
import {
  mapManualDetailsFromSettings,
  PAYMENT_SETTINGS_SECTION,
  type ManualPaymentDetails,
} from "./payments-core";
import type { PaymobRuntimeConfig } from "./paymob";

/** Read manual payment details from siteSettings (section "payments"). */
async function getManualPaymentDetails(): Promise<ManualPaymentDetails> {
  const db = getDb();
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.section, PAYMENT_SETTINGS_SECTION));
  return mapManualDetailsFromSettings(rows);
}

/** Parse an admin-entered integration ID; empty/invalid → null. */
function parseIntSetting(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resolve the full Paymob runtime config. env.PAYMOB_BASE_URL defaults to the
 * Egypt gateway; FRONTEND_URL hosts the webhook + return URLs.
 */
async function resolvePaymobRuntimeConfig(): Promise<PaymobRuntimeConfig> {
  const details = await getManualPaymentDetails();
  return {
    secretKey: env.PAYMOB_SECRET_KEY ?? "",
    publicKey: env.PAYMOB_PUBLIC_KEY?.trim() || details.paymobPublicKey,
    hmacSecret: env.PAYMOB_HMAC_SECRET ?? "",
    // Legacy-session credential — env-only by design (it is a secret).
    apiKey: env.PAYMOB_API_KEY ?? "",
    cardIntegrationId: env.PAYMOB_INTEGRATION_CARD ?? parseIntSetting(details.paymobIntegrationCard),
    walletIntegrationId: env.PAYMOB_INTEGRATION_WALLET ?? parseIntSetting(details.paymobIntegrationWallet),
    walletIframeId: env.PAYMOB_IFRAME_ID ?? parseIntSetting(details.paymobWalletIframe),
    baseUrl: env.PAYMOB_BASE_URL,
    frontendUrl: env.FRONTEND_URL,
  };
}

export { getManualPaymentDetails, parseIntSetting, resolvePaymobRuntimeConfig };
