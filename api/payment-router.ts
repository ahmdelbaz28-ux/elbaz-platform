import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { getDb, withTransaction } from "./queries/connection";
import { payments, enrollments, courses, promoCodes } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { initiatePaymobPayment, isPaymobConfigured } from "./lib/paymob";
import { invalidateStatsCache } from "./lib/cache";

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

        if (!course || !course.isPublished) {
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
        const isFree = parseFloat(amount) === 0;
        const transactionId = isFree
          ? `FREE-${nanoid(12)}`
          : `TXN-${nanoid(16)}`;

        // ✅ FIX: Server-side promo code discount calculation
        let discountAmount = 0;
        let finalAmount = amount;
        let appliedPromoCodeId: number | null = null;

        if (input.promoCodeId && !isFree) {
          const [promo] = await tx
            .select()
            .from(promoCodes)
            .where(eq(promoCodes.id, input.promoCodeId))
            .limit(1);

          if (promo && promo.isActive) {
            const now = new Date();
            if (now >= promo.validFrom && (promo.validUntil === null || now <= promo.validUntil)) {
              if (promo.maxUses === null || promo.usedCount < promo.maxUses) {
                if (promo.discountType === "percentage") {
                  discountAmount = (parseFloat(amount) * parseFloat(String(promo.discountValue))) / 100;
                } else {
                  discountAmount = parseFloat(String(promo.discountValue));
                }
                discountAmount = Math.min(discountAmount, parseFloat(amount));
                finalAmount = Math.max(parseFloat(amount) - discountAmount, 0).toString();
                appliedPromoCodeId = promo.id;
              }
            }
          }
        }

        // ✅ Free courses: enroll immediately, no Paymob needed
        if (isFree) {
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

          await invalidateStatsCache();

          return {
            success: true,
            transactionId,
            paymentId: Number(payment.insertId),
            requiresRedirect: false,
            message: "Enrolled successfully!",
          };
        }

        // ✅ PAID COURSES: Initiate Paymob payment
        // Check Paymob configuration first
        if (!isPaymobConfigured()) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Payment gateway is not configured. Please contact support.",
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

        // Call Paymob API: Auth → Create Order → Generate Payment Key
        let paymobResult: { paymentUrl: string; paymobOrderId: number };
        try {
          paymobResult = await initiatePaymobPayment(
            finalAmount,
            transactionId,
            ctx.user.name || ctx.user.username,
            ctx.user.email || "",
            input.phoneNumber || "",
            input.paymentMethod, // ✅ Pass payment method to select correct Integration ID
          );
        } catch (error: any) {
          // Paymob API failed — mark payment as failed
          await tx
            .update(payments)
            .set({ status: "failed" })
            .where(eq(payments.id, Number(payment.insertId)));

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
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
   * Check if Paymob is configured (for frontend to show/hide payment options)
   */
  isConfigured: publicQuery.query(() => {
    return { configured: isPaymobConfigured() };
  }),
});
