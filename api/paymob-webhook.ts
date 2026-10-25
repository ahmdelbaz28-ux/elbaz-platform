/**
 * Paymob Webhook Handler
 *
 * This module handles POST /api/paymob/webhook — the endpoint that Paymob
 * calls when a payment is completed, failed, or refunded.
 *
 * Flow:
 * 1. Paymob sends a POST with the payment payload + HMAC signature
 * 2. We verify the HMAC to confirm it's genuinely from Paymob
 * 3. We look up the payment by merchant_order_id (our transactionId)
 * 4. We update the payment status and create the enrollment if successful
 * 5. We return 200 immediately (Paymob retries on non-200)
 *
 * Security:
 * - HMAC-SHA512 signature verification
 * - Amount verification (prevent partial payment attacks)
 * - Idempotent enrollment creation (unique constraint on userId+courseId)
 * - Rate limiting on the endpoint
 */

import { Hono, type Context } from "hono";
import { eq, sql, and, or } from "drizzle-orm";
import { db } from "./queries/connection.js";
import { payments, enrollments, courses } from "@db/schema";
import { verifyTransactionCallback, verifyPaymobAmount, type PaymobCallbackPayload, type PaymobCallbackTransaction } from "./lib/paymob.js";
import { env } from "./lib/env.js";
import { invalidateCourseCache, invalidateStatsCache } from "./lib/cache.js";
import { releasePromoUsageForPayment } from "./promo-router.js";
import { invalidateSitemapCache } from "./boot.js";
import { logger } from "./lib/logger.js";

const paymobWebhook = new Hono();

/**
 * Compute the new payment status based on webhook flags.
 */
function computeNewPaymentStatus(isSuccess: boolean, isRefunded: boolean, isVoided: boolean): string {
  const successStatus = isSuccess ? "completed" : "failed";
  const voidedStatus = isVoided ? "failed" : successStatus;
  return isRefunded ? "refunded" : voidedStatus;
}

/**
 * Verify the callback amount matches our recorded amount (prevent partial-payment attacks).
 * Returns null on success, or an error Response on mismatch.
 */
async function verifyWebhookAmount(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], paymentRecord: { finalAmount: string | null; amount: string }, obj: PaymobCallbackTransaction, merchantOrderId: string): Promise<Response | null> {
  const expectedAmount = Number.parseFloat(String(paymentRecord.finalAmount ?? paymentRecord.amount));
  const webhookAmountCents = Number(obj.amount_cents);
  const amountValid = verifyPaymobAmount(webhookAmountCents, expectedAmount, "EGP");
  if (amountValid) return null;

  logger.error(`[Paymob Webhook] Amount mismatch`, { expectedAmount, webhookAmountCents, merchantOrderId });
  // Block payment — mark as failed to prevent partial-payment attacks
  await tx
    .update(payments)
    .set({ status: "failed", providerPaymentId: String(obj.id) })
    .where(eq(payments.transactionId, merchantOrderId));
  return new Response(JSON.stringify({ ok: false, error: "Amount mismatch" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create the user's enrollment if it doesn't already exist (idempotent),
 * bump the course's student count, and invalidate caches.
 */
async function createEnrollmentIfMissing(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  paymentRecord: { userId: number | string; courseId: number | string },
): Promise<void> {
  const existingEnrollment = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, Number(paymentRecord.userId)),
        eq(enrollments.courseId, Number(paymentRecord.courseId))
      )
    )
    .limit(1);

  if (existingEnrollment.length > 0) return;

  // Create enrollment
  await tx.insert(enrollments).values({
    userId: Number(paymentRecord.userId),
    courseId: Number(paymentRecord.courseId),
    progress: "0.00",
    isCompleted: false,
  });

  // Update course enrolled count
  await tx
    .update(courses)
    .set({
      studentCount: sql`${courses.studentCount} + 1`,
    })
    .where(eq(courses.id, Number(paymentRecord.courseId)));

  logger.info(`[Paymob Webhook] Enrollment created`, { userId: paymentRecord.userId, courseId: paymentRecord.courseId });
}

/**
 * Run the payment-update + enrollment-creation logic inside the transaction.
 * Returns the JSON response to send to Paymob.
 */
async function processWebhookInTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  obj: PaymobCallbackTransaction,
  merchantOrderId: string,
  isSuccess: boolean,
  isRefunded: boolean,
  isVoided: boolean,
): Promise<Response> {
  // ── Step 2: Find our payment record by transactionId ──
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(eq(payments.transactionId, merchantOrderId))
    .limit(1);

  const paymentRecord = paymentRows[0];

  if (!paymentRecord) {
    logger.warn(`[Paymob Webhook] Payment not found`, { merchantOrderId });
    return c.json({ ok: true, message: "Transaction not found" }, 200);
  }

  // ── Step 3: Skip if already processed (idempotency) ──
  if (paymentRecord.status === "completed" && !isRefunded && !isVoided) {
    logger.info(`[Paymob Webhook] Payment already completed, skipping`, { merchantOrderId });
    return c.json({ ok: true, message: "Already processed" }, 200);
  }

  // ── Step 4: Verify amount matches what we expect ──
  if (isSuccess) {
    const amountMismatch = await verifyWebhookAmount(tx, paymentRecord, obj, merchantOrderId);
    if (amountMismatch) return amountMismatch;
  }

  // ── Step 5: Update payment status ──
  const newStatus = computeNewPaymentStatus(isSuccess, isRefunded, isVoided);

  await tx
    .update(payments)
    .set({
      status: newStatus,
      providerPaymentId: String(obj.id),
      paidAt: isSuccess ? new Date() : null,
    })
    .where(eq(payments.transactionId, merchantOrderId));

  logger.info(`[Paymob Webhook] Payment status updated`, { merchantOrderId, newStatus });

  // ✅ SECURITY FIX (audit run-1): propagate revocation to the enrollment on
  // refund/void. Previously only payments.status changed — the enrollment row
  // kept satisfying the row-existence gate in course-watching.ts forever, so
  // refunded students retained full premium video access indefinitely.
  if (isRefunded || isVoided) {
    await tx
      .update(enrollments)
      .set({ status: "refunded" })
      .where(
        and(
          eq(enrollments.userId, Number(paymentRecord.userId)),
          eq(enrollments.courseId, Number(paymentRecord.courseId)),
        ),
      );
    logger.info(`[Paymob Webhook] Enrollment revoked after refund/void`, { merchantOrderId, newStatus });

    // ✅ SECURITY FIX (audit run-1, payments.promo-quota-burn): release the
    // promo quota this payment consumed — refunds/voids must return the
    // discount to the shared budget.
    await releasePromoUsageForPayment(Number(paymentRecord.id), Number(paymentRecord.userId));
  }

  // ── Step 6: Create enrollment if payment successful ──
  if (isSuccess && newStatus === "completed") {
    await createEnrollmentIfMissing(tx, paymentRecord);

    // Invalidate caches (outside transaction logic but within handler)
    await invalidateCourseCache();
    await invalidateStatsCache();
    invalidateSitemapCache();
  }

  return c.json({ ok: true, status: newStatus }, 200);
}

const handlePaymobWebhook = async (c: Context) => {
  const contentType = c.req.header("content-type") ?? "";

  // Paymob sends JSON
  if (!contentType.includes("application/json")) {
    logger.warn("[Paymob Webhook] Invalid content-type", { contentType });
    return c.json({ error: "Invalid content type" }, 400);
  }

  let payload: PaymobCallbackPayload;
  try {
    payload = await c.req.json();
  } catch {
    logger.warn("[Paymob Webhook] Failed to parse JSON body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // ── Step 1: Verify HMAC signature ──
  // Official Intention-API callbacks carry the HMAC on the URL (?hmac=…);
  // legacy Accept callbacks embedded it in the body — both are accepted.
  const queryHmac = c.req.query("hmac");
  if (!verifyTransactionCallback(payload, queryHmac, env.PAYMOB_HMAC_SECRET ?? "")) {
    logger.warn("[Paymob Webhook] HMAC verification failed — possible tampering or wrong secret", {
      hmacSource: queryHmac ? "query" : payload.hmac ? "body" : "missing",
    });
    return c.json({ error: "Invalid signature" }, 401);
  }

  // verifyTransactionCallback only passes when payload.obj exists — this guard
  // narrows the type for the rest of the handler (TS18048).
  const obj = payload.obj;
  if (!obj) {
    logger.warn("[Paymob Webhook] Callback missing transaction object");
    return c.json({ error: "Missing transaction object" }, 400);
  }

  const merchantOrderId = obj.order?.merchant_order_id;
  const isSuccess = obj.success === true;
  const isRefunded = obj.is_refunded === true;
  const isVoided = obj.is_voided === true;

  if (!merchantOrderId) {
    logger.warn("[Paymob Webhook] Missing merchant_order_id");
    return c.json({ error: "Missing order ID" }, 400);
  }

  logger.info(`[Paymob Webhook] Received`, { txnId: obj.id, orderId: obj.order?.id, success: isSuccess, amount: obj.amount, merchantOrderId });

  try {
    return await db.transaction(async (tx) =>
      processWebhookInTransaction(c, tx, obj, merchantOrderId, isSuccess, isRefunded, isVoided),
    );
  } catch (err) {
    logger.error("[Paymob Webhook] Database error — triggering retry", { error: err instanceof Error ? err.message : String(err) });
    // ⚠️ Return 503 to make Paymob retry later if DB is locked/down
    return c.json({ error: "Service Unavailable", detail: "Database busy" }, 503);
  }
};

// ─── Legacy dashboard-registered callback path ─────────────────────────
//
// The Paymob dashboard has the account-level Transaction Processed /
// Response callbacks registered on /api/webhooks/paymob (set when the
// integrations were created). The mobile-wallet legacy flow relies on those
// account-level URLs, so mount the SAME HMAC-verified handler there.

// Canonical path (/api/paymob/webhook) AND the dashboard-registered legacy
// alias share the SAME handler — verified: forwarding the request between two
// mounted sub-apps silently 404s the forwarded POST, so no internal fetch here.
paymobWebhook.post("/webhook", handlePaymobWebhook);

/** POST /api/webhooks/paymob — processed callback, identical handler. */
const paymobWebhookAlias = new Hono();
paymobWebhookAlias.on("POST", ["/", "/*"], handlePaymobWebhook);

/**
 * GET /api/webhooks/paymob — the browser-side Response Callback. After a
 * (legacy) payment Paymob redirects the customer's browser here with the
 * result as query params. Never trust those params for state — look the
 * payment up by merchant_order_id and send the customer to the same
 * course page the Intention flow uses (?txn=… polls payment.verify).
 */
paymobWebhookAlias.on("GET", ["/", "/*"], async (c) => {
  // ⚠️ Bound calls: `const q = c.req.query; q(...)` detaches `this` and crashes
  // with "Cannot read properties of undefined (reading 'url')" in Hono v4.
  const merchantOrderId = c.req.query("merchant_order_id") || c.req.query("order") || "";
  const frontend = env.FRONTEND_URL.replace(/\/+$/, "");
  let destination = `${frontend}/dashboard?payment=returned`;
  if (merchantOrderId) {
    try {
      // The legacy Response Callback may carry OUR transaction id
      // (merchant_order_id) or Paymob's order id (`order`) — match either.
      const [row] = await db
        .select({ slug: courses.slug, id: courses.id })
        .from(payments)
        .innerJoin(courses, eq(courses.id, payments.courseId))
        .where(or(eq(payments.transactionId, merchantOrderId), eq(payments.paymobOrderId, merchantOrderId)))
        .limit(1);
      if (row) {
        destination = `${frontend}/courses/${row.slug ?? row.id}?txn=${encodeURIComponent(String(merchantOrderId))}`;
      }
    } catch (err) {
      logger.warn("[Paymob Webhook] GET return lookup failed", { error: String(err) });
    }
  }
  return c.redirect(destination, 302);
});

export { paymobWebhook, paymobWebhookAlias };
