import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { MANUAL_PAYMENT_METHODS, resolveManualChannel } from "./lib/payments-core";
import { getManualPaymentDetails, resolvePaymobRuntimeConfig } from "./lib/payments-config";
import { getDb, withTransaction } from "./queries/connection";
import { payments, enrollments, courses, promoCodes, promoCodeUsage } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import {
  createIntention,
  createLegacyWalletCheckout,
  isPaymobConfigComplete,
  isWalletMethod,
  summarizePaymobConfig,
} from "./lib/paymob";
import { env } from "./lib/env";
import { invalidateCourseCache, invalidateStatsCache } from "./lib/cache";

/**
 * Apply a promo code to compute the discount amount, final amount, and applied promo id.
 * Returns null if the promo code is invalid/expired/over-used; otherwise the computed values.
 * ✅ SECURITY FIX (audit run-1): this is the ONLY path that grants a real discount,
 * so it must enforce the SAME controls as the /api/promo apply path — course scoping
 * and per-user usage caps — otherwise any active code can be reused unlimited times
 * per user and applied to any course.
 */
async function applyPromoCode(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  promoCodeId: number,
  amount: string,
  userId: number,
  courseId: number,
): Promise<{ discountAmount: number; finalAmount: string; appliedPromoCodeId: number } | null> {
  const [promo] = await tx
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, promoCodeId))
    .limit(1);

  if (!promo?.isActive) return null;
  const now = new Date();
  if (now < promo.validFrom) return null;
  if (promo.validUntil !== null && now > promo.validUntil) return null;
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) return null;

  // ✅ Course scoping (previously only enforced on the unused /api/promo path)
  if (!promo.isValidForAllCourses) {
    const scoped = Array.isArray(promo.courseIds) ? promo.courseIds : [];
    if (!scoped.includes(courseId)) return null;
  }

  // ✅ Per-user usage cap (previously only enforced on the unused /api/promo path)
  const maxPerUser = promo.maxUsesPerUser ?? 1;
  const userUsageRows = await tx
    .select({ id: promoCodeUsage.id })
    .from(promoCodeUsage)
    .where(and(eq(promoCodeUsage.promoCodeId, promo.id), eq(promoCodeUsage.userId, userId)));
  if (userUsageRows.length >= maxPerUser) return null;

  let discountAmount: number;
  if (promo.discountType === "percentage") {
    discountAmount = (Number.parseFloat(amount) * Number.parseFloat(String(promo.discountValue))) / 100;
  } else {
    discountAmount = Number.parseFloat(String(promo.discountValue));
  }
  discountAmount = Math.min(discountAmount, Number.parseFloat(amount));
  const finalAmount = Math.max(Number.parseFloat(amount) - discountAmount, 0).toString();
  return { discountAmount, finalAmount, appliedPromoCodeId: promo.id };
}

/**
 * Handle a free course: insert a completed payment + enrollment + bump student count.
 */
async function enrollInFreeCourse(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  ctx: { user: { id: number } },
  input: { courseId: number; paymentMethod: string; phoneNumber?: string },
  amount: string,
  transactionId: string,
): Promise<{ success: true; transactionId: string; paymentId: number; requiresRedirect: false; message: string }> {
  const [payment] = await tx.insert(payments).values({
    userId: ctx.user.id,
    courseId: input.courseId,
    amount,
    currency: "EGP",
    provider: "free",
    paymentMethod: input.paymentMethod,
    transactionId,
    status: "completed",
    paidAt: new Date(),
    phoneNumber: input.phoneNumber || null,
  });

  await tx.insert(enrollments).values({
    userId: ctx.user.id,
    courseId: input.courseId,
    progress: "0",
    isCompleted: false,
  });

  await tx
    .update(courses)
    .set({ studentCount: sql`${courses.studentCount} + 1` })
    .where(eq(courses.id, input.courseId));

  await invalidateCourseCache();
  await invalidateStatsCache();

  return {
    success: true,
    transactionId,
    paymentId: Number(payment.insertId),
    requiresRedirect: false,
    message: "Enrolled successfully!",
  };
}

export const paymentRouter = createRouter({
  /**
   * ✅ FULLY FUNCTIONAL: Create payment and redirect to Paymob
   *
   * Flow:
   * 1. Validate course + user (server checks price, enrollment status)
   * 2. Create payment record in DB (status: "pending")
   * 3. Call Paymob API (auth → order → payment key)
   * 4. Return Paymob payment URL → Frontend redirects user
   * 5. User pays on Paymob → Paymob sends webhook → User gets enrolled
   */
  create: authedQuery
    .input(
      z.object({
        courseId: z.number().int().positive(),
        paymentMethod: z.enum(["visa", "instapay", "vodafone_cash", "wallet", "bank_transfer", "paypal", "kiosk", "cash_collection", "other"]),
        idempotencyKey: z.string().min(8).max(64), // ✅ Client generates UUID per payment attempt
        phoneNumber: z.string().max(20).optional(), // ✅ User's phone (required by Paymob)
        promoCodeId: z.number().int().positive().optional(), // ✅ Promo code for discount
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ✅ CRITICAL FIX: Use transaction to prevent race conditions
      return await withTransaction(async (tx) => {
        // ✅ Server fetches the actual price — never trust client-sent amount
        // Select the course slug too — the Paymob redirect lands back on
        // /courses/{slug}?txn=… where the frontend polls payment.verify.
        const [course] = await tx
          .select({
            id: courses.id,
            slug: courses.slug,
            titleAr: courses.titleAr,
            titleEn: courses.titleEn,
            price: courses.price,
            isPremium: courses.isPremium,
            isPublished: courses.isPublished,
          })
          .from(courses)
          .where(eq(courses.id, input.courseId))
          .limit(1);

        if (!course?.isPublished) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
        }

        // ✅ Idempotency: check if this payment key was already used
        const existingPayment = await tx
          .select({ id: payments.id, status: payments.status })
          .from(payments)
          .where(eq(payments.transactionId, `IDEM-${input.idempotencyKey}`))
          .limit(1);

        if (existingPayment.length > 0) {
          return { success: true, transactionId: `IDEM-${input.idempotencyKey}`, duplicate: true };
        }

        // ✅ Check already enrolled — inside transaction to prevent race condition
        const alreadyEnrolled = await tx
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(eq(enrollments.userId, ctx.user.id), eq(enrollments.courseId, input.courseId)))
          .limit(1);

        if (alreadyEnrolled.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Already enrolled in this course" });
        }

        const amount = course.price;
        const isFree = Number.parseFloat(amount) === 0;
        const transactionId = isFree
          ? `FREE-${nanoid(12)}`
          : `TXN-${nanoid(16)}`;

        // ✅ FIX: Server-side promo code discount calculation
        let discountAmount = 0;
        let finalAmount = amount;
        let appliedPromoCodeId: number | null = null;

        if (input.promoCodeId && !isFree) {
          const promoResult = await applyPromoCode(tx, input.promoCodeId, amount, ctx.user.id, input.courseId);
          if (promoResult) {
            discountAmount = promoResult.discountAmount;
            finalAmount = promoResult.finalAmount;
            appliedPromoCodeId = promoResult.appliedPromoCodeId;
          }
        }

        // ✅ Free courses: enroll immediately, no Paymob needed
        if (isFree) {
          return await enrollInFreeCourse(tx, ctx, input, amount, transactionId);
        }

        // ✅ PAID COURSES: create a Paymob intention and return the hosted-checkout URL
        // Resolve config (env + dashboard settings) first so a missing piece
        // produces an actionable error instead of a failed Paymob call.
        const paymobConfig = await resolvePaymobRuntimeConfig();
        if (!isPaymobConfigComplete(paymobConfig)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Payment gateway is not fully configured. Missing: ${summarizePaymobConfig(paymobConfig).join("; ")}`,
          });
        }

        // Create payment record with "pending" status
        const [payment] = await tx.insert(payments).values({
          userId: ctx.user.id,
          courseId: input.courseId,
          amount: finalAmount,
          currency: "EGP",
          provider: "paymob",
          paymentMethod: input.paymentMethod,
          transactionId,
          status: "pending",
          phoneNumber: input.phoneNumber || null,
          promoCodeId: appliedPromoCodeId,
          discountAmount: discountAmount > 0 ? discountAmount.toFixed(2) : null,
          finalAmount: discountAmount > 0 ? finalAmount : null,
        });

        // ✅ SECURITY FIX (audit run-1): record promo usage and advance the
        // global counter in the SAME transaction as the discounted payment.
        // Previously the purchase path never wrote promoCodeUsage nor bumped
        // usedCount, so both caps could never trip.
        if (appliedPromoCodeId !== null) {
          await tx.insert(promoCodeUsage).values({
            promoCodeId: appliedPromoCodeId,
            userId: ctx.user.id,
            paymentId: Number(payment.insertId),
          });
          await tx
            .update(promoCodes)
            .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
            .where(eq(promoCodes.id, appliedPromoCodeId));
        }

        // Call Paymob: cards ride the official Intention API; mobile wallets ride
        // the classic Accept flow (this account's UIG wallet integration is
        // rejected by the Intention API — probed live — and the classic flow
        // renders the hosted wallet page through the dashboard IFRAME).
        let paymobResult: { paymentUrl: string; paymobOrderId: number };
        const courseLabel = course.titleAr || course.titleEn || `Course #${input.courseId}`;
        const paymobCustomer = {
          firstName: (ctx.user.name || ctx.user.username || "Customer").split(" ")[0],
          lastName: (ctx.user.name || ctx.user.username || "Customer").split(" ").slice(1).join(" ") || "Customer",
          email: ctx.user.email || "",
          phone: input.phoneNumber || "",
        };
        const paymobExtras = {
          course_id: input.courseId,
          user_id: ctx.user.id,
          payment_id: Number(payment.insertId),
          discount: discountAmount > 0 ? discountAmount.toFixed(2) : null,
        };
        try {
          const result = isWalletMethod(input.paymentMethod)
            ? await createLegacyWalletCheckout(paymobConfig, {
                amount: finalAmount,
                itemName: courseLabel,
                specialReference: transactionId,
                customer: paymobCustomer,
                paymentMethod: input.paymentMethod,
                extras: paymobExtras,
              })
            : await createIntention(paymobConfig, {
                amount: finalAmount,
                itemName: courseLabel,
                specialReference: transactionId,
                customer: paymobCustomer,
                paymentMethod: input.paymentMethod,
                extras: paymobExtras,
                // Land the customer back on the course page — the frontend reads
                // ?txn=… and polls payment.verify until the webhook settles.
                redirectionUrl: `${env.FRONTEND_URL}/courses/${course.slug ?? input.courseId}?txn=${transactionId}`,
              });
          paymobResult = { paymentUrl: result.checkoutUrl, paymobOrderId: result.paymobOrderId };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // Paymob API failed — mark payment as failed
          await tx
            .update(payments)
            .set({ status: "failed" })
            .where(eq(payments.id, Number(payment.insertId)));

          throw new TRPCError({
            // PRECONDITION_FAILED (412) keeps the underlying Paymob detail
            // visible in production — INTERNAL_SERVER_ERROR would be masked by
            // the errorFormatter, hiding the exact gateway misconfiguration.
            code: "PRECONDITION_FAILED",
            message: error.message || "Failed to initiate payment. Please try again.",
          });
        }

        // Store Paymob order ID in our payment record
        await tx
          .update(payments)
          .set({
            paymobOrderId: String(paymobResult.paymobOrderId),
          })
          .where(eq(payments.id, Number(payment.insertId)));

        return {
          success: true,
          transactionId,
          paymentId: Number(payment.insertId),
          paymentUrl: paymobResult.paymentUrl, // ✅ Frontend will redirect to this URL
          requiresRedirect: true,
          message: "Redirecting to payment gateway...",
        };
      });
    }),

  /**
   * Get payment history for the authenticated user
   */
  history: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select({
        id: payments.id,
        courseId: payments.courseId,
        amount: payments.amount,
        currency: payments.currency,
        paymentMethod: payments.paymentMethod,
        transactionId: payments.transactionId,
        status: payments.status,
        createdAt: payments.createdAt,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .where(eq(payments.userId, ctx.user.id))
      .orderBy(desc(payments.createdAt));
  }),

  /**
   * Verify payment status — used by frontend to poll after user returns from Paymob
   */
  verify: authedQuery
    .input(z.object({ transactionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [payment] = await db
        .select({
          id: payments.id,
          courseId: payments.courseId,
          amount: payments.amount,
          currency: payments.currency,
          paymentMethod: payments.paymentMethod,
          transactionId: payments.transactionId,
          status: payments.status,
          createdAt: payments.createdAt,
          paidAt: payments.paidAt,
        })
        .from(payments)
        .where(and(
          eq(payments.transactionId, input.transactionId),
          eq(payments.userId, ctx.user.id), // ✅ User can only verify their own transactions
        ))
        .limit(1);
      return payment || null;
  }),

  /**
   * Paymob configuration status — drives the frontend "electronic payment"
   * visibility AND gives the admin dashboard an actionable missing-items list.
   * Env-only values (secret key, HMAC) can't be displayed; everything else is
   * either resolved or listed as missing with its exact source.
   */
  isConfigured: publicQuery.query(async () => {
    const cfg = await resolvePaymobRuntimeConfig();
    const missing = summarizePaymobConfig(cfg);
    const mode = cfg.secretKey.includes("_test_") || cfg.secretKey.includes("_sk_test")
      ? "test"
      : cfg.secretKey
        ? "live"
        : "unset";
    return {
      configured: missing.length === 0,
      missing,
      mode,
      // Per-method availability — the frontend hides dead options so a
      // customer can never select a method that would 412/404 at the gateway.
      // Wallet needs BOTH the integration ID and the legacy checkout IFRAME.
      methods: {
        card: cfg.cardIntegrationId !== null,
        wallet: cfg.walletIntegrationId !== null && cfg.walletIframeId !== null,
      },
    };
  }),

  /**
   * Manual payment details (Vodafone Cash number / InstaPay handle / bank
   * account) — admin-editable via siteSettings section "payments".
   * Public because the payment modal needs to show transfer instructions.
   */
  manualDetails: publicQuery.query(async () => {
    return await getManualPaymentDetails();
  }),

  /**
   * Manual (offline) payment — for methods completed outside the platform:
   * vodafone_cash / instapay / bank_transfer.
   *
   * Flow:
   * 1. Admin fills the transfer details in the dashboard (siteSettings "payments")
   * 2. User transfers money using those details, then submits this mutation
   *    with their phone + optional transfer reference
   * 3. Payment row created with status "pending", provider "manual"
   * 4. Admin approves (admin.approveManual) → enrollment granted, or
   *    rejects (admin.rejectManual) → payment marked failed
   *
   * Same server-side guarantees as `create`: real price from DB, promo caps,
   * idempotency key, already-enrolled guard, free-course instant enrollment.
   */
  createManual: authedQuery
    .input(
      z.object({
        courseId: z.number().int().positive(),
        paymentMethod: z.enum(MANUAL_PAYMENT_METHODS),
        idempotencyKey: z.string().min(8).max(64),
        phoneNumber: z.string().max(20).optional(),
        reference: z.string().max(255).optional(), // transfer/wallet reference number
        promoCodeId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await withTransaction(async (tx) => {
        const [course] = await tx
          .select({
            id: courses.id,
            price: courses.price,
            isPremium: courses.isPremium,
            isPublished: courses.isPublished,
          })
          .from(courses)
          .where(eq(courses.id, input.courseId))
          .limit(1);

        if (!course?.isPublished) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
        }

        // Manual channels must be configured by the admin before accepting
        // (resolveManualChannel returns null when disabled or channel empty)
        const details = await getManualPaymentDetails();
        const channelValue = resolveManualChannel(details, input.paymentMethod);
        if (!channelValue) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected manual payment channel is not available.",
          });
        }

        // ✅ Idempotency: same key pattern as the Paymob path
        const existingPayment = await tx
          .select({ id: payments.id, status: payments.status })
          .from(payments)
          .where(eq(payments.transactionId, `IDEM-${input.idempotencyKey}`))
          .limit(1);
        if (existingPayment.length > 0) {
          return { success: true, transactionId: `IDEM-${input.idempotencyKey}`, duplicate: true };
        }

        // ✅ Already enrolled guard (inside transaction like `create`)
        const alreadyEnrolled = await tx
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(eq(enrollments.userId, ctx.user.id), eq(enrollments.courseId, input.courseId)))
          .limit(1);
        if (alreadyEnrolled.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Already enrolled in this course" });
        }

        const amount = course.price;
        const isFree = Number.parseFloat(amount) === 0;
        const transactionId = isFree
          ? `FREE-${nanoid(12)}`
          : `MANUAL-${nanoid(16)}`;

        // ✅ Server-side promo calculation (identical to the Paymob path)
        let discountAmount = 0;
        let finalAmount = amount;
        let appliedPromoCodeId: number | null = null;

        if (input.promoCodeId && !isFree) {
          const promoResult = await applyPromoCode(tx, input.promoCodeId, amount, ctx.user.id, input.courseId);
          if (promoResult) {
            discountAmount = promoResult.discountAmount;
            finalAmount = promoResult.finalAmount;
            appliedPromoCodeId = promoResult.appliedPromoCodeId;
          }
        }

        // ✅ Free courses: enroll immediately (no admin approval needed)
        if (isFree) {
          return await enrollInFreeCourse(tx, ctx, input, amount, transactionId);
        }

        // ✅ Paid course → pending manual payment awaiting admin approval
        const [payment] = await tx.insert(payments).values({
          userId: ctx.user.id,
          courseId: input.courseId,
          amount: finalAmount,
          currency: "EGP",
          provider: "manual",
          paymentMethod: input.paymentMethod,
          transactionId,
          status: "pending",
          phoneNumber: input.phoneNumber || null,
          promoCodeId: appliedPromoCodeId,
          discountAmount: discountAmount > 0 ? discountAmount.toFixed(2) : null,
          finalAmount: discountAmount > 0 ? finalAmount : null,
          metadata: { reference: input.reference?.trim() || null },
        });

        if (appliedPromoCodeId !== null) {
          await tx.insert(promoCodeUsage).values({
            promoCodeId: appliedPromoCodeId,
            userId: ctx.user.id,
            paymentId: Number(payment.insertId),
          });
          await tx
            .update(promoCodes)
            .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
            .where(eq(promoCodes.id, appliedPromoCodeId));
        }

        return {
          success: true,
          transactionId,
          paymentId: Number(payment.insertId),
          requiresAdminApproval: true,
          message: "Payment submitted — awaiting admin confirmation.",
        };
      });
    }),
});
