/**
 * Active-enrollment authorization predicate (audit run-1).
 *
 * SECURITY FIX: enrollment gates previously tested only row EXISTENCE for
 * (userId, courseId). The enrollments table carries lifecycle fields
 * (status default 'active', expiresAt) that no reader consulted, and the
 * Paymob refund webhook flipped payments.status without touching the
 * enrollment — so a refunded student kept minting presigned URLs for every
 * premium lesson forever. Every enrollment-gated procedure must use this
 * predicate: status = 'active' AND (expiresAt IS NULL OR expiresAt > now).
 */

import { enrollments } from "@db/schema";
import { and, eq, gt, isNull, or } from "drizzle-orm";

export function activeEnrollmentWhere(userId: number, courseId: number) {
  return and(
    eq(enrollments.userId, userId),
    eq(enrollments.courseId, courseId),
    eq(enrollments.status, "active"),
    or(isNull(enrollments.expiresAt), gt(enrollments.expiresAt, new Date())),
  );
}
