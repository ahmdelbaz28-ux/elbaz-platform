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

import { Hono } from "hono";
import { eq, sql, and } from "drizzle-orm";
import { db } from "./queries/connection.js";
import { payments, enrollments, courses } from "@db/schema";
import { verifyPaymobWebhook, type PaymobWebhookPayload } from "./lib/paymob.js";
import { invalidateCourseCache, invalidateStatsCache } from "./lib/cache.js";
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
 * Verify the webhook amount matches our recorded amount (prevent partial-payment attacks).
 * Returns null on success, or an error Response on mismatch.
 */
async function verifyWebhookAmount(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], paymentRecord: { finalAmount: string | null; amount: string }, obj: PaymobWebhookPayload["obj"], merchantOrderId: string): Promise<Response | null> {
  const expectedAmount = Number.parseFloat(String(paymentRecord.finalAmount ?? paymentRecord.amount));
  const webhookAmount = Number.parseFloat(obj.amount_cents?.toString() ?? obj.amount as string) / 100;
  const amountValid = Math.abs(webhookAmount - expectedAmount) < 0.01;
  if (amountValid) return null;

  logger.error(`[Paymob Webhook] Amount mismatch`, { expectedAmount, webhookAmount, merchantOrderId });
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
  c: any,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  obj: PaymobWebhookPayload["obj"],
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

paymobWebhook.post("/webhook", async (c) => {
  const contentType = c.req.header("content-type") ?? "";

  // Paymob sends JSON
  if (!contentType.includes("application/json")) {
    logger.warn("[Paymob Webhook] Invalid content-type", { contentType });
    return c.json({ error: "Invalid content type" }, 400);
  }

  let payload: PaymobWebhookPayload;
  try {
    payload = await c.req.json();
  } catch {
    logger.warn("[Paymob Webhook] Failed to parse JSON body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // ── Step 1: Verify HMAC signature ──
  if (!verifyPaymobWebhook(payload)) {
    logger.warn("[Paymob Webhook] HMAC verification failed — possible tampering or wrong secret");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const obj = payload.obj;
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
});

export { paymobWebhook };
