import crypto from "node:crypto";
import { eq, and, sql, lte } from "drizzle-orm";
import { getDb, withTransaction } from "../queries/connection";
import { payments, enrollments, courses } from "@db/schema";
import { env } from "./env";

// Decode API key if it's base64-encoded (HF Secrets are stored as base64)
let PAYMOB_API_KEY = env.paymobApiKey;
try {
  if (PAYMOB_API_KEY && !PAYMOB_API_KEY.startsWith("eyJ")) {
    const decoded = Buffer.from(PAYMOB_API_KEY, "base64").toString("utf-8");
    if (decoded.startsWith("eyJ")) PAYMOB_API_KEY = decoded;
  }
} catch (e) { /* use as-is if decoding fails */ }
const PAYMOB_BASE_URL = env.paymobBaseUrl;
const PAYMOB_HMAC_SECRET = env.paymobHmacSecret;
const PAYMOB_INTEGRATION_ID = env.paymobIntegrationId;
const PAYMENT_EXPIRY_MINUTES = 60;

let cachedAuthToken: { token: string; expiresAt: number } | null = null;
const AUTH_TOKEN_TTL_MS = 50 * 60 * 1000;

export type PaymobPaymentMethod = "visa" | "instapay" | "vodafone_cash" | "wallet" | "bank_transfer" | "paypal" | "kiosk" | "cash_collection" | "other";

// FIX #1: InstaPay uses Card integration (was wrongly mapped to Wallet)
const INTEGRATION_MAP: Record<PaymobPaymentMethod, string> = {
  visa: env.paymobIntegrationCard,
  wallet: env.paymobIntegrationWallet,
  paypal: env.paymobIntegrationPayPal,
  cash_collection: env.paymobIntegrationCash,
  kiosk: env.paymobIntegrationKiosk,
  bank_transfer: env.paymobIntegrationCash,
  instapay: env.paymobIntegrationCard,
  vodafone_cash: env.paymobIntegrationWallet,
  other: PAYMOB_INTEGRATION_ID,
};

// FIX #3: Centralized phone validation (was duplicated 3 times)
function cleanAndValidatePhone(raw: string, context: string): string {
  let phone = (raw || "").replace(/[\s\-\(\)]/g, "");
  if (phone.startsWith("+")) phone = phone.substring(1);
  if (!phone.startsWith("2")) phone = "2" + phone;
  // FIX #2: Throw error instead of dummy 201000000000
  if (!/^2\d{11}$/.test(phone)) {
    throw new Error("Invalid phone for " + context + ': "' + raw + '". Use Egyptian format like 01012345678');
  }
  return phone;
}

// FIX #4: Centralized name splitting (was duplicated 2 times)
function splitNameForPaymob(fullName: string) {
  const parts = (fullName || "Student").trim().split(/\s+/);
  return {
    first: (parts[0] || "Student").substring(0, 50),
    last: (parts.slice(1).join(" ") || "User").substring(0, 50),
  };
}

function getIntegrationId(method: PaymobPaymentMethod): string {
  return INTEGRATION_MAP[method] || PAYMOB_INTEGRATION_ID;
}

export function isPaymobConfigured(): boolean {
  return !!(PAYMOB_API_KEY && PAYMOB_HMAC_SECRET && (
    PAYMOB_INTEGRATION_ID || env.paymobIntegrationCard ||
    env.paymobIntegrationWallet || env.paymobIntegrationPayPal ||
    env.paymobIntegrationCash || env.paymobIntegrationKiosk
  ));
}

export async function getPaymobAuthToken(): Promise<string> {
  if (cachedAuthToken && Date.now() < cachedAuthToken.expiresAt) {
    return cachedAuthToken.token;
  }
  if (!PAYMOB_API_KEY) {
    throw new Error("Paymob API key not configured");
  }
  const response = await fetch(PAYMOB_BASE_URL + "/auth/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: PAYMOB_API_KEY }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error("Paymob auth failed (" + response.status + "): " + text);
  }
  const data = await response.json();
  cachedAuthToken = { token: data.token, expiresAt: Date.now() + AUTH_TOKEN_TTL_MS };
  return data.token;
}

export async function createPaymobOrder(
  authToken: string, amountCents: number, txnId: string,
  userName: string, userEmail: string, userPhone: string,
): Promise<number> {
  const name = splitNameForPaymob(userName);
  const phone = cleanAndValidatePhone(userPhone, "order");
  const response = await fetch(PAYMOB_BASE_URL + "/ecommerce/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: "EGP",
      merchant_order_id: txnId,
      items: [],
      shipping_data: {
        first_name: name.first, last_name: name.last,
        phone_number: phone, email: userEmail || "student@elbaz-platform.com",
        building: "N/A", floor: "N/A", apartment: "N/A",
        street: "N/A", city: "Cairo", country: "EG",
        postal_code: "00000", state: "Cairo",
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error("Paymob order failed (" + response.status + "): " + text);
  }
  return response.json().then(function(d) { return d.id; });
}

export async function generatePaymobPaymentKey(
  authToken: string, paymobOrderId: number, amountCents: number,
  userName: string, userEmail: string, userPhone: string,
  paymentMethod: PaymobPaymentMethod = "visa",
): Promise<string> {
  const integrationId = getIntegrationId(paymentMethod);
  if (!integrationId) {
    throw new Error("Integration ID not configured for: " + paymentMethod);
  }
  const name = splitNameForPaymob(userName);
  const phone = cleanAndValidatePhone(userPhone, "payment key");
  const response = await fetch(PAYMOB_BASE_URL + "/acceptance/payment_keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: authToken, amount_cents: amountCents,
      expiration: PAYMENT_EXPIRY_MINUTES * 60,
      order_id: paymobOrderId,
      billing_data: {
        first_name: name.first, last_name: name.last,
        phone_number: phone, email: userEmail || "student@elbaz-platform.com",
        apartment: "N/A", floor: "N/A", building: "N/A",
        street: "N/A", city: "Cairo", country: "EG",
        postal_code: "00000", state: "Cairo",
      },
      currency: "EGP",
      integration_id: Number(integrationId),
      lock_order_when_paid: true,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error("Paymob payment key failed (" + response.status + "): " + text);
  }
  return response.json().then(function(d) { return d.token; });
}

export async function initiatePaymobPayment(
  amount: string, txnId: string, userName: string,
  userEmail: string, userPhone: string,
  paymentMethod: PaymobPaymentMethod = "visa",
): Promise<{ paymentUrl: string; paymobOrderId: number }> {
  const amountCents = Math.round(parseFloat(amount) * 100);
  if (amountCents <= 0) throw new Error("Amount must be greater than zero");
  const authToken = await getPaymobAuthToken();
  const paymobOrderId = await createPaymobOrder(authToken, amountCents, txnId, userName, userEmail, userPhone);
  const paymentKey = await generatePaymobPaymentKey(authToken, paymobOrderId, amountCents, userName, userEmail, userPhone, paymentMethod);
  const integrationId = getIntegrationId(paymentMethod);
  return {
    paymentUrl: PAYMOB_BASE_URL + "/acceptance/iframes/" + integrationId + "?payment_token=" + paymentKey,
    paymobOrderId: paymobOrderId,
  };
}

export function verifyPaymobHmac(queryParams: Record<string, string>): boolean {
  if (!PAYMOB_HMAC_SECRET) {
    console.error("[PAYMOB] HMAC verification disabled");
    return false;
  }
  const hmac = queryParams.hmac;
  if (!hmac) return false;
  var fields = [
    "amount_cents","created_at","currency","error_occured",
    "has_parent_transaction","id","integration_id","is_3d_secure",
    "is_auth","is_capture","is_refunded","is_standalone_payment",
    "is_voided","order","owner","pending","source_data_pan",
    "source_data_sub_type","source_data_type","success",
  ];
  var concatenated = fields.map(function(f) { return queryParams[f] || ""; }).join("");
  var calculated = crypto.createHmac("sha512", PAYMOB_HMAC_SECRET).update(concatenated).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(calculated, "hex"));
  } catch (e) {
    return false;
  }
}

export async function confirmPaymentAndEnroll(
  txnId: string, paymobTxnId: string, paymobOrderId: number,
): Promise<{ success: boolean; userId: number; courseId: number; isNewEnrollment: boolean }> {
  return await withTransaction(async function(tx) {
    var rows = await tx.select().from(payments)
      .where(and(eq(payments.transactionId, txnId), eq(payments.status, "pending"))).limit(1);
    var payment = rows[0];
    if (!payment) throw new Error("No pending payment found: " + txnId);
    if (payment.paymobOrderId && Number(payment.paymobOrderId) !== paymobOrderId) {
      throw new Error("Order ID mismatch: " + txnId);
    }
    await tx.update(payments)
      .set({ status: "completed", paidAt: new Date(), gatewayTxnId: paymobTxnId })
      .where(eq(payments.id, payment.id));
    var existing = await tx.select({ id: enrollments.id }).from(enrollments)
      .where(and(eq(enrollments.userId, payment.userId), eq(enrollments.courseId, payment.courseId))).limit(1);
    var isNew = false;
    if (!existing[0]) {
      await tx.insert(enrollments).values({
        userId: payment.userId, courseId: payment.courseId, progress: 0, isCompleted: false,
      });
      await tx.update(courses)
        .set({ studentCount: sql`${courses.studentCount} + 1` })
        .where(eq(courses.id, payment.courseId));
      isNew = true;
    }
    return { success: true, userId: payment.userId, courseId: payment.courseId, isNewEnrollment: isNew };
  });
}
// === PART 2: Paste BELOW part 1 in the same file ===

export async function refundPaymobPayment(
  paymentId: number,
  adminAuthToken?: string,
): Promise<{ success: boolean; refundId?: string }> {
  var db = getDb();
  var rows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  var payment = rows[0];
  if (!payment) throw new Error("Payment not found: " + paymentId);
  if (payment.status !== "completed") throw new Error("Cannot refund: " + payment.status);
  if (!payment.gatewayTxnId) throw new Error("No gateway transaction ID");
  if (!payment.paymobOrderId) throw new Error("No Paymob order ID");
  var authToken = adminAuthToken || await getPaymobAuthToken();
  var res = await fetch(PAYMOB_BASE_URL + "/acceptance/refunds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: authToken,
      txn: Number(payment.gatewayTxnId),
      amount_cents: Math.round(parseFloat(String(payment.amount)) * 100),
    }),
  });
  if (!res.ok) {
    var text = await res.text();
    throw new Error("Paymob refund failed (" + res.status + "): " + text);
  }
  var refundData = await res.json();
  await withTransaction(async function(tx) {
    await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, paymentId));
    await tx.delete(enrollments)
      .where(and(eq(enrollments.userId, payment.userId), eq(enrollments.courseId, payment.courseId)));
    await tx.update(courses)
      .set({ studentCount: sql`${courses.studentCount} - 1` })
      .where(eq(courses.id, payment.courseId));
  });
  return { success: true, refundId: String(refundData.id || refundData.txn_ref || "N/A") };
}

export async function expireOldPayments(): Promise<number> {
  var db = getDb();
  var expiryTime = new Date(Date.now() - PAYMENT_EXPIRY_MINUTES * 60 * 1000);
  var result = await db.update(payments).set({ status: "expired" })
    .where(and(eq(payments.status, "pending"), lte(payments.expiresAt, expiryTime)));
  return result[0]?.affectedRows || 0;
}