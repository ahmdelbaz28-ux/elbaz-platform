import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../lib/env.js";

/**
 * Paymob integration ID mapping per payment method.
 * Set these in HF Secrets to support multiple payment methods.
 * Falls back to PAYMOB_INTEGRATION_ID if no method-specific ID is set.
 */
const PAYMENT_METHOD_INTEGRATION_IDS: Record<string, string> = {
  visa: "PAYMOB_INTEGRATION_ID_CARD",
  instapay: "PAYMOB_INTEGRATION_ID_CARD",
  vodafone_cash: "PAYMOB_INTEGRATION_ID_WALLET",
  wallet: "PAYMOB_INTEGRATION_ID_WALLET",
  bank_transfer: "PAYMOB_INTEGRATION_ID_BANK",
  kiosk: "PAYMOB_INTEGRATION_ID_KIOSK",
  cash_collection: "PAYMOB_INTEGRATION_ID_CASH",
};

function getIntegrationIdForMethod(paymentMethod: string): number {
  const envKey = PAYMENT_METHOD_INTEGRATION_IDS[paymentMethod];
  if (envKey) {
    const val = (process.env as Record<string, string | undefined>)[envKey];
    if (val) return parseInt(val, 10);
  }
  // Fallback to default integration ID
  return env.PAYMOB_INTEGRATION_ID ?? 0;
}

interface PaymobWebhookPayload {
  type: string;
  obj: {
    id: number;
    amount: string;
    amount_cents: number;
    currency: string;
    created_at: string;
    error_occured: boolean;
    has_parent_transaction: boolean;
    integration_id: number;
    is_3d_secure: boolean;
    is_auth: boolean;
    is_capture: boolean;
    is_refunded: boolean;
    is_standalone_payment: boolean;
    is_voided: boolean;
    order: {
      id: number;
      merchant_order_id: string;
      created_at: string;
    };
    owner?: number;
    pending?: boolean;
    payment_key_claims: {
      id: number;
    };
    source_data: {
      type: string;
      sub_type: string;
      pan: string;
    };
    success: boolean;
    is_live: boolean;
    acq_response_code: string;
  };
  hmac: string;
}

function buildPaymobHmacString(payload: PaymobWebhookPayload): string {
  const obj = payload.obj;
  const fields = [
    (obj.amount_cents ?? 0).toString(),
    obj.created_at,
    obj.currency,
    (obj.error_occured ?? false).toString(),
    (obj.has_parent_transaction ?? false).toString(),
    obj.id.toString(),
    (obj.integration_id ?? 0).toString(),
    (obj.is_3d_secure ?? false).toString(),
    (obj.is_auth ?? false).toString(),
    (obj.is_capture ?? false).toString(),
    (obj.is_refunded ?? false).toString(),
    (obj.is_standalone_payment ?? false).toString(),
    (obj.is_voided ?? false).toString(),
    obj.order.id.toString(),
    obj.order.created_at,
    obj.order.merchant_order_id,
    (obj.owner ?? 0).toString(),
    (obj.pending ?? false).toString(),
    obj.source_data.pan,
    obj.source_data.sub_type,
    obj.source_data.type,
    obj.success.toString(),
  ];
  return fields.join("");
}

function verifyPaymobWebhook(payload: PaymobWebhookPayload): boolean {
  if (!payload.hmac || !env.PAYMOB_HMAC_SECRET) return false;
  try {
    const hmacString = buildPaymobHmacString(payload);
    const expected = createHmac("sha512", env.PAYMOB_HMAC_SECRET)
      .update(hmacString)
      .digest("hex");

    return timingSafeEqual(
      Buffer.from(payload.hmac, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

function verifyPaymobAmount(
  webhookAmount: string | number,
  expectedAmount: number,
  expectedCurrency: string
): boolean {
  const amount = typeof webhookAmount === "string" ? parseFloat(webhookAmount) : webhookAmount;
  if (isNaN(amount)) return false;
  const amountCents = Math.round(amount * 100);
  const expectedCents = Math.round(expectedAmount * 100);
  return amountCents === expectedCents && expectedCurrency === "EGP";
}

interface PaymobTransactionResponse {
  success: boolean;
  transaction_id: number;
  amount: number;
  currency: string;
  order_id: number;
  created_at: string;
  is_refunded: boolean;
  is_voided: boolean;
}

interface PaymobAuthResponse {
  token: string;
}

interface PaymobOrderResponse {
  id: number;
  order_id?: string;
  created_at?: string;
}

interface PaymobPaymentKeyResponse {
  token: string;
}

async function verifyPaymobTransaction(transactionId: number): Promise<PaymobTransactionResponse | null> {
  try {
    const baseUrl = env.PAYMOB_BASE_URL;
    const authResponse = await fetch(`${baseUrl}/api/auth/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.PAYMOB_API_KEY }),
    });
    const authData = (await authResponse.json()) as PaymobAuthResponse;
    const token = authData.token;
    if (!token) return null;

    const txnResponse = await fetch(
      `${baseUrl}/api/acceptance/transactions/${transactionId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const txn = await txnResponse.json() as Record<string, unknown>;

    return {
      success: (txn.success as boolean) ?? false,
      transaction_id: txn.id as number,
      amount: parseFloat((txn.amount_cents as number | string | undefined ?? 0).toString()) / 100,
      currency: (txn.currency as string) ?? "EGP",
      order_id: (txn.order as { id: number } | undefined)?.id ?? 0,
      created_at: (txn.created_at as string) ?? new Date().toISOString(),
      is_refunded: (txn.is_refunded as boolean) ?? false,
      is_voided: (txn.is_voided as boolean) ?? false,
    };
  } catch (error) {
    console.error("[Paymob] Transaction verification failed:", error);
    return null;
  }
}

function isPaymobConfigured(): boolean {
  return !!(
    env.PAYMOB_API_KEY &&
    env.PAYMOB_INTEGRATION_ID &&
    env.PAYMOB_HMAC_SECRET
  );
}

interface PaymobPaymentResult {
  paymentUrl: string;
  paymobOrderId: number;
}

async function initiatePaymobPayment(
  amount: string | number,
  merchantOrderId: string,
  name: string,
  email: string,
  phone: string,
  paymentMethod: string
): Promise<PaymobPaymentResult> {
  if (!isPaymobConfigured()) {
    throw new Error("Paymob is not configured");
  }

  const amountNum = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error("Invalid payment amount");
  }

  const baseUrl = env.PAYMOB_BASE_URL;

  const authRes = await fetch(`${baseUrl}/api/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: env.PAYMOB_API_KEY }),
  });
  const authData = (await authRes.json()) as PaymobAuthResponse;
  const token = authData.token;
  if (!token) throw new Error("Paymob authentication failed");

  const orderRes = await fetch(`${baseUrl}/api/ecommerce/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: token,
      delivery_needed: "false",
      amount_cents: Math.round(amountNum * 100),
      currency: "EGP",
      merchant_order_id: merchantOrderId,
      items: [],
    }),
  });
  const orderData = (await orderRes.json()) as PaymobOrderResponse;
  if (!orderData.id) throw new Error("Failed to create Paymob order");

  const integrationId = getIntegrationIdForMethod(paymentMethod);

  if (!integrationId) {
    throw new Error(`No Paymob integration ID configured for payment method: ${paymentMethod}. Set PAYMOB_INTEGRATION_ID or method-specific env var.`);
  }

  const paymentKeyRes = await fetch(`${baseUrl}/api/acceptance/payment_keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: token,
      amount_cents: Math.round(amountNum * 100),
      expiration: 3600,
      order_id: orderData.id,
      billing_data: {
        first_name: name?.split(" ")[0] ?? "",
        last_name: name?.split(" ").slice(1).join(" ") ?? "",
        email: email ?? "",
        phone_number: phone ?? "",
        street: "",
        building: "",
        floor: "",
        apartment: "",
        city: "",
        country: "EG",
      },
      currency: "EGP",
      integration_id: Number(integrationId),
      lock_order_when_paid: "true",
    }),
  });
  const paymentKeyData = (await paymentKeyRes.json()) as PaymobPaymentKeyResponse;
  if (!paymentKeyData.token) throw new Error("Failed to generate payment key");

  const paymentUrl = `${baseUrl}/api/acceptance/iframes/${env.PAYMOB_IFRAME_ID}?payment_token=${paymentKeyData.token}`;

  return { paymentUrl, paymobOrderId: orderData.id };
}

export {
  verifyPaymobWebhook,
  verifyPaymobAmount,
  verifyPaymobTransaction,
  buildPaymobHmacString,
  initiatePaymobPayment,
  isPaymobConfigured,
};
export type { PaymobWebhookPayload, PaymobTransactionResponse };
