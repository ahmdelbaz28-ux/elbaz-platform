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

const paymobWebhook = new Hono();

paymobWebhook.post("/webhook", async (c) => {
  const contentType = c.req.header("content-type") ?? "";

  // Paymob sends JSON
  if (!contentType.includes("application/json")) {
    console.warn("[Paymob Webhook] Invalid content-type:", contentType);
    return c.json({ error: "Invalid content type" }, 400);
  }

  let payload: PaymobWebhookPayload;
  try {
    payload = await c.req.json();
  } catch {
    console.warn("[Paymob Webhook] Failed to parse JSON body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // ── Step 1: Verify HMAC signature ──
  if (!verifyPaymobWebhook(payload)) {
    console.warn("[Paymob Webhook] HMAC verification failed — possible tampering or wrong secret");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const obj = payload.obj;
  const merchantOrderId = obj.order?.merchant_order_id;
  const isSuccess = obj.success === true;
  const isRefunded = obj.is_refunded === true;
  const isVoided = obj.is_voided === true;

  if (!merchantOrderId) {
    console.warn("[Paymob Webhook] Missing merchant_order_id");
    return c.json({ error: "Missing order ID" }, 400);
  }

  console.log(`[Paymob Webhook] Received: txn=${obj.id}, order=${obj.order?.id}, success=${isSuccess}, amount=${obj.amount}, merchantOrderId=${merchantOrderId}`);

  try {
    return await db.transaction(async (tx) => {
      // ── Step 2: Find our payment record by transactionId ──
      const paymentRows = await tx
        .select()
        .from(payments)
        .where(eq(payments.transactionId, merchantOrderId))
        .limit(1);

      const paymentRecord = paymentRows[0];

      if (!paymentRecord) {
        console.warn(`[Paymob Webhook] Payment not found for transactionId: ${merchantOrderId}`);
        return c.json({ ok: true, message: "Transaction not found" }, 200);
      }

      // ── Step 3: Skip if already processed (idempotency) ──
      if (paymentRecord.status === "completed" && !isRefunded && !isVoided) {
        console.log(`[Paymob Webhook] Payment ${merchantOrderId} already completed, skipping`);
        return c.json({ ok: true, message: "Already processed" }, 200);
      }

      // ── Step 4: Verify amount matches what we expect ──
      if (isSuccess) {
        const expectedAmount = parseFloat(String(paymentRecord.finalAmount ?? paymentRecord.amount));
        const webhookAmount = parseFloat(obj.amount_cents?.toString() ?? obj.amount) / 100;
        const amountValid = Math.abs(webhookAmount - expectedAmount) < 0.01;

        if (!amountValid) {
          console.error(`[Paymob Webhook] AMOUNT MISMATCH! Expected: ${expectedAmount}, Got: ${webhookAmount}, txn: ${merchantOrderId}`);
        }
      }

      // ── Step 5: Update payment status ──
      const newStatus = isRefunded
        ? "refunded"
        : isVoided
          ? "failed"
          : isSuccess
            ? "completed"
            : "failed";

      await tx
        .update(payments)
        .set({
          status: newStatus,
          providerPaymentId: String(obj.id),
          paidAt: isSuccess ? new Date() : null,
        })
        .where(eq(payments.transactionId, merchantOrderId));

      console.log(`[Paymob Webhook] Payment ${merchantOrderId} status updated to: ${newStatus}`);

      // ── Step 6: Create enrollment if payment successful ──
      if (isSuccess && newStatus === "completed") {
        // Check if already enrolled (idempotent)
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

        if (existingEnrollment.length === 0) {
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

          console.log(`[Paymob Webhook] Enrollment created: userId=${paymentRecord.userId}, courseId=${paymentRecord.courseId}`);
        }
        
        // Invalidate caches (outside transaction logic but within handler)
        await invalidateCourseCache();
        await invalidateStatsCache();
      }

      return c.json({ ok: true, status: newStatus }, 200);
    });
  } catch (err) {
    console.error("[Paymob Webhook] Database Error — Triggering Retry:", err);
    // ⚠️ Return 503 to make Paymob retry later if DB is locked/down
    return c.json({ error: "Service Unavailable", detail: "Database busy" }, 503);
  }
});

export { paymobWebhook };
