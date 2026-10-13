/**
 * Paymob integration — official Intention API + Unified Checkout.
 *
 * Sources (verified 2026-10):
 * - Official Paymob AI Integration Skill (github.com/PaymobAccept/Paymob-AI-Integration-Skill)
 * - Official Postman collection "Intention APIs" (github.com/PaymobAccept/API-Postman-Collections)
 *
 * Why the rewrite: the previous implementation targeted the LEGACY Accept flow
 * (auth → order → payment key → iframe) which requires an iframe ID and an old
 * 64-hex API key. Accounts onboarded on the new Paymob dashboard (JWT "API Key"
 * + egy_sk_... secret key) are Intention-API-only: the legacy auth endpoint
 * rejects their keys (verified live: `{"detail":"incorrect credentials"}`) and
 * no iframe exists. That mismatch was the root cause of "payments disabled".
 *
 * Flow (all server-side):
 *   1. POST {base}/v1/intention/   Authorization: Token <SECRET_KEY>
 *      → { id, intention_order_id, client_secret }
 *   2. Redirect customer to {base}/unifiedcheckout/?publicKey=…&clientSecret=…
 *   3. Paymob POSTs the transaction to notification_url with ?hmac=… (query param)
 *      → verify HMAC-SHA512 over 20 concatenated fields, then enroll.
 *
 * This module is pure (no DB) so the crypto and request shaping stay unit-testable.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "./logger.js";

/** Default regional base URL for Egypt accounts (test and live share it — mode is key-driven). */
export const PAYMOB_EGYPT_BASE_URL = "https://accept.paymob.com";

/** Runtime configuration resolved from env (+ admin-editable site settings fallback). */
export interface PaymobRuntimeConfig {
  /** Secret key (egy_sk_… / sk_…) — server-only. */
  secretKey: string;
  /** Public key (pk_… / egy_pk_…) — safe client-side, needed to launch Unified Checkout. */
  publicKey: string;
  /** HMAC secret for webhook verification (Dashboard → Settings → API Keys). */
  hmacSecret: string;
  /** Card (online) integration ID — Settings → Payment Integrations. */
  cardIntegrationId: number | null;
  /** Mobile wallet integration ID (Vodafone Cash etc.). */
  walletIntegrationId: number | null;
  /** Regional gateway base, no trailing slash. */
  baseUrl: string;
  /** Public site origin used for notification_url / redirection_url. */
  frontendUrl: string;
}

/**
 * Enumerate the missing pieces of a runtime config, in operator-actionable order.
 * Empty list = fully configured and ready to create real intentions.
 */
export function summarizePaymobConfig(
  cfg: Pick<PaymobRuntimeConfig, "secretKey" | "publicKey" | "hmacSecret" | "cardIntegrationId" | "walletIntegrationId">,
): string[] {
  const missing: string[] = [];
  if (!cfg.secretKey) missing.push("PAYMOB_SECRET_KEY");
  if (!cfg.publicKey) missing.push("Paymob Public Key (env PAYMOB_PUBLIC_KEY or dashboard setting paymob_public_key)");
  if (!cfg.hmacSecret) missing.push("PAYMOB_HMAC_SECRET");
  if (cfg.cardIntegrationId === null && cfg.walletIntegrationId === null) {
    missing.push("at least one Integration ID (env PAYMOB_INTEGRATION_CARD / PAYMOB_INTEGRATION_WALLET or dashboard settings paymob_integration_card / paymob_integration_wallet)");
  }
  return missing;
}

/** True when every value needed to create a real intention is present. */
export function isPaymobConfigComplete(
  cfg: Pick<PaymobRuntimeConfig, "secretKey" | "publicKey" | "hmacSecret" | "cardIntegrationId" | "walletIntegrationId">,
): boolean {
  return summarizePaymobConfig(cfg).length === 0;
}

/**
 * Pick the integration IDs that apply to a requested payment method.
 * - "visa" / card-ish methods → card integration.
 * - "vodafone_cash" / "wallet" → wallet integration.
 * - Unmapped methods (e.g. "other") → every configured integration, letting the
 *   customer choose on the Paymob-hosted checkout page.
 * Returns [] when nothing applies (caller surfaces a config error).
 */
export function integrationIdsForMethod(
  cfg: Pick<PaymobRuntimeConfig, "cardIntegrationId" | "walletIntegrationId">,
  paymentMethod: string,
): number[] {
  const walletMethods = new Set(["vodafone_cash", "wallet"]);
  if (walletMethods.has(paymentMethod)) {
    return cfg.walletIntegrationId !== null ? [cfg.walletIntegrationId] : [];
  }
  if (paymentMethod === "visa" || paymentMethod === "instapay") {
    return cfg.cardIntegrationId !== null ? [cfg.cardIntegrationId] : [];
  }
  const ids: number[] = [];
  if (cfg.cardIntegrationId !== null) ids.push(cfg.cardIntegrationId);
  if (cfg.walletIntegrationId !== null) ids.push(cfg.walletIntegrationId);
  return ids;
}

// ─── Intention creation ────────────────────────────────────────────────

export interface CreateIntentionInput {
  /** Amount in EGP (decimal string or number) — converted to integer cents here. */
  amount: string | number;
  /** Line item label shown on the Paymob checkout page (course title). */
  itemName: string;
  /** Our transaction id — echoed back as `merchant_order_id` in callbacks. */
  specialReference: string;
  customer: { firstName: string; lastName: string; email: string; phone: string };
  /** Requested payment method — selects the integration ID(s). */
  paymentMethod: string;
  /** Arbitrary data echoed back in the callback claims. */
  extras?: Record<string, unknown>;
  /** Where Paymob sends the customer after payment — defaults to the site origin. */
  redirectionUrl?: string;
}

export interface CreateIntentionResult {
  intentionId: number;
  paymobOrderId: number;
  clientSecret: string;
  checkoutUrl: string;
}

/** Convert an EGP amount to integer piasters without float drift. */
export function toAmountCents(amount: string | number): number {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function intentionBaseUrl(cfg: PaymobRuntimeConfig): string {
  return (cfg.baseUrl || PAYMOB_EGYPT_BASE_URL).replace(/\/+$/, "");
}

/** Build the hosted-checkout redirect URL from a client secret (official shape). */
export function buildCheckoutUrl(cfg: PaymobRuntimeConfig, clientSecret: string): string {
  return `${intentionBaseUrl(cfg)}/unifiedcheckout/?publicKey=${encodeURIComponent(cfg.publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
}

interface IntentionApiResponse {
  id?: number;
  intention_order_id?: number;
  client_secret?: string;
  detail?: string;
  message?: string;
}

/**
 * Create a payment intention and return the hosted-checkout URL.
 * Uses the official contract: `Authorization: Token <secret>`, amounts in
 * cents, `special_reference` for correlation, phone number mandatory.
 */
async function createIntention(
  cfg: PaymobRuntimeConfig,
  input: CreateIntentionInput,
): Promise<CreateIntentionResult> {
  const amountCents = toAmountCents(input.amount);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Invalid payment amount");
  }

  const paymentMethods = integrationIdsForMethod(cfg, input.paymentMethod);
  if (paymentMethods.length === 0) {
    throw new Error(
      `No Paymob integration ID is configured for payment method "${input.paymentMethod}". Add it in Dashboard → Settings → Payment Integrations, then set it in the admin dashboard.`,
    );
  }

  const firstName = input.customer.firstName?.trim() || "Customer";
  const lastName = input.customer.lastName?.trim() || firstName;
  // phone_number is REQUIRED by Paymob — fall back to a placeholder so a
  // missing frontend field can never 400 the whole checkout.
  const phone = input.customer.phone?.trim() || "+201000000000";

  const body = {
    amount: amountCents,
    currency: "EGP",
    payment_methods: paymentMethods,
    items: [{ name: input.itemName, amount: amountCents, quantity: 1 }],
    billing_data: {
      first_name: firstName,
      last_name: lastName,
      email: input.customer.email || "customer@example.com",
      phone_number: phone,
      apartment: "NA",
      floor: "NA",
      street: "NA",
      building: "NA",
      shipping_method: "NA",
      postal_code: "NA",
      city: "NA",
      state: "NA",
      country: "EGY",
    },
    customer: { first_name: firstName, last_name: lastName, email: input.customer.email || "customer@example.com" },
    special_reference: input.specialReference,
    expiration: 3600,
    notification_url: `${cfg.frontendUrl}/api/paymob/webhook`,
    redirection_url: input.redirectionUrl || cfg.frontendUrl,
    extras: input.extras ?? {},
  };

  const res = await fetch(`${intentionBaseUrl(cfg)}/v1/intention/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${cfg.secretKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as IntentionApiResponse;

  if (!res.ok || !data.client_secret) {
    // Surface Paymob's own error text (e.g. "Integration ID/Name does not exist…")
    // so the admin dashboard shows the actionable cause, not a generic failure.
    const detail = data.detail || data.message || `HTTP ${res.status}`;
    logger.error("[Paymob] Intention creation failed", { status: res.status, detail, paymentMethod: input.paymentMethod });
    throw new Error(`Paymob intention failed: ${detail}`);
  }

  const checkoutUrl = buildCheckoutUrl(cfg, data.client_secret);
  logger.info("[Paymob] Intention created", {
    intentionId: data.id,
    paymobOrderId: data.intention_order_id,
    specialReference: input.specialReference,
    methods: paymentMethods,
  });

  return {
    intentionId: Number(data.id ?? 0),
    paymobOrderId: Number(data.intention_order_id ?? 0),
    clientSecret: data.client_secret,
    checkoutUrl,
  };
}

// ─── Webhook verification (Transaction Processed callback) ─────────────

export interface PaymobCallbackTransaction {
  id: number;
  amount_cents: number;
  created_at: string;
  currency: string;
  error_occured: boolean;
  has_parent_transaction: boolean;
  integration_id: number;
  is_3d_secure: boolean;
  is_auth: boolean;
  is_capture: boolean;
  is_refunded: boolean;
  is_standalone_payment: boolean;
  is_voided: boolean;
  order: { id: number; merchant_order_id?: string; created_at?: string };
  owner?: number;
  pending?: boolean;
  source_data?: { type?: string; sub_type?: string; pan?: string };
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PaymobCallbackPayload {
  type?: string;
  obj?: PaymobCallbackTransaction;
  hmac?: string;
}

/**
 * Concatenate the 20 documented transaction fields, in the exact official
 * order, using raw values as received (no date reformatting, no rounding).
 * Order (NOT alphabetical — Paymob's documented concatenation order):
 *   amount_cents, created_at, currency, error_occured, has_parent_transaction,
 *   id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded,
 *   is_standalone_payment, is_voided, order.id, owner, pending,
 *   source_data.pan, source_data.sub_type, source_data.type, success
 */
export function buildTransactionHmacString(obj: PaymobCallbackTransaction): string {
  const fields: unknown[] = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    obj.order?.id,
    obj.owner,
    obj.pending,
    obj.source_data?.pan,
    obj.source_data?.sub_type,
    obj.source_data?.type,
    obj.success,
  ];
  return fields.map((f) => (f === undefined || f === null ? "" : String(f))).join("");
}

/** Constant-time hex comparison that never throws on length mismatch. */
function safeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Transaction Processed callback.
 * The official transport puts the HMAC on the URL (`?hmac=…`); the legacy
 * Accept flow embedded it in the body — both are accepted, query param first.
 */
export function verifyTransactionCallback(
  payload: PaymobCallbackPayload,
  receivedHmac: string | undefined,
  hmacSecret: string,
): boolean {
  const hmac = (receivedHmac ?? "").trim() || (payload.hmac ?? "").trim();
  if (!hmac || !hmacSecret || !payload.obj) return false;
  try {
    const computed = createHmac("sha512", hmacSecret)
      .update(buildTransactionHmacString(payload.obj))
      .digest("hex")
      .toLowerCase();
    return safeHexEqual(computed, hmac.toLowerCase());
  } catch (error) {
    logger.error("[Paymob] HMAC verification error", { error: String(error) });
    return false;
  }
}

/**
 * Verify the callback amount matches what we recorded (anti partial-payment).
 * Compares integer cents to avoid float artifacts, and pins currency to EGP.
 */
export function verifyPaymobAmount(
  webhookAmountCents: number,
  expectedAmount: string | number,
  expectedCurrency: string,
): boolean {
  if (!Number.isFinite(webhookAmountCents)) return false;
  const expectedCents = toAmountCents(expectedAmount);
  if (!Number.isInteger(expectedCents)) return false;
  return webhookAmountCents === expectedCents && expectedCurrency === "EGP";
}

export {
  createIntention,
};
